# Setup and updates

## Requirements

Python 3.10 or newer; Git for tracked inventories, history, diffs and worktree isolation. No Python runtime dependencies, API keys, service signup or background process are needed. Claude/Codex installation and authentication are managed by those hosts. Native investigations use repository-configured code-intelligence tools as optional retrieval aids. The engine has no vendor-specific importer or required index.

## Codex

```bash
codex plugin marketplace add bpstr/understand-code
codex plugin add understand-code@understand-code
```

Alternatively select Understand Code in the Plugins Directory after adding the marketplace. Open a new task to load the installed skill, then use `$understand-code`. The self-contained runner and contracts live inside the skill cache; no global CLI installation is necessary.

Update the marketplace and reinstall its current snapshot:

```bash
codex plugin marketplace upgrade understand-code
codex plugin add understand-code@understand-code
```

Open a new task after updates. If the host reports the plugin is already installed without refreshing it, remove and add that exact plugin:

```bash
codex plugin remove understand-code@understand-code
codex plugin add understand-code@understand-code
```

CLI verbs are documented from `codex plugin --help`; older host builds may expose installation through their UI. The repository uses the root plugin path, as in the reference repository's marketplace.

## Claude Code

```bash
claude plugin marketplace add bpstr/understand-code
claude plugin install understand-code@understand-code
```

Restart the session. Use `/understand-code:understand-code` with a reconstruction, focus or update request. The plugin also includes 18 read-only specialist agent definitions. Tool access and native delegation remain controlled by the host/user.

Update:

```bash
claude plugin marketplace update understand-code
claude plugin update understand-code@understand-code
```

Restart after updating. For a local checkout, `claude --plugin-dir /absolute/path/to/understand-code` loads the plugin for development; do not run an inference/eval command as an installation test.

## Open Agent Skills

```bash
npx skills add bpstr/understand-code --skill understand-code
```

Choose the target host in the installer. The entire engine, schemas, specialist cards and references are bundled under `skills/understand-code`; copying only SKILL.md is insufficient. For updates, rerun the same installer and select the same skill/hosts, reviewing its replacement behavior.

## Standalone CLI

Pinned release:

```bash
uv tool install 'git+https://github.com/bpstr/understand-code.git@v1.0.0'
understand-code --version
```

Without uv:

```bash
python3 -m venv ~/.venvs/understand-code
~/.venvs/understand-code/bin/python -m pip install 'git+https://github.com/bpstr/understand-code.git@v1.0.0'
~/.venvs/understand-code/bin/understand-code --help
```

Update to a reviewed release by replacing the version tag:

```bash
uv tool install --force 'git+https://github.com/bpstr/understand-code.git@v1.0.0'
```

Or follow main explicitly with `uv tool install --force 'git+https://github.com/bpstr/understand-code.git@main'`. Pinning a tag is preferable for repeatable deployments. The same pinned install command supports rollback to an earlier release. No PyPI publication is required or implied.

## First reconstruction

```bash
understand-code bootstrap /path/to/repo --provider codex
```

This requires a clean committed checkout and creates a sibling worktree on a `codex/understand-code-*` branch. Use the repository path printed in its JSON result for subsequent commands. If repository/user policy requires the current branch, or you need to include uncommitted code:

```bash
understand-code bootstrap /path/to/repo --write-mode local --provider claude
```

No source files are modified in either mode. Existing output must be an owned Codebase Spec; choose `--output docs/reconstructed` for a separate destination. Use that output on every subsequent command. Add `.understand-codeignore` for additional glob exclusions (one glob per line, `#` comments). Git-ignored files are excluded in Git repositories, and known secret/dependency/build paths are excluded everywhere. The scanner does not execute source or inspect `.secrets`.

Modes: quick = up to 6 tasks × 24 paths; standard = 18 × 40; deep = 36 × 60. Scan limits default to 2,000 files and 5 MB of UTF-8 text. `--max-files` and `--max-bytes` adjust them. Skipped/deferred coverage is explicit. Deep mode adds bounded history analysis, not runtime execution.

## Code intelligence and source updates

Read applicable repository/ancestor `AGENTS.md`, `CLAUDE.md` and host instructions. Use any installed structural, symbol, semantic-search or code-graph tool configured there. Fall back to bounded source/file search when no tool is configured, available or sufficient. External retrieval results are hints, not source evidence; no external-index refresh is required by this engine.

After source changes:

```bash
understand-code update --repo /path/to/spec-worktree --base origin/main
understand-code status --repo /path/to/spec-worktree
```

The update creates scoped tasks and marks affected prior claims UNKNOWN. Investigate and apply refreshed findings before calling the spec current. See [workflow](docs/WORKFLOW.md) and [maintenance/recovery](skills/understand-code/references/maintenance.md).

## Local development

```bash
git clone https://github.com/bpstr/understand-code.git
cd understand-code
python3 -m venv .venv
.venv/bin/python -m pip install -e .
python3 scripts/build_bundle.py
python3 scripts/check_distribution.py
```

Edit canonical code under `src/`, contracts under `schemas/`, and role objectives in `src/understand_code/spec/planner.py`. Regenerate the bundle after edits; CI rejects stale copies. Run `sh scripts/understand-code.sh --help` to inspect the bundled runner without any provider call.
