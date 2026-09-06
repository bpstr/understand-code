# Graphify integration

Understand Code consumes an existing `graphify-out/graph.json` node-link export (`nodes` and `links` or `edges`). `--graph <relative-path>` selects another export. It records the input hash and exposes bounded graph neighborhoods to specialist tasks. Node file hints recognize `file`, `source_file`, and `path`. Missing/incompatible graph context never becomes invented structural evidence.

Use graphify/codebase-memory MCP tools for structural lookup and source snippets. Those tools remain the structural engine; Understand Code does not implement a competing call graph. Index source first when authorized, investigate findings, write the Codebase Spec, then refresh the graph with the source plus generated Markdown.

After writing, `_meta/graphify-handoff.json` records the Markdown root and refresh request. `_meta/graphify-semantic.json` is a directed node-link sidecar carrying semantic entities, typed relations, confidence and evidence. Use a compatible consumer to merge it or let Graphify index the Markdown links. Do not replace `graphify-out/graph.json` with the semantic sidecar: that would discard the structural graph.

Graphify installations differ in CLI/API and extraction costs. Consult the installed Graphify skill/tool documentation for its supported incremental refresh. This engine never executes Graphify, invokes an LLM for Markdown extraction, installs dependencies, or assumes an undocumented merge command. If extraction would spend tokens, obtain the authorization required by the user's policy; otherwise retain `pending-external` and state that limitation. A preexisting graph is not necessarily current, and an exported sidecar is not evidence of successful indexing.
