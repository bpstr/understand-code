"""File-bound evidence. Source is data and is never executed."""
from pathlib import Path, PurePosixPath

from .ontology import digest, stable_id

SECRET_NAMES = {".env", ".secrets", "credentials", "credentials.json", "id_rsa", "id_ed25519"}
EXCLUDED = {".git", ".hg", ".svn", "node_modules", ".venv", "venv", "__pycache__",
            "vendor", "dist", "build", "coverage", ".next", "graphify-out", ".codebase-memory"}


def safe_path(root: Path, relative: str) -> Path:
    p = PurePosixPath(relative)
    if p.is_absolute() or not p.parts or any(v in ("..", ".git") for v in p.parts) or "\\" in relative:
        raise ValueError(f"Unsafe repository path: {relative!r}")
    candidate = root.joinpath(*p.parts)
    cursor = root
    for part in p.parts:
        cursor /= part
        if cursor.is_symlink():
            raise ValueError(f"Symlink paths are outside the evidence contract: {relative}")
    if not candidate.resolve().is_relative_to(root.resolve()):
        raise ValueError(f"Path escapes repository: {relative}")
    return candidate


def excluded(path: str, output: str) -> bool:
    parts = PurePosixPath(path).parts
    return (path == output or path.startswith(output.rstrip("/") + "/") or
            any(p in EXCLUDED for p in parts) or any(
                p in SECRET_NAMES or p.startswith((".env.", ".secrets.")) or
                p.endswith((".pem", ".key", ".p12", ".pfx")) for p in parts))


def read_source(root: Path, path: str, limit: int = 1_000_000) -> str:
    file = safe_path(root, path)
    if file.stat().st_size > limit:
        raise ValueError(f"File exceeds {limit} byte evidence limit: {path}")
    data = file.read_bytes()
    if b"\0" in data:
        raise ValueError(f"Binary source: {path}")
    return data.decode("utf-8")


def source_hash(text: str) -> str:
    return digest(text)


def capture(path: str, text: str, start: int, end: int, commit: str, kind: str = "source") -> dict:
    lines = text.splitlines()
    if type(start) is not int or type(end) is not int or not 1 <= start <= end <= len(lines):
        raise ValueError(f"Invalid evidence range: {path}:{start}-{end}")
    excerpt = "\n".join(lines[start - 1:end])
    return {"id": stable_id("evidence", f"{path}:{start}:{end}:{source_hash(text)}:{digest(excerpt)}"), "path": path,
            "start_line": start, "end_line": end, "sha256": source_hash(text),
            "excerpt_sha256": digest(excerpt), "commit": commit, "kind": kind}


def verify(root: Path, record: dict, output: str) -> str | None:
    path = record.get("path", "")
    if excluded(path, output):
        return "Evidence references excluded/generated material"
    try:
        text = read_source(root, path)
        current = capture(path, text, record["start_line"], record["end_line"], record["commit"], record["kind"])
        if current["sha256"] != record["sha256"] or current["excerpt_sha256"] != record["excerpt_sha256"]:
            return "Source changed since evidence was captured"
        if current["id"] != record["id"]:
            return "Evidence ID does not match its source range"
    except (OSError, ValueError, KeyError, UnicodeError) as error:
        return str(error)
    return None
