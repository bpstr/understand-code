# Release acceptance and boundaries

The supplied design's v1 capability set is implemented as an engine plus native-agent workflow. Reconstruction quality depends on actually performing and reviewing the investigations; an initial inventory is never presented as a completed semantic spec.

| Requirement | Implementation / validation |
| --- | --- |
| Tool-agnostic retrieval | Native sessions use repository-configured tools; the engine has no vendor dependency or refresh requirement |
| Repository/framework discovery | Git inventory, manifests, language extensions, conservative declaration candidates with explicit limitations and native cartographer interpretation; bounded/excluded inventory tests |
| Module/architecture map | Evidence-backed directory membership baseline; cartographer/deployment findings add actual responsibilities |
| Entrypoints/features/flows | Candidates plus entrypoint/domain/runtime specialists; prepared checkout findings demonstrate supported behavior and missing HTTP binding |
| UI/backend, settings, data and tests | Dedicated specialist contracts and typed edges; prepared setting → cache invalidation → checkout gate evidence, explicit gap instead of a fictional UI/server connection |
| Confidence/evidence | Closed schemas, exact line and file hashes, source-reviewed established claims, conflicts and UNKNOWNs; invalid/stale/fabricated evidence rejection tests |
| Agent readiness | Instruction inventory and bounded diagnostics; stale fixture documentation remains separate from source truth |
| Markdown spec | Relevant concept pages, source-linked change maps, navigation, coverage and gaps; human-note/generated-edit protection tests |
| Reader-facing documents | Optional typed profiles, audience/purpose/scope, evidence-backed sections, ordered steps, tables and literal examples; linked document and entity pages |
| Requirement authority and traceability | Stable requirement IDs, observed/specified/proposed/unknown basis, explicit proposal origin, rationale and verification intent; nested evidence stays within the owning entity and task |
| Example validation | Unexecuted, syntax/schema checked and behavior checked states; external provenance binds the example content and source snapshot; no engine execution |
| Documentation readiness | Separate `documentation_quality` report and optional `--require-doc-quality` gate; incomplete/unreviewed/stale content remains visible, and legacy verification retains its meaning |
| Incremental Git refresh | Base diff plus working-tree snapshots, renamed/deleted/new files, semantic blast radius, stale quarantine and focused tasks |
| Claude/Codex providers | Native task adapters, shared self-contained skill, Claude role cards and both plugin manifests; distribution/native manifest checks |
| Setup/update/release | Pinned npm archive installation, host marketplace instructions, Node.js CI, versioned plugin/skill/npm archives and checksums |

Git history is available to the deep-mode history specialist, but no statistical co-change engine or runtime trace executor is claimed. CI verifies this tool's offline contracts; optional `verify --require-complete` is available for consuming repositories. Interactive visualization and automatic external index extraction remain outside v1. No hosted server deployment, npm registry publication, paid headless provider driver, live-model quality evaluation or store approval is implied by the GitHub release.

Fixture assertions measure engine behavior: citation integrity, state transitions, preservation and uncertainty. They do not measure model feature-location recall, relationship accuracy or false-intent rates. Those require a separately authorized evaluation plan; paid synthetic testing is forbidden here.

## Documentation acceptance

Review authored documents against the [authoring guide](../skills/understand-code/references/documentation-authoring.md). Mechanical acceptance checks structure, citation ownership, authority compatibility, freshness and example provenance. Reviewers still need to establish that the selected scope serves the reader, the prose follows from the cited source, exceptions are accurate, applicability reasons are justified and verification procedures test the intended requirement.

No authored documents means documentation readiness is false, even if inventory verification passes. Unknown required topics, unresolved requirement verification, missing required examples and runnable examples without a current successful behavior check block the documentation gate. Illustrative examples remain visibly unexecuted and produce a warning. A passed gate does not certify implementation approval, runtime correctness, complete repository documentation or live-model performance.

See the [dated research and issue matrix](research/2026-11-08-documentation-quality.md) for the basis of these additions and the [offline testing policy](TESTING.md) for the limits of the prepared scenarios.
