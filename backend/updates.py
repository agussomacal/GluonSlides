"""Is there a newer GluonSlides? (the notice shown at start)

Asks GitHub for the latest published release (pre-releases are ignored)
and compares it with this version. Nothing is downloaded or installed:
the page shows a note with a link. The request sends nothing about the
user or their projects (a generic User-Agent; GitHub sees the IP address,
as with any web request). Turned off with "Don't check for updates"
(stored in updates.json in the user's config folder) or the start screen.
"""

import json
import re
import urllib.request

from . import __version__
from .user_settings import _read_json, _write_json, settings_path

LATEST_RELEASE_API = "https://api.github.com/repos/agussomacal/GluonSlides/releases/latest"
RELEASES_PAGE = "https://github.com/agussomacal/GluonSlides/releases/latest"
PREFS_FILE = "updates.json"
TIMEOUT_S = 5


def parse_version(text):
    """'v0.2.1' / '0.2.1-rc1' -> (0, 2, 1); None if it isn't a version."""
    m = re.match(r"^v?(\d+)\.(\d+)(?:\.(\d+))?", str(text or "").strip())
    return tuple(int(x or 0) for x in m.groups()) if m else None


def preferences():
    path = settings_path(PREFS_FILE)
    try:
        data = _read_json(path) if path.exists() else {}
    except Exception:
        data = {}
    if not isinstance(data, dict):
        data = {}
    return {"check": data.get("check", True) is not False, "skipped": str(data.get("skipped") or "")}


def set_preferences(check=None, skipped=None):
    prefs = preferences()
    if check is not None:
        prefs["check"] = bool(check)
    if skipped is not None:
        prefs["skipped"] = str(skipped)
    try:
        _write_json(settings_path(PREFS_FILE), prefs)
        return {"success": True, **prefs}
    except Exception as e:
        return {"success": False, "error": str(e)}


def _fetch_latest():
    req = urllib.request.Request(LATEST_RELEASE_API, headers={
        "Accept": "application/vnd.github+json",
        "User-Agent": "GluonSlides-update-check",
    })
    from .net import open_url
    with open_url(req, timeout=TIMEOUT_S) as res:
        return json.loads(res.read().decode("utf-8"))


def check_for_update(current=__version__, fetch=_fetch_latest):
    """{"success", "current", "newer": bool, "version", "url"}. Never raises:
    offline or GitHub unreachable -> newer False, with the reason."""
    prefs = preferences()
    result = {"success": True, "current": current, "newer": False, "check": prefs["check"]}
    if not prefs["check"]:
        return result
    try:
        release = fetch()
    except Exception as e:
        return {**result, "error": f"Could not check for updates: {e}"}
    latest = parse_version(release.get("tag_name"))
    mine = parse_version(current)
    if not latest or not mine:
        return result
    version = ".".join(str(x) for x in latest)
    newer = latest > mine and version != prefs["skipped"]
    return {**result, "newer": newer, "version": version, "url": release.get("html_url") or RELEASES_PAGE}
