"""Download the JS/CSS libraries and fonts listed in dependencies.yaml into libs/."""

import urllib.request

import yaml

from . import APP_DIR

LIBS_DIR = APP_DIR / "libs"
FONTS_DIR = LIBS_DIR / "fonts"
CONFIG_FILE = APP_DIR / "dependencies.yaml"


def _download(name, url, dest, label):
    """Fetch url into dest unless it already exists."""
    if dest.exists():
        return
    dest.parent.mkdir(parents=True, exist_ok=True)
    print(f"Installing missing {label}: {name}...")
    try:
        urllib.request.urlretrieve(url, dest)
        print(f"Successfully downloaded {label} {name}")
    except Exception as e:
        print(f"Error downloading {name}: {e}")


def check_and_install_dependencies():
    """Download any missing entries of dependencies.yaml.

    `dependencies` go to libs/<name> (or libs/<subdir>/<name> when a
    `subdir` key is given); `fonts` go to libs/fonts/<name>.
    """
    if not CONFIG_FILE.exists():
        print(f"Warning: {CONFIG_FILE} not found. Skipping automated dependency check.")
        return

    LIBS_DIR.mkdir(exist_ok=True)
    try:
        config = yaml.safe_load(CONFIG_FILE.read_text(encoding="utf-8")) or {}

        for dep in config.get("dependencies") or []:
            name = dep.get("name")
            target_dir = LIBS_DIR / dep["subdir"] if dep.get("subdir") else LIBS_DIR
            _download(name, dep.get("url"), target_dir / name, "dependency")

        for font in config.get("fonts") or []:
            name = font.get("name")
            _download(name, font.get("url"), FONTS_DIR / name, "font")
    except Exception as e:
        print(f"Error parsing {CONFIG_FILE}: {e}")
