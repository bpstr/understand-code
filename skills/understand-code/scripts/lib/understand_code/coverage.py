"""Snapshot-bound change obligations and source-reviewed completion contracts.

No edit/test/provider execution occurs here. A disposition is accountable review
of a declared standard, not proof of the reviewer's semantic judgment.
"""
from copy import deepcopy
from pathlib import Path

from .change_scope import (POLICY, established, fingerprint, in_boundary, resolve,
                           source_manifest, validate_boundaries)
from .contracts import validate_contract
from .evidence import verify as verify_evidence
from .ontology import stable_id

DISPOSITIONS = ("changed_directly", "changed_via_shared_dependency", "already_compliant",
                "excluded", "removed", "unresolved")


def validate_standard(standard: dict) -> None:
    validate_contract("change-standard", standard)
    for key in ("criteria", "required_checks", "exclusions"):
        if len({item["id"] for item in standard[key]}) != len(standard[key]):
            raise ValueError("Duplicate standard item ID")
    criteria = {c["id"]: c for c in standard["criteria"]}
    checks = standard["required_checks"]
    if any(set(c["criteria"]) - criteria.keys() for c in checks):
        raise ValueError("Behavioral check names an unknown criterion")
    required = {c["id"] for c in criteria.values() if c["verification"] == "behavioral"}
    supplied = {key for check in checks for key in check["criteria"]}
    if required - supplied:
        raise ValueError("Behavioral criteria must declare required execution checks")


def new_request(topic: str, intent: str, standard: dict | None = None,
                boundaries: list[str] | None = None, examples: list[str] | None = None,
                exclusions: list[str] | None = None, max_depth: int = 8, max_nodes: int = 500) -> dict:
    if standard is not None:
        validate_standard(standard)
    return {"topic": topic, "intent": intent,
            "standard": standard or {"id": "standard.unspecified", "criteria": [], "required_checks": [], "exclusions": []},
            "boundaries": validate_boundaries(boundaries or []), "examples": validate_boundaries(examples or []),
            "exclusions": validate_boundaries(exclusions or []), "max_depth": max_depth, "max_nodes": max_nodes}


def scope_options(request: dict) -> dict:
    return {key: request[key] for key in ("intent", "boundaries", "examples", "exclusions", "max_depth", "max_nodes")}


def _paths(claim: dict, refs: dict) -> set[str]:
    return {refs[key]["path"] for key in claim.get("evidence", []) if key in refs}


def _composition(surface: str, entities: dict, relations: list[dict], refs: dict) -> tuple[list, list]:
    queue, seen, paths, edges = [surface], set(), set(), set()
    while queue:
        key = queue.pop()
        if key in seen:
            continue
        seen.add(key)
        for relation in relations:
            other = None
            if relation["kind"] in ("renders", "implemented_by") and relation["source"] == key:
                other = relation["target"]
            if relation["kind"] == "reused_by" and relation["target"] == key:
                other = relation["source"]
            if other and established(relation) and established(entities.get(other, {})):
                edges.add(relation["id"])
                paths.update(_paths(entities[other], refs))
                queue.append(other)
    return sorted(paths), sorted(edges)


def _obligation(key: str, kind: str, state: dict) -> dict:
    entities = {e["id"]: e for e in state["entities"]}
    refs = {r["id"]: r for r in state["evidence"]}
    entity = entities[key]
    surface = entity.get("occurrence", {}).get("surface", key)
    consumer_paths = sorted(_paths(entities.get(surface, {}), refs))
    dependencies, composition = _composition(surface, entities, state["relations"], refs)
    implementation = entity.get("occurrence", {}).get("implementation", [])
    paths = _paths(entity, refs) | {r["path"] for r in implementation} | set(consumer_paths) | set(dependencies)
    return {"id": key if kind == "occurrence" else "anchor." + stable_id("surface", key),
            "subject": key, "kind": kind, "surface": surface, "title": entity["title"],
            "conditions": entity.get("occurrence", {}).get("conditions", []),
            "anchor": entity.get("occurrence", {}).get("anchor", key),
            "implementation": implementation, "paths": sorted(paths), "consumer_paths": consumer_paths,
            "dependency_paths": dependencies, "composition": composition, "evidence": entity["evidence"]}


