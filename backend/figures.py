"""Figure loading (as data URIs) and importing into a project's figures/ folder."""

import base64
import io
import os
import shutil

from PIL import Image

from . import projectfiles

_MIME_TYPES = {".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".svg": "image/svg+xml"}


def _resolve_figure_path(project_folder, file_path):
    if not file_path:
        return None
    if os.path.isabs(file_path) and os.path.exists(file_path):
        return file_path
    if project_folder:
        candidate = os.path.join(project_folder, file_path)
        if os.path.exists(candidate):
            return candidate
    if os.path.exists(file_path):
        return file_path
    return None


def _png_data_uri(image):
    buffered = io.BytesIO()
    image.save(buffered, format="PNG")
    return "data:image/png;base64," + base64.b64encode(buffered.getvalue()).decode("utf-8")


def _rasterize_first_page(path):
    """First page of a PDF/EPS as a PIL image (pdf2image, falling back to Pillow)."""
    try:
        from pdf2image import convert_from_path
        images = convert_from_path(path, first_page=1, last_page=1)
        if images:
            return images[0]
    except Exception:
        pass
    return Image.open(path).convert("RGB")


def load_figure_data_uri(project_folder, file_path):
    """Load a figure from disk into a data URI (in memory only)."""
    try:
        resolved = _resolve_figure_path(project_folder, file_path)
        if not resolved:
            return {"success": False, "error": "Figure file not found."}

        ext = os.path.splitext(resolved)[1].lower()
        if ext in (".pdf", ".eps"):
            data_uri = _png_data_uri(_rasterize_first_page(resolved))
        else:
            mime_type = _MIME_TYPES.get(ext, "image/png")
            with open(resolved, "rb") as f:
                encoded = base64.b64encode(f.read()).decode("utf-8")
            data_uri = f"data:{mime_type};base64,{encoded}"
        return {"success": True, "path": resolved, "data_uri": data_uri}
    except Exception as e:
        return {"success": False, "error": str(e)}


def import_figure(project_folder, source_path, linked=None):
    """Copy an external figure into <project>/figures/ (only when needed: backend/projectfiles.py) and load it."""
    try:
        if not project_folder or not os.path.exists(project_folder):
            return {"success": False, "error": "No project folder set."}
        rel_path = projectfiles.copy_into(project_folder, source_path, "figures", linked)
        dest_path = os.path.join(project_folder, rel_path)

        loaded = load_figure_data_uri(project_folder, rel_path)
        if not loaded.get("success"):
            return loaded
        return {
            "success": True,
            "path": dest_path,
            "relative_path": rel_path,
            "data_uri": loaded["data_uri"],
        }
    except Exception as e:
        return {"success": False, "error": str(e)}


_EXT_FOR_MIME = {"image/png": ".png", "image/jpeg": ".jpg", "image/gif": ".gif", "image/webp": ".webp", "image/svg+xml": ".svg"}


def save_figure_data(project_folder, data_uri, name_hint=""):
    """Save a pasted image (data URI) as <project>/figures/<name>.<ext> and load it back."""
    try:
        if not project_folder or not os.path.isdir(project_folder):
            return {"success": False, "error": "No project folder set."}
        header, _, payload = str(data_uri or "").partition(",")
        mime = header[5:].split(";")[0] if header.startswith("data:") else ""
        if mime not in _EXT_FOR_MIME or ";base64" not in header:
            return {"success": False, "error": f"Not a supported image ({mime or 'unknown type'})."}
        data = base64.b64decode(payload, validate=False)

        stem = os.path.splitext(os.path.basename(str(name_hint or "")))[0]
        stem = "".join(c if c.isalnum() or c in "-_" else "-" for c in stem).strip("-") or "pasted"
        fig_dir = os.path.join(project_folder, "figures")
        os.makedirs(fig_dir, exist_ok=True)
        ext = _EXT_FOR_MIME[mime]
        dest = os.path.join(fig_dir, stem + ext)
        counter = 1
        while os.path.exists(dest):
            dest = os.path.join(fig_dir, f"{stem}_{counter}{ext}")
            counter += 1
        with open(dest, "wb") as f:
            f.write(data)
        rel_path = os.path.relpath(dest, project_folder)
        return {"success": True, "path": dest, "relative_path": rel_path, "data_uri": data_uri}
    except Exception as e:
        return {"success": False, "error": str(e)}


def refresh_linked_figures(project_folder, figures):
    """Re-copy figures whose original file changed since it was imported.

    `figures` is a list of {"filePath", "originalPath"} (filePath relative
    to the project, as in the .gl file). An original that is newer, or of
    a different size, than the project's copy is copied over it (copy2
    keeps its time, so an unchanged original is never copied twice).
    Returns the updated ones with their new data URI.
    """
    updated = []
    try:
        for item in figures or []:
            original = (item or {}).get("originalPath") or ""
            local_rel = (item or {}).get("filePath") or ""
            if not original or not local_rel or not os.path.isabs(original) or not os.path.isfile(original):
                continue
            local = os.path.join(project_folder or "", local_rel)
            if os.path.abspath(local) == os.path.abspath(original):
                continue
            src, dst = os.stat(original), (os.stat(local) if os.path.isfile(local) else None)
            if dst is not None and int(src.st_mtime) == int(dst.st_mtime) and src.st_size == dst.st_size:
                continue
            os.makedirs(os.path.dirname(local), exist_ok=True)
            shutil.copy2(original, local)
            loaded = load_figure_data_uri(project_folder, local_rel)
            if loaded.get("success"):
                updated.append({"filePath": local_rel, "data_uri": loaded["data_uri"]})
        return {"success": True, "updated": updated}
    except Exception as e:
        return {"success": False, "error": str(e), "updated": updated}
