# Understand Code

**Reconstruct what a codebase does, where its features live, and how changes travel through it—with source evidence.**

Understand Code is a Python CLI and self-contained Claude Code / Codex skill. It produces a repository-native **Codebase Spec** in `docs/codebase/`: Markdown concept pages, source citations, typed relationships, change maps and explicit knowledge gaps.

It combines deterministic inventory and validation with bounded investigations in your existing Claude or Codex session. It never starts provider subprocesses, executes the target application, or silently spends API credits.

## Code intelligence

Understand Code is deliberately tool-agnostic. The native session follows applicable repository/ancestor instructions such as `AGENTS.md` or `CLAUDE.md` and may use any installed code-intelligence, symbol, semantic-search or code-graph tool described there. If none is configured or useful, it falls back to bounded source/file search. External retrieval output is never evidence by itself; persisted claims require exact current-source evidence.

## Install

```bash
codex plugin marketplace add bpstr/understand-code
codex plugin add understand-code@understand-code
```

or:

```bash
claude plugin marketplace add bpstr/understand-code
claude plugin install understand-code@understand-code
```

Standalone CLI, Python 3.10+ and Git:

```bash
uv tool install 'git+https://github.com/bpstr/understand-code.git@v1.0.0'
understand-code bootstrap /path/to/repository
```

## Workflow

```text
Source + repository-configured retrieval tools
          ↓ deterministic inventory
Bounded native specialist investigations
          ↓ cited findings + source review
Codebase Spec
          ↓ source verification
Task planning / implementation / deep-code-review
          ↓ Git diff + semantic impact
Updated Codebase Spec
```

```bash
understand-code bootstrap .
understand-code bootstrap . --write-mode local
understand-code focus "checkout" --repo /path/to/worktree
understand-code update --repo /path/to/worktree --base origin/main
understand-code verify --repo /path/to/worktree
understand-code agent-audit --repo /path/to/worktree
understand-code status --repo /path/to/worktree
```

Bootstrap inventories the repository and writes an investigation plan. It does not invent product features from filenames or claim a semantic reconstruction is finished. Native investigations capture exact source evidence and apply reviewed findings through the deterministic engine.

## What ships

- Git-aware structural discovery, manifests, language inventory and bounded candidates.
- 18 native specialist roles with quick/standard/deep budgets.
- Typed semantic entities and directed relationships with stable IDs and aliases.
- Exact source ranges, file/excerpt hashes, confidence and review provenance.
- Incremental Git updates, stale-claim quarantine and explicit gaps.
- Maintainer-note preservation and generated-region protection.
- Tool-agnostic retrieval governed by repository/host instructions.
- Codex/Claude manifests, standalone CLI and offline deterministic CI.

`EXTRACTED` means reviewed direct evidence; `CORROBORATED` requires independent evidence; `INFERRED` is incomplete interpretation; `UNKNOWN` is unresolved. Mechanical checks prove citation identity and freshness, not natural-language truth. Retrieval tools provide hints only. Tests establish assertions, not passing runtime behavior.

## Develop

```bash
python3 -m venv .venv
.venv/bin/python -m pip install -e .
PYTHONPATH=src .venv/bin/python -m unittest discover -s tests -v
python3 scripts/build_bundle.py --check
python3 scripts/check_distribution.py
```

All automated tests are offline and deterministic. MIT licensed.
