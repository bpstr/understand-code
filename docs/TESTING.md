# Offline testing policy

All automated tests, CI, synthetic scenarios, smoke checks, benchmarks, grading, calibration and retries use prepared data and mocked transports. Paid token/API testing is forbidden, including opt-ins, ambient credentials, subscription proxies, alternate keys/models and automatic fixture recording. Never load `.secrets` into a test runner.

The engine contains no provider/network transport. Tests use Node's built-in test runner, prepared inputs, and deterministic Git subprocesses. Native host commands used for packaging validation must be read-only `--help` or plugin manifest validation, never inference/eval prompts. Release checks run the packaged CLI with a PATH containing only Node and Git, without inherited provider credentials or preload hooks. Installing development tools with `npm ci` is a dependency download, not a test or inference call; runtime fixture checks remain offline.

Run:

```bash
npm ci --ignore-scripts
npm run build
npm test
npm run check
npm run release
npm run check:artifacts
```

The fixture intentionally includes a stale README, dead implementation, setting persistence/cache invalidation, frontend requests and an absent HTTP binding. Prepared expectations assert only what that fixture supports. Tests cover evidence forgery, invalid corroboration, stale snapshots, relation endpoints, explicit unknowns, contradiction retention, note preservation, symlink/secret exclusions, scan budgets, Git renames, worktree isolation and CLI exit behavior.

Python files under `tests/fixtures/` remain multilingual source input data and are never executed. Runtime code, contributor tooling, automated tests, release packages and CI do not depend on Python. The declaration scanner deliberately labels heuristic matches as `INFERRED`; tests must not restore the previous Python AST claim by overstating what a regex proves.

`npm run check` recompiles strict TypeScript to a temporary directory and checks generated JavaScript, declarations, schema resources, role cards, manifest versions, skill metadata and local documentation links without rewriting them. `npm run release` builds deterministic plugin/skill ZIPs and an npm archive, then writes `dist/SHA256SUMS`. `npm run check:artifacts` verifies every checksum, extracts the exact current-version archives, and exercises their bootstrap/verify/status commands plus an offline npm installation. It checks that incomplete documentation fails its optional quality gate. These scripts make no provider calls and never execute a fixture application or example.

Prepared responses are contract evidence only. They do not establish provider availability, model quality, true production usage, settlement, live latency or launch qualification. Failed evidence must be preserved; do not regenerate expected values to conceal a regression.

## Documentation contract scenarios

The prepared inputs in [fixtures/documentation](../tests/fixtures/documentation/README.md) and `tests/documentation.test.mjs` exercise authored documents without invoking a model or executing the examples. Placeholder evidence IDs are rebound to exact ranges in the temporary fixture; any execution provenance is explicitly constructed test data.

Maintain regressions for the following meaningful boundaries:

- Accept supported reference, how-to and specification records while rejecting mismatched authority, missing nested citations and duplicate document identities.
- Preserve paragraphs, ordered steps, tables, indentation, fences and marker-like literals; keep human notes and generated-edit protections intact.
- Bind checked examples to both the supplied content and source snapshot; distinguish unexecuted, failed, syntax/schema and behavior checks.
- Keep incomplete, unknown, stale or conflicting documents out of the optional readiness gate; preserve legacy findings and verification behavior.
- Reconcile additive documentation and real conflicts, and omit native-only document records from the closed Change Knowledge Exchange v1 export.

These cases establish deterministic ingestion, rendering and readiness behavior. They do not measure whether a native agent will select the right audience, discover every public interface, write useful explanations or infer correct requirements on unseen code. Use the manual source-and-reader review rubric in the [authoring guide](../skills/understand-code/references/documentation-authoring.md); do not present fixture success as a model evaluation.

Live-content dogfood is a separate manual activity requiring exact real-content scope, an explicit hard monetary/request cap and a stop condition before any call. This repository's implementation/release authorization does not authorize it. No live dogfood was used for this release.
