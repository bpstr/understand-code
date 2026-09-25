"""Deterministic reconstruction lifecycle. No provider subprocesses or network."""
from contextlib import contextmanager
import json
import os
from pathlib import Path

from . import __version__, graphify
from .audit import audit
from .discovery import inventory
from .evidence import safe_path, verify as check_evidence
from .findings import validate, reconcile
from .git import changes
from .impact import analyze
from .ontology import digest, stable_id
from .providers import render as prompt
from .spec.planner import plan, schedule_followups
from . import coverage
from .spec.writer import write, render, json_text, jsonl


def load(root: Path, output: str) -> dict | None:
    target = safe_path(root, output)
    marker = target / "_meta/manifest.json"
    if not marker.exists():
        return None
    # Reject symlinked metadata before reading potentially unrelated files.
    for path in ("manifest.json", "inventory.json", "plan.json", "entities.jsonl", "relations.jsonl", "evidence.jsonl", "gaps.json", "audit.json"):
        safe_path(root, f"{output}/_meta/{path}")
    def read(name):
        return json.loads((target / "_meta" / name).read_text())
    def lines(name):
        return [json.loads(line) for line in (target / "_meta" / name).read_text().splitlines() if line]
    manifest = read("manifest.json")
    if manifest.get("schema_version") != 1 or manifest.get("producer") != "understand-code":
        raise ValueError("Unsupported or unowned Codebase Spec manifest")
    # Metadata paths from a manifest are untrusted.
    for path in manifest.get("managed", {}):
        safe_path(root, output + "/" + path)
    for path, expected in manifest.get("metadata_hashes", {}).items():
        file = safe_path(root, output + "/" + path)
        if digest(file.read_text()) != expected:
            raise ValueError(f"Metadata integrity check failed: {path}; restore the original metadata before continuing")
    for optional in ("_meta/change-scopes/index.json", "_meta/knowledge-imports.json", "_meta/retired-claims.json"):
        file = safe_path(root, output + "/" + optional)
        if file.exists() and optional not in manifest.get("metadata_hashes", {}):
            raise ValueError("Untracked optional metadata")
    scope_index = target / "_meta/change-scopes/index.json"
    scope_ids = read("change-scopes/index.json") if scope_index.exists() else []
    if not isinstance(scope_ids, list) or len(scope_ids) > 1000:
        raise ValueError("Invalid change-scope index")
    from .ontology import check_id
    scopes = {}
    for key in scope_ids:
        if not check_id(key):
            raise ValueError("Invalid change-scope ID")
        path = f"_meta/change-scopes/{key}/scope.json"
        if path not in manifest.get("metadata_hashes", {}):
            raise ValueError("Untracked change-scope metadata")
        safe_path(root, output + "/" + path)
        scopes[key] = read(f"change-scopes/{key}/scope.json")
        if scopes[key].get("schema_version") != 1 or scopes[key].get("id") != key:
            raise ValueError("Unsupported change-scope state")
    import_index = target / "_meta/knowledge-imports.json"
    imports = read("knowledge-imports.json") if import_index.exists() else []
    retired = read("retired-claims.json") if (target / "_meta/retired-claims.json").exists() else []
    return {"manifest": manifest, "change_scopes": scopes, "knowledge_imports": imports, "retired_claims": retired,
            "inventory": read("inventory.json"), "plan": read("plan.json"),
            "entities": lines("entities.jsonl"), "relations": lines("relations.jsonl"),
            "evidence": lines("evidence.jsonl"), "gaps": read("gaps.json"), "audit": read("audit.json")}


