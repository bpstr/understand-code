# Semantic change discovery and coverage verification

Understand Code inventories **obligations to inspect and account for**, not files that must be edited. A request naming eight avatar locations must not silently exclude the profile page. A shared component change may satisfy several occurrences, but every consumer surface needs its own source-reviewed disposition.

This workflow is standalone and offline. It adds native investigation contracts, not autonomous interpretation, application editing or test execution. Its strict verdict is **complete within the declared scope and supported analysis boundary**, never proof of every possible runtime occurrence.

## Create a scope before editing

Put the acceptance standard outside the source scan, for example `/tmp/avatar-standard.json`. This illustrative standard permits static review; it is not a default styling rule supplied by the engine:

```json
{
  "id": "standard.avatar-presentation",
  "criteria": [
    {
      "id": "criterion.presentation",
      "description": "Use the agreed avatar presentation rules on every included surface and variant.",
      "verification": "static"
    }
  ],
  "required_checks": [],
  "exclusions": []
}
```

Replace the description with the actual, concrete project rules before seeking completion. A missing standard remains an unresolved requirements gap. Merely saying “standard format” does not tell the engine or reviewer what compliance means.

```bash
understand-code scope "avatar presentation" --repo . \
  --intent ui_standardization --mode deep \
  --criteria /tmp/avatar-standard.json \
  --example src/components/UserMenu.tsx
```

`scope` creates a Codebase Spec in the selected checkout when absent. Unlike default `bootstrap`, it does not create a clean worktree that would hide dirty source. The JSON response supplies `change_scope`. Continue with the same `--repo` and `--output`.

`--example` supplies investigation seeds, not limits. Only explicit `--boundary` and `--exclude-path` prefixes narrow discovery. They are recorded in the request. A broader independent roster is deliberately conservative: being in the roster does not mean a file needs editing. Unknown terms produce a concept-resolution gap and a bounded independent plan, rather than an empty success or a guess at the intended feature.

The intent choices are `ui_standardization`, `settings_change` and `cross_cutting`. Traversal uses different relationship policies; `impact.py` retains its separate conservative freshness invalidation.

## Native investigation and evidence

Read `_meta/plan.json` and its source-bound tasks. Apply normal reviewed findings using `apply --findings`. UI and reuse specialists investigate independent surfaces, primary roles, wrappers, aliases, route declarations, concrete consumers and implementations that bypass shared components. Quick mode reserves UI/reuse capacity and **defers**, rather than waives, remaining obligations. Every source/configuration format receives fallback investigation even without a language heuristic.

The engine's JSX, route and import hints remain candidates. They are not a TypeScript compiler or proof of runtime rendering. Unsupported dynamic registrations, scan omissions, ignored relevant files, depth/node limits, missing settings stages and unresolved semantic links remain explicit frontiers. A mapper must not call work complete because it inspected every example in the original prompt.

### Concepts, surfaces and occurrences

`concept` describes an aspect such as avatar presentation or timezone-sensitive display. Existing `feature`, `ui_surface`, `component`, `setting` and `data_entity` kinds retain their meanings. `occurrence` describes one statically identifiable manifestation on a consumer surface, with conditions and source-qualified implementation references.

`search_terms` is bounded natural-language vocabulary, such as “profile photo”. `aliases` remains identifier-shaped identity vocabulary. A profile page is normally a related surface, not an avatar synonym. Search vocabulary is evidence-backed semantic material and does not itself establish membership.

| Relation | Legal direction | Traversal meaning |
| --- | --- | --- |
| `has_aspect` | feature/concept → concept | Narrower aspect; unrelated siblings are not automatic edit targets. |
| `primary_surface` | feature/concept → ui_surface | Mandatory inspection anchor supported by source review; state the role/scope in `scope`. |
| `presents` | ui_surface → concept/feature/setting/data_entity | Observable expression on a surface. |
| `renders` | component/ui_surface → component | Static composition reference, not unconditional execution. |
| `occurs_on` | occurrence → ui_surface | Must agree with occurrence membership. |
| `realizes` | occurrence → concept/feature/setting/data_entity | Must agree with occurrence membership. |

All six relations use the existing confidence, source citation and review contract. Keep existing `implemented_by`, read/write, effect and propagation relations instead of adding synonyms. A primary profile surface and a canonical shared implementation are different roles; neither filename nor degree establishes primacy. Several scoped primary surfaces are permitted.

An occurrence's `occurrence` object requires `concept`, `surface`, `anchor`, `conditions` and nonempty `implementation`. Each implementation record binds `repository`, `path`, `anchor`, `sha256`, `start_line` and `end_line`; optional `symbol` and `producer_id` are descriptive, not permanent external identity. Native records use the explicitly bound `repository.local`. Ranges must be covered by the occurrence's own source evidence.

