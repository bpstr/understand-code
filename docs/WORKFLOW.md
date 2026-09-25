# Native investigation workflow

Use the plugin for the full workflow. The standalone CLI deliberately stops at a reviewable task plan until findings are supplied; there is no hidden provider call.

1. `bootstrap` inventories source and prepares bounded tasks. Read the returned repository/output paths. Read the spec's `_meta/plan.json` and the matching `_meta/tasks/<task-id>.md`.
2. In the existing Claude/Codex session, inspect scoped source, using optional repository-configured code-intelligence tools to narrow retrieval. External tool results are hints, not evidence. Each task includes its snapshot, role, file budget, candidate references and empty response contract. The skill sequences reconnaissance, targeted tracing, synthesis and review; the CLI validates state.
3. Capture evidence using `understand-code evidence --repo <repo> checkout.py --start 4 --end 7`. Save the returned JSON in the response's `evidence` array. Its ID goes in each supported claim's evidence list. Read the range to confirm what it actually proves.
4. Create entities, relations and gaps using the [contract](../skills/understand-code/references/evidence-contract.md). `CORROBORATED` requires independent sources and actual source review; count alone is insufficient. Existing test code proves what is asserted, not that execution passed.
5. Save the response outside the source scan, for example `/tmp/checkout-findings.json`. Apply with `understand-code apply --repo <repo> --findings /tmp/checkout-findings.json`. Repeat `--findings` for multiple responses; endpoint dependencies are processed in argument order.
6. Review generated Markdown and the diff. `verify` checks source freshness and content integrity; `status` shows pending tasks, deferred scopes and coverage. Finish important unresolved investigations or disclose their gaps.

The prepared fixture at `tests/fixtures/prepared/checkout.json` demonstrates claim shapes. It is deliberately incomplete as an ingestion file: tests bind it to their temporary fixture snapshot and task, with explicit prepared provenance. Do not apply it to a real repository.

## Feature pages

Semantic entities become pages grouped by kind: features, flows, settings, entrypoints, UI, data, integrations, cross-cutting concerns and architecture. Every page contains confidence, summary, cited source ranges and typed incoming/outgoing change-map links. Optional `details` can provide purpose, runtime steps, permissions, failures or settings effects when the same evidence supports those claims. Unobserved behavior belongs in gaps, not decorative sections.

For a setting, model the concrete UI/API writer, persistence, cache invalidation, runtime reader and observable UI/API consumers as separate entities and evidence-backed edges. The resulting change map permits traversal in either direction. If a binding is absent, stop that trace at an UNKNOWN gap. Never turn adjacent filenames into a connected runtime flow.

## Handoffs

Task-loop agents resolve feature IDs and change maps before fetching source; current source always wins over stale docs. Review agents use semantic impact plus source citations to locate blast radius. After accepted source changes, `update --base <task-base>` prepares affected investigations. Source-dependent claims stay UNKNOWN until reviewed replacements arrive.

Build/test/run pages link to declared manifests and instructions. This tool does not execute repository commands, migrate databases, run tests or rewrite agent instructions. Human notes are passed to subsequent native tasks as editorial corrections to investigate.
