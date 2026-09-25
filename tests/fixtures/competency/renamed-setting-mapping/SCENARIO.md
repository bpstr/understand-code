# Renamed setting across API and frontend

Question: Do the API and frontend enforce the same attachment-size setting despite different identifiers?

Expected: trace `MAX_ATTACHMENT_BYTES` through `attachment_limit()` and the `upload_policy()` serialization key `maxUploadSize` into the frontend policy consumer. The API validator and frontend validator use this explicit value mapping, not coincidentally equal hard-coded constants.

The fixture supplies a serialization/consumer contract, not an HTTP route or evidence that a deployed browser fetched it. Keep that transport boundary unresolved unless additional source supplies it. Lexical name equality and equal values are neither required nor sufficient for runtime equivalence.
