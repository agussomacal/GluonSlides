"""Download the JS/CSS libraries and fonts listed in dependencies.yaml into libs/.

The app does this at start. On its own (e.g. on a test machine):

    python -m backend.vendor_libs     # exit code 1 if anything is missing
"""

import sys
import urllib.request

import yaml

from . import APP_DIR

LIBS_DIR = APP_DIR / "libs"
FONTS_DIR = LIBS_DIR / "fonts"
CONFIG_FILE = APP_DIR / "dependencies.yaml"


def _download(name, url, dest, label):
    """Fetch url into dest unless it already exists. Returns False on failure."""
    if dest.exists():
        return True
    dest.parent.mkdir(parents=True, exist_ok=True)
    print(f"Installing missing {label}: {name}...")
    try:
        urllib.request.urlretrieve(url, dest)
        print(f"Successfully downloaded {label} {name}")
        return True
    except Exception as e:
        print(f"Error downloading {name}: {e}")
        dest.unlink(missing_ok=True)  # no half-written file
        return False


def check_and_install_dependencies():
    """Download any missing entries of dependencies.yaml.

    `dependencies` go to libs/<name> (or libs/<subdir>/<name> when a
    `subdir` key is given); `fonts` go to libs/fonts/<name>.
    Returns the names that could not be downloaded.
    """
    failed = []
    if not CONFIG_FILE.exists():
        print(f"Warning: {CONFIG_FILE} not found. Skipping automated dependency check.")
        return failed

    LIBS_DIR.mkdir(exist_ok=True)
    try:
        config = yaml.safe_load(CONFIG_FILE.read_text(encoding="utf-8")) or {}

        for dep in config.get("dependencies") or []:
            name = dep.get("name")
            target_dir = LIBS_DIR / dep["subdir"] if dep.get("subdir") else LIBS_DIR
            if not _download(name, dep.get("url"), target_dir / name, "dependency"):
                failed.append(name)

        for font in config.get("fonts") or []:
            name = font.get("name")
            if not _download(name, font.get("url"), FONTS_DIR / name, "font"):
                failed.append(name)
    except Exception as e:
        print(f"Error parsing {CONFIG_FILE}: {e}")
        failed.append(str(CONFIG_FILE))
    return failed


if __name__ == "__main__":
    missing = check_and_install_dependencies()
    if missing:
        print(f"Missing: {', '.join(missing)}")
        sys.exit(1)
    print("All libraries and fonts are present.")
