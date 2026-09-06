# Contributing

Use Python 3.10+ and the standard library for runtime code. Keep source discovery separate from semantic interpretation. Source hashes, human notes and explicit unknowns are release contracts, not presentation details.

Edit `src/`, `schemas/` and skill references. Regenerate with `python3 scripts/build_bundle.py`, then run the commands in [testing policy](docs/TESTING.md). Add meaningful offline regression coverage for changes to state, evidence, filesystem safety and preservation. Never invoke paid models or load `.secrets` in automated checks.

Use a focused branch unless the requester selects another workflow. Write plain-English imperative commit subjects, without type/scope prefixes. Explain concrete behavior changes and validation in pull requests. Update both plugin manifests, marketplace versions, Python version, changelog and installation examples together for releases.

For a release, run `python3 scripts/release.py`, review the resulting archives and checksums, push the reviewed main commit, wait for CI, then create the matching `vX.Y.Z` Git tag and GitHub release. Publishing requires maintainer authorization; the script only builds local artifacts.