Use distinct stable anchors for two uses in one file. Preserve separate consumer occurrences for a reused component. Duplicate citations and runtime user instances are not occurrences. Identical occurrence identities are rejected. Line shifts retain product/anchor identity but still require fresh citations and review; uncertain renames are not automatically matched.

Settings investigations record source-reviewed `details` for `writer`, `validation`, `persistence`, `cache_projection`, `reader` and `observable_effect`, backed by cited code and read/write/propagation/effect relations. A declared getter alone does not establish an observable consumer. Missing stages block discovery; free-text judgments remain accountable source review, not mechanical entailment.

### Follow-ups and explicit retirement

A findings response can include `followups` records with `id`, existing `role`, `paths` and `question`. Requests persist in the plan, including paths not yet available and children that cannot fit the task budget. Unanswered requests inside the declared boundary block strict completion.

`resolved_gaps` records require a known gap `id`, current `evidence` and `rationale` in a source-reviewed response. This closes a question without discarding the archived response history.

When source is intentionally removed, `retirements` uses the same reviewed record shape to retire existing claims. Dependent relations and occurrences must be retired explicitly, not implicitly cascaded. `_meta/retired-claims.json` retains original claims, evidence and review provenance. Retiring a claim **does not remove its earlier change obligation**. Account for the missing occurrence through reviewed removal or identity reconciliation.

## Implementation handoff and disposition ledger

Each scope is stored in `_meta/change-scopes/<scope-id>/`. It has an immutable baseline source manifest, current target, request/standard, resolver provenance, union of observed obligations and candidates, review history and discovery passes. Manifests cover admitted tracked/untracked content, deletions, scan limits, ignore boundaries and imported generations; a commit alone is not a dirty-tree snapshot.

The generated `changes/<scope-id>.md` is the handoff checklist. Concept pages link primary surfaces, canonical implementations and occurrence inventories; occurrence and source-index pages link back. Maintainer notes and the existing generated-region conflict protections remain in force.

The coding harness performs authorized application edits and checks outside Understand Code. After edits, rediscover the whole declared source boundary, **not only changed files**:

```bash
understand-code scope --repo . --change-scope <scope-id> --mode deep
# Complete refreshed native investigations, then apply their findings.
understand-code apply --repo . --findings /tmp/reviewed-findings.json
```

Newly discovered occurrences become obligations. Missing occurrences remain in the denominator. Source, semantic model, standard or discovery revision changes invalidate earlier dispositions; old packets and discovery passes remain inspectable. Invalidation is deliberately conservative, including relevant shared dependencies and sometimes unrelated admitted source changes.

Copy the generated `review-template.json` outside the source scan and fill it according to [change-review.schema.json](../schemas/change-review.schema.json). Do not edit managed metadata. Exact `change_scope`, `baseline_snapshot`, `target_snapshot` and `revision` bind the packet. Capture current evidence with the normal `evidence` command and supply a genuine reviewer/method.

| Disposition | Contract |
| --- | --- |
| `changed_directly` | Reviewed consumer implementation changed between baseline and target; assess every criterion. |
| `changed_via_shared_dependency` | Changed shared dependency, surviving reviewed composition, `consumer_evidence` and `dependency_evidence`; assess every criterion at the surface/variant. |
| `already_compliant` | Inspect the unchanged surface against the same explicit criteria. No unnecessary direct edit is required. |
| `excluded` | `exclusion` identifies a rationale authorized in the standard; no opportunistic scope narrowing. |
| `removed` | Absent modeled occurrence, intentional removal and source evidence. An unchanged source file with a missing detector result is not removal evidence. |
| `unresolved` | Retain the question; blocks strict completion. |

Mandatory anchors receive dispositions even without a direct diff. Independent roster candidates need reviewed `modeled`, `not_relevant`, `removed` or `unresolved` accounting. `modeled` cites current occurrence IDs bound to that candidate's source. Known occurrence/anchor paths cannot be dismissed as unrelated. Source-reviewed `policies` records acknowledge the declared independent/primary/alternate/consumer investigations.

Use `identity_mappings` for an explicitly reviewed missing-baseline → current-target identity transition. Each mapping requires evidence and rationale; it does not let a missing obligation disappear without a current target disposition. Historical discovery passes retain original manifests, observations and evidence.

```bash
understand-code apply --repo . --change-scope <scope-id> --ledger /tmp/change-review.json
understand-code verify --repo . --change-scope <scope-id> --require-change-complete
```

