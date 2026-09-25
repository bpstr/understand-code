"""Offline prepared-fixture behavior and bounded planning regressions."""
from pathlib import Path
import runpy
import shutil
import tempfile
from types import SimpleNamespace
import unittest
from unittest.mock import Mock, patch

from understand_code.discovery import inventory
from understand_code.orchestrator import load, run
from understand_code.spec.planner import balanced_paths


class LatePackageFixtureTests(unittest.TestCase):
    def test_failure_handler_uses_explicit_retry_dependency(self):
        root = Path(__file__).parent / "fixtures/competency/late-package-coverage"
        handler = runpy.run_path(str(root / "zzz_payments/webhook.py"))["payment_webhook"]
        retry = Mock(return_value="queued")
        self.assertEqual(handler(SimpleNamespace(event="payment.failed", order_id="order-1"), retry), "queued")
        retry.assert_called_once_with("order-1")
        retry.reset_mock()
        self.assertIsNone(handler(SimpleNamespace(event="payment.succeeded", order_id="order-1"), retry))
        retry.assert_not_called()

    def test_quick_cartography_does_not_starve_late_package(self):
        fixture = Path(__file__).parent / "fixtures/competency/late-package-coverage"
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary) / "repo"
            shutil.copytree(fixture, root)
            for package in ("aaa_noise", "mmm_noise"):
                for n in range(80):
                    (root / package / f"noise_{n:03}.py").write_text("def helper(): return 'noise'\n")
            with patch("socket.socket.connect", side_effect=AssertionError("Offline fixtures only")):
                run(root, "docs/codebase", "bootstrap", mode="quick")
            plan = load(root, "docs/codebase")["plan"]
            first = next(t for t in plan["tasks"] if t["role"] == "repository-cartographer")
            self.assertIn("zzz_payments/webhook.py", first["paths"])
            self.assertLessEqual(len(plan["tasks"]), 6)
            self.assertTrue(all(len(t["paths"]) <= 24 for t in plan["tasks"]))
            self.assertTrue(plan["deferred"])
            expected = set(inventory(root, "docs/codebase")["files"])
            accounted = {p for t in plan["tasks"] + plan["deferred"] if t["role"] == "repository-cartographer" for p in t["paths"]}
            self.assertEqual(accounted, expected)

    def test_nested_packages_are_balanced_without_losing_paths(self):
        paths = [f"packages/aaa/part/{n:03}.py" for n in range(70)] + ["packages/zzz/handler.py", "README.md"]
        result = balanced_paths(paths)
        self.assertIn("packages/zzz/handler.py", result[:3])
        self.assertEqual(result, balanced_paths(list(reversed(paths))))
        self.assertEqual(set(result), set(paths))
        self.assertEqual(len(result), len(paths))
