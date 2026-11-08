# Prepared version-one migration evidence

`v1-state.json` records a Codebase Spec written by the previous Python engine at
commit `a38209d81a14a320851e40e32b94f01a3ae0cb05`, using only the prepared legacy
source and finding fixtures. It includes the original source, generated files,
metadata hashes, accepted claims, and an added human note. Its bytes must remain
unchanged: the Node.js regression loads and updates this historical state without
needing Python or regenerating expected results.

`v1-identities.json` contains sorted-key serialization and hash examples captured
from that implementation, including numeric-looking keys, non-ASCII text, control
characters and an astral Unicode character.

These fixtures establish deterministic migration compatibility. They are not
evidence of model quality or execution of the source application.
