#!/bin/sh
# The bundled Node.js skill runner works without a global CLI installation.
set -eu
script_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
exec node "$script_dir/../skills/understand-code/scripts/run.mjs" "$@"
