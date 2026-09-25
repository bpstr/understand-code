"""Explainable, bounded semantic retrieval. No application/provider execution.

A roster is independent of the query. Traversal supplies investigation candidates,
not a claim that every adjacent node is an edit target. Freshness invalidation
continues to use impact.py's separate conservative policy.
"""
from collections import deque
import json
from pathlib import PurePosixPath
import re
import unicodedata

from .ontology import digest, stable_id

POLICY = "semantic-change-scope-v1"
INTENTS = ("ui_standardization", "settings_change", "cross_cutting")
UI_RELATIONS = {"has_aspect", "primary_surface", "presents", "renders", "occurs_on", "realizes",
                "implemented_by", "exposed_at", "reused_by"}
SETTING_RELATIONS = {"reads", "writes", "written_by", "persisted_in", "read_by", "affects",
                     "propagates_to", "invalidates", "configured_by", "controls", "guards",
                     "depends_on", "implemented_by", "realizes", "occurs_on", "presents"}
DISCOVERY_POLICIES = {
    "ui_standardization": ["independent-surfaces", "primary-surfaces", "alternate-implementations", "component-consumers"],
    "settings_change": ["independent-surfaces", "settings-effects", "alternate-implementations"],
    "cross_cutting": ["independent-surfaces", "alternate-implementations", "observable-consumers"],
}


def fingerprint(value) -> str:
    return digest(json.dumps(value, sort_keys=True, ensure_ascii=True, separators=(",", ":")))


def normalize(value: str) -> str:
    value = re.sub(r"(?<=[a-z0-9])(?=[A-Z])", " ", value)
    return " ".join(re.findall(r"\w+", unicodedata.normalize("NFKC", value).casefold().replace("_", " ")))


def validate_boundaries(paths: list[str]) -> list[str]:
    result = []
    for value in paths:
        path = PurePosixPath(value)
        if (not value.strip() or path.is_absolute() or ".." in path.parts or "\\" in value
                or ".git" in path.parts):
            raise ValueError(f"Unsafe change boundary: {value!r}")
        result.append(path.as_posix().rstrip("/"))
    return sorted(set(result))


def in_boundary(path: str, boundaries: list[str], exclusions: list[str] | None = None) -> bool:
    def matches(prefix):
        return prefix == "." or path == prefix or path.startswith(prefix + "/")
    return (not boundaries or any(matches(p) for p in boundaries)) and not any(matches(p) for p in exclusions or [])


def source_manifest(inv: dict, boundaries: list[str] | None = None,
                    exclusions: list[str] | None = None, generations: list[dict] | None = None) -> dict:
    boundaries, exclusions = boundaries or [], exclusions or []
    keep = lambda p: in_boundary(p, boundaries, exclusions)
    data = {"commit": inv["commit"],
            "files": {p: v["sha256"] for p, v in sorted(inv["files"].items()) if keep(p)},
            "deleted": sorted(p for p in inv.get("deleted", []) if keep(p)),
            "ignored": [x for x in inv.get("ignored", []) if keep(x["path"])],
            "limitations": [x for x in inv["skipped"] + inv.get("limitations", []) if keep(x["path"])],
            "policy": inv.get("discovery_policy", "legacy-inventory"),
            "index_generations": sorted(generations or [], key=lambda x: (x["producer"], x["sha256"]))}
    return {"id": fingerprint(data), **data}


def established(claim: dict) -> bool:
    return (claim.get("confidence") in ("EXTRACTED", "CORROBORATED")
            and claim.get("review", {}).get("status") == "source-reviewed"
            and bool(claim.get("evidence")) and not claim.get("stale") and not claim.get("conflict"))


def surface_roster(inv: dict, boundaries: list[str] | None = None,
                   exclusions: list[str] | None = None) -> list[dict]:
    """Files needing native inspection, never regex-established UI semantics.

    Include every nonempty source-language file as a fallback. A native mapper can
    record an evidence-backed not-relevant decision instead of editing that file.
    """
    hints = {}
    for candidate in inv["candidates"]:
        hints.setdefault(candidate["path"], set()).add(candidate["kind"])
    roster = []
    for path, info in sorted(inv["files"].items()):
        if not in_boundary(path, boundaries or [], exclusions) or not info.get("evidence"):
            continue
        kinds = hints.get(path, set())
        ui = PurePosixPath(path).suffix in (".tsx", ".jsx", ".vue", ".svelte") or "ui_surface" in kinds
        if not info.get("language") and not ui and "entrypoint" not in kinds and info.get("kind") not in ("source", "test", "config"):
            continue
        roster.append({"id": stable_id("candidate", path), "path": path,
                       "kind": "surface" if ui else "source_fallback",
                       "evidence": [info["evidence"]], "hints": sorted(kinds), "confidence": "INFERRED"})
    return roster


