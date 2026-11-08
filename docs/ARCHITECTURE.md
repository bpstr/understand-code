# Architecture

The deterministic engine is Python 3.10+ using the standard library only. Host-native reasoning is deliberately outside the engine, so CLI tests and CI cannot accidentally construct an inference client.

| Layer | Responsibility |
| --- | --- |
| `cli.py` | Commands, local/worktree policy, structured output and exit status |
| `discovery.py`, `git.py` | Git-aware bounded inventory, exact Python syntax, heuristic candidates, diff/rename handling |
| Repository/host instructions | Select optional code-intelligence tools for native-session retrieval |
| `spec/planner.py`, `providers/` | Adaptive scopes and native Claude/Codex task contracts |
| `evidence.py`, `contracts.py`, `findings.py` | Safe paths, source hashes, closed JSON input schemas, source review contracts and contradiction reconciliation |
| `documentation.py` | Optional authored-document contracts, nested evidence/authority validation and exact example fingerprints |
| `impact.py` | Evidence-to-concept mapping and conservative transitive dependency/consumer impact |
| `audit.py` | Read-only instruction observations and recommendations |
| `orchestrator.py` | State transitions, locks, stale-claim quarantine, accepted response archival and handoff |
| `spec/writer.py`, `spec/verifier.py` | Markdown/source links, protected human notes, staged replacement and freshness checks |
| `spec/documentation.py` | Profile-aware document rendering and a separate bounded documentation-readiness assessment |

`src/` and `schemas/` are canonical. `scripts/build_bundle.py` generates the self-contained skill engine, schema resources and specialist cards. Distribution checks prevent shipped copies drifting. The Python package embeds the same schemas via package data.

## State

The spec stores a versioned manifest, scan inventory, current bounded plan, typed entities/relations/evidence, gaps, audit, impact under `_meta`. Accepted native responses are preserved by content hash. A task's ID includes its role, file scope and source snapshot. Applying a response for a changed snapshot fails before writes.

Evidence IDs include both the excerpt and whole-file hash. Updates do not quietly refresh citations under unchanged claim IDs. Evidence-dependent and semantically connected claims are quarantined as UNKNOWN. Reviewed replacements may explicitly supersede stale/conflicting claims; conflicting alternatives are retained in archived responses.

No-op updates retain unfinished tasks. Focused runs carry unfinished wider scopes into a visible backlog. Scan omissions and task deferrals are never interpreted as absence of functionality.

## Trust and limits

Source, external retrieval output and provider responses are untrusted input. The engine does not evaluate their contents. JSON schemas close the input shape, references stay within task scope, and filesystem reads/writes reject symlink traversal. Known secret/dependency/build paths are excluded; `.understand-codeignore` adds repository-specific exclusions. This is not a general secret detector or OS sandbox.

Hash checks prove identity and freshness, not semantic entailment. `source-reviewed` records an accountable judgment; the software cannot prevent someone deliberately lying in that field. Reviewers must inspect cited code, distinguish declarations from execution and preserve unknowns. Generated natural-language details obey the same confidence/evidence contract as summaries.

Output is staged beside the destination and swapped with rollback on ordinary failures. This is process-level transactional replacement, not a crash-proof database transaction. A hard kill can require backup recovery; see [maintenance](../skills/understand-code/references/maintenance.md). The target source tree is not changed and the engine never commits or pushes it.

## Authored documents

The optional `entity.documentation` array extends native findings without changing legacy entities. `schemas/documentation.schema.json` defines reader profiles, authority modes, plain-text sections, typed steps/tables, requirements and examples. Nested evidence must belong to the parent entity and the current response. Document IDs are globally unique and remain attached to one entity; the document inherits its review, confidence, staleness and conflict state.

The renderer writes managed `documents/<id>.md` pages and navigation through the existing transactional writer. Plain prose is escaped, paragraphs are retained, and code remains literal inside safe fences. Managed-marker parsing distinguishes generated-region delimiters from identical strings inside fenced examples. Documents receive the same human-note, generated-edit and retirement protection as concept pages.

Requirement authority is independent of confidence: observed behavior, documentary intent and proposed obligations have different evidence rules. Verification procedures describe intended checks; test citations identify assertions. Example attestations separately record check level and external-run provenance, bound to the source snapshot and a fingerprint of language/code/prerequisites/expected result. Neither structure executes code or turns a reviewer label into runtime proof.

`verify` and `status` expose `documentation_quality`. The optional `--require-doc-quality` gate checks authored records for the required profile topics, current reviewed support, resolvable requirements and appropriate example validation. It reports blockers and warnings without changing legacy integrity or coverage semantics. Semantic adequacy and whole-repository documentation coverage remain outside this mechanical assessment.

Authored documents participate in reconciliation and stale-claim handling. The closed Change Knowledge Exchange v1 format deliberately omits this native-only extension, including within conflict alternatives; its pinned wire schema remains unchanged. See [authoring](../skills/understand-code/references/documentation-authoring.md) for native use and [testing](TESTING.md) for prepared evidence limits.

## Semantic change coverage

`change_scope.py` provides an independent source roster and typed relevance traversal; it does not replace conservative `impact.py` invalidation. `coverage.py` maintains source-bound baseline/target inventories, retained occurrence and anchor obligations, reviewed dispositions, identity mappings and five separate coverage axes. `exchange.py` supplies a bounded offline wire adapter with candidate-only imports and source-mismatch quarantine.

The orchestrator loads hashed optional scope/import/retirement metadata, validates findings and ledger packets before publication, preserves review/discovery histories, and writes through the existing transactional spec writer. Native roles interpret source; the coding harness alone edits applications and executes authorized behavioral checks. See [change coverage](CHANGE_COVERAGE.md) for the completion contract and compatibility boundaries.
## Retrieval boundary

The engine does not import vendor graphs, expose vendor-specific CLI flags, or require external index refresh. Native sessions select configured tools using applicable repository/ancestor instructions. Results narrow retrieval; accepted claims still require exact current-source evidence. Historical files from older versions are not promoted into the current model.
