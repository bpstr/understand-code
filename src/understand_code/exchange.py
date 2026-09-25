"""Change Knowledge Exchange v1: bounded, offline, candidate-only adapters.

Imports never upgrade external structural or semantic claims into native facts.
Original review/confidence and stale alternatives remain in the archived envelope.
"""
from copy import deepcopy
import json
import os
from pathlib import Path
import tempfile

from . import __version__
from .change_scope import fingerprint, source_manifest, validate_boundaries
from .contracts import validate_contract
from .evidence import excluded, safe_path, verify as verify_evidence
from .ontology import RELATION_ENDPOINTS, stable_id

MAX_BYTES = 5_000_000
CAPABILITIES = ["source-qualified-references-v1", "snapshot-manifests-v1", "reviewed-semantic-findings-v1",
                "independent-surface-candidates-v1", "candidate-only-import-v1"]


def export_knowledge(state: dict, current: dict) -> dict:
    entities = deepcopy(state["entities"])
    envelope = {"contract": "change-knowledge", "version": 1,
                "producer": {"id": "understand-code", "version": __version__},
                "repositories": [{"id": "repository.local", "manifest": source_manifest(current)}],
                "capabilities": CAPABILITIES[:],
                "entities": [e for e in entities if e["kind"] != "occurrence"],
                "occurrences": [e for e in entities if e["kind"] == "occurrence"],
                "relations": deepcopy(state["relations"]),
                "evidence": [{**deepcopy(e), "repository": "repository.local"} for e in state["evidence"]],
                "gaps": deepcopy(state["gaps"])}
    validate_contract("change-knowledge", envelope)
    validate_references(envelope)
    return envelope


def validate_references(envelope: dict) -> None:
    def unique(items, label):
        mapping = {item["id"]: item for item in items}
        if len(mapping) != len(items):
            raise ValueError(f"Duplicate {label} ID")
        return mapping
    repositories = unique(envelope["repositories"], "repository")
    refs = unique(envelope["evidence"], "evidence")
    entities = unique(envelope["entities"] + envelope["occurrences"], "entity/occurrence")
    relations = unique(envelope["relations"], "relation")
    if entities.keys() & relations.keys():
        raise ValueError("Entity and relation identities overlap")
    unique(envelope["gaps"], "gap")
    for repository in repositories.values():
        manifest = repository["manifest"]
        body = {key: value for key, value in manifest.items() if key != "id"}
        if fingerprint(body) != manifest["id"]:
            raise ValueError("Source manifest identity mismatch")
        for path in list(manifest["files"]) + manifest["deleted"]:
            validate_boundaries([path])
        for item in manifest["ignored"] + manifest["limitations"]:
            validate_boundaries([item["path"]])
    for ref in refs.values():
        validate_boundaries([ref["path"]])
        if ref["repository"] not in repositories or ref["end_line"] < ref["start_line"]:
            raise ValueError("Unbound evidence repository or invalid range")
    alternatives = [claim for gap in envelope["gaps"] for claim in gap.get("alternatives", [])]
    for claim in list(entities.values()) + list(relations.values()) + alternatives:
        if any(key not in refs for key in claim["evidence"]):
            raise ValueError("Dangling exchange evidence reference")
        if claim["confidence"] != "UNKNOWN" and not claim["evidence"]:
            raise ValueError("Exchange claims need original evidence")
        for ref in claim.get("code_references", []) + claim.get("occurrence", {}).get("implementation", []):
            validate_boundaries([ref["path"]])
            if ref["repository"] not in repositories or ref["start_line"] > ref["end_line"]:
                raise ValueError("Unbound code reference or invalid range")
        if claim.get("kind") == "occurrence":
            occurrence = claim.get("occurrence", {})
            if not occurrence or entities.get(occurrence["surface"], {}).get("kind") != "ui_surface" or entities.get(occurrence["concept"], {}).get("kind") not in ("concept", "feature", "setting", "data_entity"):
                raise ValueError("Unresolved occurrence membership reference")
    if any(e["kind"] == "occurrence" for e in envelope["entities"]) or any(e["kind"] != "occurrence" for e in envelope["occurrences"]):
        raise ValueError("Occurrences must use the dedicated wire collection")
    for relation in relations.values():
        if relation["source"] not in entities or relation["target"] not in entities:
            raise ValueError("Dangling exchange relation endpoint")
        rule = RELATION_ENDPOINTS.get(relation["kind"])
        if rule and (entities[relation["source"]]["kind"] not in rule[0] or entities[relation["target"]]["kind"] not in rule[1]):
            raise ValueError("Illegal exchange relation endpoints")
        if relation["kind"] in ("occurs_on", "realizes"):
            field = "surface" if relation["kind"] == "occurs_on" else "concept"
            if entities[relation["source"]].get("occurrence", {}).get(field) != relation["target"]:
                raise ValueError("Exchange relation contradicts occurrence membership")