def refresh(previous: dict | None, request: dict, state: dict, amend_standard: bool = False) -> dict:
    """Rediscover independently and retain the union of every observed obligation."""
    resolution = resolve(request["topic"], state["inventory"], state["entities"], state["relations"],
                         state["evidence"], **scope_options(request))
    generations = [{"producer": item["producer"], "sha256": item["sha256"]}
                   for item in state.get("knowledge_imports", [])]
    source = current_source(previous or {}, state["inventory"], generations)
    model = fingerprint({"entities": state["entities"], "relations": state["relations"], "gaps": state["gaps"]})
    revision = fingerprint({"source": source["id"], "model": model, "request": request, "resolution": resolution})
    current_obligations = [_obligation(key, "occurrence", state) for key in resolution["occurrences"]]
    current_obligations += [_obligation(key, "anchor", state) for key in resolution["required_anchors"]]
    # A declared boundary can exclude an anchor, but it is recorded, not silently lost.
    excluded_anchors = [item for item in current_obligations if item["kind"] == "anchor" and not any(
        in_boundary(p, request["boundaries"], request["exclusions"]) for p in item["consumer_paths"])]
    current_obligations = [item for item in current_obligations if item not in excluded_anchors]
    if previous is None:
        key = stable_id("change", fingerprint({"request": request, "baseline": source["id"]}))
        scope = {"schema_version": 1, "id": key, "policy": POLICY, "request": deepcopy(request),
                 "baseline": deepcopy(source), "baseline_model": model, "obligations": {}, "candidates": {},
                 "dispositions": {}, "candidate_reviews": {}, "policy_reviews": {}, "executions": {},
                 "reviews": [], "passes": [], "identity_mappings": {}}
    else:
        if previous["request"] != request:
            without_standard = lambda value: {key: item for key, item in value.items() if key != "standard"}
            if not amend_standard or without_standard(previous["request"]) != without_standard(request):
                raise ValueError("Cannot silently change a scope's standard/boundary")
            validate_standard(request["standard"])
        scope = deepcopy(previous)
        if scope["request"] != request:
            scope.setdefault("request_history", []).append({"request": scope["request"], "revision": scope["revision"]})
            scope["request"] = deepcopy(request)
    for item in scope["obligations"].values():
        item["present"] = False
    for item in current_obligations:
        prior = scope["obligations"].get(item["id"], {})
        scope["obligations"][item["id"]] = {**item, "present": True,
                                              "first_seen": prior.get("first_seen", revision)}
    for item in scope["candidates"].values():
        item["present"] = False
    for item in resolution["roster"]:
        prior = scope["candidates"].get(item["id"], {})
        scope["candidates"][item["id"]] = {**item, "present": True,
                                             "first_seen": prior.get("first_seen", revision)}
    scope.update({"target": source, "model": model, "revision": revision, "resolution": resolution,
                  "excluded_anchors": excluded_anchors})
    if not scope["passes"] or scope["passes"][-1]["revision"] != revision:
        scope["passes"].append({"revision": revision, "source_snapshot": source["id"], "model": model,
                                "policy": POLICY, "roster": [c["id"] for c in resolution["roster"]],
                                "obligations": [o["id"] for o in current_obligations],
                                "observed_obligations": deepcopy(current_obligations), "source_manifest": deepcopy(source),
                                "observed_roster": deepcopy(resolution["roster"]),
                                "evidence": deepcopy([e for e in state["evidence"] if e["path"] in resolution["paths"]])})
    return scope


def current_source(scope: dict, inv: dict, generations: list[dict]) -> dict:
    manifest = source_manifest(inv, generations=generations)
    omitted = {x["path"] for x in manifest["ignored"] + manifest["limitations"]}
    manifest["deleted"] = sorted(set(manifest["deleted"]) | (set(scope.get("baseline", {}).get("files", {})) - set(manifest["files"]) - omitted))
    manifest["id"] = fingerprint({key: value for key, value in manifest.items() if key != "id"})
    return manifest


