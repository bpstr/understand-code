"""Prepared local change-coverage contracts; no inference or application execution."""
import contextlib
import copy
import io
import json
from pathlib import Path
import shutil
import socket
import subprocess
import tempfile
import unittest
from unittest.mock import patch

from understand_code import coverage
from understand_code.change_scope import resolve, source_manifest, surface_roster, fingerprint
from understand_code.cli import main
from understand_code.contracts import validate_contract, validate_finding
from understand_code.discovery import inventory
from understand_code.evidence import capture, read_source
from understand_code.exchange import export_knowledge, import_knowledge, validate_references, write_export
from understand_code.findings import validate
from understand_code.git import head
from understand_code.orchestrator import load, run
from understand_code.spec.planner import plan, schedule_followups

OUT = "docs/codebase"
FIXTURE = Path(__file__).parent / "fixtures/change-coverage"
REVIEW = {"status": "source-reviewed", "reviewer": "prepared-fixture-reviewer",
          "method": "Prepared source inspection; no target application execution"}
STANDARD = {"id": "standard.portrait", "criteria": [{"id": "criterion.rounded", "description": "Portraits use rounded-full.", "verification": "static"}], "required_checks": [], "exclusions": []}
GRAPH = {"status": "unavailable", "nodes": [], "links": []}


class ChangeCoverageTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name) / "source"
        shutil.copytree(FIXTURE, self.root)
        self.net = patch.object(socket.socket, "connect", side_effect=AssertionError("Offline only"))
        self.net.start()
        self.addCleanup(self.net.stop)
        original = subprocess.run
        def offline(args, *a, **kw):
            if not isinstance(args, list) or args[0] != "git":
                raise AssertionError("Only deterministic Git subprocesses are permitted")
            return original(args, *a, **kw)
        self.proc = patch("subprocess.run", side_effect=offline)
        self.proc.start()
        self.addCleanup(self.proc.stop)

    def file(self, name, value):
        path = Path(self.temp.name) / name
        path.write_text(json.dumps(value, indent=2) + "\n")
        return path

    def model(self, pages=None, second=False):
        inv = inventory(self.root, OUT)
        refs = {p: capture(p, read_source(self.root, p), 1,
                          len(read_source(self.root, p).splitlines()), head(self.root), "source")
                for p in inv["files"] if read_source(self.root, p).splitlines()}
        entities, relations = [], []
        def entity(key, kind, paths, **extra):
            result = {"id": key, "kind": kind, "title": key, "summary": "Prepared fixture: " + key,
                      "confidence": "EXTRACTED", "evidence": [refs[p]["id"] for p in paths],
                      "review": copy.deepcopy(REVIEW), **extra}
            entities.append(result)
            return result
        def relation(key, kind, source, target, path):
            relations.append({"id": "relation." + key.lower(), "kind": kind, "source": source, "target": target,
                              "confidence": "EXTRACTED", "evidence": [refs[path]["id"]], "review": copy.deepcopy(REVIEW)})
        def code(path, anchor):
            return {"repository": "repository.local", "path": path, "anchor": anchor,
                    "sha256": refs[path]["sha256"], "start_line": 1, "end_line": refs[path]["end_line"]}
        portrait = "components/Portrait.tsx"
        entity("concept.avatar", "concept", [portrait], title="Avatar presentation", search_terms=["profile photo", "avatar"])
        entity("component.portrait", "component", [portrait])
        entity("component.frame", "component", ["components/Frame.tsx", "components/index.ts"])
        relation("frame-picture", "renders", "component.frame", "component.portrait", "components/Frame.tsx")
        pages = pages if pages is not None else sorted(p.stem for p in (self.root / "pages").glob("*.tsx"))
        for page in pages:
            path = f"pages/{page}.tsx"
            surface = "ui_surface." + page.lower()
            occurrence = "occurrence." + page.lower()
            entity(surface, "ui_surface", [path])
            relation(page + "-presents", "presents", surface, "concept.avatar", path)
            if page != "Activity":
                relation(page + "-renders", "renders", surface, "component.frame", path)
            implementation = [code(path, page + "/portrait/1")]
            paths = [path]
            if page != "Activity":
                implementation.append(code(portrait, "Portrait/img"))
                paths.append(portrait)
            entity(occurrence, "occurrence", paths, occurrence={"concept": "concept.avatar", "surface": surface,
                    "anchor": page + "/portrait/1", "conditions": ["default"], "implementation": implementation})
            relation(page + "-occurs", "occurs_on", occurrence, surface, path)
            relation(page + "-realizes", "realizes", occurrence, "concept.avatar", path)
            if page == "Profile":
                relation("primary-profile", "primary_surface", "concept.avatar", surface, path)
                relations[-1]["scope"] = "Personal profile; default role"
            if page == "Profile" and second:
                entity("occurrence.profile-secondary", "occurrence", [path], occurrence={"concept": "concept.avatar", "surface": surface,
                        "anchor": "Profile/portrait/2", "conditions": ["preview"], "implementation": [code(path, "Profile/portrait/2")]})
        tasks = [{"id": "task.prepared", "role": "relationship-verifier", "paths": sorted(inv["files"]),
                  "status": "accepted", "review": copy.deepcopy(REVIEW)}]
        return {"inventory": inv, "entities": entities, "relations": relations,
                "evidence": list(refs.values()), "gaps": [], "knowledge_imports": [],
                "plan": {"tasks": tasks, "deferred": [], "followups": []}}

    def request(self, standard=STANDARD, **kw):
        examples = [str(p.relative_to(self.root)) for p in sorted((self.root / "pages").glob("*.tsx")) if p.stem != "Profile"]
        return coverage.new_request("avatar presentation", "ui_standardization", copy.deepcopy(standard), examples=examples, **kw)

    def scope(self, state=None, previous=None, request=None):
        state = state or self.model()
        return coverage.refresh(previous, request or (previous["request"] if previous else self.request()), state), state

    def packet(self, scope, state, omit=()):
        packet = coverage.review_template(scope)
        packet["review"] = copy.deepcopy(REVIEW)
        packet["evidence"] = copy.deepcopy(state["evidence"])
        by_path = {r["path"]: r["id"] for r in state["evidence"]}
        criterion_ids = [c["id"] for c in scope["request"]["standard"]["criteria"]]
        for key, obligation in scope["obligations"].items():
            if key in omit or not obligation["present"]:
                continue
            packet["dispositions"].append({"obligation": key, "disposition": "already_compliant", "criteria": criterion_ids,
                                           "evidence": [by_path[p] for p in obligation["consumer_paths"]],
                                           "rationale": "Prepared inspection against the declared criterion at this surface."})
        for key, candidate in scope["candidates"].items():
            if not candidate["present"]:
                continue
            occurrences = [k for k, o in scope["obligations"].items() if o["present"] and o["kind"] == "occurrence" and candidate["path"] in o["paths"]]
            packet["candidates"].append({"candidate": key, "status": "modeled" if occurrences else "not_relevant",
                                        "occurrences": occurrences, "evidence": [by_path[candidate["path"]]],
                                        "rationale": "Prepared independent inspection of this source file."})
        packet["policies"] = scope["resolution"]["required_policies"][:]
        return packet

    def reviewed(self, scope, state, packet=None):
        return coverage.apply_review(scope, packet or self.packet(scope, state), self.root, OUT)

    def assessment(self, scope, state):
        return coverage.assess(scope, state, inventory(self.root, OUT))

    def test_omitted_profile_is_independently_mandatory(self):
        scope, state = self.scope()
        self.assertNotIn("pages/Profile.tsx", scope["request"]["examples"])
        self.assertEqual(len(scope["resolution"]["occurrences"]), 9)
        self.assertEqual(scope["resolution"]["required_anchors"], ["ui_surface.profile"])
        self.assertIn("pages/Profile.tsx", scope["resolution"]["paths"])
        self.assertTrue(any(c["path"] == "pages/Activity.tsx" for c in scope["resolution"]["roster"]))
        self.assertEqual(len(scope["obligations"]), 10)

    def test_eight_of_nine_never_passes_until_profile_accounted(self):
        scope, state = self.scope()
        omitted = [key for key, o in scope["obligations"].items() if o["surface"] == "ui_surface.profile"]
        partial = self.reviewed(scope, state, self.packet(scope, state, omitted))
        report = self.assessment(partial, state)
        self.assertFalse(report["change_complete"])
        self.assertEqual(set(report["occurrence_accounting"]["unaccounted"]), set(omitted))
        complete = self.reviewed(partial, state)
        self.assertTrue(self.assessment(complete, state)["change_complete"])
        self.assertEqual(self.assessment(complete, state)["behavioral_verification"]["status"], "not_required")

    def test_shared_change_requires_no_direct_profile_edit(self):
        file = self.root / "components/Portrait.tsx"
        file.write_text(file.read_text().replace("rounded-full", "rounded-sm"))
        baseline, _ = self.scope()
        file.write_text(file.read_text().replace("rounded-sm", "rounded-full"))
        scope, state = self.scope(previous=baseline)
        packet = self.packet(scope, state)
        ref = next(r["id"] for r in state["evidence"] if r["path"] == "components/Portrait.tsx")
        for item in packet["dispositions"]:
            if scope["obligations"][item["obligation"]]["surface"] != "ui_surface.activity":
                item.update(disposition="changed_via_shared_dependency", consumer_evidence=item["evidence"][:], dependency_evidence=[ref])
        report = self.assessment(self.reviewed(scope, state, packet), state)
        self.assertTrue(report["change_complete"])
        self.assertEqual(scope["baseline"]["files"]["pages/Profile.tsx"], scope["target"]["files"]["pages/Profile.tsx"])

    def test_shared_disposition_rejects_missing_consumer_or_unchanged_dependency(self):
        scope, state = self.scope()
        packet = self.packet(scope, state)
        packet["dispositions"][0]["disposition"] = "changed_via_shared_dependency"
        with self.assertRaisesRegex(ValueError, "evidence|Shared"):
            self.reviewed(scope, state, packet)

    def test_same_file_occurrences_remain_distinct(self):
        scope, _ = self.scope(self.model(second=True))
        self.assertEqual(len(scope["resolution"]["occurrences"]), 10)
        self.assertEqual(len(scope["obligations"]), 11)

    def test_new_occurrence_becomes_unaccounted_obligation(self):
        scope, state = self.scope()
        scope = self.reviewed(scope, state)
        (self.root / "pages/Extra.tsx").write_text("export const Extra = () => <img src='/me.png' />;\n")
        target, state = self.scope(previous=scope)
        self.assertEqual(len(target["obligations"]), 11)
        self.assertFalse(self.assessment(target, state)["change_complete"])
        self.assertIn("occurrence.extra", self.assessment(target, state)["occurrence_accounting"]["unaccounted"])
        self.assertTrue(target["reviews"])
        self.assertTrue(target["passes"][0]["observed_obligations"])

    def test_detector_cannot_shrink_denominator_or_fake_source_removal(self):
        scope, state = self.scope()
        target, state = self.scope(self.model(pages=[p.stem for p in (self.root / "pages").glob("*.tsx") if p.stem != "Activity"]), previous=scope)
        self.assertEqual(len(target["obligations"]), 10)
        self.assertFalse(target["obligations"]["occurrence.activity"]["present"])
        packet = self.packet(target, state)
        ref = next(r["id"] for r in state["evidence"] if r["path"] == "pages/Activity.tsx")
        packet["dispositions"].append({"obligation": "occurrence.activity", "disposition": "removed", "criteria": ["criterion.rounded"],
                                       "evidence": [ref], "rationale": "Detector disappeared", "intentional": True})
        with self.assertRaisesRegex(ValueError, "detector"):
            self.reviewed(target, state, packet)

    def test_deleted_occurrence_requires_explicit_removal_and_preserves_history(self):
        baseline, _ = self.scope()
        (self.root / "pages/Activity.tsx").unlink()
        target, state = self.scope(previous=baseline)
        self.assertIn("pages/Activity.tsx", target["target"]["deleted"])
        self.assertIn("occurrence.activity", target["obligations"])
        packet = self.packet(target, state)
        ref = state["evidence"][0]["id"]
        packet["dispositions"].append({"obligation": "occurrence.activity", "disposition": "removed", "criteria": ["criterion.rounded"],
                                       "evidence": [ref], "rationale": "Prepared intentional removal of obsolete fixture surface.", "intentional": True})
        candidate = next(k for k, c in target["candidates"].items() if c["path"] == "pages/Activity.tsx")
        packet["candidates"].append({"candidate": candidate, "status": "removed", "occurrences": [], "evidence": [ref], "rationale": "Deleted intentionally.", "intentional": True})
        self.assertTrue(self.assessment(self.reviewed(target, state, packet), state)["change_complete"])
        self.assertIn("pages/Activity.tsx", target["baseline"]["files"])

    def test_identity_mapping_is_explicit_and_reviewed(self):
        baseline, _ = self.scope()
        state = self.model()
        occurrence = next(e for e in state["entities"] if e["id"] == "occurrence.activity")
        occurrence["id"] = "occurrence.activity-renamed"
        for r in state["relations"]:
            if r["source"] == "occurrence.activity":
                r["source"] = occurrence["id"]
        target, state = self.scope(state, previous=baseline)
        packet = self.packet(target, state)
        self.assertFalse(self.assessment(self.reviewed(target, state, packet), state)["change_complete"])
        packet["identity_mappings"] = [{"baseline": "occurrence.activity", "target": occurrence["id"], "rationale": "Reviewed same source anchor, renamed product ID.", "evidence": occurrence["evidence"]}]
        self.assertTrue(self.assessment(self.reviewed(target, state, packet), state)["change_complete"])

    def test_line_shift_preserves_stable_anchor_but_invalidates_review(self):
        scope, state = self.scope()
        scope = self.reviewed(scope, state)
        path = self.root / "pages/Profile.tsx"
        path.write_text("\n" + path.read_text())
        target, state = self.scope(previous=scope)
        self.assertEqual(target["obligations"]["occurrence.profile"]["anchor"], scope["obligations"]["occurrence.profile"]["anchor"])
        self.assertEqual(len(target["obligations"]), 10)
        self.assertFalse(self.assessment(target, state)["change_complete"])
        self.assertTrue(self.assessment(target, state)["occurrence_accounting"]["invalidated"])

    def test_relationship_only_source_enters_focus(self):
        (self.root / "composition.md").write_text("Profile presents avatar presentation.\n")
        state = self.model()
        ref = next(r["id"] for r in state["evidence"] if r["path"] == "composition.md")
        state["relations"][0]["evidence"] = [ref]
        scope, _ = self.scope(state)
        self.assertIn("composition.md", scope["resolution"]["paths"])
        self.assertFalse(any("composition.md" in [r["path"] for r in state["evidence"] if r["id"] in e["evidence"]] for e in state["entities"]))

    def test_unknown_phrase_gets_gap_and_independent_roster(self):
        state = self.model()
        result = resolve("totally unknown presentation", state["inventory"], [], [], state["evidence"])
        self.assertEqual(result["concepts"], [])
        self.assertIn("concept-resolution", [f["id"] for f in result["frontier"]])
        self.assertIn("pages/Profile.tsx", result["paths"])

    def test_phrase_search_and_alias_contract_remain_separate(self):
        state = self.model()
        result = resolve("profile photo", state["inventory"], state["entities"], state["relations"], state["evidence"])
        self.assertEqual(result["concepts"], ["concept.avatar"])
        entity = copy.deepcopy(state["entities"][0]); entity.pop("review")
        validate_contract("entity", entity)
        entity["aliases"] = ["profile photo"]
        with self.assertRaises(ValueError):
            validate_contract("entity", entity)

    def test_cycle_and_depth_limits_are_explicit(self):
        scope, _ = self.scope(request=self.request(max_depth=1))
        self.assertTrue(any(f["id"].startswith("depth-limit") for f in scope["resolution"]["frontier"]))
        full, _ = self.scope()
        self.assertFalse(full["resolution"]["frontier"])

    def test_quick_budget_keeps_ui_and_reuse_and_defers_other_work(self):
        state = self.model()
        p = plan(state["inventory"], GRAPH, "quick", "avatar presentation", entities=state["entities"], relations=state["relations"], evidence=state["evidence"], scope_options={"intent": "ui_standardization"})
        self.assertTrue({"ui-mapper", "reuse-mapper"} <= {t["role"] for t in p["tasks"]})
        self.assertTrue(p["deferred"])
        state["plan"] = p
        scope, state = self.scope(state)
        self.assertFalse(self.assessment(self.reviewed(scope, state), state)["change_complete"])

    def test_unsupported_dynamic_source_blocks_until_explicit_boundary_exclusion(self):
        (self.root / "dynamic.tsx").write_text("const view = React.createElement(registry[current]);\n")
        scope, state = self.scope()
        self.assertTrue(scope["resolution"]["frontier"])
        self.assertFalse(self.assessment(self.reviewed(scope, state), state)["change_complete"])
        scoped, state = self.scope(request=self.request(exclusions=["dynamic.tsx"]))
        self.assertFalse(scoped["resolution"]["frontier"])
        self.assertTrue(self.assessment(self.reviewed(scoped, state), state)["change_complete"])

    def test_settings_reader_is_not_an_observable_effect(self):
        state = self.model()
        setting = copy.deepcopy(state["entities"][0])
        setting.update(id="setting.timezone", kind="setting", title="Timezone", search_terms=["timezone"], details={"writer": "Prepared editor", "validation": "Prepared validator", "persistence": "Prepared database", "cache_projection": "Prepared cache", "reader": "Prepared getter"})
        state["entities"].append(setting)
        result = resolve("timezone", state["inventory"], state["entities"], state["relations"], state["evidence"], intent="settings_change")
        self.assertIn("settings-stage:setting.timezone:observable_effect", [f["id"] for f in result["frontier"]])

    def test_followup_missing_source_is_durable(self):
        state = self.model()
        p = plan(state["inventory"], GRAPH, "deep")
        request = {"id": "followup.dynamic", "role": "ui-mapper", "paths": ["missing.tsx"], "question": "Resolve registry source."}
        schedule_followups(p, [request], state["inventory"], GRAPH)
        self.assertEqual(p["followups"][0]["status"], "pending")
        schedule_followups(p, [], state["inventory"], GRAPH)
        self.assertEqual(len(p["followups"]), 1)

    def test_missing_standard_does_not_complete(self):
        scope, state = self.scope(request=self.request(standard=None))
        self.assertTrue(any(f["id"] == "requirements" for f in self.assessment(scope, state)["discovery_coverage"]["frontier"]))
        self.assertFalse(self.assessment(scope, state)["change_complete"])

    def test_standard_amendment_keeps_baseline_and_invalidates_review(self):
        scope, state = self.scope()
        scope = self.reviewed(scope, state)
        request = copy.deepcopy(scope["request"])
        request["standard"]["criteria"][0]["description"] += " Including preview variants."
        with self.assertRaises(ValueError):
            coverage.refresh(scope, request, state)
        amended = coverage.refresh(scope, request, state, amend_standard=True)
        self.assertEqual(amended["baseline"], scope["baseline"])
        self.assertEqual(len(amended["request_history"]), 1)
        self.assertFalse(self.assessment(amended, state)["change_complete"])

    def test_required_execution_is_external_current_and_successful(self):
        standard = copy.deepcopy(STANDARD)
        standard["criteria"][0]["verification"] = "behavioral"
        standard["required_checks"] = [{"id": "check.portraits", "command": "npm test -- portraits", "criteria": ["criterion.rounded"]}]
        scope, state = self.scope(request=self.request(standard=standard))
        packet = self.packet(scope, state)
        self.assertFalse(self.assessment(self.reviewed(scope, state, packet), state)["change_complete"])
        execution = {"id": "check.portraits", "command": "npm test -- portraits", "exit_code": 1,
                     "runner": "prepared-external-harness", "executed_at": "2026-09-25T00:00:00Z", "output_sha256": "a" * 64, "source_snapshot": scope["target"]["id"]}
        packet["executions"] = [execution]
        self.assertFalse(self.assessment(self.reviewed(scope, state, packet), state)["change_complete"])
        execution["exit_code"] = 0
        self.assertTrue(self.assessment(self.reviewed(scope, state, packet), state)["change_complete"])
        execution["source_snapshot"] = "b" * 64
        with self.assertRaises(ValueError):
            self.reviewed(scope, state, packet)

    def test_invalid_ledger_is_atomic_and_cannot_narrow_scope(self):
        scope, state = self.scope()
        before = copy.deepcopy(scope)
        packet = self.packet(scope, state)
        packet["dispositions"][-1].update(disposition="excluded", exclusion="exclusion.not-authorized")
        with self.assertRaisesRegex(ValueError, "Unauthorized"):
            self.reviewed(scope, state, packet)
        self.assertEqual(scope, before)
        packet = self.packet(scope, state)
        packet["evidence"][0]["sha256"] = "a" * 64
        with self.assertRaises(ValueError):
            self.reviewed(scope, state, packet)
        self.assertEqual(scope, before)

    def test_source_manifest_captures_untracked_content_and_deletion(self):
        inv = inventory(self.root, OUT)
        first = source_manifest(inv)
        (self.root / "new.ts").write_text("const created = true;\n")
        second = source_manifest(inventory(self.root, OUT))
        self.assertNotEqual(first["id"], second["id"])
        self.assertIn("new.ts", second["files"])

    def test_exchange_roundtrip_preserves_original_provenance_without_promotion(self):
        state = self.model()
        wire = export_knowledge(state, state["inventory"])
        validate_contract("change-knowledge", wire)
        validate_references(wire)
        path = self.file("knowledge.json", wire)
        imported = import_knowledge(self.root, OUT, path)
        self.assertEqual(imported["envelope"], wire)
        self.assertTrue(imported["candidates"])
        self.assertTrue(all(c["confidence"] == "INFERRED" for c in imported["candidates"]))
        self.assertEqual(wire["occurrences"][0]["review"], REVIEW)
        self.assertEqual(wire["occurrences"][0]["occurrence"]["conditions"], ["default"])

    def test_exchange_quarantines_stale_source(self):
        state = self.model()
        wire = export_knowledge(state, state["inventory"])
        path = self.file("knowledge.json", wire)
        (self.root / "pages/Profile.tsx").write_text("export const Profile = () => null;\n")
        imported = import_knowledge(self.root, OUT, path)
        self.assertTrue(imported["gaps"])
        self.assertEqual(imported["envelope"], wire)

    def test_exchange_rejects_traversal_and_unknown_references(self):
        state = self.model()
        wire = export_knowledge(state, state["inventory"])
        wire["evidence"][0]["path"] = "../outside.ts"
        with self.assertRaises(ValueError):
            import_knowledge(self.root, OUT, self.file("invalid.json", wire))
        wire = export_knowledge(state, state["inventory"])
        wire["relations"][0]["source"] = "component.missing"
        with self.assertRaises(ValueError):
            validate_references(wire)

    def test_exchange_rejects_symlink_escape(self):
        state = self.model()
        wire = export_knowledge(state, state["inventory"])
        path = self.root / "components/Portrait.tsx"
        outside = Path(self.temp.name) / "outside.tsx"
        outside.write_text(path.read_text()); path.unlink(); path.symlink_to(outside)
        with self.assertRaises(ValueError):
            import_knowledge(self.root, OUT, self.file("knowledge.json", wire))

    def test_missing_followup_path_still_blocks_strict_completion(self):
        scope, state = self.scope()
        state["plan"]["followups"] = [{"id": "followup.registry", "paths": ["missing.tsx"], "status": "pending"}]
        report = self.assessment(self.reviewed(scope, state), state)
        self.assertFalse(report["change_complete"])
        self.assertEqual(report["investigation_coverage"]["followups"], ["followup.registry"])

    def test_unknown_source_format_receives_fallback_inspection(self):
        (self.root / "profile.custom-template").write_text("<UserPicture />\n")
        scope, state = self.scope()
        self.assertIn("profile.custom-template", scope["resolution"]["paths"])
        self.assertTrue(any(c["path"] == "profile.custom-template" and c["kind"] == "source_fallback"
                            for c in scope["resolution"]["roster"]))

    def test_unreviewed_composition_does_not_become_verified_scope(self):
        state = self.model()
        state["relations"][0]["confidence"] = "INFERRED"
        state["relations"][0]["review"] = {"status": "unreviewed"}
        scope, state = self.scope(state)
        self.assertTrue(any(f["id"].startswith("unreviewed-relation:") for f in scope["resolution"]["frontier"]))
        self.assertFalse(self.assessment(self.reviewed(scope, state), state)["change_complete"])

    def test_new_contracts_reject_bad_code_reference_and_duplicate_occurrence(self):
        state = self.model()
        p = plan(state["inventory"], GRAPH, "deep")
        task = next(t for t in p["tasks"] if t["role"] == "repository-cartographer")
        bundle = {"schema_version": 1, "task_id": task["id"], "snapshot": task["snapshot"],
                  "entities": [{k: v for k, v in e.items() if k != "review"} for e in state["entities"]],
                  "relations": [{k: v for k, v in r.items() if k != "review"} for r in state["relations"]],
                  "evidence": state["evidence"], "gaps": [], "review": REVIEW}
        validate(bundle, self.root, OUT, task, [])
        duplicate = copy.deepcopy(next(e for e in bundle["entities"] if e["kind"] == "occurrence"))
        duplicate["id"] = "occurrence.duplicate"
        bundle["entities"].append(duplicate)
        with self.assertRaisesRegex(ValueError, "Duplicate occurrence identity"):
            validate(bundle, self.root, OUT, task, [])
        bundle["entities"].pop()
        occurrence = next(e for e in bundle["entities"] if e["kind"] == "occurrence")
        occurrence["occurrence"]["implementation"][0]["end_line"] = 500
        with self.assertRaisesRegex(ValueError, "range"):
            validate(bundle, self.root, OUT, task, [])

    def test_wire_fixture_contracts_and_schema_pin(self):
        directory = Path(__file__).parent / "fixtures/change-knowledge"
        valid = json.loads((directory / "valid-v1.json").read_text())
        validate_contract("change-knowledge", valid)
        validate_references(valid)
        for file in directory.glob("invalid-*.json"):
            with self.subTest(file=file.name), self.assertRaises(ValueError):
                value = json.loads(file.read_text())
                validate_contract("change-knowledge", value)
                validate_references(value)
        import hashlib
        canonical = Path(__file__).resolve().parents[1] / "schemas/change-knowledge.schema.json"
        pin = (directory / "schema.sha256").read_text().split()[0]
        self.assertEqual(hashlib.sha256(canonical.read_bytes()).hexdigest(), pin)

    def test_export_rejects_unrelated_destination(self):
        state = self.model()
        path = Path(self.temp.name) / "notes.json"
        path.write_text('{"notes":"keep"}')
        with self.assertRaisesRegex(ValueError, "unrelated"):
            write_export(path, export_knowledge(state, state["inventory"]))
        self.assertEqual(path.read_text(), '{"notes":"keep"}')

    def test_cli_separate_gate_validation_and_partial_exit(self):
        with contextlib.redirect_stdout(io.StringIO()), contextlib.redirect_stderr(io.StringIO()):
            self.assertEqual(main(["verify", "--repo", str(self.root), "--require-change-complete"]), 2)
            self.assertEqual(main(["scope", "avatar presentation", "--repo", str(self.root), "--intent", "ui_standardization"]), 0)
        state = load(self.root, OUT)
        key = next(iter(state["change_scopes"]))
        with contextlib.redirect_stdout(io.StringIO()), contextlib.redirect_stderr(io.StringIO()):
            self.assertEqual(main(["verify", "--repo", str(self.root), "--change-scope", key, "--require-change-complete"]), 1)
            self.assertEqual(main(["verify", "--repo", str(self.root)]), 0)

    def test_full_native_apply_and_ledger_cli_workflow(self):
        request = self.request()
        result = run(self.root, OUT, "scope", mode="deep", change_request=request)
        key = result["change_scope"]
        stored = load(self.root, OUT)
        model = self.model()
        all_paths = set(model["inventory"]["files"])
        responses = []
        supplied = False
        for task in stored["plan"]["tasks"]:
            refs = [r for r in model["evidence"] if r["path"] in task["paths"]]
            if not supplied and all_paths <= set(task["paths"]):
                entities = [{k: v for k, v in e.items() if k != "review"} for e in model["entities"]]
                relations = [{k: v for k, v in r.items() if k != "review"} for r in model["relations"]]
                supplied = True
            else:
                entities = [{"id": "decision." + task["role"], "kind": "decision", "title": "Prepared investigation",
                             "summary": "Prepared source-only fixture review for " + task["role"], "confidence": "EXTRACTED", "evidence": [refs[0]["id"]]}]
                relations = []
            response = {"schema_version": 1, "task_id": task["id"], "snapshot": task["snapshot"], "entities": entities,
                        "relations": relations, "evidence": refs, "gaps": [], "review": REVIEW}
            responses.append(self.file(task["id"] + ".json", response))
        self.assertTrue(supplied)
        run(self.root, OUT, "apply", finding_paths=responses)
        state = load(self.root, OUT)
        scope = state["change_scopes"][key]
        packet = self.packet(scope, state)
        path = self.file("review.json", packet)
        with contextlib.redirect_stdout(io.StringIO()), contextlib.redirect_stderr(io.StringIO()):
            self.assertEqual(main(["apply", "--repo", str(self.root), "--change-scope", key, "--ledger", str(path)]), 0)
            self.assertEqual(main(["verify", "--repo", str(self.root), "--change-scope", key, "--require-change-complete"]), 0)
        state = load(self.root, OUT)
        self.assertEqual(len(state["change_scopes"][key]["obligations"]), 10)
        self.assertTrue((self.root / OUT / "changes" / (key + ".md")).is_file())
        self.assertTrue(any((self.root / OUT / "concepts").glob("*.md")))


if __name__ == "__main__":
    unittest.main()
