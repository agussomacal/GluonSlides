"""GluonSlides Python backend (exposed to the JS frontend via pywebview)."""

from pathlib import Path

# Repo root: holds index.html, the frontend files, dependencies.yaml and libs/.
APP_DIR = Path(__file__).resolve().parent.parent
