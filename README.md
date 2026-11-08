# Understand Code

**Reconstruct what a codebase does, where its features live, and how changes travel through it—with source evidence.**

Understand Code is a Node.js CLI, written in TypeScript, and a self-contained Claude Code / Codex skill. It produces a repository-native **Codebase Spec** in `docs/codebase/`: Markdown concept pages, source citations, typed relationships, change maps and explicit knowledge gaps. Reviewed findings can also include reader-facing reference, how-to, tutorial, explanation and specification documents.

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

**Standalone CLI** — Node.js 22+, Git, no Python or runtime npm dependencies:

```bash
npm install --global https://github.com/bpstr/understand-code/releases/download/v2.0.0/understand-code-2.0.0.tgz
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
| Structural discovery | Git-aware file inventory, languages/manifests, declaration and route/settings/UI/data/event/test candidates, explicit scan limits |
| Native agents | 18 specialist roles; adaptive quick/standard/deep budgets; Claude/Codex task formats; sequential or authorized native delegation |
| Semantic model | Typed entities and directed relationships; stable IDs, aliases, feature/flow pages and source-linked change maps |
| Evidence | Exact ranges, file and excerpt hashes, source snapshots, explicit confidence and recorded semantic review |
| Authored documentation | Audience and purpose, behavioral contracts, ordered procedures, tables, literal examples, requirement traceability and maintenance triggers |
| Incremental updates | Git base + working-tree hashes; renames/deletions; transitive semantic impact; stale claims demoted to UNKNOWN |
| Human knowledge | Maintainer notes preserved; generated edits block replacement; conflicts retain alternatives |
| Agent readiness | Instruction scopes, size, duplicate content, missing link observations and bounded recommendations |
| Distribution | Codex/Claude manifests and marketplaces, standalone JavaScript skill runner, installable npm archive with TypeScript declarations, offline CI and release archives |

The default output includes overview, concept pages, evidence, instruction/readiness reports, operational pointers, glossary and gaps. Relevant feature/flow/settings/UI/data pages appear when findings support them. Empty architecture claims are not filled with plausible prose.

## Write documentation and specifications

Ask the skill to document an in-scope API, explain a design, write a how-to or prepare an implementation specification. It first inspects existing documentation and the source, then chooses the reader, purpose and document profile. Optional `entity.documentation` records become linked pages in `docs/codebase/documents/`; ordinary reconstruction findings remain valid without them.

Specifications distinguish observed behavior, existing specified intent, proposals and unknowns. Stable requirement IDs connect statements, rationale and source/test evidence to a verification plan. Examples retain their literal code and clearly state whether they were unexecuted, syntax/schema checked or behavior checked by an external harness. A proposal is not an approved design, and reading a test is not running it.

```bash
understand-code verify --repo /path/to/worktree --require-doc-quality
```

The optional documentation gate reports missing profile topics, unresolved requirements, stale or unreviewed support and examples without the required check. Its `documentation_quality` report also appears in `status`. It assesses authored documents, separately from investigation/change completeness; no authored documents means not ready. Passing records structural readiness and source review, not semantic proof or coverage of every API in the repository.

See the [authoring guide](skills/understand-code/references/documentation-authoring.md), [workflow](docs/WORKFLOW.md#reader-facing-documents-and-specifications) and [research and gap analysis](docs/research/2026-11-08-documentation-quality.md). Source comments and docstrings can be recommended, while the engine continues to write only its configured Codebase Spec output.

## Truth and limitations

`EXTRACTED` means reviewed, direct evidence; `CORROBORATED` requires independent evidence; `INFERRED` is incomplete interpretation; `UNKNOWN` is an unresolved question. Mechanical checks can establish that a citation exists and is current. **They cannot prove a natural-language claim is true.** Reviewer provenance, gaps and coverage remain visible.

External tool results are retrieval hints. Regex matches are candidates. Python remains supported as source text; declaration discovery is conservative and explicitly inferred rather than an exact Python AST pass. No language runtime is invoked to inspect target code. Test source establishes assertions, not a passing test run. Static links do not establish runtime reachability. Architectural intent needs explicit evidence. There is no live-provider quality claim: the shipped regression suite uses prepared fixtures only.

This release does not execute runtime traces or run autonomous paid headless agents. Native sessions provide reasoning and optional repository-configured retrieval; no external index refresh is owned by the engine. These boundaries and the [release acceptance map](docs/ACCEPTANCE.md) distinguish implemented capabilities from future extensions.

## Change completeness, separately from investigation completeness

Create a source-bound `scope` before an application-wide change, investigate its independent surface roster, and account for every baseline/target occurrence through a reviewed ledger. Primary surfaces remain inspection obligations even when a shared component fixes them without a direct edit.

```bash
understand-code scope "avatar presentation" --repo . --intent ui_standardization --criteria /tmp/standard.json
understand-code scope --repo . --change-scope <scope-id> --mode deep
understand-code apply --repo . --change-scope <scope-id> --ledger /tmp/change-review.json
understand-code verify --repo . --change-scope <scope-id> --require-change-complete
```

Missing criteria, unresolved discovery, unaccounted occurrences and required-but-missing external checks block the new gate. Existing `verify --require-complete` retains its investigation-only meaning. The engine still does not edit the application or execute its tests. See [the change-coverage workflow and wire contract](docs/CHANGE_COVERAGE.md) for native findings, dispositions, five coverage axes, migration, safe exchange and limitations.

## Develop

```bash
npm ci --ignore-scripts
npm run build
npm test
npm run check
npm run release
npm run check:artifacts
```

All automated tests are offline and deterministic. Never load `.secrets`, record fixtures from providers, or add a paid test opt-in. See [testing policy](docs/TESTING.md) and [contributing](CONTRIBUTING.md).

Inspired by the bounded specialist pattern in [deep-code-review](https://github.com/bpstr/deep-code-review). The implementation is original. Plugin setup follows the host's [Codex plugin interface](https://learn.chatgpt.com/docs/plugins) and [Claude plugin reference](https://code.claude.com/docs/en/plugins-reference).

MIT licensed. [Changelog](CHANGELOG.md) · [Architecture](docs/ARCHITECTURE.md) · [Security](SECURITY.md)
