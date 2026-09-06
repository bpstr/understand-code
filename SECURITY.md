# Security and data handling

Understand Code reads local source and writes a dedicated documentation directory. It has no telemetry, hosted service, API-key configuration or inference client. Native Claude/Codex sessions have their own permissions and data policies.

Known secret filenames, symlinks, dependency/build directories and Git-ignored files are excluded from inventory. Add sensitive repository-specific paths to `.understand-codeignore` before discovery. This is not a general secret scanner: secrets embedded in ordinary source can still be visible to a native investigation.

Findings and graph data cannot instruct the engine to run code. Source paths must remain inside the repository and task scope. Existing generated content is protected from silent overwrite; metadata hashes detect accidental changes, not malicious rewriting by someone who controls the entire output.

Report vulnerabilities through GitHub's private security reporting when enabled. If unavailable, open an issue requesting a private contact without including secrets or exploit details. Never submit real credentials in a fixture.
