"""Import an existing talk as a new GluonSlides project.

    import_talk(source, parent_folder, name, options)

source: a Beamer .tex, a .zip of a LaTeX project (Overleaf's download),
a PowerPoint .pptx, or a .pdf. Creates <parent>/<name>/ with figures/
(copied), macros.tex and bibliography.bib, and returns the slides (see
model.py); the page builds the project from them and writes the .gl.
"""

import os
import shutil
import tempfile
import zipfile

from ..project_io import project_paths

SUPPORTED = (".tex", ".zip", ".pptx", ".pdf")


def _safe_extract(zf, dest):
    """Extract a zip without letting entries escape `dest` (../, absolute paths)."""
    root = os.path.realpath(dest)
    for info in zf.infolist():
        target = os.path.realpath(os.path.join(dest, info.filename))
        if not (target == root or target.startswith(root + os.sep)):
            continue
        if info.is_dir():
            os.makedirs(target, exist_ok=True)
            continue
        os.makedirs(os.path.dirname(target), exist_ok=True)
        with zf.open(info) as src, open(target, "wb") as out:
            shutil.copyfileobj(src, out)


def import_talk(source, parent_folder, name, options=None):
    options = options or {}
    ext = os.path.splitext(source or "")[1].lower()
    if ext not in SUPPORTED:
        return {"success": False, "error": "Choose a Beamer .tex (or a .zip of it), a .pptx or a .pdf."}
    if not os.path.isfile(source):
        return {"success": False, "error": f"File not found: {source}"}
    target = os.path.join(parent_folder or "", "".join(c for c in name if c.isalnum() or c in (" ", "-", "_")).strip() or "Presentation")
    if os.path.isdir(target) and os.listdir(target):
        return {"success": False, "error": "A folder with this name already exists there: choose another name."}
    paths = project_paths(parent_folder, name)
    if not paths.get("success"):
        return paths
    folder = paths["folder"]
    try:
        if ext in (".tex", ".zip"):
            from .beamer import find_main_tex, import_beamer
            if ext == ".zip":
                with tempfile.TemporaryDirectory(prefix="gluon-import-") as tmp:
                    with zipfile.ZipFile(source) as zf:
                        _safe_extract(zf, tmp)
                    main = find_main_tex(tmp)
                    if not main:
                        return {"success": False, "error": "No LaTeX document (\\documentclass ... \\begin{document}) in the zip."}
                    result = import_beamer(main, folder, linked=False)
            else:
                result = import_beamer(source, folder, linked=True)
        elif ext == ".pptx":
            from .pptx import import_pptx
            result = import_pptx(source, folder)
        else:
            from .pdf import import_pdf
            result = import_pdf(source, folder, mode=options.get("pdfMode", "editable"))
    except ImportError as e:
        return {"success": False, "error": f"Missing component for this import: {e}", "missing": str(e)}
    except Exception as e:  # a converter bug must not leave the app stuck
        return {"success": False, "error": f"Could not import {os.path.basename(source)}: {type(e).__name__}: {e}"}
    if not result.get("slides"):
        return {"success": False, "error": "No slides were found in that file."}
    return {"success": True, "path": paths["path"], "folder": folder, "project": result}
