"""Validate native findings before they become documentation.

Mechanical validation establishes citation identity and scope. It cannot prove that
a natural-language statement follows from an excerpt; an independent review records
that judgment explicitly and never changes source hashes to make a stale result pass.
"""
from .evidence import verify, safe_path, excluded, read_source, source_hash
from .ontology import KINDS, RELATIONS, RELATION_ENDPOINTS, CONFIDENCES, check_id, stable_id
from .contracts import validate_finding
from .git import head


def required(obj: dict, fields: set[str], label: str) -> None:
    if not isinstance(obj, dict) or fields - obj.keys():
        raise ValueError(f"{label} missing required fields: {sorted(fields - obj.keys()) if isinstance(obj, dict) else fields}")


def validate(bundle: dict, root, output: str, task: dict, known_entities: list[dict]) -> None:
    validate_finding(bundle)
    required(bundle, {"schema_version", "task_id", "snapshot", "entities", "relations", "evidence", "gaps", "review"}, "finding")
    if bundle["schema_version"] != 1 or bundle["task_id"] != task["id"] or bundle["snapshot"] != task["snapshot"]:
        raise ValueError("Findings do not match the task and source snapshot")
    for key in ("entities", "relations", "evidence", "gaps"):
        if not isinstance(bundle[key], list) or len(bundle[key]) > 500:
            raise ValueError(f"{key} must be a bounded array (maximum 500)")
    if not any(bundle.get(k) for k in ("entities", "relations", "gaps", "followups", "resolved_gaps", "retirements")):
        raise ValueError("An empty response is not a completed investigation; record an explicit knowledge gap")
    if not isinstance(bundle["review"], dict) or bundle["review"].get("status") not in ("unreviewed", "source-reviewed"):
        raise ValueError("Review must explicitly be unreviewed or source-reviewed")
    if bundle["review"]["status"] == "source-reviewed" and not all(
            isinstance(bundle["review"].get(k), str) and bundle["review"][k].strip() for k in ("reviewer", "method")):
        raise ValueError("Source review requires reviewer identity and method")
    refs = {}
    for ref in bundle["evidence"]:
        required(ref, {"id", "path", "start_line", "end_line", "sha256", "excerpt_sha256", "commit", "kind"}, "evidence")
        if ref["path"] not in task["paths"]:
            raise ValueError(f"Evidence outside task scope: {ref['path']}")
        if ref["commit"] != head(root):
            raise ValueError("Evidence commit does not match the current repository; recapture it")
        if ref["kind"] not in ("source", "test", "config", "documentation", "human"):
            raise ValueError("Unsupported evidence kind")
        error = verify(root, ref, output)
        if error:
            raise ValueError(f"Evidence rejected {ref['id']}: {error}")
        if ref["id"] in refs:
            raise ValueError("Duplicate evidence ID")
        refs[ref["id"]] = ref
    for resolution in bundle.get("resolved_gaps", []) + bundle.get("retirements", []):
        if bundle["review"]["status"] != "source-reviewed" or any(key not in refs for key in resolution["evidence"]):
            raise ValueError("Gap closure needs current source-reviewed evidence")
    entity_ids = {e["id"] for e in known_entities}
    entity_map = {e["id"]: e for e in known_entities + bundle["entities"]}
    seen = set()
    for entity in bundle["entities"]:
        required(entity, {"id", "kind", "title", "summary", "confidence", "evidence"}, "entity")
        if entity["kind"] not in KINDS:
            raise ValueError("Unknown entity kind")
        if not entity["id"].startswith(entity["kind"] + "."):
            raise ValueError("Entity ID must start with its kind")
        for key in ("title", "summary"):
            if not isinstance(entity[key], str) or not entity[key].strip() or len(entity[key]) > 12000:
                raise ValueError(f"Invalid entity {key}")
        entity_ids.add(entity["id"])
        if entity["kind"] == "occurrence":
            occurrence = entity.get("occurrence")
            if not occurrence:
                raise ValueError("Occurrence requires a concept, surface, stable anchor, conditions and implementation references")
            if entity_map.get(occurrence["concept"], {}).get("kind") not in ("concept", "feature", "setting", "data_entity"):
                raise ValueError("Occurrence has an unknown concept endpoint")
            if entity_map.get(occurrence["surface"], {}).get("kind") != "ui_surface":
                raise ValueError("Occurrence has an unknown surface endpoint")
        elif "occurrence" in entity:
            raise ValueError("Only occurrence entities can contain occurrence membership")
        code_refs = entity.get("code_references", []) + entity.get("occurrence", {}).get("implementation", [])
        for ref in code_refs:
            if ref["repository"] != "repository.local" or ref["path"] not in task["paths"]:
                raise ValueError("Code reference outside the bound repository/task")
            text = read_source(root, ref["path"])
            if source_hash(text) != ref["sha256"] or not 1 <= ref["start_line"] <= ref["end_line"] <= len(text.splitlines()):
                raise ValueError("Stale code reference or invalid range")
            if not any(e["path"] == ref["path"] and e["sha256"] == ref["sha256"]
                       and e["start_line"] <= ref["start_line"] <= ref["end_line"] <= e["end_line"]
                       for key, e in refs.items() if key in entity["evidence"]):
                raise ValueError("Code reference lacks supporting claim evidence")
    occurrence_keys = {}
    supplied_ids = {entity["id"] for entity in bundle["entities"]}
    for entity in entity_map.values():
        occurrence = entity.get("occurrence")
        if not occurrence:
            continue
        identity = (occurrence["concept"], occurrence["surface"], occurrence["anchor"],
                    tuple(sorted(occurrence["conditions"])),
                    tuple(sorted((ref["repository"], ref["path"], ref["anchor"])
                                 for ref in occurrence["implementation"])))
        previous = occurrence_keys.get(identity)
        if previous and previous != entity["id"] and ({previous, entity["id"]} & supplied_ids):
            raise ValueError("Duplicate occurrence identity; distinct uses need distinct stable anchors")
        occurrence_keys[identity] = entity["id"]
    for item in bundle["entities"] + bundle["relations"]:
        required(item, {"id", "confidence", "evidence"}, "claim")
        if not check_id(item["id"]) or item["id"] in seen:
            raise ValueError("Invalid or duplicate claim ID")
        seen.add(item["id"])
        if item["confidence"] not in CONFIDENCES:
            raise ValueError("Unknown confidence")
        if not isinstance(item["evidence"], list) or any(not isinstance(x, str) or x not in refs for x in item["evidence"]):
            raise ValueError("Claim references missing evidence")
        if item["confidence"] != "UNKNOWN" and not item["evidence"]:
            raise ValueError("Non-UNKNOWN claims require evidence")
        if item["confidence"] == "CORROBORATED":
            sources = {refs[x]["path"] for x in item["evidence"]}
            if len(sources) < 2:
                raise ValueError("CORROBORATED requires at least two independent source files")
        if item["confidence"] in ("EXTRACTED", "CORROBORATED") and bundle["review"]["status"] != "source-reviewed":
            raise ValueError("Established claims require recorded source review; use INFERRED until reviewed")
    for relation in bundle["relations"]:
        required(relation, {"source", "target", "kind"}, "relation")
        if relation["kind"] not in RELATIONS or any(relation[k] not in entity_ids for k in ("source", "target")):
            raise ValueError("Relation has unknown kind or endpoints")
        if relation["kind"] in RELATION_ENDPOINTS:
            source_kinds, target_kinds = RELATION_ENDPOINTS[relation["kind"]]
            if entity_map[relation["source"]]["kind"] not in source_kinds or entity_map[relation["target"]]["kind"] not in target_kinds:
                raise ValueError("Illegal typed relation endpoints")
        if relation["kind"] in ("occurs_on", "realizes"):
            membership = entity_map[relation["source"]].get("occurrence", {})
            field = "surface" if relation["kind"] == "occurs_on" else "concept"
            if membership.get(field) != relation["target"]:
                raise ValueError("Relation contradicts occurrence membership")
    from .spec.planner import ROLES
    for request in bundle.get("followups", []):
        if request["role"] not in ROLES:
            raise ValueError("Unknown follow-up role")
        for path in request["paths"]:
            safe_path(root, path)
            if excluded(path, output):
                raise ValueError("Follow-up cannot target excluded material")
    for gap in bundle["gaps"]:
        required(gap, {"id", "question", "next_step"}, "gap")
        if any(path not in task["paths"] for path in gap.get("paths", [])):
            raise ValueError("Gap paths outside task scope")
        if not check_id(gap["id"]) or not all(isinstance(gap[k], str) and gap[k].strip() for k in ("question", "next_step")):
            raise ValueError("Invalid knowledge gap")


