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