def review_template(scope: dict) -> dict:
    return {"schema_version": 1, "change_scope": scope["id"],
            "baseline_snapshot": scope["baseline"]["id"], "target_snapshot": scope["target"]["id"],
            "revision": scope["revision"], "review": {"status": "unreviewed"}, "evidence": [],
            "dispositions": [], "candidates": [], "policies": [], "executions": [], "identity_mappings": []}


def apply_review(scope: dict, packet: dict, root: Path, output: str) -> dict:
    """Validate the entire packet before modifying even the in-memory scope."""
    validate_contract("change-review", packet)
    expected = review_template(scope)
    if any(packet[key] != expected[key] for key in ("change_scope", "baseline_snapshot", "target_snapshot", "revision")):
        raise ValueError("Change review does not match current baseline/target/revision; rediscover and review again")
    review = packet["review"]
    if review["status"] != "source-reviewed" or not all(review.get(k, "").strip() for k in ("reviewer", "method")):
        raise ValueError("Change dispositions require an accountable source review")
    refs = {e["id"]: e for e in packet["evidence"]}
    if len(refs) != len(packet["evidence"]):
        raise ValueError("Duplicate change-review evidence ID")
    for ref in refs.values():
        error = verify_evidence(root, ref, output)
        if error or scope["target"]["files"].get(ref["path"]) != ref["sha256"] or ref["commit"] != scope["target"]["commit"]:
            raise ValueError(f"Invalid current change-review evidence: {error or ref['path']}")
    def evidence_paths(ids, required=True):
        if (required and not ids) or any(key not in refs for key in ids):
            raise ValueError("Review item requires supplied current evidence")
        return {refs[key]["path"] for key in ids}
    criteria = {c["id"] for c in scope["request"]["standard"]["criteria"]}
    exclusions = {x["id"] for x in scope["request"]["standard"]["exclusions"]}
    changed = {p for p in scope["target"]["files"] if scope["baseline"]["files"].get(p) != scope["target"]["files"][p]}
    for key, identity in (("dispositions", "obligation"), ("candidates", "candidate"), ("executions", "id"), ("identity_mappings", "baseline")):
        records = packet.get(key, [])
        if len({r[identity] for r in records}) != len(records):
            raise ValueError(f"Duplicate {key} in change review")
    for item in packet["dispositions"]:
        obligation = scope["obligations"].get(item["obligation"])
        if not obligation:
            raise ValueError("Unknown change obligation")
        disposition = item["disposition"]
        paths = evidence_paths(item["evidence"], disposition != "unresolved")
        if disposition not in ("excluded", "unresolved") and (not criteria or set(item["criteria"]) != criteria):
            raise ValueError("Disposition must assess every explicit acceptance criterion")
        if set(item["criteria"]) - criteria:
            raise ValueError("Unknown acceptance criterion")
        if disposition == "excluded":
            if item.get("exclusion") not in exclusions:
                raise ValueError("Unauthorized scope narrowing: exclusion must be declared in the standard")
        elif disposition == "removed":
            if obligation["present"] or item.get("intentional") is not True:
                raise ValueError("Removal requires an absent obligation and intentional reviewed removal")
            surviving = set(obligation["consumer_paths"]).intersection(scope["target"]["files"])
            if surviving and not surviving.intersection(changed).intersection(paths):
                raise ValueError("A disappeared model/detector is not evidence of source removal; review changed consumer source or reconcile identity")
        elif disposition != "unresolved":
            if not obligation["present"]:
                raise ValueError("Missing obligation requires removal, identity reconciliation or unresolved status")
            if not paths.intersection(obligation["consumer_paths"]):
                raise ValueError("Disposition must inspect this occurrence/surface, not an unrelated file")
            if disposition == "changed_directly" and not paths.intersection(changed).intersection(obligation["consumer_paths"]):
                raise ValueError("Direct change requires a baseline-to-target implementation change")
            if disposition == "changed_via_shared_dependency":
                consumer = evidence_paths(item.get("consumer_evidence", []))
                dependency = evidence_paths(item.get("dependency_evidence", []))
                if (not consumer.intersection(obligation["consumer_paths"]) or not obligation["composition"]
                        or not dependency.intersection(changed).intersection(obligation["dependency_paths"])):
                    raise ValueError("Shared change requires changed dependency and a surviving reviewed consumer path")
    for item in packet["candidates"]:
        candidate = scope["candidates"].get(item["candidate"])
        if not candidate:
            raise ValueError("Unknown discovery candidate")
        paths = evidence_paths(item["evidence"], item["status"] != "unresolved")
        if item["status"] == "removed":
            if candidate["present"] or item.get("intentional") is not True or candidate["path"] in scope["target"]["files"]:
                raise ValueError("Candidate removal needs intentional source removal")
        elif item["status"] != "unresolved":
            if not candidate["present"] or candidate["path"] not in paths:
                raise ValueError("Discovery review must inspect the candidate's own source")
        if item["status"] == "modeled":
            if not item["occurrences"] or any(key not in scope["obligations"] or not scope["obligations"][key]["present"]
                                              or scope["obligations"][key]["kind"] != "occurrence"
                                              or candidate["path"] not in scope["obligations"][key]["paths"]
                                              for key in item["occurrences"]):
                raise ValueError("Modeled candidate requires current occurrences bound to its source")
        if item["status"] == "not_relevant" and any(o["present"] and candidate["path"] in o["paths"] for o in scope["obligations"].values()):
            raise ValueError("Known occurrence/anchor cannot be dismissed as an unrelated candidate")
    if set(packet["policies"]) - set(scope["resolution"]["required_policies"]):
        raise ValueError("Unknown discovery policy")
    checks = {c["id"]: c for c in scope["request"]["standard"]["required_checks"]}
    for execution in packet["executions"]:
        check = checks.get(execution["id"])
        if not check or execution["command"] != check["command"] or execution["source_snapshot"] != scope["target"]["id"]:
            raise ValueError("Execution provenance does not match the declared check/current source snapshot")
        from datetime import datetime
        try:
            when = datetime.fromisoformat(execution["executed_at"].replace("Z", "+00:00"))
        except ValueError as error:
            raise ValueError("Execution provenance requires an ISO-8601 timestamp") from error
        if when.tzinfo is None:
            raise ValueError("Execution timestamp must include a timezone")
    for mapping in packet.get("identity_mappings", []):
        before = scope["obligations"].get(mapping["baseline"])
        after = scope["obligations"].get(mapping["target"])
        if not before or before["present"] or not after or not after["present"] or before["kind"] != after["kind"]:
            raise ValueError("Identity mapping requires a missing baseline and current target of the same kind")
        if mapping["baseline"] == mapping["target"] or not evidence_paths(mapping["evidence"]).intersection(after["paths"]):
            raise ValueError("Identity mapping needs reviewed current target evidence")
    updated = deepcopy(scope)
    for key, source, identity in (("dispositions", "dispositions", "obligation"), ("candidate_reviews", "candidates", "candidate"),
                                   ("executions", "executions", "id"), ("identity_mappings", "identity_mappings", "baseline")):
        for item in packet.get(source, []):
            updated[key][item[identity]] = {**item, "revision": scope["revision"], "review": review}
    for policy in packet["policies"]:
        updated["policy_reviews"][policy] = {"revision": scope["revision"], "review": review}
    updated["reviews"].append(deepcopy(packet))
    return updated


