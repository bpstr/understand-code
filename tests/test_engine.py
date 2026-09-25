"""Offline regression contracts. No provider invocation, fixture recording or network."""
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

from understand_code.cli import main
from understand_code.discovery import inventory
from understand_code.evidence import capture, read_source, safe_path
from understand_code.findings import validate, reconcile
from understand_code.git import changes, head, isolate
from understand_code.graphify import load as graph_load, export
from understand_code.orchestrator import load, run
from understand_code.spec.verifier import verify
from understand_code.spec.writer import END, write

FIXTURES = Path(__file__).parent / "fixtures"
OUT = "docs/codebase"


class EngineTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name) / "legacy"
        shutil.copytree(FIXTURES / "legacy", self.root)
        self.net = patch.object(socket.socket, "connect", side_effect=AssertionError("Tests must stay offline"))
        self.net.start()
        self.addCleanup(self.net.stop)
        real_run = subprocess.run
        def offline_run(args, *a, **kw):
            if not isinstance(args, list) or args[0] != "git":
                raise AssertionError("Only deterministic Git subprocesses are permitted in engine tests")
            return real_run(args, *a, **kw)
        self.proc = patch("subprocess.run", side_effect=offline_run)
        self.proc.start()
        self.addCleanup(self.proc.stop)

    def bootstrap(self):
        return run(self.root, OUT, "bootstrap")

    def state(self):
        return load(self.root, OUT)

    def prepared(self):
        state = self.state()
        task = next(t for t in state["plan"]["tasks"] if t["role"] == "domain-discoverer")
        fixture = json.loads((FIXTURES / "prepared/checkout.json").read_text())
        refs = [capture(p, read_source(self.root, p), 1, len(read_source(self.root, p).splitlines()),
                        head(self.root), "test" if p.startswith("test_") else "source")
                for p in ("checkout.py", "settings.py", "test_checkout.py")]
        return {"schema_version": 1, "task_id": task["id"], "snapshot": task["snapshot"],
                "entities": [{**fixture["entity"], "evidence": [refs[0]["id"], refs[2]["id"]]},
                             {**fixture["setting"], "evidence": [refs[1]["id"]]}],
                "relations": [{**fixture["relation"], "evidence": [refs[0]["id"], refs[1]["id"]]}],
                "evidence": refs, "gaps": [fixture["gap"]], "review": fixture["review"]}

    def apply(self, bundle):
        response = Path(self.temp.name) / "response.json"
        response.write_text(json.dumps(bundle))
        return run(self.root, OUT, "apply", finding_paths=[response])

    def git(self, *args):
        return subprocess.run(["git", "-C", str(self.root), *args], capture_output=True, check=True).stdout

    def init_git(self):
        self.git("init", "-b", "main")
        self.git("config", "user.name", "Fixture")
        self.git("config", "user.email", "fixture@example.invalid")
        self.git("add", ".")
        self.git("commit", "-m", "Add prepared legacy fixture")

    def test_bootstrap_changes_only_documentation(self):
        before = {p: p.read_bytes() for p in self.root.rglob("*") if p.is_file()}
        result = self.bootstrap()
        self.assertGreater(result["coverage"]["pending_tasks"], 0)
        self.assertTrue(all(p.read_bytes() == data for p, data in before.items()))
        self.assertFalse(any(e["kind"] == "feature" for e in self.state()["entities"]))

    def test_prepared_cross_layer_findings_are_persisted(self):
        self.bootstrap()
        self.apply(self.prepared())
        state = self.state()
        self.assertIn("feature.checkout", {e["id"] for e in state["entities"]})
        self.assertEqual(state["relations"][0]["kind"], "affects")
        self.assertTrue(verify(self.root, OUT, state, inventory(self.root, OUT))["ok"])
        page = (self.root / OUT / "features/feature.checkout.md").read_text()
        self.assertIn("checkout.py", page)
        self.assertNotIn("always enabled", page)
        self.assertIn("knowledge_gap.http-binding", {g["id"] for g in state["gaps"]})

    def test_fabricated_source_hash_fails_without_output_mutation(self):
        self.bootstrap()
        before = (self.root / OUT / "_meta/manifest.json").read_bytes()
        bundle = self.prepared()
        bundle["evidence"][0]["sha256"] = "0" * 64
        with self.assertRaisesRegex(ValueError, "Evidence rejected"):
            self.apply(bundle)
        self.assertEqual(before, (self.root / OUT / "_meta/manifest.json").read_bytes())

    def test_missing_evidence_and_false_corroboration_rejected(self):
        self.bootstrap()
        for refs in ([], ["fake"], [self.prepared()["evidence"][0]["id"]]):
            bundle = self.prepared()
            bundle["entities"][0]["evidence"] = refs
            with self.assertRaises(ValueError):
                self.apply(bundle)

    def test_unreviewed_claim_cannot_be_established_fact(self):
        self.bootstrap()
        bundle = self.prepared()
        bundle["review"] = {"status": "unreviewed"}
        with self.assertRaisesRegex(ValueError, "source review"):
            self.apply(bundle)

    def test_empty_response_is_not_completion(self):
        self.bootstrap()
        bundle = self.prepared()
        for key in ("entities", "relations", "gaps"):
            bundle[key] = []
        with self.assertRaisesRegex(ValueError, "empty response"):
            self.apply(bundle)

    def test_unknown_relation_endpoint_rejected(self):
        self.bootstrap()
        bundle = self.prepared()
        bundle["relations"][0]["target"] = "feature.imaginary"
        with self.assertRaisesRegex(ValueError, "endpoints"):
            self.apply(bundle)

    def test_stale_task_rejected(self):
        self.bootstrap()
        bundle = self.prepared()
        (self.root / "checkout.py").write_text("def checkout(): return False\n")
        with self.assertRaisesRegex(ValueError, "Source changed"):
            self.apply(bundle)

    def test_update_marks_claims_unknown_without_rebinding_evidence(self):
        self.bootstrap()
        self.apply(self.prepared())
        old = next(e for e in self.state()["entities"] if e["id"] == "feature.checkout")
        (self.root / "checkout.py").write_text(read_source(self.root, "checkout.py") + "\n# changed\n")
        run(self.root, OUT, "update")
        new = next(e for e in self.state()["entities"] if e["id"] == "feature.checkout")
        self.assertEqual(new["evidence"], old["evidence"])
        self.assertEqual(new["confidence"], "UNKNOWN")
        self.assertTrue(new["stale"])
        self.assertFalse(verify(self.root, OUT, self.state(), inventory(self.root, OUT))["ok"])

    def test_human_notes_survive_and_reach_tasks(self):
        self.bootstrap()
        path = self.root / OUT / "overview.md"
        path.write_text(path.read_text() + "\nMaintainer: HTTP adapter is external.\n")
        run(self.root, OUT, "update")
        self.assertIn("HTTP adapter is external", path.read_text())
        self.assertTrue(self.state()["plan"]["tasks"][0]["maintainer_notes"])

    def test_edited_generated_region_blocks_entire_write(self):
        self.bootstrap()
        path = self.root / OUT / "overview.md"
        path.write_text(path.read_text().replace("Scanned", "Human changed this: Scanned"))
        before = {str(p): p.read_bytes() for p in (self.root / OUT).rglob("*") if p.is_file()}
        with self.assertRaisesRegex(ValueError, "Generated region edited"):
            run(self.root, OUT, "update")
        self.assertEqual(before, {str(p): p.read_bytes() for p in (self.root / OUT).rglob("*") if p.is_file()})

    def test_unmanaged_output_is_not_overwritten(self):
        target = self.root / OUT
        target.mkdir(parents=True)
        (target / "README.md").write_text("Human knowledge")
        with self.assertRaisesRegex(ValueError, "without an Understand Code manifest"):
            self.bootstrap()
        self.assertEqual((target / "README.md").read_text(), "Human knowledge")

    def test_secret_and_symlink_exclusion(self):
        (self.root / ".secrets").write_text("NEVER_READ_THIS")
        (self.root / ".env.production").write_text("NEVER_READ_THIS")
        (self.root / "outside.py").symlink_to(Path(self.temp.name) / "missing")
        inv = inventory(self.root, OUT)
        self.assertNotIn(".secrets", inv["files"])
        self.assertNotIn(".env.production", inv["files"])
        self.assertNotIn("outside.py", inv["files"])
        with self.assertRaises(ValueError):
            safe_path(self.root, "../escape")

    def test_symlink_output_rejected(self):
        (self.root / "docs").symlink_to(Path(self.temp.name))
        with self.assertRaisesRegex(ValueError, "Symlink"):
            self.bootstrap()

    def test_budget_shortfall_is_visible(self):
        result = run(self.root, OUT, "bootstrap", max_files=1)
        self.assertGreater(result["coverage"]["skipped"], 0)

    def test_noop_update_preserves_pending_tasks_and_content(self):
        self.bootstrap()
        before = self.state()["plan"]
        page = (self.root / OUT / "overview.md").read_bytes()
        run(self.root, OUT, "update")
        self.assertEqual(len(before["tasks"]), len(self.state()["plan"]["tasks"]))
        self.assertEqual(page, (self.root / OUT / "overview.md").read_bytes())

    def test_focus_keeps_other_scopes_as_backlog(self):
        self.bootstrap()
        run(self.root, OUT, "focus", focus="checkout")
        self.assertTrue(self.state()["plan"]["deferred"])
        run(self.root, OUT, "focus", focus="nonexistenttopic")
        self.assertTrue(self.state()["plan"]["tasks"])
        self.assertIn("concept-resolution", [g["id"] for g in self.state()["plan"]["scope_resolution"]["frontier"]])

    def test_conflicts_become_unknown_with_preserved_alternatives(self):
        self.bootstrap()
        bundle = self.prepared()
        self.apply(bundle)
        bundle["entities"][0]["summary"] = "Contradictory interpretation for fixture testing."
        self.apply(bundle)
        entity = next(e for e in self.state()["entities"] if e["id"] == "feature.checkout")
        self.assertEqual(entity["confidence"], "UNKNOWN")
        self.assertTrue(any(g.get("alternatives") for g in self.state()["gaps"]))

    def test_graph_import_does_not_promote_edges_to_facts(self):
        (self.root / "graphify-out").mkdir()
        (self.root / "graphify-out/graph.json").write_text(json.dumps({"nodes": [{"id": "a", "file": "checkout.py"}],
                                                                    "links": [{"source": "a", "target": "missing", "relation": "calls"}]}))
        self.bootstrap()
        self.assertEqual(self.state()["manifest"]["graph_status"], "imported-unverified")
        self.assertEqual(self.state()["relations"], [])
        self.assertEqual(export([], [])["graph"]["producer"], "understand-code")

    def test_git_base_includes_rename_and_unstaged_change(self):
        self.init_git()
        self.git("mv", "ui.tsx", "new ui.tsx")
        (self.root / "checkout.py").write_text(read_source(self.root, "checkout.py") + "\n# change\n")
        diff = changes(self.root, "HEAD")
        self.assertTrue(any(d.get("old_path") == "ui.tsx" and d["path"] == "new ui.tsx" for d in diff))
        self.assertTrue(any(d["path"] == "checkout.py" for d in diff))

    def test_isolated_worktree_leaves_original_clean(self):
        self.init_git()
        worktree = isolate(self.root)
        run(worktree, OUT, "bootstrap")
        self.assertFalse((self.root / OUT).exists())
        self.assertEqual(self.git("status", "--porcelain"), b"")

    def test_cli_verify_exit_codes(self):
        self.bootstrap()
        with contextlib.redirect_stdout(io.StringIO()):
            self.assertEqual(main(["verify", "--repo", str(self.root)]), 0)
            self.assertEqual(main(["verify", "--repo", str(self.root), "--require-complete"]), 1)
        (self.root / "checkout.py").unlink()
        with contextlib.redirect_stdout(io.StringIO()):
            self.assertEqual(main(["verify", "--repo", str(self.root)]), 1)

    def test_false_commit_and_out_of_scope_evidence_rejected(self):
        self.bootstrap()
        bundle = self.prepared()
        bundle["evidence"][0]["commit"] = "made-up-commit"
        with self.assertRaisesRegex(ValueError, "commit"):
            self.apply(bundle)
        bundle = self.prepared()
        task = next(t for t in self.state()["plan"]["tasks"] if t["id"] == bundle["task_id"])
        task["paths"] = ["settings.py"]
        with self.assertRaisesRegex(ValueError, "outside task scope"):
            validate(bundle, self.root, OUT, task, self.state()["entities"])

    def test_closed_contract_rejects_extra_fields(self):
        self.bootstrap()
        bundle = self.prepared()
        bundle["entities"][0]["execute"] = "malicious command"
        with self.assertRaisesRegex(ValueError, "unsupported field"):
            self.apply(bundle)

    def test_metadata_tampering_is_detected(self):
        self.bootstrap()
        path = self.root / OUT / "_meta/entities.jsonl"
        path.write_text("")
        with self.assertRaisesRegex(ValueError, "integrity"):
            self.state()

    def test_conflict_can_be_resolved_by_explicit_reviewed_replacement(self):
        self.bootstrap()
        original = self.prepared()
        self.apply(original)
        conflict = copy.deepcopy(original)
        conflict["entities"][0]["summary"] = "A deliberately conflicting prepared claim."
        self.apply(conflict)
        original["entities"][0]["supersedes"] = "feature.checkout"
        self.apply(original)
        entity = next(e for e in self.state()["entities"] if e["id"] == "feature.checkout")
        self.assertEqual(entity["confidence"], "CORROBORATED")
        self.assertFalse(entity.get("conflict"))
        self.assertFalse(any(g.get("alternatives") for g in self.state()["gaps"]))

    def test_stale_claim_requires_explicit_supersedes_for_changed_interpretation(self):
        self.bootstrap()
        bundle = self.prepared()
        entities, relations, _ = reconcile([], [], [bundle])
        entities[0]["stale"] = True
        bundle["entities"][0]["summary"] = "New interpretation after a source change."
        bundle["entities"][0]["supersedes"] = "feature.checkout"
        updated, _, gaps = reconcile(entities, relations, [bundle])
        self.assertFalse(updated[0].get("stale"))
        self.assertFalse(any(g.get("alternatives") for g in gaps))

    def test_publication_rename_failure_restores_previous_spec(self):
        self.bootstrap()
        before = (self.root / OUT / "README.md").read_bytes()
        real_rename = Path.rename
        def failing_rename(path, destination):
            if path.name.startswith(".understand-code-stage-") and not path.name.endswith("-backup"):
                raise OSError("Prepared filesystem failure")
            return real_rename(path, destination)
        with patch.object(Path, "rename", failing_rename):
            with self.assertRaisesRegex(OSError, "Prepared filesystem failure"):
                run(self.root, OUT, "update")
        self.assertEqual(before, (self.root / OUT / "README.md").read_bytes())


if __name__ == "__main__":
    unittest.main()
