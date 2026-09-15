# Tool-agnostic code intelligence

Understand Code must not depend on Graphify, codebase-memory, Codanna, Sourcegraph, or any other named code-intelligence implementation.

## Discovery policy

The native Claude/Codex session reads applicable `AGENTS.md`, `CLAUDE.md`, and equivalent host/repository instructions. If those instructions describe an installed code-intelligence, symbol, semantic-search, or code-graph tool, the session may use that tool for retrieval. If several are available, choose the smallest useful structural query for the current investigation. If none is configured or the tool is unavailable, fall back to bounded source/file search.

External tool output is retrieval context only. It never becomes evidence by itself and never establishes runtime behavior. Accepted claims continue to require exact current-source evidence through Understand Code's evidence contract.

## Engine boundary

The deterministic engine should own inventory, task scopes, evidence identity, reconciliation, incremental invalidation, and persisted specs. It should not import a vendor graph export, expose vendor-specific CLI flags, write vendor handoff files, or require a graph refresh step.

The native investigation prompt should instead state that repository-configured code-intelligence tools may be used according to applicable agent instructions. This keeps retrieval replaceable without changing the persistent semantic model.

## Removal acceptance

- remove the Graphify importer and generated bundle copy
- remove `--graph` and Graphify metadata/handoff output
- remove Graphify-specific docs, keywords, tests, exclusions, and skill instructions
- preserve offline deterministic engine tests
- add tests proving reconstruction works with no external code-intelligence integration
- keep external tool results explicitly unverified until checked against source
