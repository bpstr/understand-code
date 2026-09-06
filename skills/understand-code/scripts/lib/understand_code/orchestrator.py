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
from .spec.planner import plan
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
    return {"manifest": manifest, "inventory": read("inventory.json"), "plan": read("plan.json"),
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
        graph_path: str = "graphify-out/graph.json", max_files: int = 2000, max_bytes: int = 5_000_000) -> dict:
    root = root.resolve()
    target = safe_path(root, output)
    if target == root or not output.strip() or Path(output).parts[0] in ("src", "tests", "skills", ".git", ".github"):
        raise ValueError("Choose a dedicated documentation directory, not source, repository root, or tool configuration")
    with lock(root, output):
        old = load(root, output)
        if command in ("update", "focus", "apply") and old is None:
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
                             entities, relations, previous_refs)
            if old:
                accepted = {t["id"] for t in old["plan"]["tasks"] if t["status"] == "accepted"}
                for task in task_plan["tasks"]:
                    if task["id"] in accepted:
                        task["status"] = "accepted"
        # Preserve unfinished scopes across focused/incremental investigations. They remain
        # explicit backlog rather than disappearing when the current plan becomes narrower.
        if old and command in ("focus", "update") and task_plan is not old["plan"]:
            active = {(t["role"], tuple(t["paths"])) for t in task_plan["tasks"]}
            for task in old["plan"]["tasks"]:
                if task["status"] != "accepted" and (task["role"], tuple(task["paths"])) not in active:
                    task_plan["deferred"].append({"role": task["role"], "paths": task["paths"], "reason": "unfinished prior scope; rerun bootstrap or focus to schedule"})
            task_plan["deferred"].extend(old["plan"]["deferred"])
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
        for bundle in bundles:
            tasks[bundle["task_id"]]["status"] = "accepted"
        refs = {r["id"]: r for r in previous_refs + inv["evidence"] + [r for b in bundles for r in b["evidence"]]}
        for task in task_plan["tasks"]:
            scoped_refs = {key for key, ref in refs.items() if ref["path"] in task["paths"]}
            concepts = [e for e in entities if scoped_refs.intersection(e["evidence"])]
            ids = {e["id"] for e in concepts}
            task["current_model"] = {"entities": concepts[:100],
                "relations": [r for r in relations if r["source"] in ids or r["target"] in ids][:200],
                "note": "Existing interpretations to reconcile and challenge, not authority over current source."}
        # Retain exactly the evidence referenced by active claims and inventory, not abandoned stale citations.
        used_refs = {r for e in entities + relations for r in e["evidence"]} | {r["id"] for r in inv["evidence"]}
        refs = {key: value for key, value in refs.items() if key in used_refs}
        gaps = {g["id"]: g for g in (old["gaps"] if old else []) + new_gaps}
        for bundle in bundles:
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
                "coverage": manifest["coverage"], "graph_status": graph["status"],
                "next_step": "Investigate pending native tasks, apply source-reviewed findings, then verify and refresh the graph."}
