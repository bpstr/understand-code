#!/usr/bin/env python3
"""Offline package, manifest, schema, link and self-contained runner checks."""
import json
from pathlib import Path
import re
import subprocess
import sys

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "src"))
from understand_code import __version__
from understand_code.ontology import KINDS, RELATIONS


def main():
    errors = []
    for directory in (".codex-plugin", ".claude-plugin"):
        data = json.loads((ROOT / directory / "plugin.json").read_text())
        if data["name"] != "understand-code" or data["version"] != __version__:
            errors.append(f"Version/name mismatch: {directory}")
        if not (ROOT / data["skills"]).is_dir():
            errors.append(f"Missing skill directory: {directory}")
    project = (ROOT / "pyproject.toml").read_text()
    if f'version = "{__version__}"' not in project:
        errors.append("Python project version mismatch")
    market = json.loads((ROOT / ".claude-plugin/marketplace.json").read_text())
    if market["plugins"][0]["version"] != __version__:
        errors.append("Claude marketplace version mismatch")
    for name, vocabulary in (("entity", KINDS), ("relation", RELATIONS)):
        schema = json.loads((ROOT / f"schemas/{name}.schema.json").read_text())
        if schema["properties"]["kind"]["enum"] != list(vocabulary):
            errors.append(f"Schema vocabulary mismatch: {name}")
    for directory in (ROOT / "skills", ROOT / "docs"):
        for file in directory.rglob("*.md"):
            for target in re.findall(r"\[[^\]]*\]\(([^)]+)\)", file.read_text()):
                target = target.split("#", 1)[0]
                if target and not re.match(r"[a-z]+:", target) and not (file.parent / target).exists():
                    errors.append(f"Broken link {file.relative_to(ROOT)} → {target}")
    check = subprocess.run([sys.executable, str(ROOT / "scripts/build_bundle.py"), "--check"], capture_output=True, text=True)
    if check.returncode:
        errors.append(check.stderr)
    runner = subprocess.run([sys.executable, str(ROOT / "skills/understand-code/scripts/run.py"), "--version"],
                            cwd=ROOT.parent, capture_output=True, text=True)
    if runner.returncode or runner.stdout.strip() != __version__:
        errors.append("Self-contained skill runner failed outside repository")
    if errors:
        print("\n".join(errors), file=sys.stderr)
        return 1
    print(f"Distribution valid: {__version__}, {len(KINDS)} entity kinds, {len(RELATIONS)} relation kinds")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
