# Architecture

The deterministic engine is Python 3.10+ using the standard library only. Host-native reasoning and retrieval are deliberately outside the engine, so CLI tests and CI cannot accidentally construct an inference or code-intelligence client.

| Layer | Responsibility |
| --- | --- |
| `cli.py` | Commands, local/worktree policy, structured output and exit status |
| `discovery.py`, `git.py` | Git-aware bounded inventory, exact Python syntax, heuristic candidates, diff/rename handling |
| repository/host instructions | Select any installed code-intelligence retrieval tools available to the native session |
| `spec/planner.py`, `providers/` | Adaptive scopes and native Claude/Codex task contracts |
| `evidence.py`, `contracts.py`, `findings.py` | Safe paths, source hashes, closed JSON input schemas, source review contracts and contradiction reconciliation |
| `impact.py` | Evidence-to-concept mapping and conservative transitive dependency/consumer impact |
| `audit.py` | Read-only instruction observations and recommendations |
| `orchestrator.py` | State transitions, locks, stale-claim quarantine and accepted response archival |
| `spec/writer.py`, `spec/verifier.py` | Markdown/source links, protected human notes, staged replacement and freshness checks |

`src/` and `schemas/` are canonical. `scripts/build_bundle.py` generates the self-contained skill engine, schema resources and specialist cards.

## Retrieval boundary

The engine has no vendor-specific code-intelligence import, CLI flag, persisted handoff or refresh protocol. Native Claude/Codex investigations read applicable `AGENTS.md`, `CLAUDE.md` and equivalent instructions and may use the installed structural/symbol/search tools described there. External tool output is untrusted retrieval context only; accepted claims require exact current-source evidence.

## State

The spec stores a versioned manifest, scan inventory, current bounded plan, typed entities/relations/evidence, gaps, audit and impact metadata under `_meta`. Accepted native responses are preserved by content hash. Applying a response for a changed source snapshot fails before writes.

Evidence IDs include both excerpt and whole-file hashes. Updates do not quietly refresh citations under unchanged claim IDs. Evidence-dependent and semantically connected claims are quarantined as UNKNOWN. Reviewed replacements may explicitly supersede stale/conflicting claims.

## Trust and limits

Source, external retrieval output and provider responses are untrusted input. Hash checks prove identity and freshness, not semantic entailment. `source-reviewed` records a reviewer judgment. Generated natural-language details obey the same confidence/evidence contract as summaries.

Output is staged beside the destination and swapped with rollback on ordinary failures. The target source tree is not changed and the engine never commits or pushes it.
