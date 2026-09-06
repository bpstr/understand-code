"""Git operations with literal arguments and explicit worktree isolation."""
from pathlib import Path
import subprocess
import uuid


def git(root: Path, *args: str, optional: bool = False) -> str:
    result = subprocess.run(["git", "-C", str(root), *args], capture_output=True, timeout=30)
    if result.returncode and not optional:
        raise ValueError(result.stderr.decode("utf-8", "replace").strip() or "Git command failed")
    return result.stdout.decode("utf-8", "surrogateescape").strip() if not result.returncode else ""


def head(root: Path) -> str:
    return git(root, "rev-parse", "--verify", "HEAD", optional=True) or "uncommitted"


def files(root: Path) -> list[str] | None:
    if not git(root, "rev-parse", "--show-toplevel", optional=True):
        return None
    # NUL separation preserves whitespace in repository paths.
    raw = subprocess.run(["git", "-C", str(root), "ls-files", "-z", "--cached", "--others",
                          "--exclude-standard"], capture_output=True, check=True, timeout=30).stdout
    return sorted(set(p.decode("utf-8", "surrogateescape") for p in raw.split(b"\0") if p))


def changes(root: Path, base: str) -> list[dict]:
    revision = git(root, "rev-parse", "--verify", "--end-of-options", base + "^{commit}")
    result = subprocess.run(["git", "-C", str(root), "diff", "--name-status", "-z", "-M",
                             revision, "--"], capture_output=True, check=True, timeout=30)
    tokens = result.stdout.decode("utf-8", "surrogateescape").split("\0")
    output = []
    i = 0
    while i < len(tokens) and tokens[i]:
        status, path = tokens[i:i + 2]
        i += 2
        item = {"status": status, "path": path}
        if status.startswith(("R", "C")):
            item["old_path"], item["path"] = path, tokens[i]
            i += 1
        output.append(item)
    return output


def isolate(root: Path) -> Path:
    if head(root) == "uncommitted":
        raise ValueError("Worktree mode requires a commit. Use --write-mode local for an unborn/non-Git repository.")
    if git(root, "status", "--porcelain"):
        raise ValueError("Worktree mode needs a clean checkout; commit first or explicitly use --write-mode local.")
    name = "understand-code-" + uuid.uuid4().hex[:8]
    destination = root.parent / (root.name + "-" + name)
    git(root, "worktree", "add", "-b", "codex/" + name, str(destination), "HEAD")
    return destination
