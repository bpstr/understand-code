#!/usr/bin/env python3
"""Exercise released entrypoints on a copied fixture with no inference or network."""
from pathlib import Path
import json
import shutil
import subprocess
import sys
import tempfile
import zipfile

ROOT = Path(__file__).resolve().parents[1]


def main():
    with tempfile.TemporaryDirectory(prefix="understand-code-artifacts-") as temporary:
        temp = Path(temporary)
        fixture = temp / "fixture"
        shutil.copytree(ROOT / "tests/fixtures/legacy", fixture)
        skill_archive = next((ROOT / "dist").glob("*-skill.zip"))
        wheel = next((ROOT / "dist").glob("*.whl"))
        for name, archive in (("skill", skill_archive), ("wheel", wheel)):
            target = temp / name
            with zipfile.ZipFile(archive) as bundle:
                bundle.extractall(target)
            schema_root = target / ("understand-code/scripts/lib/understand_code" if name == "skill" else "understand_code")
            schema = json.loads((schema_root / "resources/finding.schema.json").read_text())
            if "evidence" not in schema["required"]:
                raise ValueError("Packaged evidence contract missing")
            if name == "skill":
                command = [sys.executable, str(target / "understand-code/scripts/run.py")]
            else:
                # A wheel is importable after extraction; this checks embedded schema resources too.
                command = [sys.executable, "-c", "import sys; sys.path.insert(0, sys.argv.pop(1)); from understand_code.cli import main; raise SystemExit(main())", str(target)]
            subprocess.run(command + ["bootstrap", str(fixture), "--write-mode", "local", "--output", f"docs/{name}"],
                           cwd=temp, check=True, capture_output=True)
            subprocess.run(command + ["verify", "--repo", str(fixture), "--output", f"docs/{name}"],
                           cwd=temp, check=True, capture_output=True)
            # Exclude earlier artifact output from the next scan.
            shutil.rmtree(fixture / "docs")
        print("Released skill and wheel bootstrap/verify passed on prepared fixtures; no provider calls")


if __name__ == "__main__":
    main()
