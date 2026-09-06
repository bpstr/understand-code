# Architecture

The deterministic engine is Python 3.10+ using the standard library only. Host-native reasoning is deliberately outside the engine, so CLI tests and CI cannot accidentally construct an inference client.

| Layer | Responsibility |
| --- | --- |
| `cli.py` | Commands, local/worktree policy, structured output and exit status |
| `discovery.py`, `git.py` | Git-aware bounded inventory, exact Python syntax, heuristic candidates, diff/rename handling |
| `graphify.py` | Node-link import, bounded retrieval context and semantic export |
| `spec/planner.py`, `providers/` | Adaptive scopes and native Claude/Codex task contracts |
| `evidence.py`, `contracts.py`, `findings.py` | Safe paths, source hashes, closed JSON input schemas, source review contracts and contradiction reconciliation |
| `impact.py` | Evidence-to-concept mapping and conservative transitive dependency/consumer impact |
| `audit.py` | Read-only instruction observations and recommendations |
| `orchestrator.py` | State transitions, locks, stale-claim quarantine, accepted response archival and handoff |
| `spec/writer.py`, `spec/verifier.py` | Markdown/source links, protected human notes, staged replacement and freshness checks |

`src/` and `schemas/` are canonical. `scripts/build_bundle.py` generates the self-contained skill engine, schema resources and specialist cards. Distribution checks prevent shipped copies drifting. The Python package embeds the same schemas via package data.

## State

The spec stores a versioned manifest, scan inventory, current bounded plan, typed entities/relations/evidence, gaps, audit, impact and graph handoff under `_meta`. Accepted native responses are preserved by content hash. A task's ID includes its role, file scope and source snapshot. Applying a response for a changed snapshot fails before writes.

Evidence IDs include both the excerpt and whole-file hash. Updates do not quietly refresh citations under unchanged claim IDs. Evidence-dependent and semantically connected claims are quarantined as UNKNOWN. Reviewed replacements may explicitly supersede stale/conflicting claims; conflicting alternatives are retained in archived responses.

No-op updates retain unfinished tasks. Focused runs carry unfinished wider scopes into a visible backlog. Scan omissions and task deferrals are never interpreted as absence of functionality.

## Trust and limits

Source, graph exports and provider responses are untrusted input. The engine does not evaluate their contents. JSON schemas close the input shape, references stay within task scope, and filesystem reads/writes reject symlink traversal. Known secret/dependency/build paths are excluded; `.understand-codeignore` adds repository-specific exclusions. This is not a general secret detector or OS sandbox.

Hash checks prove identity and freshness, not semantic entailment. `source-reviewed` records an accountable judgment; the software cannot prevent someone deliberately lying in that field. Reviewers must inspect cited code, distinguish declarations from execution and preserve unknowns. Generated natural-language details obey the same confidence/evidence contract as summaries.

Output is staged beside the destination and swapped with rollback on ordinary failures. This is process-level transactional replacement, not a crash-proof database transaction. A hard kill can require backup recovery; see [maintenance](../skills/understand-code/references/maintenance.md). The target source tree is not changed and the engine never commits or pushes it.
