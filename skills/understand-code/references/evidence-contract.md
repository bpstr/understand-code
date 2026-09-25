# Evidence contract

The authoritative machine contracts are [finding.schema.json](schemas/finding.schema.json), [entity.schema.json](schemas/entity.schema.json), [relation.schema.json](schemas/relation.schema.json), and [evidence.schema.json](schemas/evidence.schema.json). A findings object copies `task_id` and `snapshot` from the current task. `entities`, `relations`, `evidence`, and `gaps` are arrays; `review` states `unreviewed` or `source-reviewed` with an actual reviewer and method.

Every evidence record binds a repository-relative path, inclusive line range, whole-file SHA-256, excerpt SHA-256 and commit. Use the engine's `evidence` command rather than inventing any field. Evidence IDs include the whole-file hash: unrelated file edits still make prior evidence stale. Excluded secrets, symlinks, paths outside the task and generated output are rejected.

Every entity has `id`, `kind`, `title`, `summary`, `confidence`, `evidence`. Stable semantic IDs such as `feature.checkout` are preferred; preserve IDs after renames. `aliases` records old names for maintainers. `details` may contain concise feature-specific sections, all subject to the same citations and confidence as the summary. Do not put unsupported claims in details.

Relations have `id`, `source`, `target`, `kind`, `confidence`, `evidence`. Endpoints must be known entities, introduced in the same response or an earlier accepted response. Direction is literal: `setting.guest-checkout affects feature.checkout`, not its reverse. A relation is a separate claim requiring its own citations.

Confidence means:

- `EXTRACTED`: directly visible in cited source and explicitly source-reviewed.
- `CORROBORATED`: reviewed interpretation supported by independent sources (at least two different files is a necessary mechanical check, not sufficient proof).
- `INFERRED`: plausible interpretation with incomplete proof; clearly labeled.
- `UNKNOWN`: question or disputed interpretation, never a factual assertion.

All non-UNKNOWN claims need citations. The engine verifies ranges and hashes; it cannot decide whether natural language follows logically from source. A fabricated reviewer label is not review. Never claim tests passed from reading test code, infer runtime reachability from a definition, infer intent from a class name, or promote graph proximity into causation.

An investigation with no supportable findings must return a gap with `id`, `question`, `next_step`. An empty response cannot complete a task. Fixture responses are prepared contract tests, explicitly marked with fixture provenance; they are not provider evaluation or live-content evidence.

For a stale claim, preserve its ID and provide `supersedes` with that same ID after source review. A changed interpretation without an explicit reviewed replacement creates a conflict gap retaining both alternatives. Resolve conflicts by source investigation, not by manipulating metadata.

## Change knowledge and coverage contracts

Additional canonical contracts are [code-reference.schema.json](schemas/code-reference.schema.json), [change-standard.schema.json](schemas/change-standard.schema.json), [change-review.schema.json](schemas/change-review.schema.json) and [change-knowledge.schema.json](schemas/change-knowledge.schema.json). Their bundled copies are generated, never edited independently.

Use `concept` for an aspect and `occurrence` for one identifiable manifestation on a surface. An occurrence requires concept/surface IDs, a stable anchor, conditions and source-qualified implementation references. Every code reference requires `repository.local`, a safe path, anchor, current whole-file hash and inclusive range covered by the claim's evidence. Distinct uses need distinct anchors; duplicate citations do not create occurrences. `search_terms` accepts up to 32 natural-language phrases; identity `aliases` still rejects arbitrary phrases.

New directed relations are feature/concept `has_aspect` concept; feature/concept `primary_surface` ui_surface; ui_surface `presents` concept/feature/setting/data_entity; component/ui_surface `renders` component; occurrence `occurs_on` ui_surface; occurrence `realizes` concept/feature/setting/data_entity. Membership edges must agree with the occurrence. A scoped primary surface needs reviewed evidence, not filename/degree inference. Composition means a static reference, not unconditional rendering. Existing implementation/read/write/effect/propagation relations remain canonical.

Findings may request `followups` with id/role/paths/question, close `resolved_gaps` with id/evidence/rationale, or explicitly retire obsolete claims with `retirements` of the same reviewed shape. Never close an unsupported consumer path merely because the prompt did not mention it. Dependent occurrences/relations must be retired explicitly; their baseline obligations and archived evidence remain.

A change review is separately bound to its scope, baseline/target snapshots and discovery revision. Each disposition records the obligation, criteria assessed, current evidence and rationale under an accountable source review. Shared changes additionally need `consumer_evidence` and `dependency_evidence`; exclusions must identify a declared standard exclusion. Missing model entries are not automatic source removals. `identity_mappings` need reviewed old/new identities and current target evidence. Preserve uncertainty as unresolved.

A required behavioral check needs external execution provenance: check ID, exact declared command, current source snapshot, runner, timestamp with timezone, output SHA-256 and exit code. The engine does not execute it. No test assertion, hash check or reviewer label alone proves runtime correctness. Imported exchange confidence/review is preserved as original provenance but never promoted into native findings without recaptured source and review.