def assess(scope: dict, state: dict, current: dict) -> dict:
    """Five independent axes; do not overload legacy coverage_complete."""
    generations = [{"producer": item["producer"], "sha256": item["sha256"]}
                   for item in state.get("knowledge_imports", [])]
    fresh_source = current_source(scope, current, generations)["id"] == scope["target"]["id"]
    model = fingerprint({"entities": state["entities"], "relations": state["relations"], "gaps": state["gaps"]})
    fresh = fresh_source and model == scope["model"]
    def current_record(record):
        return fresh and bool(record) and record.get("revision") == scope["revision"]
    invalidated, unaccounted, unresolved_candidates = [], [], []
    for key in scope["obligations"]:
        item = scope["dispositions"].get(key)
        mapping = scope["identity_mappings"].get(key)
        if current_record(mapping):
            item = scope["dispositions"].get(mapping["target"])
        if not current_record(item) or item["disposition"] == "unresolved":
            unaccounted.append(key)
            if item and not current_record(item):
                invalidated.append({"obligation": key, "reason": "source, semantic evidence, standard or discovery revision changed"})
    for key in scope["candidates"]:
        item = scope["candidate_reviews"].get(key)
        if not current_record(item) or item["status"] == "unresolved":
            unresolved_candidates.append(key)
    paths = set(scope["resolution"]["paths"])
    pending = [t["id"] for t in state["plan"]["tasks"] if paths.intersection(t["paths"])
               and (t["status"] != "accepted" or t.get("review", {}).get("status") != "source-reviewed")]
    deferred = [x for x in state["plan"]["deferred"] if paths.intersection(x["paths"])]
    followups = [x["id"] for x in state["plan"].get("followups", []) if x["status"] != "accounted" and any(in_boundary(p, scope["request"]["boundaries"], scope["request"]["exclusions"]) for p in x["paths"])]
    frontier = list(scope["resolution"]["frontier"])
    for gap in state["gaps"]:
        if gap["id"] != "knowledge_gap.graphify" and (not gap.get("paths") or paths.intersection(gap["paths"])):
            frontier.append({"id": gap["id"], "reason": gap["question"]})
    for imported in state.get("knowledge_imports", []):
        # Optional hints cannot disappear from the scope merely because their bindings failed.
        for gap in imported.get("gaps", []):
            if not gap.get("path") or gap["path"] in paths:
                frontier.append({"id": gap["id"], "reason": gap["reason"]})
    missing_policies = [p for p in scope["resolution"]["required_policies"] if not current_record(scope["policy_reviews"].get(p))]
    standard = scope["request"]["standard"]
    if not standard["criteria"]:
        frontier.append({"id": "requirements", "reason": "The requested standard has no concrete acceptance criteria."})
    if not scope["resolution"]["concepts"]:
        frontier.append({"id": "empty-concept-scope", "reason": "No resolved semantic concept; an empty ledger is not completion."})
    anchors = [key for key in unaccounted if scope["obligations"][key]["kind"] == "anchor"]
    checks = standard["required_checks"]
    missing_checks = [c["id"] for c in checks if not current_record(scope["executions"].get(c["id"]))
                      or scope["executions"][c["id"]]["exit_code"] != 0]
    boundary = lambda p: in_boundary(p, scope["request"]["boundaries"], scope["request"]["exclusions"])
    omissions = [x for x in current["skipped"] + current.get("ignored", []) if boundary(x["path"])]
    inventory_ok = fresh_source and not omissions
    investigation_ok = fresh and not pending and not deferred and not followups
    discovery_ok = fresh and not frontier and not unresolved_candidates and not scope["resolution"]["candidate_occurrences"] and not anchors and not missing_policies
    accounting_ok = fresh and not unaccounted
    behavioral_ok = fresh and bool(standard["criteria"]) and not missing_checks
    complete = all((inventory_ok, investigation_ok, discovery_ok, accounting_ok, behavioral_ok))
    axis = lambda ok, **details: {"status": "complete" if ok else "partial", **details}
    return {"scope_id": scope["id"], "change_complete": complete, "source_current": fresh_source,
            "semantic_evidence_current": model == scope["model"],
            "inventory_coverage": axis(inventory_ok, omissions=omissions, snapshot=scope["target"]["id"]),
            "investigation_coverage": axis(investigation_ok, pending_tasks=pending, deferred=deferred, followups=followups),
            "discovery_coverage": axis(discovery_ok, frontier=frontier, unresolved_candidates=unresolved_candidates,
                                       candidate_occurrences=scope["resolution"]["candidate_occurrences"], mandatory_anchors=anchors,
                                       missing_policy_reviews=missing_policies),
            "occurrence_accounting": axis(accounting_ok, total=len(scope["obligations"]), unaccounted=unaccounted, invalidated=invalidated),
            "behavioral_verification": {"status": ("not_required" if behavioral_ok and not checks else "complete" if behavioral_ok else "partial"),
                                         "missing_or_failed_checks": missing_checks, "execution_owner": "external coding harness; none executed by Understand Code"},
            "summary": "Complete within the declared scope and supported analysis boundary." if complete else "Partial change coverage; unresolved obligations remain.",
            "semantic_truth": "Source-reviewed dispositions are accountable judgments, not mathematical proof."}
