# Native investigation workflow

Use the plugin for the full workflow. The standalone CLI deliberately stops at a reviewable task plan until findings are supplied; there is no hidden provider call.

1. `bootstrap` inventories source and prepares bounded tasks.
2. In the existing Claude/Codex session, read applicable repository/ancestor instructions. Use any installed code-intelligence, symbol, semantic-search or code-graph tool described there when it helps narrow retrieval; otherwise use bounded source/file search. External retrieval output is context only, never evidence.
3. Inspect scoped current source and capture exact evidence with `understand-code evidence --repo <repo> <path> --start N --end M`.
4. Create entities, relations and gaps using the evidence contract. `CORROBORATED` requires independent sources and actual source review; count alone is insufficient.
5. Save findings outside the source scan and apply with `understand-code apply --repo <repo> --findings <response.json>`.
6. Review generated Markdown and the diff. `verify` checks source freshness and content integrity; `status` shows pending tasks, deferred scopes and coverage.

## Feature pages

Semantic entities become pages grouped by kind. Every page contains confidence, summary, cited source ranges and typed incoming/outgoing change-map links. Unobserved behavior belongs in gaps.

For a setting, model the concrete UI/API writer, persistence, cache invalidation, runtime reader and observable consumers as separate entities and evidence-backed edges. If a binding is absent, stop the trace at an UNKNOWN gap.

## Handoffs

Task-loop agents resolve feature IDs and change maps before fetching source; current source always wins over stale docs or external retrieval indexes. Review agents use semantic impact plus source citations to locate blast radius. After accepted source changes, `update --base <task-base>` prepares affected investigations.

Build/test/run pages link to declared manifests and instructions. This tool does not execute repository commands, migrate databases, run tests or rewrite agent instructions.
