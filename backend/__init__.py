"""GluonSlides Python backend (exposed to the JS frontend via pywebview)."""

import sys
from pathlib import Path

__version__ = "0.2.1"  # keep in step with pyproject.toml (a backend test checks)

# Bundled by PyInstaller (packaging/): the app's files are unpacked next
# to the program (sys._MEIPASS), libraries and fonts included.
FROZEN = bool(getattr(sys, "frozen", False))

# Holds index.html, the frontend files, dependencies.yaml and libs/.
APP_DIR = Path(sys._MEIPASS) if FROZEN and hasattr(sys, "_MEIPASS") else Path(__file__).resolve().parent.parent