def resolve(topic: str, inv: dict, entities: list[dict], relations: list[dict], evidence: list[dict],
            intent: str = "cross_cutting", examples: list[str] | None = None,
            boundaries: list[str] | None = None, exclusions: list[str] | None = None,
            max_depth: int = 8, max_nodes: int = 500) -> dict:
    if intent not in INTENTS or max_depth < 1 or max_nodes < 1 or not normalize(topic):
        raise ValueError("Invalid semantic scope request or traversal budget")
    boundaries = validate_boundaries(boundaries or [])
    exclusions = validate_boundaries(exclusions or [])
    examples = validate_boundaries(examples or [])
    keep = lambda p: in_boundary(p, boundaries, exclusions)
    roster = surface_roster(inv, boundaries, exclusions)
    by_id = {e["id"]: e for e in entities}
    refs = {e["id"]: e for e in evidence}
    query = normalize(topic)
    query_words = set(query.split())
    # Terms are vocabulary, not identity aliases or semantic proofs.
    matches = {e["id"] for e in entities if any(
        query == normalize(term) or query_words <= set(normalize(term).split())
        for term in [e["id"], e["title"], *e.get("aliases", []), *e.get("search_terms", [])])}
    paths = {p for p in inv["files"] if keep(p) and (p in examples or query == normalize(p))}
    frontier = []
    if not matches:
        frontier.append({"id": "concept-resolution", "reason": "Query has no known concept; independently investigate the source roster."})
    allowed = UI_RELATIONS if intent == "ui_standardization" else SETTING_RELATIONS | UI_RELATIONS
    adjacency = {}
    for relation in relations:
        if relation["kind"] in allowed:
            adjacency.setdefault(relation["source"], []).append((relation, relation["target"]))
            adjacency.setdefault(relation["target"], []).append((relation, relation["source"]))
    queue = deque((key, 0, []) for key in sorted(matches))
    visited, included_relations, provenance = set(), {}, {}
    while queue:
        key, depth, chain = queue.popleft()
        if key in visited:
            continue
        if len(visited) >= max_nodes:
            frontier.append({"id": "node-limit:" + key, "reason": "Traversal node budget", "entity": key, "via": chain})
            continue
        visited.add(key)
        provenance[key] = chain
        for relation, other in sorted(adjacency.get(key, []), key=lambda pair: pair[0]["id"]):
            included_relations[relation["id"]] = relation
            if other not in visited:
                if depth >= max_depth:
                    frontier.append({"id": "depth-limit:" + relation["id"], "reason": "Traversal depth budget", "entity": other, "via": chain + [relation["id"]]})
                else:
                    queue.append((other, depth + 1, chain + [relation["id"]]))
    claims = [by_id[key] for key in sorted(visited) if key in by_id] + list(included_relations.values())
    for claim in claims:
        paths.update(refs[r]["path"] for r in claim["evidence"] if r in refs and keep(refs[r]["path"]))
    for relation in included_relations.values():
        if not established(relation):
            frontier.append({"id": "unreviewed-relation:" + relation["id"],
                             "reason": "A relevant semantic connection remains inferred, stale or conflicting."})
    # Ancestors provide anchor context; unrelated siblings do not become edit obligations.
    concepts = {k for k in matches if by_id[k]["kind"] in ("concept", "feature", "setting", "feature_flag", "data_entity")}
    changed = True
    while changed:
        added = {r["target"] for r in included_relations.values()
                 if r["kind"] == "has_aspect" and r["source"] in concepts}
        changed = bool(added - concepts)
        concepts |= added
    ancestors = set(concepts)
    for _ in range(max_depth):
        ancestors |= {r["source"] for r in included_relations.values()
                      if r["kind"] == "has_aspect" and r["target"] in ancestors}
    anchors, occurrences, candidate_occurrences = [], [], []
    for relation in included_relations.values():
        if relation["kind"] == "primary_surface" and relation["source"] in ancestors:
            surface = by_id.get(relation["target"], {})
            if established(relation) and established(surface):
                anchors.append(surface["id"])
            else:
                frontier.append({"id": "unreviewed-anchor:" + relation["id"], "reason": "Primary-surface claim requires current source review."})
    for entity in entities:
        occurrence = entity.get("occurrence", {})
        if entity["kind"] != "occurrence" or occurrence.get("concept") not in concepts:
            continue
        locations = [r["path"] for r in occurrence.get("implementation", [])]
        surface = by_id.get(occurrence.get("surface"), {})
        locations += [refs[r]["path"] for r in surface.get("evidence", []) if r in refs]
        if locations and not any(keep(p) for p in locations):
            continue
        (occurrences if established(entity) and established(surface) and established(by_id.get(occurrence.get("concept"), {}))
         else candidate_occurrences).append(entity["id"])
        visited.add(entity["id"])
        paths.update(p for p in locations if keep(p))
    if intent == "ui_standardization" and concepts and not anchors:
        frontier.append({"id": "primary-surface", "reason": "No current evidence-backed primary surface; investigate independently of prompt examples."})
    if intent == "settings_change":
        # Stage evidence is explicit, not inferred from graph degree or a plausible chain.
        for key in concepts:
            if by_id[key]["kind"] not in ("setting", "feature_flag"):
                continue
            stages = by_id[key].get("details", {})
            for stage in ("writer", "validation", "persistence", "cache_projection", "reader", "observable_effect"):
                if not established(by_id[key]) or not stages.get(stage):
                    frontier.append({"id": f"settings-stage:{key}:{stage}", "reason": f"Missing source-reviewed settings segment: {stage}"})
    for item in inv["skipped"] + inv.get("ignored", []) + inv.get("limitations", []):
        if keep(item["path"]):
            frontier.append({"id": stable_id("frontier", json.dumps(item, sort_keys=True)), **item})
    # Always investigate the independent roster. It is not a list of required edits.
    paths.update(c["path"] for c in roster)
    return {"policy": POLICY, "topic": topic, "intent": intent, "examples": examples,
            "boundaries": boundaries, "exclusions": exclusions, "concepts": sorted(concepts),
            "entities": sorted(visited), "relations": sorted(included_relations),
            "required_anchors": sorted(set(anchors)), "occurrences": sorted(set(occurrences)),
            "candidate_occurrences": sorted(set(candidate_occurrences)), "roster": roster,
            "paths": sorted(p for p in paths if p in inv["files"]), "frontier": frontier,
            "provenance": provenance, "required_policies": DISCOVERY_POLICIES[intent],
            "limits": {"max_depth": max_depth, "max_nodes": max_nodes}}
