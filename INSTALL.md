# Setup and updates

## Requirements

Python 3.10 or newer and Git. No Python runtime dependencies, API keys, service signup or background process are required. Claude/Codex installation and authentication are managed by those hosts.

Code-intelligence retrieval is host-managed: the native session follows applicable `AGENTS.md`, `CLAUDE.md` and equivalent repository/ancestor instructions and may use any installed structural, symbol, semantic-search or code-graph tool described there. No specific code-intelligence product is required by the CLI.

## Codex

```bash
codex plugin marketplace add bpstr/understand-code
codex plugin add understand-code@understand-code
```

## Claude Code

```bash
claude plugin marketplace add bpstr/understand-code
claude plugin install understand-code@understand-code
```

## Open Agent Skills

```bash
npx skills add bpstr/understand-code --skill understand-code
```

## Standalone CLI

```bash
uv tool install 'git+https://github.com/bpstr/understand-code.git@v1.0.0'
understand-code --version
```

## First reconstruction

```bash
understand-code bootstrap /path/to/repo --provider codex
```

The default creates an isolated worktree from a clean committed checkout. Use `--write-mode local` when repository policy requires the current branch or uncommitted source must be included. No source files are modified.

Modes: quick = up to 6 tasks × 24 paths; standard = 18 × 40; deep = 36 × 60. Scan limits default to 2,000 files and 5 MB of UTF-8 text. `--max-files` and `--max-bytes` adjust them. Skipped/deferred coverage is explicit.

After source changes:

```bash
understand-code update --repo /path/to/spec-worktree --base origin/main
understand-code status --repo /path/to/spec-worktree
```

## Local development

```bash
git clone https://github.com/bpstr/understand-code.git
cd understand-code
python3 -m venv .venv
.venv/bin/python -m pip install -e .
python3 scripts/build_bundle.py
PYTHONPATH=src python3 -m unittest discover -s tests -v
python3 scripts/check_distribution.py
```

Edit canonical code under `src/`, contracts under `schemas/`, and role objectives in `src/understand_code/spec/planner.py`. Regenerate the bundle after edits; CI rejects stale copies.
