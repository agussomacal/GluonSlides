"""Project and plain text file IO."""

import os
import subprocess


def _write_text(path, content):
    with open(path, "w", encoding="utf-8") as f:
        f.write(content)


def project_paths(parent, name):
    """Create <parent>/<safe name>/ and return the project file path to use."""
    safe = "".join(c for c in name if c.isalnum() or c in (" ", "-", "_")).strip()
    if not safe:
        safe = "Presentation"

    folder = os.path.join(parent, safe)
    project_file = os.path.join(folder, safe + ".gl")
    try:
        os.makedirs(folder, exist_ok=True)
        if os.path.exists(project_file):
            return {"success": False, "error": "A project with this name already exists in that folder."}
    except Exception as e:
        return {"success": False, "error": str(e)}
    return {"success": True, "path": project_file, "folder": folder}


def save_project_data(path, content):
    try:
        _write_text(path, content)
        return {"success": True, "path": path}
    except Exception as e:
        return {"success": False, "error": str(e)}


def load_project_at(path):
    """Return the raw project text; format detection happens in the JS frontend."""
    try:
        with open(path, "r", encoding="utf-8") as f:
            content = f.read()
        if not content.strip():
            return {"success": False, "error": "Project file is empty."}
        return {"success": True, "path": path, "content": content}
    except UnicodeDecodeError:
        return {"success": False, "error": "Not a text project file (binary?)."}
    except Exception as e:
        return {"success": False, "error": str(e)}


def write_file(file_path, content):
    try:
        _write_text(file_path, content)
        return {"success": True, "path": file_path}
    except Exception as e:
        return {"success": False, "error": str(e)}


def _file_in_folder(folder_path, filename):
    """Join a plain file name onto a folder; reject anything that would
    escape it (absolute paths, '..', subdirectories)."""
    if not filename or os.path.basename(filename) != filename or filename in (".", ".."):
        raise ValueError(f"Invalid file name: {filename!r}")
    return os.path.join(folder_path, filename)


def save_text_file(folder_path, filename, content):
    if not folder_path:
        return {"success": False, "error": "No folder path provided"}
    try:
        return write_file(_file_in_folder(folder_path, filename), content)
    except ValueError as e:
        return {"success": False, "error": str(e)}


def load_text_file(folder_path, filename):
    try:
        if not folder_path:
            return {"success": False, "error": "No folder path provided"}
        file_path = _file_in_folder(folder_path, filename)
        if os.path.exists(file_path):
            with open(file_path, "r", encoding="utf-8") as f:
                return {"success": True, "content": f.read()}
        return {"success": False, "error": "File not found"}
    except Exception as e:
        return {"success": False, "error": str(e)}


def save_direct_file(folder_path, filename, content):
    if not folder_path or not os.path.exists(folder_path):
        return {"success": False, "error": "Project folder not set or does not exist."}
    try:
        return write_file(_file_in_folder(folder_path, filename), content)
    except ValueError as e:
        return {"success": False, "error": str(e)}


def open_file_with_system(file_path):
    """Open a file using the OS default viewer or browser."""
    try:
        if not file_path or not os.path.exists(file_path):
            return {"success": False, "error": "File not found."}
        if os.name == "nt":
            os.startfile(file_path)
        elif os.uname().sysname == "Darwin":
            subprocess.run(["open", file_path])
        else:
            subprocess.run(["xdg-open", file_path])
        return {"success": True}
    except Exception as e:
        return {"success": False, "error": str(e)}
