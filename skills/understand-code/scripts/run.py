#!/usr/bin/env python3
"""Self-contained skill entrypoint. No installs, network or provider calls."""
from pathlib import Path
import sys

sys.path.insert(0, str(Path(__file__).resolve().parent / "lib"))
from understand_code.cli import main

raise SystemExit(main())
