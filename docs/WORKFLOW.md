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

## Reader-facing documents and specifications

Use optional `entity.documentation` when a request needs a document designed for a reader, rather than only the concept's summary and relationships. Read the [authoring guide](../skills/understand-code/references/documentation-authoring.md) and [canonical document schema](../schemas/documentation.schema.json).

1. Inspect existing docs, public interfaces, callers, validation, tests and relevant ADRs. Identify canonical sources, the audience, purpose and scope. Keep the project's terminology and docstring/schema conventions.
2. Choose `reference`, `how-to`, `tutorial`, `explanation` or `specification`. Choose `as-built`, `proposal` or `mixed` separately; this describes authority and intent, not evidence confidence.
3. Attach a stable `doc.*` ID to the owning entity. Add supported sections and exact citations. Represent unanswered topics as `unknown`; use `not-applicable` only with an explicit reason reviewed against the source. Use typed `steps`/`table` fields and literal example code rather than embedding Markdown in escaped prose.
4. For specifications, add individually identified requirements, basis, rationale and verification procedures with expected results. Cite implementation/configuration for observed behavior and documentary/human evidence for specified intent. Give proposals an explicit origin. A proposed requirement or verification plan does not assert approval, implementation or successful execution.
5. Provide relevant examples with prerequisites and expected outcomes. Default validation to `not-run`/`none`. Only an authorized external harness can provide a checked result, bound to the exact example content and task snapshot. Preserve failures and distinguish syntax/schema validation from behavior checks; the engine never executes examples.
6. Obtain source review, apply the findings and inspect the rendered diff. Confirm readable headings, ordered steps, tables, source links and unchanged literal code. The writer links documents from their parent entity and the document index. Preserve maintainer notes through the normal managed-output workflow.
7. Run `verify --require-doc-quality` and report its per-document blockers/warnings. Supply concrete `review_when` triggers and an owner only if known. Refresh affected requirements and example attestations after source changes.

```bash
understand-code apply --repo <repo> --findings /tmp/documentation-findings.json
understand-code verify --repo <repo> --require-doc-quality
understand-code status --repo <repo>
```

The [prepared documentation fixtures](../tests/fixtures/documentation/README.md) demonstrate the structures. Their evidence placeholders and execution attestations are filled by the offline test harness; they are not real findings or proof of example execution. Do not apply the fixtures unchanged to a repository.

The `documentation_quality` report covers authored documents only. Its gate requires profile-specific topics, source review and current support, resolved requirement verification, and appropriate example evidence. It does not prove prose entailment or all-interface coverage. A proposal can be ready for review while its proposed behavior remains unimplemented. Existing `verify` integrity, `--require-complete` investigation coverage and `--require-change-complete` change accounting retain their separate meanings.

## Handoffs

Task-loop agents resolve feature IDs and change maps before fetching source; current source always wins over stale docs. Review agents use semantic impact plus source citations to locate blast radius. After accepted source changes, `update --base <task-base>` prepares affected investigations. Source-dependent claims stay UNKNOWN until reviewed replacements arrive.

Build/test/run pages link to declared manifests and instructions. This tool does not execute repository commands, migrate databases, run tests or rewrite agent instructions. Recommend needed inline comments/docstrings to the authorized coding workflow; only the configured spec output is written here. Human notes are passed to subsequent native tasks as editorial corrections to investigate.
