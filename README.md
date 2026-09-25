# Understand Code

**Reconstruct what a codebase does, where its features live, and how changes travel through it—with source evidence.**

Understand Code is a Python CLI and self-contained Claude Code / Codex skill. It produces a repository-native **Codebase Spec** in `docs/codebase/`: Markdown concept pages, source citations, typed relationships, change maps and explicit knowledge gaps.

It combines deterministic inventory and validation with bounded investigations in your existing Claude or Codex session. It never starts provider subprocesses, executes the target application, or silently spends API credits.

## Code intelligence

Understand Code is tool-agnostic. Native investigations follow applicable repository/ancestor `AGENTS.md`, `CLAUDE.md` and host instructions to select available code-intelligence tools. When none is configured, available or sufficient, use bounded source/file search. External output is retrieval context, never source evidence. See [retrieval policy](docs/CODE_INTELLIGENCE.md).

## Install

**Codex plugin**

```bash
codex plugin marketplace add bpstr/understand-code
codex plugin add understand-code@understand-code
```

Start a new task and invoke `$understand-code reconstruct this repository`.

**Claude Code plugin**

```bash
claude plugin marketplace add bpstr/understand-code
claude plugin install understand-code@understand-code
```

Restart Claude Code and invoke `/understand-code:understand-code reconstruct this repository`.

**Standalone CLI** — Python 3.10+, Git, no runtime Python dependencies:

```bash
uv tool install 'git+https://github.com/bpstr/understand-code.git@v1.0.0'
understand-code bootstrap /path/to/repository
```

The plugin already includes the runner; installing the CLI is optional. See [complete setup and updates](INSTALL.md), including Open Agent Skills and local development.

## Workflow

```text
Source + repository-configured retrieval tools
          ↓ deterministic inventory
Bounded native specialist investigations
          ↓ cited findings + source review
Codebase Spec + typed semantic model
          ↓ source verification
Task planning / implementation / deep-code-review
          ↓ Git diff + semantic impact
Updated Codebase Spec
```

```bash
understand-code bootstrap .                       # dedicated worktree by default
understand-code bootstrap . --write-mode local    # docs on the current branch
understand-code focus "checkout" --repo /path/to/worktree
understand-code update --repo /path/to/worktree --base origin/main
understand-code verify --repo /path/to/worktree
understand-code agent-audit --repo /path/to/worktree
understand-code status --repo /path/to/worktree
```

Bootstrap inventories the repository and writes an investigation plan. It **does not invent product features** from filenames or claim a semantic reconstruction is finished. The skill performs the planned investigations, captures exact source evidence, and applies reviewed findings through the same deterministic engine. [Native workflow and contracts](docs/WORKFLOW.md).

## What ships

| Capability | Behavior |
| --- | --- |
| Structural discovery | Git-aware file inventory, language/manifests, Python symbols, route/settings/UI/data/event/test candidates, explicit scan limits |
| Native agents | 18 specialist roles; adaptive quick/standard/deep budgets; Claude/Codex task formats; sequential or authorized native delegation |
| Semantic model | 18 entity kinds and 22 directed relation types; stable IDs, aliases, feature/flow pages and source-linked change maps |
| Evidence | Exact ranges, file and excerpt hashes, source snapshots, explicit confidence and recorded semantic review |
| Incremental updates | Git base + working-tree hashes; renames/deletions; transitive semantic impact; stale claims demoted to UNKNOWN |
| Human knowledge | Maintainer notes preserved; generated edits block replacement; conflicts retain alternatives |
| Agent readiness | Instruction scopes, size, duplicate content, missing link observations and bounded recommendations |
| Distribution | Codex/Claude manifests and marketplaces, standalone skill runner, installable Python package, offline CI and release archives |

The default output includes overview, concept pages, evidence, instruction/readiness reports, operational pointers, glossary and gaps. Relevant feature/flow/settings/UI/data pages appear when findings support them. Empty architecture claims are not filled with plausible prose.

## Truth and limitations

`EXTRACTED` means reviewed, direct evidence; `CORROBORATED` requires independent evidence; `INFERRED` is incomplete interpretation; `UNKNOWN` is an unresolved question. Mechanical checks can establish that a citation exists and is current. **They cannot prove a natural-language claim is true.** Reviewer provenance, gaps and coverage remain visible.

External tool results are retrieval hints. Regex matches are candidates. Test source establishes assertions, not a passing test run. Static links do not establish runtime reachability. Architectural intent needs explicit evidence. There is no live-provider quality claim: the shipped regression suite uses prepared fixtures only.

This release does not execute runtime traces or run autonomous paid headless agents. Native sessions provide reasoning and optional repository-configured retrieval; no external index refresh is owned by the engine. These boundaries and the [v1 acceptance map](docs/ACCEPTANCE.md) distinguish implemented capabilities from future extensions.

## Develop

```bash
python3 -m venv .venv
.venv/bin/python -m pip install -e .
PYTHONPATH=src .venv/bin/python -m unittest discover -s tests -v
python3 scripts/build_bundle.py
python3 scripts/check_distribution.py
```

All automated tests are offline and deterministic. Never load `.secrets`, record fixtures from providers, or add a paid test opt-in. See [testing policy](docs/TESTING.md) and [contributing](CONTRIBUTING.md).

Inspired by the bounded specialist pattern in [deep-code-review](https://github.com/bpstr/deep-code-review). The implementation is original. Plugin setup follows the host's [Codex plugin interface](https://learn.chatgpt.com/docs/plugins) and [Claude plugin reference](https://code.claude.com/docs/en/plugins-reference).

MIT licensed. [Changelog](CHANGELOG.md) · [Architecture](docs/ARCHITECTURE.md) · [Security](SECURITY.md)
