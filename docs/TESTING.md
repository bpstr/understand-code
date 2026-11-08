# Offline testing policy

All automated tests, CI, synthetic scenarios, smoke checks, benchmarks, grading, calibration and retries use prepared data and mocked transports. Paid token/API testing is forbidden, including opt-ins, ambient credentials, subscription proxies, alternate keys/models and automatic fixture recording. Never load `.secrets` into a test runner.

The engine contains no provider/network transport. Unit tests deny socket connections and permit only deterministic Git subprocesses. Native host commands used for packaging validation must be read-only `--help` or plugin manifest validation, never inference/eval prompts.

Run:

```bash
PYTHONPATH=src python3 -m unittest discover -s tests -v
python3 scripts/build_bundle.py --check
python3 scripts/check_distribution.py
```

The fixture intentionally includes a stale README, dead implementation, setting persistence/cache invalidation, frontend requests and an absent HTTP binding. Prepared expectations assert only what that fixture supports. Tests cover evidence forgery, invalid corroboration, stale snapshots, relation endpoints, explicit unknowns, contradiction retention, note preservation, symlink/secret exclusions, scan budgets, Git renames, worktree isolation and CLI exit behavior.

Prepared responses are contract evidence only. They do not establish provider availability, model quality, true production usage, settlement, live latency or launch qualification. Failed evidence must be preserved; do not regenerate expected values to conceal a regression.

## Documentation contract scenarios

The prepared inputs in [fixtures/documentation](../tests/fixtures/documentation/README.md) and `tests/test_documentation.py` exercise authored documents without invoking a model or executing the examples. Placeholder evidence IDs are rebound to exact ranges in the temporary fixture; any execution provenance is explicitly constructed test data.

Maintain regressions for the following meaningful boundaries:

- Accept supported reference, how-to and specification records while rejecting mismatched authority, missing nested citations and duplicate document identities.
- Preserve paragraphs, ordered steps, tables, indentation, fences and marker-like literals; keep human notes and generated-edit protections intact.
- Bind checked examples to both the supplied content and source snapshot; distinguish unexecuted, failed, syntax/schema and behavior checks.
- Keep incomplete, unknown, stale or conflicting documents out of the optional readiness gate; preserve legacy findings and verification behavior.
- Reconcile additive documentation and real conflicts, and omit native-only document records from the closed Change Knowledge Exchange v1 export.

These cases establish deterministic ingestion, rendering and readiness behavior. They do not measure whether a native agent will select the right audience, discover every public interface, write useful explanations or infer correct requirements on unseen code. Use the manual source-and-reader review rubric in the [authoring guide](../skills/understand-code/references/documentation-authoring.md); do not present fixture success as a model evaluation.

Live-content dogfood is a separate manual activity requiring exact real-content scope, an explicit hard monetary/request cap and a stop condition before any call. This repository's implementation/release authorization does not authorize it. No live dogfood was used for this release.