Validation is transactional. A single invalid item rejects the packet without publishing a partial ledger. Explicitly revise an underspecified or changed standard while preserving the baseline with:

```bash
understand-code scope --repo . --change-scope <scope-id> \
  --criteria /tmp/revised-standard.json --amend-standard
```

This records request history and invalidates earlier review. Boundary/topic changes require a separate clearly declared scope; they cannot silently rewrite an existing scope's denominator.

## Five independent coverage axes

| Field | Meaning |
| --- | --- |
| `inventory_coverage` | Current recorded scan of the declared source boundary, with relevant omissions visible. |
| `investigation_coverage` | Planned tasks, deferrals and follow-ups accounted for with source review. |
| `discovery_coverage` | Required policies, primary anchors, candidate accounting and relevant semantic/frontier questions resolved within supported analysis. |
| `occurrence_accounting` | Every baseline/target obligation has a current valid disposition or reviewed identity mapping. |
| `behavioral_verification` | Required external checks are supplied, current and successful, or explicitly `not_required` by a static acceptance policy. |

Strict completion requires all five axes. `--require-change-complete` requires `--change-scope`; missing/invalid inputs return **2**, unmet verification gates return **1**, success returns **0**. The machine-readable report is `change_coverage`, with `change_complete`, freshness, missing obligations, invalidations, frontiers and per-axis details.

Existing `coverage_complete` and `verify --require-complete` still mean investigation coverage, not application-change completeness. Default verification is unchanged. Both strict flags may be used together. A fresh hash, accepted task or count of edited files is not semantic completeness.

Behavioral criteria must declare their `required_checks`, including exact `command` and covered criteria IDs. An imported execution record supplies that check ID, command, source snapshot, runner, timezone-qualified execution timestamp, output SHA-256 and exit code. Missing, stale or failed checks block completion. The engine never executes these commands, and reading a test assertion never constitutes execution evidence. The record is accountable external provenance, not an independently attested runtime result.

## Optional Change Knowledge Exchange v1

```bash
understand-code export-knowledge --repo . --file /tmp/change-knowledge.json
understand-code import-knowledge --repo . --file /tmp/change-knowledge.json
```

The canonical closed wire schema is [change-knowledge.schema.json](../schemas/change-knowledge.schema.json). Internal state versions are independent of wire `version: 1`. The prepared [exchange fixtures](../tests/fixtures/change-knowledge/) include a schema hash pin, valid envelope and invalid version/reference/path cases. A consumer such as Codanna must vendor the identical pinned schema through a reviewed update; this change does not modify Codanna.

The envelope preserves producer/version, source-qualified repositories and manifests, capabilities, original entity/relation/occurrence confidence and review, evidence, conditions, gaps and conflicting alternatives. Imports are archived as external candidate context, never merged as verified native business facts. Native specialists must recapture and review the actual source before introducing findings.

Only the explicitly named `repository.local` is bound to the selected checkout by this adapter. Other repository IDs remain unresolved; the engine does not guess roots or read external repositories. Invalid versions, references, ranges, escaping paths or symlinks are rejected. Source mismatches are quarantined, not silently rehashed. Quarantined/unbound relevant imports remain discovery gaps; v1 deliberately has no automatic binding repair or generation supersession that could conceal earlier failed evidence.

Exchange files are capped at 5 MB. Export refuses to overwrite an unrelated file. No runtime download, provider, vector database, Graphify or Codanna process is invoked. Native-only scopes work without any exchange input. This is a semantic exchange adapter, not an import of either tool's raw graph.

## Compatibility and prepared acceptance

Legacy state loads without manufactured concepts, occurrences or change scopes. New optional fields are mirrored in canonical, embedded and bundled schemas. Unknown focus behavior intentionally changes from an error to an explicit unresolved discovery plan. Conservative connected freshness invalidation is unchanged.

The prepared nine-surface fixture includes an unnamed-by-avatar profile component, wrapper, alias/re-export, shared implementation, static route and independent inline implementation. Regressions cover the separate strict CLI gate, already-compliant/shared outcomes, missing/added/deleted/renamed occurrences, duplicate anchors, phrase vocabulary, relationship-only evidence, budgets, unknown formats, missing settings effects, unresolved follow-ups, unsupported dynamic paths, stale reviews, external check provenance, schema pins, exchange quarantine and transactional rejection.

These are fixture acceptance results, not measured real-world recall or universal semantic correctness. More language/framework-specific detectors, smarter relevance ranking and a multi-repository binding/supersession policy can extend the supported boundary later without weakening strict accounting now.
