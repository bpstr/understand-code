"""Prepared competency contracts; these do not measure autonomous model recall."""
import copy
import json
from pathlib import Path
import runpy
import shutil
import socket
import subprocess
import sys
import tempfile
from types import ModuleType, SimpleNamespace
import unittest
from unittest.mock import Mock, patch

from understand_code.evidence import capture, read_source, verify
from understand_code.git import head
from understand_code.orchestrator import load, run

FIXTURES = Path(__file__).parent / "fixtures/competency"
OUT = "docs/codebase"
REVIEW = {"status": "source-reviewed", "reviewer": "prepared-fixture-reviewer",
          "method": "Prepared source contract; no inference or live application execution"}


class CompetencyContractTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        net = patch.object(socket.socket, "connect", side_effect=AssertionError("Offline fixtures only"))
        net.start()
        self.addCleanup(net.stop)
        original = subprocess.run
        def offline(args, *a, **kw):
            if not isinstance(args, list) or args[0] != "git":
                raise AssertionError("Only deterministic Git subprocesses are permitted")
            return original(args, *a, **kw)
        proc = patch("subprocess.run", side_effect=offline)
        proc.start()
        self.addCleanup(proc.stop)

    def fixture(self, name):
        root = Path(self.temp.name) / name
        shutil.copytree(FIXTURES / name, root)
        return root

    def persist(self, root, claims, edges=()):
        run(root, OUT, "bootstrap", mode="deep")
        state = load(root, OUT)
        task = next(t for t in state["plan"]["tasks"] if t["role"] == "repository-cartographer")
        paths = {p for _, _, ps in claims for p in ps}
        refs = {p: capture(p, read_source(root, p), 1, len(read_source(root, p).splitlines()), head(root), "source") for p in paths}
        entities = [{"id": key, "kind": kind, "title": key, "summary": "Prepared claim: " + key,
                     "confidence": "EXTRACTED", "evidence": [refs[p]["id"] for p in ps]} for key, kind, ps in claims]
        relations = [{"id": "relation." + str(i), "kind": "affects", "source": a, "target": b,
                      "confidence": "EXTRACTED", "evidence": [refs[p]["id"]]} for i, (a, b, p) in enumerate(edges)]
        response = {"schema_version": 1, "task_id": task["id"], "snapshot": task["snapshot"],
                    "entities": entities, "relations": relations, "evidence": list(refs.values()), "gaps": [], "review": REVIEW}
        file = Path(self.temp.name) / "response.json"
        file.write_text(json.dumps(response))
        run(root, OUT, "apply", finding_paths=[file])
        return {e["id"]: e for e in load(root, OUT)["entities"]}

    def test_same_named_settings_remain_distinct(self):
        root = self.fixture("same-setting-names")
        admin = runpy.run_path(str(root / "admin/settings.py"))
        media = runpy.run_path(str(root / "media/settings.py"))
        self.assertFalse(admin["validate_admin_upload"](100))
        self.assertTrue(media["validate_media_upload"](100))
        entities = self.persist(root, [("setting.admin-upload", "setting", ["admin/settings.py"]),
                                       ("setting.media-upload", "setting", ["media/settings.py"])])
        self.assertNotEqual(entities["setting.admin-upload"]["evidence"], entities["setting.media-upload"]["evidence"])

    def test_factory_selects_live_not_compatible_dead_handler(self):
        root = self.fixture("factory-registration")
        handlers = ModuleType("handlers")
        handlers.__dict__.update(runpy.run_path(str(root / "handlers.py")))
        with patch.dict(sys.modules, {"handlers": handlers}):
            registry = runpy.run_path(str(root / "registry.py"))
        self.assertEqual(registry["build"]("checkout").handle(), "live")
        self.assertNotIn(handlers.DeadHandler, registry["HANDLERS"].values())
        with self.assertRaises(KeyError):
            registry["build"]("unregistered")

    def test_string_event_binding_preserves_exact_keys_and_direction(self):
        root = self.fixture("string-event-binding")
        producer = runpy.run_path(str(root / "producer.py"))
        consumer = runpy.run_path(str(root / "consumer.py"))
        subscriptions = {}
        bus = SimpleNamespace(subscribe=lambda name, callback: subscriptions.setdefault(name, callback), publish=Mock())
        receipt = Mock()
        consumer["register"](bus, receipt)
        producer["complete_order"](bus, "order-1")
        bus.publish.assert_called_once_with("order.completed", {"id": "order-1"})
        self.assertIs(subscriptions["order.completed"], receipt)
        self.assertIsNot(subscriptions["order.refunded"], receipt)
        self.assertNotIn("order.missing", subscriptions)

    def test_stale_documentation_remains_an_intentional_contradiction(self):
        root = self.fixture("stale-doc-conflict")
        checkout = runpy.run_path(str(root / "checkout.py"))["checkout"]
        queue = SimpleNamespace(enqueue=Mock())
        self.assertEqual(checkout(queue, SimpleNamespace(id="order-1")), {"accepted": True})
        queue.enqueue.assert_called_once_with("charge-card", "order-1")
        self.assertIn("synchronously", (root / "README.md").read_text())

    def test_missing_backend_authorization_is_not_repaired_out_of_fixture(self):
        root = self.fixture("missing-server-enforcement")
        delete = runpy.run_path(str(root / "api.py"))["delete_project"]
        request = SimpleNamespace(user=SimpleNamespace(role="viewer"), db=SimpleNamespace(delete_project=Mock(return_value="deleted")))
        self.assertEqual(delete(request, "project-1"), "deleted")
        request.db.delete_project.assert_called_once_with("project-1")
        self.assertIn("user.role === 'admin'", (root / "web.ts").read_text())

    def test_unrelated_edit_preserves_established_claim_and_evidence(self):
        root = self.fixture("unrelated-edit-preservation")
        before = self.persist(root, [("feature.checkout", "feature", ["feature.py"])])["feature.checkout"]
        (root / "unrelated.py").write_text("BANNER_TEXT = 'Changed independently'\n")
        run(root, OUT, "update")
        after = next(e for e in load(root, OUT)["entities"] if e["id"] == "feature.checkout")
        self.assertEqual(before, after)
        self.assertEqual(after["confidence"], "EXTRACTED")

    def test_dependency_edit_quarantines_dependents_not_isolated_support(self):
        root = self.fixture("dependency-edit-invalidation")
        self.persist(root, [("setting.tax", "setting", ["config.py"]), ("feature.checkout", "feature", ["checkout.py"]),
                            ("setting.support", "setting", ["unrelated.py"])], [("setting.tax", "feature.checkout", "config.py")])
        (root / "config.py").write_text("TAX_RATE = 0.25\n")
        run(root, OUT, "update")
        entities = {e["id"]: e for e in load(root, OUT)["entities"]}
        self.assertEqual(entities["setting.tax"]["confidence"], "UNKNOWN")
        self.assertEqual(entities["feature.checkout"]["confidence"], "UNKNOWN")
        self.assertEqual(entities["setting.support"]["confidence"], "EXTRACTED")

    def test_same_paths_in_separate_roots_do_not_share_evidence(self):
        root = self.fixture("cross-repo-identity")
        a, b = root / "repo-a", root / "repo-b"
        entities = self.persist(a, [("feature.billing", "feature", ["src/service.py"])])
        run(b, OUT, "bootstrap")
        self.assertNotIn("feature.billing", {e["id"] for e in load(b, OUT)["entities"]})
        ref = next(e for e in load(a, OUT)["evidence"] if e["id"] == entities["feature.billing"]["evidence"][0])
        self.assertIsNone(verify(a, ref, OUT))
        self.assertTrue(verify(b, ref, OUT))
