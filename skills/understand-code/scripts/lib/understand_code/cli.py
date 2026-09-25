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
from .coverage import new_request, assess
from .change_scope import INTENTS


def parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(description="Reconstruct an evidence-backed Codebase Spec with native Claude/Codex investigations.")
    p.add_argument("--version", action="version", version=__version__)
    sub = p.add_subparsers(dest="command", required=True)
    for command in ("bootstrap", "focus", "update", "verify", "agent-audit", "status", "apply", "evidence", "scope", "export-knowledge", "import-knowledge"):
        cmd = sub.add_parser(command)
        cmd.add_argument("--repo", default=".", help="Repository root (use the reported worktree after isolated bootstrap)")
        cmd.add_argument("--output", default="docs/codebase", help="Dedicated output directory, relative to repository")
        cmd.add_argument("--max-files", type=int, default=2000)
        cmd.add_argument("--max-bytes", type=int, default=5_000_000)
        if command in ("bootstrap", "focus", "update", "apply", "scope", "import-knowledge"):
            cmd.add_argument("--mode", choices=("quick", "standard", "deep"), default="standard")
            cmd.add_argument("--provider", choices=("codex", "claude"), default="codex", help="Native task prompt format; never launches a provider")
            cmd.add_argument("--graph", default="graphify-out/graph.json", help="Existing Graphify node-link export")
            cmd.add_argument("--findings", type=Path, action="append", default=[], help="Prepared/native JSON response to ingest; repeatable")
        if command in ("scope", "apply", "verify"):
            cmd.add_argument("--change-scope", help="Existing snapshot-bound scope ID")
        if command == "apply":
            cmd.add_argument("--ledger", type=Path, action="append", default=[], help="Source-reviewed change packet; repeatable")
        if command in ("export-knowledge", "import-knowledge"):
            cmd.add_argument("--file", type=Path, required=True)
        if command == "scope":
            cmd.add_argument("topic", nargs="?", help="Intent topic; omit when resuming --change-scope")
            cmd.add_argument("--intent", choices=INTENTS, default="cross_cutting")
            cmd.add_argument("--criteria", type=Path, help="Explicit change-standard JSON; absent criteria block completion")
            cmd.add_argument("--amend-standard", action="store_true", help="Explicitly revise criteria while preserving the baseline/obligation history")
            cmd.add_argument("--example", action="append", default=[], help="Example path, NOT a boundary")
            cmd.add_argument("--boundary", action="append", default=[], help="Explicit included path prefix; repeatable")
            cmd.add_argument("--exclude-path", action="append", default=[], help="Explicit excluded path prefix; repeatable")
            cmd.add_argument("--max-depth", type=int, default=8)
            cmd.add_argument("--max-nodes", type=int, default=500)
        if command == "bootstrap":
            cmd.add_argument("path", nargs="?", help="Repository path")
            cmd.add_argument("--write-mode", choices=("worktree", "local"), default="worktree")
        if command == "focus":
            cmd.add_argument("topic")
        if command == "update":
            cmd.add_argument("--base", help="Git revision; includes committed, staged, unstaged, deleted and renamed files")
        if command == "verify":
            cmd.add_argument("--require-complete", action="store_true", help="Also fail on pending/deferred investigation coverage")
            cmd.add_argument("--require-change-complete", action="store_true", help="Separate strict occurrence/discovery gate; requires --change-scope")
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
        if args.command == "verify" and args.require_change_complete and not args.change_scope:
            raise ValueError("--require-change-complete requires --change-scope")
        if args.command in ("bootstrap", "focus", "update", "apply", "scope", "import-knowledge"):
            request = None
            if args.command == "scope":
                if args.change_scope:
                    if args.topic or args.boundary or args.example or args.exclude_path or args.intent != "cross_cutting" or args.max_depth != 8 or args.max_nodes != 500:
                        raise ValueError("Resume with --change-scope; do not silently replace its saved request")
                    if bool(args.criteria) != args.amend_standard:
                        raise ValueError("A standard amendment requires both --criteria and --amend-standard")
                    if args.criteria:
                        from copy import deepcopy
                        saved = load(root, args.output)
                        if not saved or args.change_scope not in saved.get("change_scopes", {}):
                            raise ValueError("Unknown change scope")
                        if args.criteria.stat().st_size > 1_000_000:
                            raise ValueError("Acceptance standard exceeds 1 MB")
                        request = deepcopy(saved["change_scopes"][args.change_scope]["request"])
                        from .coverage import validate_standard
                        request["standard"] = json.loads(args.criteria.read_text())
                        validate_standard(request["standard"])
                else:
                    if args.amend_standard:
                        raise ValueError("--amend-standard requires --change-scope")
                    if not args.topic:
                        raise ValueError("New scope requires a topic")
                    standard = None
                    if args.criteria:
                        if args.criteria.stat().st_size > 1_000_000:
                            raise ValueError("Acceptance standard exceeds 1 MB")
                        standard = json.loads(args.criteria.read_text())
                    request = new_request(args.topic, args.intent, standard, args.boundary, args.example,
                                          args.exclude_path, args.max_depth, args.max_nodes)
            result = run(root, args.output, args.command, args.mode, args.provider,
                         getattr(args, "topic", None), getattr(args, "base", None), args.findings,
                         args.graph, args.max_files, args.max_bytes,
                         change_request=request, change_scope=getattr(args, "change_scope", None),
                         ledger_paths=getattr(args, "ledger", None),
                         knowledge_path=args.file if args.command == "import-knowledge" else None,
                         amend_standard=getattr(args, "amend_standard", False))
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
            if args.command == "export-knowledge":
                from .exchange import export_knowledge, write_export
                envelope = export_knowledge(state, current)
                write_export(args.file, envelope)
                print(json.dumps({"file": str(args.file.absolute()), "contract": "change-knowledge", "version": 1,
                                  "entities": len(envelope["entities"]), "occurrences": len(envelope["occurrences"])}))
                return 0
            checks = verify(root, args.output, state, current)
            if args.command == "verify" and args.change_scope:
                scope = state.get("change_scopes", {}).get(args.change_scope)
                if not scope:
                    raise ValueError("Unknown change scope")
                checks["change_coverage"] = assess(scope, state, current)
            result = checks if args.command == "verify" else {"manifest": state["manifest"], "verification": checks,
                      "tasks": [{"id": t["id"], "role": t["role"], "status": t["status"]} for t in state["plan"]["tasks"]]}
            if args.command == "verify" and (not checks["ok"] or (args.require_complete and not checks["coverage_complete"])
                                             or (args.require_change_complete and not checks["change_coverage"]["change_complete"])):
                print(json.dumps(result, indent=2))
                return 1
        print(json.dumps(result, indent=2))
        return 0
    except (ValueError, OSError, KeyError, TypeError, subprocess.SubprocessError) as error:
        print(json.dumps({"error": str(error)}), file=sys.stderr)
        return 2


if __name__ == "__main__":
    raise SystemExit(main())
