#!/usr/bin/env python3
"""Build deterministic plugin/skill ZIP archives and SHA-256 sums; never publish."""
import hashlib
from pathlib import Path
import subprocess
import sys
import zipfile

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "src"))
from understand_code import __version__


def archive(path: Path, entries: list[tuple[Path, str]]) -> None:
    with zipfile.ZipFile(path, "w", compression=zipfile.ZIP_DEFLATED) as output:
        for file, name in sorted(entries, key=lambda entry: entry[1]):
            info = zipfile.ZipInfo(name, (2026, 1, 1, 0, 0, 0))
            info.compress_type = zipfile.ZIP_DEFLATED
            info.external_attr = 0o644 << 16
            output.writestr(info, file.read_bytes())


def main():
    subprocess.run([sys.executable, str(ROOT / "scripts/check_distribution.py")], check=True)
    destination = ROOT / "dist"
    destination.mkdir(exist_ok=True)
    roots = [ROOT / p for p in (".codex-plugin", ".claude-plugin", ".agents", "skills", "agents", "docs")]
    entries = [(file, file.relative_to(ROOT).as_posix()) for directory in roots for file in directory.rglob("*")
               if file.is_file() and "__pycache__" not in file.parts and file.suffix != ".pyc"]
    entries += [(ROOT / p, p) for p in ("README.md", "INSTALL.md", "LICENSE", "SECURITY.md", "CHANGELOG.md", "CONTRIBUTING.md")]
    plugin = destination / f"understand-code-{__version__}-plugin.zip"
    skill = destination / f"understand-code-{__version__}-skill.zip"
    archive(plugin, entries)
    archive(skill, [(p, n.removeprefix("skills/")) for p, n in entries if n.startswith("skills/")]
            + [(ROOT / "LICENSE", "understand-code/LICENSE")])
    artifacts = [plugin, skill] + sorted(destination.glob(f"understand_code-{__version__}-*.whl"))
    checksum = destination / "SHA256SUMS"
    checksum.write_text("".join(hashlib.sha256(p.read_bytes()).hexdigest() + "  " + p.name + "\n" for p in artifacts))
    print("\n".join(str(p) for p in artifacts + [checksum]))


if __name__ == "__main__":
    main()