@contextmanager
def lock(root: Path, output: str):
    # Keep the lock outside the scan and output tree; no application files are written.
    import tempfile
    lock_path = Path(tempfile.gettempdir()) / ("understand-code-" + digest(str(root / output)) + ".lock")
    try:
        descriptor = os.open(lock_path, os.O_CREAT | os.O_EXCL | os.O_WRONLY, 0o600)
    except FileExistsError:
        raise ValueError(f"Another writer holds {lock_path}. If interrupted, inspect its PID before removing this stale lock.")
    try:
        os.write(descriptor, str(os.getpid()).encode())
        os.close(descriptor)
        yield
    finally:
        lock_path.unlink(missing_ok=True)


def baseline(inv: dict) -> list[dict]:
    groups = {}
    for path, info in inv["files"].items():
        if info["language"] and info.get("evidence"):
            parent = str(Path(path).parent)
            groups.setdefault(parent, []).append(info["evidence"])
    return [{"id": stable_id("module", parent), "kind": "module", "title": parent,
             "summary": f"Source directory {parent}; module responsibility and business behavior remain unverified.",
             "confidence": "EXTRACTED", "evidence": refs,
             "review": {"status": "source-reviewed", "reviewer": "deterministic inventory",
                        "method": "Directory membership only; no behavioral assertion"}}
            for parent, refs in sorted(groups.items())]


