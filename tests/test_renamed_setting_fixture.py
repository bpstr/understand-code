"""Prepared fixture integrity, not model recall or live transport qualification."""
from pathlib import Path
import runpy
import unittest


class RenamedSettingFixtureTests(unittest.TestCase):
    def test_explicit_serialized_policy_and_server_boundary(self):
        root = Path(__file__).parent / "fixtures/competency/renamed-setting-mapping"
        api = runpy.run_path(str(root / "api/config.py"))
        policy = api["upload_policy"]()
        self.assertEqual(policy, {"maxUploadSize": api["MAX_ATTACHMENT_BYTES"]})
        self.assertTrue(api["accepts_attachment"](policy["maxUploadSize"]))
        self.assertFalse(api["accepts_attachment"](policy["maxUploadSize"] + 1))
        web = (root / "web/upload.ts").read_text()
        self.assertIn("return bytes <= policy.maxUploadSize;", web)
        self.assertNotIn("10 * 1024", web)
