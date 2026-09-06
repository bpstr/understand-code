"""Read-only verification: freshness and integrity are distinct from semantics."""
import json
from pathlib import Path

from ..evidence import verify as verify_evidence, safe_path
from ..ontology import digest
from .writer import generated


def verify(root: Path, output: str, state: dict, current: dict) -> dict:
    errors, stale, unreviewed = [], [], []
    manifest = state["manifest"]
    for path, expected in manifest["managed"].items():
        try:
            file = safe_path(root, output + "/" + path)
            if digest(generated(file.read_text())) != expected:
                errors.append(f"Generated content changed: {path}")
        except (OSError, ValueError) as error:
            errors.append(f"{path}: {error}")
    for ref in state["evidence"]:
        error = verify_evidence(root, ref, output)
        if error:
            stale.append({"evidence": ref["id"], "path": ref["path"], "reason": error})
    previous = state["inventory"]["files"]
    changed = sorted(p for p in set(previous) | set(current["files"])
                     if previous.get(p, {}).get("sha256") != current["files"].get(p, {}).get("sha256"))
    known = {e["id"] for e in state["entities"]}
    refs = {r["id"] for r in state["evidence"]}
    for claim in state["entities"] + state["relations"]:
        if any(r not in refs for r in claim["evidence"]):
            errors.append(f"Dangling evidence on {claim['id']}")
        if claim.get("stale") or claim.get("conflict"):
            errors.append(f"Unresolved claim: {claim['id']}")
        if claim.get("review", {}).get("status") != "source-reviewed":
            unreviewed.append(claim["id"])
    for relation in state["relations"]:
        if relation["source"] not in known or relation["target"] not in known:
            errors.append(f"Dangling relation: {relation['id']}")
    pending = [t["id"] for t in state["plan"]["tasks"] if t["status"] != "accepted"]
    return {"ok": not errors and not stale and not changed, "errors": errors, "stale_evidence": stale,
            "changed_files": changed, "unreviewed_claims": unreviewed, "pending_tasks": pending,
            "coverage_complete": not pending and not state["plan"]["deferred"] and not current["skipped"],
            "semantic_truth": "not mechanically provable; source-reviewed records identify a human/native reviewer judgment"}