def reconcile(entities: list[dict], relations: list[dict], bundles: list[dict]) -> tuple[list, list, list]:
    entity_map = {e["id"]: e for e in entities}
    relation_map = {r["id"]: r for r in relations}
    gaps = []
    for bundle in bundles:
        for key, target in (("entities", entity_map), ("relations", relation_map)):
            for claim in bundle[key]:
                existing = target.get(claim["id"])
                replacement = (existing and (existing.get("stale") or existing.get("conflict")) and claim.get("supersedes") == existing["id"]
                               and bundle["review"]["status"] == "source-reviewed")
                if existing and not replacement and any(existing.get(k) != claim.get(k) for k in ("summary", "kind", "source", "target", "occurrence", "code_references", "search_terms", "scope", "details")):
                    gaps.append({"id": stable_id("knowledge_gap", claim["id"] + "conflict"),
                                 "question": f"Conflicting interpretations for {claim['id']}; which is supported?",
                                 "next_step": "Review both preserved alternatives against source before replacing this claim.",
                                 "alternatives": [existing, claim]})
                    target[claim["id"]] = {**existing, "confidence": "UNKNOWN", "conflict": True}
                else:
                    target[claim["id"]] = {**claim, "review": bundle["review"]}
        gaps.extend(bundle["gaps"])
    return list(entity_map.values()), list(relation_map.values()), gaps
