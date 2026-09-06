# Repository guidance

Read [architecture](docs/ARCHITECTURE.md) and [testing policy](docs/TESTING.md) before changing the engine.

Prefer codebase-memory MCP graph tools for code discovery; index the repository if needed. Use scoped text/file searches when graph tools are unavailable or insufficient, or for config/literal searches.

Canonical code is in `src/`; input contracts are in `schemas/`. After editing either or the role registry, run `python3 scripts/build_bundle.py`. Do not independently edit generated skill engine copies or specialist cards.

Validate with `PYTHONPATH=src python3 -m unittest discover -s tests -v` and `python3 scripts/check_distribution.py`. All automated tests use prepared fixtures and no paid inference. Never load `.secrets`, invoke provider CLIs for tests, record live fixtures or add a paid opt-in. Live dogfood requires separate explicit real-content scope, hard monetary/request limits and a stop condition.

Preserve source evidence identity, human notes and historical failed evidence. Do not represent passing fixtures or hash checks as semantic truth or provider qualification.

Follow the user's selected branch. Commit subjects use plain-English imperative wording without Conventional Commit prefixes.
