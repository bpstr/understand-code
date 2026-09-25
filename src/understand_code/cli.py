"""Small CLI; every command is offline and provider-spend-free."""
import argparse
import json
from pathlib import Path
import sys
import subprocess

from . import __version__
from .audit import audit
from .discovery import inventory
from .evidence import capture, read_source, excluded
from .git import head, isolate
from .orchestrator import load, run
from .spec.verifier import verify


def parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(description="Reconstruct an evidence-backed Codebase Spec with native Claude/Codex investigations.")
    p.add_argument("--version", action="version", version=__version__)
    sub = p.add_subparsers(dest="command", required=True)
    for command in ("bootstrap", "focus", "update", "verify", "agent-audit", "status", "apply", "evidence"):
        cmd = sub.add_parser(command)
        cmd.add_argument("--repo", default=".", help="Repository root (use the reported worktree after isolated bootstrap)")
        cmd.add_argument("--output", default="docs/codebase", help="Dedicated output directory, relative to repository")
        cmd.add_argument("--max-files", type=int, default=2000)
        cmd.add_argument("--max-bytes", type=int, default=5_000_000)
        if command in ("bootstrap", "focus", "update", "apply"):
            cmd.add_argument("--mode", choices=("quick", "standard", "deep"), default="standard")
            cmd.add_argument("--provider", choices=("codex", "claude"), default="codex", help="Native task prompt format; never launches a provider")
            cmd.add_argument("--findings", type=Path, action="append", default=[], help="Prepared/native JSON response to ingest; repeatable")
        if command == "bootstrap":
            cmd.add_argument("path", nargs="?", help="Repository path")
            cmd.add_argument("--write-mode", choices=("worktree", "local"), default="worktree")
        if command == "focus":
            cmd.add_argument("topic")
        if command == "update":
            cmd.add_argument("--base", help="Git revision; includes committed, staged, unstaged, deleted and renamed files")
        if command == "verify":
            cmd.add_argument("--require-complete", action="store_true", help="Also fail on pending/deferred investigation coverage")
        if command == "evidence":
            cmd.add_argument("path")
            cmd.add_argument("--start", type=int, required=True)
            cmd.add_argument("--end", type=int, required=True)
            cmd.add_argument("--kind", choices=("source", "test", "config", "documentation", "human"), default="source")
    return p


def main(argv=None) -> int:
    args = parser().parse_args(argv)
    try:
        if args.max_files < 1 or args.max_bytes < 1:
            raise ValueError("Scan budgets must be positive")
        root = Path(args.path if args.command == "bootstrap" and args.path else args.repo).resolve()
        if not root.is_dir():
            raise ValueError("Repository directory does not exist")
        if args.command == "bootstrap" and args.write_mode == "worktree":
            root = isolate(root)
        if args.command in ("bootstrap", "focus", "update", "apply"):
            result = run(root, args.output, args.command, args.mode, args.provider,
                         getattr(args, "topic", None), getattr(args, "base", None), args.findings,
                         args.max_files, args.max_bytes)
        elif args.command == "evidence":
            if excluded(args.path, args.output):
                raise ValueError("Cannot cite generated output, secrets, or excluded paths")
            result = capture(args.path, read_source(root, args.path), args.start, args.end, head(root), args.kind)
        elif args.command == "agent-audit":
            result = audit(root, inventory(root, args.output, args.max_files, args.max_bytes))
        else:
            state = load(root, args.output)
            if not state:
                raise ValueError("No Codebase Spec exists. Run bootstrap first.")
            current = inventory(root, args.output, args.max_files, args.max_bytes)
            checks = verify(root, args.output, state, current)
            result = checks if args.command == "verify" else {"manifest": state["manifest"], "verification": checks,
                      "tasks": [{"id": t["id"], "role": t["role"], "status": t["status"]} for t in state["plan"]["tasks"]]}
            if args.command == "verify" and (not checks["ok"] or (args.require_complete and not checks["coverage_complete"])):
                print(json.dumps(result, indent=2))
                return 1
        print(json.dumps(result, indent=2))
        return 0
    except (ValueError, OSError, KeyError, TypeError, subprocess.SubprocessError) as error:
        print(json.dumps({"error": str(error)}), file=sys.stderr)
        return 2


if __name__ == "__main__":
    raise SystemExit(main())
