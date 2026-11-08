"""Prepared authoring regressions; no inference or example/application execution."""
import contextlib
import copy
import hashlib
import io
import json
from pathlib import Path
import shutil
import unittest

import test_engine as engine

from understand_code.cli import main
from understand_code.contracts import validate_contract
from understand_code.discovery import inventory
from understand_code.evidence import capture, read_source
from understand_code.exchange import export_knowledge, validate_references
from understand_code.git import head
from understand_code.orchestrator import run
from understand_code.spec.documentation import assess_documents
from understand_code.spec.verifier import verify
from understand_code.spec.writer import END, START, generated, split_generated

FIXTURES = Path(__file__).parent / "fixtures/documentation"
OUT = engine.OUT


class DocumentationTests(unittest.TestCase):
    # Delegate only scaffolding. Importing/subclassing EngineTests here would
    # cause unittest discovery to repeat all of its existing test methods.
    bootstrap = engine.EngineTests.bootstrap
    state = engine.EngineTests.state
    prepared = engine.EngineTests.prepared
    apply = engine.EngineTests.apply

    def setUp(self):
        engine.EngineTests.setUp(self)
        shutil.copyfile(FIXTURES / "contract.md", self.root / "contract.md")

    def documented(self, *names):
        bundle = self.prepared()
        text = read_source(self.root, "contract.md")
        contract = capture("contract.md", text, 1, len(text.splitlines()), head(self.root), "documentation")
        bundle["evidence"].append(contract)
        entity = bundle["entities"][0]
        entity["evidence"].append(contract["id"])
        tokens = {"$source": bundle["evidence"][0]["id"],
                  "$test": bundle["evidence"][2]["id"], "$contract": contract["id"]}

        def bind(value):
            if isinstance(value, str):
                return tokens.get(value, value)
            if isinstance(value, list):
                return [bind(item) for item in value]
            if isinstance(value, dict):
                return {key: bind(item) for key, item in value.items()}
            return value

        entity["documentation"] = [bind(json.loads((FIXTURES / (name + ".json")).read_text()))
                                   for name in names or ("reference",)]
        return bundle

    def checked_example(self, bundle, level="behavior", status="passed"):
        """Prepare an attestation-shaped record. This does not execute the example."""
        example = bundle["entities"][0]["documentation"][0]["examples"][0]
        bound = {key: example[key] for key in ("language", "code", "prerequisites", "expected")}
        example["validation"] = {
            "status": status, "level": level,
            "reason": "Prepared synthetic check record; no command or example was executed.",
            "provenance": {
                "command": "prepared-fixture-command (not executed)",
                "environment": "Synthetic offline fixture; not a real execution environment",
                "snapshot": bundle["snapshot"], "checked_at": "2026-11-08T08:00:00+00:00",
                "runner": "prepared-fixture-author (no actual runner)",
                "output_sha256": hashlib.sha256(b"prepared output, not captured execution").hexdigest(),
                "example_sha256": hashlib.sha256(json.dumps(bound, sort_keys=True).encode()).hexdigest(),
                "exit_code": 0 if status == "passed" else 1,
            },
        }
        return example

    def output_files(self):
        return {str(p.relative_to(self.root / OUT)): p.read_bytes()
                for p in (self.root / OUT).rglob("*") if p.is_file()}

    def rejected_without_write(self, bundle):
        before = self.output_files()
        with self.assertRaises(ValueError):
            self.apply(bundle)
        self.assertEqual(before, self.output_files())

    def feature(self, state=None):
        return next(e for e in (state or self.state())["entities"] if e["id"] == "feature.checkout")

    def quality(self, state=None):
        return assess_documents(state or self.state(), inventory(self.root, OUT))

    def assert_blocked(self, report, *terms):
        self.assertFalse(report["ready"])
        blockers = " ".join(str(item) for doc in report["documents"] for item in doc["blockers"]).lower()
        if terms:
            self.assertTrue(any(term.lower() in blockers for term in terms), blockers)

    def cli(self, *flags):
        output = io.StringIO()
        with contextlib.redirect_stdout(output):
            code = main([*flags, "--repo", str(self.root), "--output", OUT])
        return code, json.loads(output.getvalue())

    def test_reference_renders_structured_content_and_keeps_source_unchanged(self):
        before = {p: p.read_bytes() for p in self.root.rglob("*") if p.is_file()}
        self.bootstrap()
        bundle = self.documented()
        self.apply(bundle)
        page = (self.root / OUT / "documents/doc.checkout-reference.md").read_text()
        self.assertIn("# Checkout function reference", page)
        self.assertIn("## Inputs and assumptions", page)
        self.assertIn("| Input | Meaning |", page)
        self.assertIn("\n\nThe function does not validate item structure.", page)
        self.assertIn("    assert result['requires_login'] is True\n", page)
        self.assertIn("checkout.py#L", page)
        self.assertIn("contract.md#L", page)
        self.assertIn(bundle["snapshot"], page)
        self.assertIn("not-run", page)
        self.assertIn("CORROBORATED", page)
        self.assertIn("checkout return values or the guest gate change.", page)
        self.assertNotIn("**Owner:**", page)
        self.assertIn("documents/doc.checkout-reference.md", (self.root / OUT / "README.md").read_text())
        self.assertIn("doc.checkout-reference.md", (self.root / OUT / "features/feature.checkout.md").read_text())
        self.assertTrue(all(path.read_bytes() == content for path, content in before.items()))
        self.assert_blocked(self.quality(), "example", "behavior")

    def test_how_to_and_tutorial_render_steps_with_illustrative_warning(self):
        self.bootstrap()
        bundle = self.documented("how-to")
        tutorial = copy.deepcopy(bundle["entities"][0]["documentation"][0])
        tutorial.update(id="doc.checkout-tutorial", profile="tutorial", title="Learn the guest gate")
        bundle["entities"][0]["documentation"].append(tutorial)
        self.apply(bundle)
        for doc_id in ("doc.checkout-how-to", "doc.checkout-tutorial"):
            with self.subTest(doc_id=doc_id):
                text = (self.root / OUT / "documents" / (doc_id + ".md")).read_text()
                self.assertIn("1. Open the checkout function", text)
                self.assertIn("2. Find the guest", text)
                self.assertIn("illustrative", text.lower())
        report = self.quality()
        self.assertTrue(report["ready"], report)
        self.assertEqual(report["total"], 2)
        self.assertTrue(all(doc["warnings"] for doc in report["documents"]))

    def test_explanation_profile_needs_no_runnable_example(self):
        self.bootstrap()
        bundle = self.documented("specification")
        doc = bundle["entities"][0]["documentation"][0]
        doc.update(id="doc.checkout-explanation", profile="explanation", mode="as-built")
        doc.pop("requirements")
        doc["sections"] = [
            {"id": "section." + topic, "topic": topic, "title": title,
             "status": "documented", "content": content, "evidence": [bundle["evidence"][0]["id"]]}
            for topic, title, content in (
                ("context", "Context", "The checkout body consults a guest_checkout setting."),
                ("design", "Design", "The falsey-user branch returns a denial before the success result."),
                ("tradeoffs", "Consequences", "The body accepts items without validation; this documents a limitation, not historical rationale."))]
        self.apply(bundle)
        self.assertTrue(self.quality()["ready"])
        self.assertIn("Consequences", (self.root / OUT / "documents/doc.checkout-explanation.md").read_text())

    def test_mixed_spec_keeps_observed_specified_and_proposed_bases(self):
        self.bootstrap()
        bundle = self.documented("specification")
        self.apply(bundle)
        requirements = self.feature()["documentation"][0]["requirements"]
        self.assertEqual([r["basis"] for r in requirements], ["observed", "specified", "proposed"])
        page = (self.root / OUT / "documents/doc.checkout-specification.md").read_text()
        for requirement in requirements:
            self.assertIn(requirement["id"], page)
            self.assertIn(requirement["basis"], page.lower())
        self.assertIn("pending maintainer decision", page)
        self.assertIn("test_checkout.py#L", page)
        self.assertIn("verification plan, not a recorded run", page)
        self.assertTrue(self.quality()["ready"])

    def test_proposal_mode_does_not_require_established_implementation_confidence(self):
        self.bootstrap()
        bundle = self.documented("specification")
        entity = bundle["entities"][0]
        entity["confidence"] = "INFERRED"
        doc = entity["documentation"][0]
        doc["mode"] = "proposal"
        doc["requirements"] = [r for r in doc["requirements"] if r["basis"] == "proposed"]
        self.apply(bundle)
        self.assertEqual(self.feature()["confidence"], "INFERRED")
        self.assertTrue(self.quality()["ready"])
        page = (self.root / OUT / "documents/doc.checkout-specification.md").read_text()
        self.assertIn("proposal", page.lower())
        self.assertIn("INFERRED", page)

    def test_requirement_authority_and_mode_mismatches_are_rejected(self):
        self.bootstrap()
        mutations = {
            "observed from test alone": lambda d, b: d["requirements"][0].update(evidence=[b["evidence"][2]["id"]]),
            "specified from implementation alone": lambda d, b: d["requirements"][1].update(evidence=[b["evidence"][0]["id"]]),
            "proposal without origin": lambda d, b: d["requirements"][2].pop("origin"),
            "as-built with normative requirements": lambda d, b: d.update(mode="as-built"),
            "proposal with observed requirements": lambda d, b: d.update(mode="proposal"),
            "unknown with resolved verification": lambda d, b: d["requirements"][0].update(basis="unknown"),
            "source masquerading as test evidence": lambda d, b: d["requirements"][0]["verification"].update(test_evidence=[b["evidence"][0]["id"]]),
        }
        for label, mutate in mutations.items():
            with self.subTest(label=label):
                bundle = self.documented("specification")
                mutate(bundle["entities"][0]["documentation"][0], bundle)
                self.rejected_without_write(bundle)

    def test_all_nested_citations_are_bound_to_parent_and_current_bundle(self):
        self.bootstrap()
        for location in ("section", "requirement", "verification", "example", "canonical"):
            for reference in ("missing", "another entity"):
                with self.subTest(location=location, reference=reference):
                    bundle = self.documented("specification", "reference")
                    documents = bundle["entities"][0]["documentation"]
                    bad = "evidence.missing" if reference == "missing" else bundle["evidence"][1]["id"]
                    if location == "section":
                        documents[0]["sections"][0]["evidence"] = [bad]
                    elif location == "requirement":
                        documents[0]["requirements"][0]["evidence"] = [bad]
                    elif location == "verification":
                        documents[0]["requirements"][0]["verification"]["test_evidence"] = [bad]
                    elif location == "example":
                        documents[1]["examples"][0]["evidence"] = [bad]
                    else:
                        documents[0]["canonical_sources"] = [bad]
                    self.rejected_without_write(bundle)

    def test_closed_shapes_unsafe_identifiers_and_duplicate_local_ids_are_rejected(self):
        self.bootstrap()
        mutations = {
            "unsafe document path": lambda d: d.update(id="doc.../escape"),
            "unknown profile": lambda d: d.update(profile="arbitrary"),
            "undeclared approval": lambda d: d.update(approved=True),
            "blank audience": lambda d: d.update(audience=" \n "),
            "unsafe fence info": lambda d: d["examples"][0].update(language="python\n```"),
            "duplicate section": lambda d: d["sections"].append(copy.deepcopy(d["sections"][0])),
            "duplicate example": lambda d: d["examples"].append(copy.deepcopy(d["examples"][0])),
            "ragged table": lambda d: d["sections"][0]["table"]["rows"].append(["too short"]),
            "asserted unknown table": lambda d: d["sections"][0].update(status="unknown"),
            "unevidenced content": lambda d: d["sections"][0].update(evidence=[]),
            "unevidenced runnable": lambda d: d["examples"][0].update(evidence=[]),
        }
        for label, mutate in mutations.items():
            with self.subTest(label=label):
                bundle = self.documented()
                mutate(bundle["entities"][0]["documentation"][0])
                self.rejected_without_write(bundle)
        bundle = self.documented("specification")
        doc = bundle["entities"][0]["documentation"][0]
        doc["requirements"].append(copy.deepcopy(doc["requirements"][0]))
        self.rejected_without_write(bundle)

    def test_document_ids_are_unique_across_new_and_existing_owners(self):
        self.bootstrap()
        bundle = self.documented("specification")
        duplicate = copy.deepcopy(bundle["entities"][0])
        duplicate.update(id="feature.other", title="Other feature")
        bundle["entities"].append(duplicate)
        self.rejected_without_write(bundle)
        bundle["entities"].pop()
        self.apply(bundle)
        moved = copy.deepcopy(bundle)
        moved["entities"] = [duplicate]
        moved["relations"] = []
        self.rejected_without_write(moved)

    def test_requirement_ids_can_repeat_in_distinct_documents(self):
        self.bootstrap()
        bundle = self.documented("specification")
        docs = bundle["entities"][0]["documentation"]
        second = copy.deepcopy(docs[0])
        second["id"] = "doc.checkout-secondary-spec"
        docs.append(second)
        self.apply(bundle)
        self.assertEqual(self.quality()["total"], 2)
        self.assertTrue(self.quality()["ready"])

    def test_checked_example_requires_truthful_bound_provenance_shape(self):
        self.bootstrap()
        mutations = {
            "missing provenance": lambda e: e["validation"].pop("provenance"),
            "no check level": lambda e: e["validation"].update(level="none"),
            "stale snapshot": lambda e: e["validation"]["provenance"].update(snapshot="0" * 64),
            "wrong snippet digest": lambda e: e["validation"]["provenance"].update(example_sha256="0" * 64),
            "changed code": lambda e: e.update(code=e["code"] + "# changed\n"),
            "changed setup": lambda e: e.update(prerequisites="Different module path and settings."),
            "changed expected result": lambda e: e.update(expected="A different status."),
            "changed language": lambda e: e.update(language="text"),
            "nonzero passed exit": lambda e: e["validation"]["provenance"].update(exit_code=1),
            "no timezone": lambda e: e["validation"]["provenance"].update(checked_at="2026-11-08T08:00:00"),
            "bad timestamp": lambda e: e["validation"]["provenance"].update(checked_at="not-a-time"),
            "illustrative execution claim": lambda e: e.update(kind="illustrative"),
            "not-run with provenance": lambda e: e["validation"].update(status="not-run", level="none"),
        }
        for label, mutate in mutations.items():
            with self.subTest(label=label):
                bundle = self.documented()
                mutate(self.checked_example(bundle))
                self.rejected_without_write(bundle)
        bundle = self.documented()
        bundle["entities"][0]["documentation"][0]["examples"][0]["validation"]["level"] = "syntax"
        self.rejected_without_write(bundle)

    def test_validation_levels_are_not_promoted_to_behavioral_checks(self):
        self.bootstrap()
        for level, status, expected in (("syntax", "passed", False), ("schema", "passed", False),
                                        ("behavior", "failed", False), ("behavior", "passed", True)):
            with self.subTest(level=level, status=status):
                bundle = self.documented()
                self.checked_example(bundle, level, status)
                # Each iteration describes a different document, avoiding a
                # contradictory replacement solely to exercise this gate.
                doc = bundle["entities"][0]["documentation"][0]
                doc["id"] = "doc." + level + "-" + status
                state = self.state()
                parent = copy.deepcopy(bundle["entities"][0])
                parent["review"] = bundle["review"]
                state["entities"] = [parent]
                state["evidence"] = bundle["evidence"]
                report = self.quality(state)
                self.assertEqual(report["ready"], expected, report)
        bundle = self.documented()
        self.checked_example(bundle)
        self.apply(bundle)
        page = (self.root / OUT / "documents/doc.checkout-reference.md").read_text()
        self.assertIn("prepared-fixture-command", page)
        self.assertIn("not executed", page)
        self.assertIn("behavior", page)
        self.assertTrue(self.quality()["ready"])

    def test_quality_requires_profile_topics_examples_and_spec_requirements(self):
        self.bootstrap()
        for name, removed, expected in (("reference", "errors", "errors"),
                                         ("how-to", "troubleshooting", "troubleshooting"),
                                         ("specification", "security", "security")):
            with self.subTest(name=name):
                bundle = self.documented(name)
                parent = bundle["entities"][0]
                parent["review"] = bundle["review"]
                parent["documentation"][0]["sections"] = [s for s in parent["documentation"][0]["sections"] if s["topic"] != removed]
                state = self.state()
                state.update(entities=[parent], evidence=bundle["evidence"])
                self.assert_blocked(self.quality(state), expected)
        for name, field, expected in (("reference", "examples", "example"),
                                     ("specification", "requirements", "requirement")):
            with self.subTest(missing=field):
                bundle = self.documented(name)
                parent = bundle["entities"][0]
                parent["review"] = bundle["review"]
                parent["documentation"][0].pop(field)
                state = self.state()
                state.update(entities=[parent], evidence=bundle["evidence"])
                self.assert_blocked(self.quality(state), expected)

    def test_unknown_sections_and_requirements_remain_open_quality_blockers(self):
        self.bootstrap()
        bundle = self.documented("specification")
        doc = bundle["entities"][0]["documentation"][0]
        doc["sections"][0].update(status="unknown", content="Which user values are supported?", evidence=[])
        requirement = doc["requirements"][0]
        requirement.update(basis="unknown", evidence=[])
        requirement["verification"].update(method="unresolved", procedure="Resolve the user-value contract before testing.")
        self.apply(bundle)
        report = self.quality()
        self.assert_blocked(report, "unknown", "unresolved")
        text = (self.root / OUT / "documents/doc.checkout-specification.md").read_text()
        self.assertIn("Which user values are supported?", text)
        self.assertIn("unknown", text.lower())

    def test_quality_blocks_unreviewed_nonestablished_and_conflicting_parents(self):
        self.bootstrap()
        self.apply(self.documented("specification"))
        for mutation, expected in (({"review": {"status": "unreviewed"}}, "review"),
                                   ({"confidence": "INFERRED"}, "established"),
                                   ({"stale": True}, "stale"), ({"conflict": True}, "conflict")):
            with self.subTest(mutation=mutation):
                state = copy.deepcopy(self.state())
                self.feature(state).update(mutation)
                self.assert_blocked(self.quality(state), expected)

    def test_no_documented_section_cannot_be_ready_through_not_applicable_only(self):
        self.bootstrap()
        bundle = self.documented("specification")
        for section in bundle["entities"][0]["documentation"][0]["sections"]:
            section.update(status="not-applicable", content="Prepared exclusion reason; this is not a behavioral assertion.")
        self.apply(bundle)
        self.assert_blocked(self.quality(), "documented", "content")

    def test_changed_supporting_source_blocks_quality_before_and_after_refresh(self):
        self.bootstrap()
        self.apply(self.documented("specification"))
        original = copy.deepcopy(self.feature()["documentation"])
        path = self.root / "checkout.py"
        path.write_text(path.read_text() + "\n# changed source snapshot\n")
        self.assert_blocked(self.quality(), "source", "stale", "changed")
        run(self.root, OUT, "update")
        self.assertTrue(self.feature()["stale"])
        self.assertEqual(self.feature()["documentation"], original)
        self.assert_blocked(self.quality(), "stale", "source")

    def test_example_attestation_expires_even_if_only_unrelated_source_changes(self):
        self.bootstrap()
        bundle = self.documented()
        self.checked_example(bundle)
        self.apply(bundle)
        self.assertTrue(self.quality()["ready"])
        (self.root / "unrelated.py").write_text("BANNER = 'new independent source'\n")
        run(self.root, OUT, "update")
        self.assertFalse(self.feature().get("stale", False))
        self.assert_blocked(self.quality(), "snapshot", "example")

    def test_literal_fences_markers_and_human_notes_survive_regeneration(self):
        self.bootstrap()
        bundle = self.documented()
        example = bundle["entities"][0]["documentation"][0]["examples"][0]
        literal = "first line\n```python\n    print('<script>literal</script>')\n```\n~~~~\n" + START + "\n" + END + "\n<!-- understand-code:human -->\n`````\nliteral tail\n"
        example.update(kind="illustrative", language="text", code=literal)
        self.apply(bundle)
        path = self.root / OUT / "documents/doc.checkout-reference.md"
        self.assertIn(literal, path.read_text())
        note = "Maintainer: preserve this exact example and reconsider its scope."
        path.write_text(path.read_text() + note + "\n")
        run(self.root, OUT, "update")
        self.assertIn(literal, path.read_text())
        prefix, suffix = split_generated(path.read_text())
        self.assertIn(literal, prefix)
        self.assertIn(note, suffix)
        notes = self.state()["plan"]["tasks"][0]["maintainer_notes"]
        relevant = [item for item in notes if item["path"].endswith("doc.checkout-reference.md")]
        self.assertEqual([item["note"] for item in relevant], [note])
        self.assertTrue(verify(self.root, OUT, self.state(), inventory(self.root, OUT))["ok"])
        path.write_text(path.read_text().replace("literal tail", "tampered tail"))
        before = self.output_files()
        with self.assertRaisesRegex(ValueError, "Generated region"):
            run(self.root, OUT, "update")
        self.assertEqual(before, self.output_files())

    def test_plain_prose_and_tables_cannot_inject_html_or_managed_markers(self):
        self.bootstrap()
        bundle = self.documented()
        doc = bundle["entities"][0]["documentation"][0]
        doc["sections"][0]["content"] = "Literal <script>alert(1)</script> and [link](javascript:bad).\n\n" + END
        doc["sections"][0]["table"]["rows"][0][0] = "user | guest"
        self.apply(bundle)
        text = (self.root / OUT / "documents/doc.checkout-reference.md").read_text()
        self.assertNotIn("<script>", text)
        self.assertIn("&lt;script&gt;", text)
        self.assertIn("\\[link\\]", text)
        self.assertIn("user \\| guest", text)
        self.assertEqual(generated(text).count(END), 1)

    def test_legacy_verify_and_first_authored_upgrade_remain_additive(self):
        self.bootstrap()
        self.apply(self.prepared())
        before = verify(self.root, OUT, self.state(), inventory(self.root, OUT))
        self.assertTrue(before["ok"])
        self.assertEqual(before["documentation_quality"]["total"], 0)
        self.assertFalse(before["documentation_quality"]["ready"])
        self.assertEqual(self.cli("verify")[0], 0)
        self.assertEqual(self.cli("verify", "--require-doc-quality")[0], 1)
        self.apply(self.documented("specification"))
        self.assertFalse(self.feature().get("conflict", False))
        after = verify(self.root, OUT, self.state(), inventory(self.root, OUT))
        self.assertTrue(after["ok"])
        self.assertEqual(before["coverage_complete"], after["coverage_complete"])
        self.assertTrue(after["documentation_quality"]["ready"])
        self.assertEqual(self.cli("verify", "--require-doc-quality")[0], 0)
        code, status = self.cli("status")
        self.assertEqual(code, 0)
        self.assertTrue(status["verification"]["documentation_quality"]["ready"])

    def test_existing_documentation_cannot_be_omitted_or_silently_retired(self):
        self.bootstrap()
        self.apply(self.documented("specification"))
        original = copy.deepcopy(self.feature()["documentation"])
        self.rejected_without_write(self.prepared())
        explicit = self.prepared()
        explicit["entities"][0]["documentation"] = []
        self.apply(explicit)
        self.assertTrue(self.feature()["conflict"])
        self.assertEqual(self.feature()["documentation"], original)
        self.assert_blocked(self.quality(), "conflict")

    def test_authored_changes_conflict_until_explicit_reviewed_replacement(self):
        self.bootstrap()
        bundle = self.documented("specification")
        self.apply(bundle)
        revised = copy.deepcopy(bundle)
        revised["entities"][0]["documentation"][0]["sections"][0]["content"] = "A revised prepared interpretation needing reconciliation."
        self.apply(revised)
        self.assertTrue(self.feature()["conflict"])
        self.assertTrue(any(g.get("alternatives") for g in self.state()["gaps"]))
        self.assert_blocked(self.quality(), "conflict")
        revised["entities"][0]["supersedes"] = "feature.checkout"
        self.apply(revised)
        self.assertFalse(self.feature().get("conflict", False))
        self.assertTrue(self.quality()["ready"])
        self.assertIn("revised prepared interpretation", (self.root / OUT / "documents/doc.checkout-specification.md").read_text())

    def test_retired_document_keeps_owner_and_notes_before_same_owner_reactivation(self):
        self.bootstrap()
        original = self.documented("specification")
        self.apply(original)
        path = self.root / OUT / "documents/doc.checkout-specification.md"
        note = "Maintainer: these historical notes belong to feature.checkout only."
        path.write_text(path.read_text() + note + "\n")
        removal = copy.deepcopy(original)
        removal["entities"][0]["documentation"] = []
        self.apply(removal)
        removal["entities"][0]["supersedes"] = "feature.checkout"
        self.apply(removal)
        self.assertEqual(self.feature()["documentation"], [])
        self.assertEqual(self.state()["manifest"]["document_owners"]["doc.checkout-specification"], "feature.checkout")
        self.assertIn(note, path.read_text())
        reassigned = copy.deepcopy(original)
        reassigned["entities"] = [copy.deepcopy(original["entities"][0])]
        reassigned["entities"][0].update(id="feature.other", title="An unrelated owner")
        reassigned["relations"] = []
        self.rejected_without_write(reassigned)
        self.apply(original)
        self.assertIn(note, path.read_text())
        self.assertEqual(self.feature()["documentation"], original["entities"][0]["documentation"])

    def test_retired_entity_cannot_release_document_identity_to_another_entity(self):
        self.bootstrap()
        original = self.documented("specification")
        self.apply(original)
        retirement = copy.deepcopy(original)
        retirement.update(entities=[], relations=[], gaps=[])
        retirement["retirements"] = [
            {"id": key, "evidence": [original["evidence"][0]["id"]],
             "rationale": "Prepared explicit retirement for ownership-history regression."}
            for key in ("feature.checkout", "relation.guest-checkout-gate")]
        self.apply(retirement)
        self.assertNotIn("feature.checkout", {e["id"] for e in self.state()["entities"]})
        reassigned = copy.deepcopy(original)
        reassigned["entities"] = [copy.deepcopy(original["entities"][0])]
        reassigned["entities"][0].update(id="feature.other", title="Another feature")
        reassigned["relations"] = []
        self.rejected_without_write(reassigned)

    def test_v1_export_omits_authored_payloads_including_conflict_alternatives(self):
        self.bootstrap()
        bundle = self.documented("specification")
        self.apply(bundle)
        revised = copy.deepcopy(bundle)
        revised["entities"][0]["documentation"][0]["purpose"] = "A different authored purpose for conflict retention."
        self.apply(revised)
        state = self.state()
        original = copy.deepcopy(state)
        wire = export_knowledge(state, inventory(self.root, OUT))
        self.assertEqual(wire["version"], 1)
        validate_contract("change-knowledge", wire)
        validate_references(wire)

        def assert_no_documentation(value):
            if isinstance(value, dict):
                self.assertNotIn("documentation", value)
                for child in value.values():
                    assert_no_documentation(child)
            elif isinstance(value, list):
                for child in value:
                    assert_no_documentation(child)

        assert_no_documentation(wire)
        self.assertEqual(state, original)
        self.assertTrue(any(g.get("alternatives") for g in wire["gaps"]))


if __name__ == "__main__":
    unittest.main()