def import_knowledge(root: Path, output: str, file: Path) -> dict:
    if file.stat().st_size > MAX_BYTES:
        raise ValueError("Knowledge exchange exceeds 5 MB")
    raw = file.read_text(encoding="utf-8")
    envelope = json.loads(raw)
    validate_contract("change-knowledge", envelope)
    validate_references(envelope)
    gaps, candidates = [], []
    manifests = {r["id"]: r["manifest"] for r in envelope["repositories"]}
    def gap(identity, reason, path=None):
        item = {"id": stable_id("exchange_gap", identity + reason), "reason": reason}
        if path:
            item["path"] = path
        gaps.append(item)
    for repository, manifest in manifests.items():
        if repository != "repository.local":
            gap(repository, "Repository binding unresolved; no external root is read")
            continue
        for path in list(manifest["files"]) + manifest["deleted"]:
            if excluded(path, output):
                raise ValueError("Exchange manifest references excluded/generated material")
            safe_path(root, path)
    for ref in envelope["evidence"]:
        if ref["repository"] != "repository.local":
            continue
        if excluded(ref["path"], output):
            raise ValueError("Exchange evidence references excluded/generated material")
        safe_path(root, ref["path"])
        local = {key: value for key, value in ref.items() if key not in ("repository", "producer_id")}
        error = verify_evidence(root, local, output)
        if error or manifests[ref["repository"]]["files"].get(ref["path"]) != ref["sha256"]:
            gap(ref["id"], error or "Evidence disagrees with imported source manifest", ref["path"])
        candidates.append({"path": ref["path"], "evidence": ref["id"], "confidence": "INFERRED",
                           "producer": envelope["producer"]["id"], "original_confidence": "preserved on original claim"})
    for claim in envelope["entities"] + envelope["occurrences"]:
        for ref in claim.get("code_references", []) + claim.get("occurrence", {}).get("implementation", []):
            if ref["repository"] == "repository.local":
                if excluded(ref["path"], output):
                    raise ValueError("Exchange code reference targets excluded material")
                safe_path(root, ref["path"])
                if manifests[ref["repository"]]["files"].get(ref["path"]) != ref["sha256"]:
                    gap(claim["id"], "Code reference disagrees with imported source manifest", ref["path"])
                from .evidence import read_source, source_hash
                try:
                    text = read_source(root, ref["path"])
                    if source_hash(text) != ref["sha256"] or ref["end_line"] > len(text.splitlines()):
                        gap(claim["id"], "Stale code reference or range", ref["path"])
                except (OSError, ValueError, UnicodeError):
                    gap(claim["id"], "Unavailable code reference", ref["path"])
    return {"sha256": fingerprint(envelope), "producer": envelope["producer"]["id"],
            "status": "quarantined" if gaps else "candidate-only", "envelope": envelope,
            "candidates": candidates, "gaps": gaps,
            "note": "Imported claims are hints, not native source-reviewed requirements. No external tool was run."}


def write_export(file: Path, envelope: dict) -> None:
    """Atomic explicit export without overwriting unrelated files or following links."""
    file = file.absolute()
    safe_path(Path(file.anchor), file.relative_to(file.anchor).as_posix())
    if not file.parent.is_dir():
        raise ValueError("Export directory does not exist")
    if file.exists():
        if file.stat().st_size > MAX_BYTES:
            raise ValueError("Refuse to overwrite unrelated large file")
        try:
            existing = json.loads(file.read_text())
        except (ValueError, UnicodeError) as error:
            raise ValueError("Refuse to overwrite an unrelated file") from error
        if not isinstance(existing, dict) or existing.get("contract") != "change-knowledge":
            raise ValueError("Refuse to overwrite an unrelated file")
    text = json.dumps(envelope, sort_keys=True, indent=2) + "\n"
    if len(text.encode()) > MAX_BYTES:
        raise ValueError("Knowledge export exceeds 5 MB; narrow the supported scope")
    descriptor, temporary = tempfile.mkstemp(prefix=".change-knowledge-", dir=file.parent)
    try:
        with os.fdopen(descriptor, "w", encoding="utf-8") as stream:
            stream.write(text)
        os.replace(temporary, file)
    finally:
        Path(temporary).unlink(missing_ok=True)
