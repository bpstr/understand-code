"""Adaptive role routing and bounded native investigation tasks."""
import json
from pathlib import Path

from ..ontology import digest, stable_id

ROLES = {
    "repository-cartographer": (None, "Map applications, packages and module boundaries using manifests and source."),
    "entrypoint-mapper": ("entrypoint", "Locate executable entrypoints including hidden webhooks and workers."),
    "domain-discoverer": (None, "Identify product capabilities across modules; distinguish names from proved behavior."),
    "ui-mapper": ("ui_surface", "Trace UI actions, state and API consumers; identify shared UI components."),
    "runtime-tracer": ("entrypoint", "Trace representative success, failure and conditional execution paths end to end."),
    "data-mapper": ("data_entity", "Trace entity ownership, persistence, transformation and deletion."),
    "settings-tracer": ("setting", "Trace writer → validation → persistence → cache → reader → observable consumers; record every missing link."),
    "integration-mapper": ("external_system", "Locate external boundaries, configuration and failure handling."),
    "async-mapper": ("event", "Trace producers, queues, consumers, retries and idempotency boundaries."),
    "permission-mapper": ("permission", "Connect authorization checks to entrypoints and conditional UI; distinguish server enforcement."),
    "reuse-mapper": ("ui_surface", "Find shared components and concrete consumers without inferring reuse from names."),
    "test-analyst": ("test_behavior", "Read tests for asserted behaviors and untested branches; never execute tests or claim they pass."),
    "history-analyst": (None, "Inspect bounded Git history for hotspots/co-change; association is not runtime causation or intent."),
    "deployment-mapper": (None, "Map declared processes and deployment configuration; separate declared from observed operation."),
    "instruction-auditor": (None, "Resolve applicable instruction hierarchy, stale guidance, duplication and actual conflicts; recommend only."),
    "feature-synthesizer": (None, "Reconcile domain findings into stable feature IDs, important flows and change maps."),
    "relationship-verifier": (None, "Challenge every behavioral and causal claim against current source, especially settings propagation."),
    "spec-curator": (None, "Check navigation, coverage, uncertainty and task/review handoffs against accepted findings."),
}
MODES = {"quick": (6, 24), "standard": (18, 40), "deep": (36, 60)}


def plan(inventory: dict, mode: str, focus: str | None = None,
         impact: dict | None = None, entities: list[dict] | None = None,
         relations: list[dict] | None = None, evidence: list[dict] | None = None) -> dict:
    max_tasks, max_paths = MODES[mode]
    snapshot = digest(json.dumps({p: v["sha256"] for p, v in inventory["files"].items()}, sort_keys=True))
    paths = sorted(inventory["files"])
    if focus:
        terms = focus.lower().split()
        matched = {e["id"] for e in entities or [] if any(t in (e["title"] + " " + e["id"] + " " + e["summary"] + " " + " ".join(e.get("aliases", []))).lower() for t in terms)}
        connected = matched | {r[k] for r in relations or [] if r["source"] in matched or r["target"] in matched for k in ("source", "target")}
        refs = {ref for e in entities or [] if e["id"] in connected for ref in e["evidence"]}
        evidence_paths = {e["path"] for e in evidence or [] if e["id"] in refs}
        paths = [p for p in paths if p in evidence_paths or any(t in p.lower() for t in terms)]
        if not paths:
            raise ValueError("Focus did not resolve to known concepts or paths. Inspect status/inventory and use a feature ID or path term.")
    elif impact is not None:
        refs = {ref for e in entities or [] if e["id"] in impact["affected_entities"] for ref in e["evidence"]}
        affected_paths = {e["path"] for e in evidence or [] if e["id"] in refs} | set(impact["changed_files"])
        paths = [p for p in paths if p in affected_paths]
    candidates = inventory["candidates"]
    category_paths = {}
    for candidate in candidates:
        category_paths.setdefault(candidate["kind"], set()).add(candidate["path"])
    roles = list(ROLES)
    if mode == "quick":
        roles = ["repository-cartographer", "entrypoint-mapper", "domain-discoverer",
                 "instruction-auditor", "feature-synthesizer", "relationship-verifier"]
    if mode != "deep":
        roles = [r for r in roles if r != "history-analyst"]
    tasks, deferred = [], []
    queue = []
    for role in roles:
        category, objective = ROLES[role]
        selected = [p for p in paths if p in category_paths.get(category, set())] if category else paths[:]
        if role == "instruction-auditor":
            selected = [p for p in paths if inventory["files"][p]["instruction"] or p.endswith("README.md")]
        if role == "deployment-mapper":
            selected = [p for p in paths if inventory["files"][p]["manifest"] or ".github/" in p or "deploy" in p.lower()]
        if not selected:
            continue
        selected_set = set(selected)
        parents = {str(Path(s).parent) for s in selected}
        adjacent = [p for p in paths if p not in selected_set and str(Path(p).parent) in parents]
        selected += adjacent[:max(0, max_paths - len(selected))]
        for offset in range(0, len(selected), max_paths):
            queue.append((offset, role, objective, selected[offset:offset + max_paths]))
    queue.sort(key=lambda item: (item[0], roles.index(item[1])))
    for _, role, objective, selected in queue:
        task_id = stable_id("task", role + snapshot + "|".join(selected))
        task = {"id": task_id, "role": role, "objective": objective, "snapshot": snapshot,
                "phase": ("synthesis" if role == "feature-synthesizer" else "verification" if role == "relationship-verifier"
                          else "curation" if role == "spec-curator" else "reconnaissance" if role in
                          ("repository-cartographer", "entrypoint-mapper", "domain-discoverer", "instruction-auditor") else "tracing"),
                "paths": selected, "status": "pending",
                "candidate_evidence": [c for c in candidates if c["path"] in selected][:120],
                "limits": {"max_paths": max_paths, "max_findings": 500, "execution": "read-only; no repository code execution"},
                "contract": {"schema_version": 1, "task_id": task_id, "snapshot": snapshot,
                             "entities": [], "relations": [], "evidence": [], "gaps": [],
                             "review": {"status": "unreviewed"}},
                "completion": "Return source-bound findings or explicit gaps. Use repository-configured code-intelligence tools only as retrieval aids when applicable instructions describe them. Request follow-up scope when paths are insufficient. Never fill unknown links with plausible claims."}
        if len(tasks) < max_tasks:
            tasks.append(task)
        else:
            deferred.append({"role": role, "paths": selected, "reason": "task budget"})
    return {"snapshot": snapshot, "mode": mode, "focus": focus, "tasks": tasks, "deferred": deferred,
            "max_tasks": max_tasks, "max_paths_per_task": max_paths}
