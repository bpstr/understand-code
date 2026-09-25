"""Adaptive native investigations with independent discovery and durable follow-ups."""
import json
from pathlib import Path

from ..graphify import context
from ..ontology import digest, stable_id
from ..change_scope import resolve

ROLES = {
    "repository-cartographer": (None, "Map applications, packages and module boundaries using manifests and source."),
    "entrypoint-mapper": ("entrypoint", "Locate executable entrypoints including hidden webhooks and workers."),
    "domain-discoverer": (None, "Identify product capabilities across modules; distinguish names from proved behavior."),
    "ui-mapper": ("ui_surface", "Enumerate independent surfaces and primary-surface roles; trace composition, wrappers and observable consumers, not just named examples."),
    "runtime-tracer": ("entrypoint", "Trace representative success, failure and conditional execution paths end to end."),
    "data-mapper": ("data_entity", "Trace entity ownership, persistence, transformation and deletion."),
    "settings-tracer": ("setting", "Trace writer → validation → persistence → cache/projection → reader → observable consumers; record every missing link."),
    "integration-mapper": ("external_system", "Locate external boundaries, configuration and failure handling."),
    "async-mapper": ("event", "Trace producers, queues, consumers, retries and idempotency boundaries."),
    "permission-mapper": ("permission", "Connect authorization checks to entrypoints and conditional UI; distinguish server enforcement."),
    "reuse-mapper": ("ui_surface", "Find actual shared-component consumers AND independent implementations bypassing reuse; account for separate occurrences and variants."),
    "test-analyst": ("test_behavior", "Read tests for asserted behaviors and untested branches; never execute tests or claim they pass."),
    "history-analyst": (None, "Inspect bounded Git history for hotspots/co-change; association is not runtime causation or intent."),
    "deployment-mapper": (None, "Map declared processes and deployment configuration; separate declared from observed operation."),
    "instruction-auditor": (None, "Resolve applicable instruction hierarchy, stale guidance, duplication and actual conflicts; recommend only."),
    "feature-synthesizer": (None, "Reconcile stable concepts, search terms, surface roles, occurrence membership and effect paths with source evidence."),
    "relationship-verifier": (None, "Challenge primary-surface designation, concept membership, unsupported links and falsely complete inventories against current source."),
    "spec-curator": (None, "Check occurrence dispositions, mandatory anchors, outstanding discovery obligations and implementation handoff coverage, not only navigation."),
}

MODES = {"quick": (6, 24), "standard": (18, 40), "deep": (36, 60)}


def task_for(role: str, selected: list[str], snapshot: str, inventory: dict, graph: dict,
             max_paths: int, suffix: str = "") -> dict:
    task_id = stable_id("task", role + snapshot + "|".join(selected) + suffix)
    return {"id": task_id, "role": role, "objective": ROLES[role][1], "snapshot": snapshot,
            "phase": ("synthesis" if role == "feature-synthesizer" else "verification" if role == "relationship-verifier"
                      else "curation" if role == "spec-curator" else "reconnaissance" if role in
                      ("repository-cartographer", "entrypoint-mapper", "domain-discoverer", "instruction-auditor") else "tracing"),
            "paths": selected, "status": "pending", "graph_context": context(graph, selected),
            "candidate_evidence": [c for c in inventory["candidates"] if c["path"] in selected][:120],
            "limits": {"max_paths": max_paths, "max_findings": 500, "execution": "read-only; no repository code execution"},
            "contract": {"schema_version": 1, "task_id": task_id, "snapshot": snapshot,
                         "entities": [], "relations": [], "evidence": [], "gaps": [], "followups": [],
                         "review": {"status": "unreviewed"}},
            "completion": "Return source-bound findings or explicit gaps. Request follow-up scope when paths are insufficient. Prompt examples never define exhaustive scope. Never fill unknown links with plausible claims."}


