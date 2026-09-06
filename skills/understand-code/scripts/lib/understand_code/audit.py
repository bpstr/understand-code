"""Instruction audit produces observations and recommendations, never edits."""
import re
from pathlib import Path

from .evidence import read_source


def audit(root: Path, inventory: dict) -> dict:
    instructions = []
    issues = []
    texts = {}
    for path, info in inventory["files"].items():
        if not info["instruction"]:
            continue
        text = read_source(root, path)
        texts[path] = text
        instructions.append({"path": path, "bytes": info["bytes"], "evidence": info.get("evidence"),
                             "scope": str(Path(path).parent), "override": Path(path).name == "AGENTS.override.md"})
        if info["bytes"] > 16_000:
            issues.append({"path": path, "confidence": "EXTRACTED", "issue": "Instruction file exceeds 16 KiB; consider scoped references."})
        for label, pattern in {"build/test guidance": r"\b(test|pytest|unittest|build|check)\b",
                               "Git workflow": r"\b(branch|commit|pull request|worktree)\b",
                               "architecture pointer": r"codebase|architecture"}.items():
            if not re.search(pattern, text, re.I):
                issues.append({"path": path, "confidence": "INFERRED", "issue": f"No {label} keyword found; inspect before recommending additions."})
        for link in re.findall(r"\[[^\]]+\]\(([^)#]+)(?:#[^)]*)?\)", text):
            if "://" not in link and not link.startswith(("mailto:", "#", "/")):
                if not (root / Path(path).parent / link).exists():
                    issues.append({"path": path, "confidence": "EXTRACTED", "issue": f"Local link target is missing: {link}"})
    if not instructions:
        issues.append({"path": None, "confidence": "UNKNOWN", "issue": "No supported instruction files found within the scanned scope."})
    for left, text in texts.items():
        for right, other in texts.items():
            if left < right and text.strip() and text.strip() == other.strip():
                issues.append({"path": left, "confidence": "EXTRACTED", "issue": f"Content duplicates {right}."})
    return {"instructions": instructions, "issues": issues,
            "limitations": ["Keyword checks do not prove missing guidance or instruction conflicts.",
                            "Resolve semantic conflicts with the instruction-auditor specialist.",
                            "Read applicable ancestor and host-level instructions outside the scanned root manually."]}
