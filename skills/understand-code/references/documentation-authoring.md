# Author documentation and specifications

Use this guide when findings need a reader-facing document, beyond the existing concept summary and change map. Keep source interpretation and source review in the native session; submit structured content through `entity.documentation`. Read the [evidence contract](evidence-contract.md) and the generated [document schema](schemas/documentation.schema.json) before preparing a response.

## Contents

- [Choose the reader and document](#choose-the-reader-and-document)
- [Inspect the behavioral contract](#inspect-the-behavioral-contract)
- [Write requirements with explicit authority](#write-requirements-with-explicit-authority)
- [Represent content without losing meaning](#represent-content-without-losing-meaning)
- [Record examples and actual checks](#record-examples-and-actual-checks)
- [Review, publish and maintain](#review-publish-and-maintain)

## Choose the reader and document

Identify the reader, their existing knowledge, the task or decision the document supports, and the boundaries of the request. Inspect existing manuals, README entry points, docstrings, schemas, generators, ADRs and contribution rules. Preserve the repository's terminology, public/private distinction, language conventions and documentation dialect. Link canonical material instead of creating a separately maintained copy. Record relevant canonical evidence in `canonical_sources`; do not invent an owner.

Choose one `profile` per document. The required topics are a minimum coverage check, not a requirement to fill irrelevant sections with prose.

| Profile | Reader outcome | Required section topics |
| --- | --- | --- |
| `reference` | Look up a callable or interface contract | `inputs`, `outputs`, `errors`, `side-effects` |
| `how-to` | Complete a concrete task | `prerequisites`, `steps`, `verification`, `troubleshooting` |
| `tutorial` | Learn by following a bounded exercise | `prerequisites`, `steps`, `verification` |
| `explanation` | Understand a design and its tradeoffs | `context`, `design`, `tradeoffs` |
| `specification` | Implement or assess explicit behavior | `behavior`, `interfaces`, `data`, `failures`, `security`, `quality`, `verification` |

Supply `audience`, `purpose` and `scope` in plain language. State important exclusions in `scope`. Use additional applicable topics such as `compatibility`, `operations`, `decisions` or `constraints`; do not generate every profile for every entity. Keep learning instructions, reference facts and rationale distinguishable. This selection follows [Diátaxis](https://www.diataxis.fr/start-here/) and [Google's audience guidance](https://developers.google.com/tech-writing/one/audience).

Choose `mode` separately from confidence: `as-built` describes observed behavior, `proposal` states requested or suggested changes, and `mixed` explicitly compares them. A well-supported observation is not automatically a product requirement or an approved design.

## Inspect the behavioral contract

Inspect declarations, actual callers/registrations, validators, configuration and relevant tests. For each in-scope interface, account for applicable input meaning and units, defaults, null/empty/boundary values, return shape, errors, side effects and preconditions. Inspect permissions, state transitions, resource ownership/cleanup, ordering, retries, idempotency, concurrency and cancellation when they can affect callers. Mark anything not established by the available scope as unknown.

Follow the source of each fact. A schema declaration, an implementation branch and a test assertion can disagree; preserve that discrepancy. In particular, a JSON Schema `default` annotation does not insert a value, and schema examples are not automatically validated. See the [JSON Schema annotation guidance](https://json-schema.org/understanding-json-schema/reference/annotations). Follow runtime defaulting and validation code before claiming behavior.

For HTTP APIs, inspect the repository's existing OpenAPI document and version if present. Check parameters, payload/media types, success responses, known errors and operation-level security overrides. Preserve its dialect; do not generate or upgrade a parallel machine contract implicitly. See the [OpenAPI specification](https://spec.openapis.org/oas/v3.2.1.html).

For architecture, describe representative success and failure scenarios, external boundaries and relevant startup/shutdown behavior. Link existing ADRs and distinguish documented rationale from your analysis; never manufacture the historical reason for a design. For quality requirements, include workload, conditions, units and an observable result when supported. Record missing targets as questions, not invented latency, memory or availability promises. See [arc42 runtime views](https://docs.arc42.org/section-6/), [quality scenarios](https://docs.arc42.org/section-10/) and [architecture decision records](https://cognitect.com/blog/2011/11/15/documenting-architecture-decisions).

Recommend inline documentation where the reader needs it: public contracts belong with public symbols, and non-obvious implementation constraints or rationale belong near the code. Add meaning beyond a signature or a paraphrase of each line. Apply the repository's docstring/comment conventions rather than imposing one language's syntax. [PEP 257](https://peps.python.org/pep-0257/) and [Go doc comments](https://go.dev/doc/comment) provide examples of this distinction. Understand Code only writes its configured spec output; hand source-comment changes to the authorized coding workflow.

## Write requirements with explicit authority

Use stable `req.*` identifiers, unique within the document. Give each requirement one observable obligation, a separate rationale, supporting evidence and a verification plan. Retain existing external requirement identifiers in `origin` when mapping them into this model. Avoid vague terms such as fast, secure or user-friendly without stated conditions and an observable criterion. Keep assumptions and unresolved values visible. These practices apply [NASA's requirement-writing checklist](https://www.nasa.gov/reference/appendix-c-how-to-write-a-good-requirement/) and [traceability guidance](https://www.nasa.gov/reference/6-2-requirements-management/) proportionately; no formal aerospace process is required.

| `basis` | Meaning and support |
| --- | --- |
| `observed` | Reconstructed current behavior; cite source or configuration evidence. This is not a new normative obligation. |
| `specified` | An existing documentary or human statement of intended behavior; cite that evidence. Inspect its authority/status and any implementation mismatch. |
| `proposed` | A requested or suggested future obligation; supply an explicit `origin`. This does not mean approved or implemented. |
| `unknown` | An unresolved requirement or question; use verification method `unresolved` and explain the next investigation. |

Use only `observed`/`unknown` requirements in `as-built` documents and `proposed`/`unknown` in `proposal` documents. Use `mixed` when a comparison needs other combinations, and label current versus intended behavior in the prose. Cite current source for proposal context; put unsupported future obligations in proposed requirements rather than presenting them as current facts.

For `verification`, choose `test`, `inspection`, `analysis`, `demonstration` or `unresolved`; provide a concrete `procedure`, `expected` result and `test_evidence` list. Use test-source evidence only for the last field. Trace requirements to source/design evidence and existing assertions, or explicitly state that a test still needs implementation. A planned check and an inspected assertion are not a passed execution.

Preserve the project's requirement convention in `requirement_convention`. If it deliberately uses BCP 14, apply [RFC 2119](https://www.rfc-editor.org/rfc/rfc2119.html) with [RFC 8174](https://www.rfc-editor.org/rfc/rfc8174.html): uppercase keywords carry the defined meanings, and SHOULD allows justified exceptions. Do not silently adopt this vocabulary or treat every use of “should” as a requirement level.

## Represent content without losing meaning

Assign a stable, globally unique `doc.*` ID owned by one entity. Keep IDs when titles change. The writer creates `documents/<id>.md` with links from its parent and the document index. Historical IDs remain reserved to their original entity even after retirement; do not reuse them for another owner.

Give each section a unique `id`, `topic`, descriptive `title`, `status`, `content` and `evidence`. Use `documented` for supported content, `unknown` for a concrete question, or `not-applicable` with a scope-based reason. Documented sections need exact evidence; a reviewer must assess whether that evidence supports the words. A required unknown topic blocks readiness. A not-applicable reason must survive source review; it is not a shortcut around missing investigation.

Write `content` as plain text with paragraph breaks. Use `steps` for an ordered sequence and `table` for exact mappings (`columns` and equal-width `rows`). Do not embed Markdown headings, tables, HTML or fenced code in content: they are escaped as text. Put literal code in `examples[].code`, retaining indentation and newlines. Use descriptive headings, clear terminology and meaningful source labels. Explain the information in any linked diagram in text; see [Google's accessible-documentation guidance](https://developers.google.com/style/accessibility).

Keep all nested evidence IDs, including canonical sources and verification tests, in the owning entity's evidence list and the current findings bundle. Reuse captured records; never invent references merely to satisfy the schema. The document inherits the entity's review, confidence and staleness.

Carry the `documentation` field forward when updating an entity that already has authored documents. Use an explicit empty array only for intentional removal. Changes and removals follow the normal conflict/source-review/`supersedes` process; omission must not silently delete a document.

Use the following incomplete shape inside an entity. It describes a fictional listing interface and deliberately contains an unresolved section/requirement and an unexecuted sketch. It is not a ready specification or an ingestion file. Replace the subject, IDs and text; add the remaining profile topics and captured evidence before promoting any content to `documented`. No fabricated citation is needed for an honest unknown.

```json
{
  "documentation": [{
    "id": "doc.listing-contract",
    "title": "Listing contract",
    "profile": "specification",
    "mode": "mixed",
    "audience": "Maintainers implementing a listing client",
    "purpose": "Resolve pagination behavior before client implementation",
    "scope": "Public listing behavior; storage internals are excluded",
    "sections": [{
      "id": "behavior",
      "topic": "behavior",
      "title": "Default page behavior",
      "status": "unknown",
      "content": "The default limit still needs source and contract review.",
      "evidence": []
    }],
    "requirements": [{
      "id": "req.default-limit",
      "statement": "What limit applies when the caller omits it?",
      "basis": "unknown",
      "rationale": "The client needs a predictable pagination boundary.",
      "evidence": [],
      "verification": {
        "method": "unresolved",
        "procedure": "Inspect the declared contract and defaulting implementation.",
        "expected": "Identify the supported limit or retain the disagreement.",
        "test_evidence": []
      }
    }],
    "examples": [{
      "id": "listing-sketch",
      "title": "Illustrative request flow",
      "kind": "illustrative",
      "language": "text",
      "code": "request a page without an explicit limit\ninspect the returned page boundary",
      "prerequisites": "Resolve the actual callable and contract before implementation.",
      "expected": "Illustrates the question only; no runtime result is asserted.",
      "evidence": [],
      "validation": {
        "status": "not-run",
        "level": "none",
        "reason": "Pseudocode for an unresolved contract; no execution occurred."
      }
    }],
    "canonical_sources": [],
    "review_when": ["The public listing signature or defaulting contract changes"]
  }]
}
```

## Record examples and actual checks

Reference, how-to and tutorial profiles require a useful example. Choose `runnable` when the supplied code can be executed with the stated setup; choose `illustrative` for a deliberately incomplete sketch and explain its limits. Provide `language`, literal `code`, `prerequisites`, `expected` result, evidence and a validation record. Use safe placeholders for credentials and describe relevant side effects. Prefer the repository's existing example/doctest mechanism; keep teaching examples concise without concealing essential setup. See [Google's sample-code guidance](https://developers.google.com/tech-writing/two/sample-code).

Default to `validation.status: not-run` and `level: none` with an honest reason. If an authorized external harness performs a check, record `passed` or `failed` and the actual level: `syntax`, `schema` or `behavior`. Syntax/schema checks do not establish the expected runtime behavior. Illustrative examples cannot claim executed validation. [Rustdoc's documentation tests](https://doc.rust-lang.org/rustdoc/write-documentation/documentation-tests.html) illustrate why compiling and running are distinct checks; this skill does not require Rust.

A checked example needs `provenance` containing the command, environment, task snapshot, timezone-aware timestamp, runner, output SHA-256, example SHA-256 and exit code. Bind the example hash to the exact language, code, prerequisites and expected result using `example_fingerprint` in the engine's `documentation.ts`; changing any of those invalidates the attestation. Never fabricate a run or hash from an expected result. An exit code of zero alone is insufficient: the harness must check the stated behavior before reporting level `behavior`.

The engine never executes examples or target code. Use only checks already authorized for the external harness; otherwise retain `not-run` and report the blocker. A source snapshot change invalidates an existing check even if the example text remains unchanged. Preserve failed checks and their diagnosis.

## Review, publish and maintain

Have a separate reviewer read the relevant source and the rendered document. Check that a reader can find the answer, prerequisites and failure path; verify that tables, sequence steps and literal examples survived rendering. Check applicability reasons, requirement authority, source links, test mapping and the distinction between proposed and implemented behavior. Do not certify quality by counting headings or citations.

Apply through the normal reviewed findings workflow, then run:

```bash
node <skill-directory>/scripts/run.mjs verify --repo <repo> --require-doc-quality
```

Inspect `documentation_quality` in `verify` or `status`. The gate covers authored documents only. It blocks missing required topics/examples, required unknowns, unreviewed/stale/conflicting support, unresolved requirements and runnable examples lacking a current successful behavior check. Illustrative examples are disclosed as warnings. No authored documents means not ready. Existing integrity and investigation/change-completeness gates retain their separate meanings.

Treat readiness as a bounded mechanical result plus recorded review, never proof of semantic truth, implementation approval, whole-repository documentation coverage or model quality. Hand off remaining blockers and warnings explicitly.

Supply concrete `review_when` triggers such as changes to the cited public signature, validator, default, state transition, schema or external contract. Add `owner` only when supplied. Refresh source, requirements, examples and links together after changes; preserve human notes, historical failures and superseded decisions. Keep the canonical documentation near its source and in the normal review workflow, following [Write the Docs principles](https://www.writethedocs.org/guide/writing/docs-principles/) and [docs as code](https://www.writethedocs.org/guide/docs-as-code/). See [maintenance](maintenance.md) for recovery and conflicts.