def run(root: Path, output: str, command: str, mode: str = "standard", provider: str = "codex",
        focus: str | None = None, base: str | None = None, finding_paths: list[Path] | None = None,
        graph_path: str = "graphify-out/graph.json", max_files: int = 2000, max_bytes: int = 5_000_000,
        change_request: dict | None = None, change_scope: str | None = None,
        ledger_paths: list[Path] | None = None, knowledge_path: Path | None = None, amend_standard: bool = False) -> dict:
    root = root.resolve()
    target = safe_path(root, output)
    if target == root or not output.strip() or Path(output).parts[0] in ("src", "tests", "skills", ".git", ".github"):
        raise ValueError("Choose a dedicated documentation directory, not source, repository root, or tool configuration")
    with lock(root, output):
        old = load(root, output)
        selected_scope = old.get("change_scopes", {}).get(change_scope) if old and change_scope else None
        if change_scope and selected_scope is None:
            raise ValueError("Unknown change scope")
        if ledger_paths and not change_scope:
            raise ValueError("Change-review ingestion requires --change-scope")
        if selected_scope and command == "scope":
            if change_request and change_request != selected_scope["request"] and not amend_standard:
                raise ValueError("Scope resume cannot silently change its accepted request or standard")
            change_request = change_request or selected_scope["request"]
        if command == "scope" and not change_request:
            raise ValueError("Scope creation requires a change request")
        if command == "scope":
            focus = change_request["topic"]
        if command in ("update", "focus", "apply", "import-knowledge") and old is None:
            raise ValueError("No Codebase Spec exists. Run bootstrap first.")
        inv = inventory(root, output, max_files, max_bytes)
        graph = graphify.load(root, graph_path)
        entities = old["entities"] if old else baseline(inv)
        relations = old["relations"] if old else []
        previous_refs = old["evidence"] if old else []
        impact = analyze(old["inventory"], inv, entities, relations, previous_refs,
                         changes(root, base) if base else None) if old else None
        # Reverify source-dependent concepts. Never rebind old claims to new source hashes.
        stale_refs = {r["id"] for r in previous_refs if check_evidence(root, r, output)}
        affected = set(impact["affected_entities"]) if impact else set()
        entities = [{**e, "confidence": "UNKNOWN", "stale": True} if e["id"] in affected or stale_refs.intersection(e["evidence"]) else e for e in entities]
        relations = [{**r, "confidence": "UNKNOWN", "stale": True} if r["source"] in affected or r["target"] in affected or stale_refs.intersection(r["evidence"]) else r for r in relations]
        if command == "apply":
            task_plan = old["plan"]
            current_snapshot = digest(json.dumps({p: v["sha256"] for p, v in inv["files"].items()}, sort_keys=True))
            if current_snapshot != task_plan["snapshot"]:
                raise ValueError("Source changed during investigation. Run update and investigate the refreshed tasks.")
        elif command == "update" and old and not impact["changed_files"]:
            # A no-op refresh must not erase incomplete discovery coverage.
            task_plan = old["plan"]
        else:
            task_plan = plan(inv, graph, mode, focus, impact if command == "update" else None,
                             entities, relations, previous_refs,
                             coverage.scope_options(change_request) if change_request else None)
            if old:
                accepted = {t["id"] for t in old["plan"]["tasks"] if t["status"] == "accepted"}
                for task in task_plan["tasks"]:
                    if task["id"] in accepted:
                        task["status"] = "accepted"
                        task["review"] = next(t.get("review", {"status": "unreviewed"}) for t in old["plan"]["tasks"] if t["id"] == task["id"])
        # Preserve unfinished scopes across focused/incremental investigations. They remain
        # explicit backlog rather than disappearing when the current plan becomes narrower.
        if old and command in ("focus", "update", "scope", "import-knowledge") and task_plan is not old["plan"]:
            active = {(t["role"], tuple(t["paths"])) for t in task_plan["tasks"]}
            for task in old["plan"]["tasks"]:
                if task["status"] != "accepted" and (task["role"], tuple(task["paths"])) not in active:
                    task_plan["deferred"].append({"role": task["role"], "paths": task["paths"], "reason": "unfinished prior scope; rerun bootstrap or focus to schedule"})
            task_plan["deferred"].extend(old["plan"]["deferred"])
            # Do not retain deferrals whose exact role/path obligation is now scheduled.
            task_plan["deferred"] = [item for item in task_plan["deferred"]
                                      if (item["role"], tuple(item["paths"])) not in active]
            task_plan["deferred"] = list({json.dumps(item, sort_keys=True): item for item in task_plan["deferred"]}.values())
            task_plan["followups"] = old["plan"].get("followups", [])
        # Maintainer notes carry higher editorial authority, but never become source proof.
        if old:
            from .spec.writer import END
            notes = []
            for path in old["manifest"]["managed"]:
                text = safe_path(root, output + "/" + path).read_text()
                if END in text:
                    note = text.split(END, 1)[1].split("<!-- understand-code:human -->", 1)[-1].strip()
                    if note:
                        notes.append({"path": output + "/" + path, "note": note[:4000], "authority": "maintainer assertion; verify source separately"})
            for task in task_plan["tasks"]:
                task["maintainer_notes"] = notes[:30]
        bundles = []
        tasks = {t["id"]: t for t in task_plan["tasks"]}
        known = entities[:]
        for file in finding_paths or []:
            if file.stat().st_size > 5_000_000:
                raise ValueError("Findings file exceeds 5 MB")
            bundle = json.loads(file.read_text())
            task = tasks.get(bundle.get("task_id"))
            if not task:
                raise ValueError("Findings reference an unknown task; use the current plan")
            validate(bundle, root, output, task, known)
            bundles.append(bundle)
            known.extend(bundle["entities"])
        entities, relations, new_gaps = reconcile(entities, relations, bundles)
        retired = old.get("retired_claims", [])[:] if old else []
        retirements = [item for bundle in bundles for item in bundle.get("retirements", [])]
        retiring = {item["id"] for item in retirements}
        if len(retiring) != len(retirements):
            raise ValueError("Duplicate retirement ID")
        claims = {claim["id"]: claim for claim in entities + relations}
        if retiring - claims.keys():
            raise ValueError("Retirement references an unknown claim")
        for relation in relations:
            if retiring.intersection((relation["source"], relation["target"])) and relation["id"] not in retiring:
                raise ValueError("Retire dependent relations explicitly; do not leave dangling endpoints")
        for entity in entities:
            occurrence = entity.get("occurrence", {})
            if retiring.intersection((occurrence.get("concept"), occurrence.get("surface"))) and entity["id"] not in retiring:
                raise ValueError("Retire dependent occurrences explicitly")
        all_refs = {ref["id"]: ref for ref in previous_refs + inv["evidence"] + [r for b in bundles for r in b["evidence"]]}
        for bundle in bundles:
            for retirement in bundle.get("retirements", []):
                claim = claims[retirement["id"]]
                retired.append({"claim": claim, "retirement": retirement, "review": bundle["review"],
                                "snapshot": task_plan["snapshot"],
                                "evidence": [all_refs[key] for key in claim["evidence"] + retirement["evidence"] if key in all_refs]})
        entities = [e for e in entities if e["id"] not in retiring]
        relations = [r for r in relations if r["id"] not in retiring]
        for bundle in bundles:
            tasks[bundle["task_id"]]["status"] = "accepted"
            tasks[bundle["task_id"]]["review"] = bundle["review"]
        schedule_followups(task_plan, [r for b in bundles for r in b.get("followups", [])], inv, graph)
        refs = {r["id"]: r for r in previous_refs + inv["evidence"] + [r for b in bundles for r in b["evidence"]]}
        for task in task_plan["tasks"]:
            scoped_refs = {key for key, ref in refs.items() if ref["path"] in task["paths"]}
            concepts = [e for e in entities if scoped_refs.intersection(e["evidence"])]
            ids = {e["id"] for e in concepts}
            task["current_model"] = {"entities": concepts[:100],
                "relations": [r for r in relations if r["source"] in ids or r["target"] in ids][:200],
                "note": "Existing interpretations to reconcile and challenge, not authority over current source."}
        # Retain exactly the evidence referenced by active claims and inventory, not abandoned stale citations.
        alternatives = [a for gap in (old["gaps"] if old else []) + new_gaps for a in gap.get("alternatives", [])]
        used_refs = {r for e in entities + relations + alternatives for r in e["evidence"]} | {r["id"] for r in inv["evidence"]}
        refs = {key: value for key, value in refs.items() if key in used_refs}
        gaps = {g["id"]: g for g in (old["gaps"] if old else []) + new_gaps}
        for bundle in bundles:
            for resolution in bundle.get("resolved_gaps", []):
                if resolution["id"] not in gaps:
                    raise ValueError("Gap closure references an unknown gap")
                gaps.pop(resolution["id"])
            if bundle["review"]["status"] == "source-reviewed":
                for claim in bundle["entities"] + bundle["relations"]:
                    if claim.get("supersedes") == claim["id"]:
                        gaps.pop(stable_id("knowledge_gap", claim["id"] + "conflict"), None)
        if graph["status"] == "unavailable":
            gaps["knowledge_gap.graphify"] = {"id": "knowledge_gap.graphify", "question": "Structural graph unavailable.",
                                               "next_step": "Use existing MCP graph tools or provide a current Graphify node-link export; verify source before accepting graph hints."}
        else:
            gaps.pop("knowledge_gap.graphify", None)
        state = {"inventory": inv, "plan": task_plan, "entities": entities, "relations": relations,
                 "evidence": list(refs.values()), "gaps": list(gaps.values()), "audit": audit(root, inv), "graph": graph}
        state["retired_claims"] = retired
        state["knowledge_imports"] = old.get("knowledge_imports", []) if old else []
        if knowledge_path is not None:
            from .exchange import import_knowledge
            imported = import_knowledge(root, output, knowledge_path)
            if not any(item["sha256"] == imported["sha256"] for item in state["knowledge_imports"]):
                state["knowledge_imports"].append(imported)
        scopes = {}
        for key, previous in (old.get("change_scopes", {}) if old else {}).items():
            scopes[key] = coverage.refresh(previous, change_request if key == change_scope and change_request else previous["request"],
                                           state, amend_standard=amend_standard and key == change_scope)
        if command == "scope" and not selected_scope:
            created = coverage.refresh(None, change_request, state)
            # Deterministic create/resume never overwrites prior review history.
            change_scope = created["id"]
            if change_scope not in scopes:
                scopes[change_scope] = created
        for path in ledger_paths or []:
            if path.stat().st_size > 5_000_000:
                raise ValueError("Change review exceeds 5 MB")
            scopes[change_scope] = coverage.apply_review(scopes[change_scope], json.loads(path.read_text()), root, output)
        for task in task_plan["tasks"]:
            task["knowledge_context"] = [{"producer": item["producer"], "generation": item["sha256"],
                                          "status": item["status"], "candidates": [c for c in item["candidates"] if c["path"] in task["paths"]][:100],
                                          "note": "External hints only; recapture source and review before native findings."}
                                         for item in state["knowledge_imports"][:20]]
        state["change_scopes"] = scopes
        docs = render(state, output)
        manifest = {"producer": "understand-code", "schema_version": 1, "version": __version__,
                    "commit": inv["commit"], "snapshot": task_plan["snapshot"], "mode": mode, "provider": provider,
                    "graph_status": graph["status"], "coverage": {"files": len(inv["files"]), "skipped": len(inv["skipped"]),
                    "entities": len(entities), "relations": len(relations), "gaps": len(gaps),
                    "pending_tasks": sum(t["status"] != "accepted" for t in task_plan["tasks"]),
                    "deferred_scopes": len(task_plan["deferred"])},
                    "validation": "mechanical source checks only; semantic review is recorded separately",
                    "output": output}
        metadata = {"_meta/" + key + ".json": json_text(value) for key, value in
                    (("inventory", inv), ("plan", task_plan), ("gaps", state["gaps"]), ("audit", state["audit"]),
                     ("impact", impact), ("graphify-semantic", graphify.export(entities, relations)))}
        metadata.update({"_meta/" + key + ".jsonl": jsonl(state[key]) for key in ("entities", "relations", "evidence")})
        metadata["_meta/change-scopes/index.json"] = json_text(sorted(scopes))
        metadata["_meta/knowledge-imports.json"] = json_text(state["knowledge_imports"])
        metadata["_meta/retired-claims.json"] = json_text(retired)
        for key, scope in scopes.items():
            prefix = f"_meta/change-scopes/{key}/"
            metadata[prefix + "scope.json"] = json_text(scope)
            metadata[prefix + "review-template.json"] = json_text(coverage.review_template(scope))
            metadata[prefix + "coverage.json"] = json_text(coverage.assess(scope, state, inv))
        metadata["_meta/graphify-handoff.json"] = json_text({"input_status": graph["status"], "input_path": graph_path,
            "input_sha256": graph.get("sha256"), "markdown_root": output,
            "semantic_export": output + "/_meta/graphify-semantic.json", "refresh": "pending-external",
            "instructions": "Index current source and Codebase Spec Markdown with your installed Graphify/native graph tooling. No extraction command is launched by this CLI."})
        # Archive each supplied response under its content hash. Failed evidence remains external and untouched.
        for bundle in bundles:
            text = json_text(bundle)
            metadata["_meta/findings/" + digest(text) + ".json"] = text
        for task in task_plan["tasks"]:
            metadata["_meta/tasks/" + task["id"] + ".md"] = prompt(provider, task)
        # Detect source changes between discovery and publication.
        after = inventory(root, output, max_files, max_bytes)
        if {p: f["sha256"] for p, f in after["files"].items()} != {p: f["sha256"] for p, f in inv["files"].items()}:
            raise ValueError("Source changed during reconstruction; nothing published. Retry against a stable checkout.")
        write(target, docs, metadata, manifest)
        return {"repository": str(root), "output": str(target), "command": command,
                "change_scope": change_scope,
                "change_coverage": coverage.assess(scopes[change_scope], state, inv) if change_scope else None,
                "coverage": manifest["coverage"], "graph_status": graph["status"],
                "next_step": "Investigate pending native tasks, apply source-reviewed findings, then verify and refresh the graph."}
