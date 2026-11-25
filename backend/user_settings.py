"""Per-user settings (recent projects, .gl inspector settings).

Stored in the platform config dir (e.g. ~/.config/gluonslides on Linux).
Files left in the repo root by older versions are copied over on first use.
"""

import json
import os
import shutil
from pathlib import Path

from platformdirs import user_config_dir

from . import APP_DIR

RECENTS_FILE = "recents.json"
INSPECTOR_FILE = "gl_inspector_settings.json"
MAX_RECENTS = 10


def config_dir():
    """Per-user config directory (overridable via GLUONSLIDES_CONFIG_DIR)."""
    return Path(os.environ.get("GLUONSLIDES_CONFIG_DIR") or user_config_dir("gluonslides"))


def settings_path(filename):
    """Path of a settings file, migrating a legacy repo-root copy if needed."""
    path = config_dir() / filename
    legacy = APP_DIR / filename
    if not path.exists() and legacy.is_file():
        path.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(legacy, path)
    return path


def _read_json(path):
    with open(path, "r", encoding="utf-8") as f:
        return json.load(f)


def _write_json(path, data):
    path.parent.mkdir(parents=True, exist_ok=True)
    with open(path, "w", encoding="utf-8") as f:
        json.dump(data, f, indent=2)


def get_inspector_settings():
    path = settings_path(INSPECTOR_FILE)
    if not path.exists():
        return {"success": True, "settings": None}
    try:
        data = _read_json(path)
        if not isinstance(data, dict):
            return {"success": True, "settings": None}
        return {"success": True, "settings": data}
    except Exception as e:
        return {"success": False, "error": str(e), "settings": None}


def save_inspector_settings(settings_data):
    path = settings_path(INSPECTOR_FILE)
    try:
        parsed = json.loads(settings_data) if isinstance(settings_data, str) else settings_data
        if not isinstance(parsed, dict):
            return {"success": False, "error": "Invalid settings payload."}
        _write_json(path, parsed)
        return {"success": True, "path": str(path)}
    except Exception as e:
        return {"success": False, "error": str(e)}


def get_recent_projects():
    """Recent projects whose files still exist; prunes the file only if needed."""
    path = settings_path(RECENTS_FILE)
    if not path.exists():
        return {"success": True, "projects": []}
    try:
        projects = _read_json(path)
        if not isinstance(projects, list):
            projects = []
        valid = [
            p for p in projects
            if isinstance(p, dict) and p.get("path") and os.path.exists(p["path"])
        ]
        if len(valid) != len(projects):
            _write_json(path, valid)
        return {"success": True, "projects": valid}
    except Exception as e:
        return {"success": False, "error": str(e), "projects": []}


def add_recent_project(name, project_path):
    """Move/insert a project at the top of the recents list."""
    path = settings_path(RECENTS_FILE)
    try:
        projects = _read_json(path) if path.exists() else []
        if not isinstance(projects, list):
            projects = []
    except Exception:
        projects = []

    projects = [p for p in projects if isinstance(p, dict) and p.get("path") != project_path]
    projects.insert(0, {"name": name, "path": project_path})
    try:
        _write_json(path, projects[:MAX_RECENTS])
        return {"success": True}
    except Exception as e:
        return {"success": False, "error": str(e)}
