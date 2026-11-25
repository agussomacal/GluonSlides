"""Figure loading (as data URIs) and importing into a project's figures/ folder."""

import base64
import io
import os
import shutil

from PIL import Image

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


def import_figure(project_folder, source_path):
    """Copy an external figure into <project>/figures/ (unique name) and load it."""
    try:
        if not project_folder or not os.path.exists(project_folder):
            return {"success": False, "error": "No project folder set."}

        fig_dir = os.path.join(project_folder, "figures")
        os.makedirs(fig_dir, exist_ok=True)

        filename = os.path.basename(source_path)
        base, ext = os.path.splitext(filename)
        dest_path = os.path.join(fig_dir, filename)
        counter = 1
        while os.path.exists(dest_path) and os.path.abspath(dest_path) != os.path.abspath(source_path):
            dest_path = os.path.join(fig_dir, f"{base}_{counter}{ext}")
            counter += 1

        # Re-importing a file that already lives in figures/ is a no-op.
        if os.path.abspath(dest_path) != os.path.abspath(source_path):
            shutil.copy2(source_path, dest_path)
        rel_path = os.path.relpath(dest_path, project_folder)

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
