# Tool-agnostic code intelligence

Understand Code does not depend on a named code-intelligence implementation.

## Discovery policy

The native Claude/Codex session reads applicable `AGENTS.md`, `CLAUDE.md`, and equivalent host/repository instructions. If those instructions describe an installed code-intelligence, symbol, semantic-search, or code-graph tool, the session may use that tool for retrieval. If several are available, choose the smallest useful structural query for the current investigation. If none is configured or the tool is unavailable or insufficient, fall back to bounded source/file search.

External tool output is retrieval context only. It never becomes evidence by itself and never establishes runtime behavior. Accepted claims continue to require exact current-source evidence through Understand Code's evidence contract.

## Engine boundary

The deterministic engine owns inventory, task scopes, evidence identity, reconciliation, incremental invalidation, and persisted specs. It does not import vendor graph exports, expose vendor-specific CLI flags, write vendor handoff files, or require an external index refresh step.

The native investigation prompt states that repository-configured code-intelligence tools may be used according to applicable agent instructions. This keeps retrieval replaceable without changing the persistent semantic model.
