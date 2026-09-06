#!/bin/sh
# The bundled skill runner works without installing a Python package.
set -eu
script_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
exec python3 "$script_dir/../skills/understand-code/scripts/run.py" "$@"
