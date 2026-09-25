"""Bounded, language-neutral inventory plus exact Python syntax extraction.

Regex matches are candidates, never asserted execution or business semantics.
"""
import ast
from collections import Counter
import fnmatch
import os
from pathlib import Path
import re

from . import evidence
from .git import files, head

LANGUAGES = {".py": "Python", ".js": "JavaScript", ".jsx": "JavaScript", ".ts": "TypeScript",
             ".tsx": "TypeScript", ".go": "Go", ".rs": "Rust", ".rb": "Ruby", ".php": "PHP",
             ".java": "Java", ".cs": "C#", ".swift": "Swift", ".kt": "Kotlin",
             ".vue": "Vue", ".svelte": "Svelte", ".sql": "SQL", ".sh": "Shell"}
MANIFESTS = {"package.json", "pyproject.toml", "Cargo.toml", "go.mod", "composer.json", "Gemfile",
             "pom.xml", "build.gradle", "Makefile", "Dockerfile", "docker-compose.yml", "compose.yml"}
INSTRUCTIONS = {"AGENTS.md", "AGENTS.override.md", "CLAUDE.md", "GEMINI.md", "CONTRIBUTING.md",
                "copilot-instructions.md"}
PATTERNS = {
    "entrypoint": r"(?:@\w+\.(?:get|post|put|patch|delete|route)\(|\b(?:app|router)\.(?:get|post|put|patch|delete)\(|\b(?:webhook|urlpatterns|APIRouter|createServer)\b|__name__\s*==)",
    "setting": r"(?:\b(?:getenv|environ|process\.env|featureFlag|feature_flag|settings|config)\b)",
    "data_entity": r"(?:\b(?:CREATE TABLE|class \w+\([^)]*Model|model \w+\s*\{|schema|migration)\b)",
    "ui_surface": r"(?:\b(?:function [A-Z]\w*|(?:const|let) [A-Z]\w*|useState|useStore|createRouter|createBrowserRouter)\b|<(?:template|form|Route)\b|\b(?:path|element|Component)\s*:)",
    "event": r"(?:\b(?:emit|publish|subscribe|enqueue|consumer|dispatch|queue)\s*\()",
    "permission": r"(?:\b(?:permission|authorize|isAdmin|hasRole|requireAuth|check_access)\b)",
    "external_system": r"(?:\b(?:fetch|requests\.(?:get|post)|axios|https?://|stripe|boto3)\b)",
    "test_behavior": r"(?:\b(?:def test_|test\(|it\(|describe\(|assert\b))",
}


def inventory(root: Path, output: str, max_files: int = 2000, max_bytes: int = 5_000_000) -> dict:
    names = files(root)
    if names is None:
        names = []
        for directory, dirs, filenames in os.walk(root, followlinks=False):
            dirs[:] = sorted(d for d in dirs if d not in evidence.EXCLUDED and
                             not (Path(directory) / d).is_symlink())
            for name in sorted(filenames):
                names.append((Path(directory) / name).relative_to(root).as_posix())
    ignores = []
    ignore_file = root / ".understand-codeignore"
    if ignore_file.is_file() and not ignore_file.is_symlink():
        ignores = [s.strip() for s in ignore_file.read_text().splitlines() if s.strip() and not s.startswith("#")]
    records, skipped, refs, candidates = {}, [], {}, []
    ignored, deleted, limitations = [], [], []
    languages = Counter()
    commit = head(root)
    total = 0
    for path in sorted(names):
        if evidence.excluded(path, output):
            continue
        if any(fnmatch.fnmatch(path, pat) for pat in ignores):
            ignored.append({"path": path, "reason": "repository ignore rule"})
            continue
        if len(records) >= max_files:
            skipped.append({"path": path, "reason": "file budget"})
            continue
        try:
            text = evidence.read_source(root, path)
        except FileNotFoundError:
            deleted.append(path)
            continue
        except (OSError, ValueError, UnicodeError) as error:
            skipped.append({"path": path, "reason": type(error).__name__})
            continue
        size = len(text.encode())
        if total + size > max_bytes:
            skipped.append({"path": path, "reason": "byte budget"})
            continue
        total += size
        p = Path(path)
        kind = "test" if ("test" in p.parts or "tests" in p.parts or p.name.startswith("test_") or ".test." in p.name or ".spec." in p.name) else "source"
        if p.suffix == ".md":
            kind = "documentation"
        if p.name in MANIFESTS or p.suffix in (".json", ".toml", ".yaml", ".yml"):
            kind = "config"
        records[path] = {"sha256": evidence.source_hash(text), "bytes": size, "lines": len(text.splitlines()),
                         "kind": kind, "language": LANGUAGES.get(p.suffix), "manifest": p.name in MANIFESTS,
                         "instruction": p.name in INSTRUCTIONS or ".cursor" in p.parts}
        if p.suffix in LANGUAGES:
            languages[LANGUAGES[p.suffix]] += 1
        if text.splitlines():
            ref = evidence.capture(path, text, 1, min(8, len(text.splitlines())), commit, kind)
            refs[ref["id"]] = ref
            records[path]["evidence"] = ref["id"]
        for line_number, line in enumerate(text.splitlines(), 1):
            if p.suffix not in LANGUAGES and p.name not in MANIFESTS:
                continue
            for category, pattern in PATTERNS.items():
                if re.search(pattern, line):
                    ref = evidence.capture(path, text, line_number, line_number, commit, kind)
                    refs[ref["id"]] = ref
                    candidates.append({"kind": category, "path": path, "line": line_number,
                                       "evidence": ref["id"], "confidence": "INFERRED"})
        if p.suffix in (".js", ".jsx", ".ts", ".tsx", ".vue", ".svelte"):
            # Routing hints only: native inspection must resolve wrappers and bindings.
            for number, line in enumerate(text.splitlines(), 1):
                for match in re.finditer(r"<[A-Z][\w.]*\b|\b(?:import|export)\s+[^;]+\bfrom\s*['\"]", line):
                    ref = evidence.capture(path, text, number, number, commit, kind)
                    refs[ref["id"]] = ref
                    candidates.append({"kind": "composition", "path": path, "line": number,
                                       "column": match.start() + 1, "name": match.group(),
                                       "evidence": ref["id"], "confidence": "INFERRED"})
                if re.search(r"\bimport\s*\(|\b(?:React\.)?createElement\s*\(|\b(?:eval|new Function)\s*\(", line):
                    limitations.append({"path": path, "reason": f"dynamic binding at line {number}; static roster cannot resolve it"})
        if p.suffix == ".py":
            try:
                tree = ast.parse(text)
                for node in ast.walk(tree):
                    if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef, ast.ClassDef)):
                        ref = evidence.capture(path, text, node.lineno, node.end_lineno or node.lineno, commit, kind)
                        refs[ref["id"]] = ref
                        candidates.append({"kind": "symbol", "name": node.name, "path": path,
                                           "line": node.lineno, "evidence": ref["id"], "confidence": "EXTRACTED"})
            except SyntaxError:
                skipped.append({"path": path, "reason": "Python syntax extraction unavailable; text retained"})
    return {"commit": commit, "files": records, "languages": dict(languages), "candidates": candidates,
            "evidence": list(refs.values()), "skipped": skipped, "bytes_read": total,
            "ignored": ignored, "deleted": deleted, "limitations": limitations,
            "discovery_policy": "surface-roster-v1",
            "limits": {"max_files": max_files, "max_bytes": max_bytes}}