def plan(inventory: dict, graph: dict, mode: str, focus: str | None = None,
         impact: dict | None = None, entities: list[dict] | None = None,
         relations: list[dict] | None = None, evidence: list[dict] | None = None,
         scope_options: dict | None = None) -> dict:
    max_tasks, max_paths = MODES[mode]
    snapshot = digest(json.dumps({p: v["sha256"] for p, v in inventory["files"].items()}, sort_keys=True))
    paths = sorted(inventory["files"])
    resolution = None
    if focus:
        resolution = resolve(focus, inventory, entities or [], relations or [], evidence or [], **(scope_options or {}))
        paths = resolution["paths"]
    elif impact is not None:
        refs = {ref for e in (entities or []) + (relations or [])
                if e.get("id") in impact["affected_entities"] or e.get("source") in impact["affected_entities"]
                or e.get("target") in impact["affected_entities"] for ref in e["evidence"]}
        affected_paths = {e["path"] for e in evidence or [] if e["id"] in refs} | set(impact["changed_files"])
        paths = [p for p in paths if p in affected_paths]
    category_paths = {}
    for candidate in inventory["candidates"]:
        category_paths.setdefault(candidate["kind"], set()).add(candidate["path"])
    roles = list(ROLES)
    if mode == "quick":
        # Reserve capacity, but keep unscheduled obligations explicit rather than waive them.
        priority = ["repository-cartographer", "ui-mapper", "reuse-mapper", "feature-synthesizer", "relationship-verifier", "spec-curator"]
        if scope_options and scope_options.get("intent") == "settings_change":
            priority[1] = "settings-tracer"
        roles = priority + [r for r in roles if r not in priority]
    if mode != "deep":
        roles = [r for r in roles if r != "history-analyst"]
    tasks, deferred, queue = [], [], []
    for role in roles:
        category, _ = ROLES[role]
        selected = [p for p in paths if p in category_paths.get(category, set())] if category else paths[:]
        if resolution and role in ("ui-mapper", "reuse-mapper", "settings-tracer"):
            selected = paths[:]  # language-neutral fallback; heuristics cannot hide a page
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
            queue.append((offset, role, selected[offset:offset + max_paths]))
    queue.sort(key=lambda item: (item[0], roles.index(item[1])))
    for _, role, selected in queue:
        task = task_for(role, selected, snapshot, inventory, graph, max_paths)
        if len(tasks) < max_tasks:
            tasks.append(task)
        else:
            deferred.append({"role": role, "paths": selected, "reason": "task budget"})
    result = {"snapshot": snapshot, "mode": mode, "focus": focus, "tasks": tasks, "deferred": deferred,
              "max_tasks": max_tasks, "max_paths_per_task": max_paths, "followups": []}
    if resolution:
        result["scope_resolution"] = resolution
    return result


def schedule_followups(task_plan: dict, requests: list[dict], inventory: dict, graph: dict) -> None:
    known = {r["id"]: r for r in task_plan.setdefault("followups", [])}
    for request in requests:
        previous = known.get(request["id"])
        if previous and any(previous[k] != request[k] for k in ("role", "paths", "question")):
            raise ValueError("Conflicting follow-up request identity")
        known[request["id"]] = {**request, "status": "pending"}
    current = {t["id"]: t for t in task_plan["tasks"]}
    for request in known.values():
        children = []
        size = task_plan["max_paths_per_task"]
        available = [p for p in request["paths"] if p in inventory["files"]]
        for offset in range(0, len(available), size):
            task = task_for(request["role"], available[offset:offset + size], task_plan["snapshot"], inventory,
                            graph, size, request["id"] + request["question"])
            task["objective"] += " Follow-up: " + request["question"]
            children.append(task["id"])
            if task["id"] not in current and len(task_plan["tasks"]) < task_plan["max_tasks"]:
                task_plan["tasks"].append(task)
                current[task["id"]] = task
        request["status"] = "accounted" if (len(available) == len(request["paths"]) and children
                       and all(current.get(key, {}).get("status") == "accepted" for key in children)) else "pending"
        request["tasks"] = children
    task_plan["followups"] = list(known.values())
