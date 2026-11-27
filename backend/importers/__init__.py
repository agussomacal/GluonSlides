"""Import an existing talk as a new GluonSlides project.

    import_talk(source, parent_folder, name, options)

source: a Beamer .tex, a Slidev .md, a .zip of either project (Overleaf's
download), a PowerPoint .pptx, or a .pdf; or several of those paths at
once, folders included (a talk split over many .tex / .md files: the
main one is found, the others are read from where they are). Creates
<parent>/<name>/ with figures/ (copied), macros.tex and bibliography.bib,
and returns the slides (see model.py); the page builds the project from
them and writes the .gl.
"""

import os
import re
import shutil
import tempfile
import zipfile

from ..project_io import project_paths

SUPPORTED = (".tex", ".zip", ".pptx", ".pdf", ".md")


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


def _is_main_tex(path):
    try:
        with open(path, encoding="utf-8", errors="replace") as f:
            text = f.read()
    except OSError:
        return False
    return "\\documentclass" in text and "\\begin{document}" in text


def _slidev_entry(mds):
    """The Slidev entry among .md files: slides.md (or the usual names), else one with a front matter."""
    for name in ("slides.md", "presentation.md", "index.md"):
        for p in mds:
            if os.path.basename(p).lower() == name:
                return p
    for p in mds:
        try:
            with open(p, encoding="utf-8", errors="replace") as f:
                if f.read(4) == "---\n":
                    return p
        except OSError:
            continue
    return mds[0] if mds else None


def resolve_sources(source):
    """What to import from `source` (a path, or a list of files / folders):
    {"path": file to convert, "ext": its kind, "pdfs": candidate compiled
    PDFs of it (given along, or next to the main .tex / .md)} or {"error"}.
    A .zip stays a .zip (extracted later)."""
    paths = [source] if isinstance(source, str) else [p for p in (source or []) if p]
    if not paths:
        return {"error": "Choose the talk to import."}
    missing = [p for p in paths if not os.path.exists(p)]
    if missing:
        return {"error": f"File not found: {missing[0]}"}
    files = [p for p in paths if os.path.isfile(p)]
    folders = [p for p in paths if os.path.isdir(p)]
    by_ext = lambda e: [p for p in files if p.lower().endswith(e)]
    pdfs = by_ext(".pdf")

    def with_pdf(main, ext):
        """Candidate compiled PDFs of the talk, best first: given along, or
        next to the main file (not in subfolders: those are figures). The
        ground-truth step checks they really are the talk."""
        stem = os.path.splitext(os.path.basename(main))[0].lower()
        here = os.path.dirname(main)
        near = sorted(os.path.join(here, f) for f in os.listdir(here) if f.lower().endswith(".pdf"))
        cands = []
        for p in pdfs + near:
            if p not in cands:
                cands.append(p)
        # given along first, then the one named like the talk
        cands.sort(key=lambda p: (p not in pdfs, os.path.splitext(os.path.basename(p))[0].lower() not in (stem, "slides-export")))
        return {"path": main, "ext": ext, "pdfs": cands}

    # one file: as it is (a lone PDF is the talk itself)
    if len(paths) == 1 and files:
        ext = os.path.splitext(files[0])[1].lower()
        if ext not in SUPPORTED:
            return {"error": "Choose a Beamer .tex, a Slidev .md (or a .zip of either), a .pptx or a .pdf."}
        if ext == ".tex":
            return with_pdf(files[0], ext) if _is_main_tex(files[0]) else {"path": files[0], "ext": ext, "pdfs": []}
        if ext in (".md", ".pptx"):  # a PowerPoint's PDF: pictures of what can't be converted
            return with_pdf(files[0], ext)
        return {"path": files[0], "ext": ext, "pdfs": []}

    # several files, or folders: the main .tex, else the Slidev entry, else a zip / pptx / pdf
    from .beamer import find_main_tex
    from .slidev import find_entry
    mains = [p for p in by_ext(".tex") if _is_main_tex(p)]
    for folder in folders:
        m = find_main_tex(folder)
        if m:
            mains.append(m)
    if mains:
        return with_pdf(mains[0], ".tex")
    entry = _slidev_entry(by_ext(".md"))
    for folder in folders:
        entry = entry or find_entry(folder)
    if entry:
        return with_pdf(entry, ".md")
    for ext in (".zip", ".pptx", ".pdf"):
        found = by_ext(ext)
        if found:
            return with_pdf(found[0], ext) if ext == ".pptx" else {"path": found[0], "ext": ext, "pdfs": []}
    if by_ext(".tex"):
        return {"error": "None of these .tex files is the main one (with \\documentclass and \\begin{document}): add it too."}
    return {"error": "No talk found there: a Beamer .tex, a Slidev slides.md, a .zip, a .pptx or a .pdf."}


def import_talk(source, parent_folder, name, options=None):
    from . import progress
    progress.report("Starting", 0, 0)
    try:
        return _import_talk(source, parent_folder, name, options)
    finally:
        progress.reset()


def _import_talk(source, parent_folder, name, options=None):
    from . import progress
    options = options or {}
    found = resolve_sources(source)
    if found.get("error"):
        return {"success": False, "error": found["error"]}
    source, ext = found["path"], found["ext"]
    # Pictures of equations read back to LaTeX (PowerPoint, PDF): an optional component
    want_equations = bool(options.get("equations")) and ext in (".pptx", ".pdf")
    if want_equations:
        from . import extras as _extras
        if _extras.load_equation_reader() is None:
            return {"success": False, "needs_extra": "equations", "extra_message": _extras.EQUATIONS_MESSAGE,
                    "error": "Recognising equations needs an extra component."}
    ground_truth = found.get("pdfs", []) if options.get("usePdf", True) else []
    target = os.path.join(parent_folder or "", "".join(c for c in name if c.isalnum() or c in (" ", "-", "_")).strip() or "Presentation")
    if os.path.isdir(target) and os.listdir(target):
        return {"success": False, "error": "A folder with this name already exists there: choose another name."}
    paths = project_paths(parent_folder, name)
    if not paths.get("success"):
        return paths
    folder = paths["folder"]
    ground_truth_used = ""
    try:
        if ext in (".tex", ".zip", ".md"):
            from .beamer import find_main_tex, import_beamer
            from .slidev import find_entry, import_slidev
            if ext == ".zip":
                with tempfile.TemporaryDirectory(prefix="gluon-import-") as tmp:
                    progress.report("Unpacking the zip", 0, 0)
                    with zipfile.ZipFile(source) as zf:
                        _safe_extract(zf, tmp)
                    inner = resolve_sources([tmp])
                    if inner.get("error") or inner["ext"] not in (".tex", ".md"):
                        return {"success": False, "error": "No LaTeX document (\\documentclass ... \\begin{document}) or Slidev slides.md in the zip."}
                    pdf = inner.get("pdfs", []) if options.get("usePdf", True) else []
                    result = (import_beamer(inner["path"], folder, linked=False) if inner["ext"] == ".tex"
                              else import_slidev(inner["path"], folder, linked=False))
                    ground_truth_used = _apply_ground_truth(result, pdf, folder)
            elif ext == ".md":
                result = import_slidev(source, folder)
                ground_truth_used = _apply_ground_truth(result, ground_truth, folder)
            else:
                result = import_beamer(source, folder, linked=True)
                ground_truth_used = _apply_ground_truth(result, ground_truth, folder)
        elif ext == ".pptx":
            from .pptx import import_pptx
            result = import_pptx(source, folder)
            ground_truth_used = _pptx_pictures_from_pdf(result, ground_truth, folder)
            from .model import finish_fallbacks
            finish_fallbacks(result)
        else:
            from . import extras
            fitz = extras.load_pymupdf()
            if fitz is None:
                if not os.listdir(folder):
                    os.rmdir(folder)  # nothing imported yet: the name stays free
                return {"success": False, "needs_extra": "pymupdf", "extra_message": extras.PYMUPDF_MESSAGE,
                        "error": "PDF import needs an extra component."}
            from .pdf import import_pdf
            result = import_pdf(source, folder, mode=options.get("pdfMode", "editable"))
    except ImportError as e:
        return {"success": False, "error": f"Missing component for this import: {e}", "missing": str(e)}
    except Exception as e:  # a converter bug must not leave the app stuck
        return {"success": False, "error": f"Could not import {os.path.basename(source)}: {type(e).__name__}: {e}"}
    if not result.get("slides"):
        return {"success": False, "error": "No slides were found in that file."}
    if want_equations:
        from . import extras as _extras
        from .equations import recognise_equations
        reader = _extras.load_equation_reader()
        if reader is not None:
            n = recognise_equations(result, folder, reader, lambda i, t: progress.report("Reading the equations", i, t))
            if n:
                result.setdefault("warnings", []).append(
                    f"{n} picture{'s' if n > 1 else ''} of equations turned into LaTeX (named “Recognised equation”): check them; "
                    "the pictures are still in figures/.")
    out = {"success": True, "path": paths["path"], "folder": folder, "project": result, "source": source}
    if ext in (".tex", ".md", ".zip", ".pptx"):
        out["ground_truth"] = ground_truth_used
    return out


def _apply_ground_truth(result, pdfs, folder):
    """Corrects the converted slides with the compiled PDF (see groundtruth.py).
    Returns the PDF's name when it was used, "" when there was none, or why not."""
    if not pdfs or not result.get("slides"):
        return ""
    from . import extras
    if extras.load_pymupdf() is None:
        result.setdefault("warnings", []).append(
            f"{os.path.basename(pdfs[0])} was not used to check the layout: that needs the PDF component (import a PDF once to get it).")
        return "needs-pymupdf"
    from .groundtruth import align_with_pdf
    for pdf in pdfs:
        try:
            if align_with_pdf(result, pdf, folder):
                return os.path.basename(pdf)
        except Exception as e:  # never lose the import for this
            result.setdefault("warnings", []).append(f"Could not compare with {os.path.basename(pdf)}: {type(e).__name__}: {e}")
            return "failed"
    return ""


def _pptx_pictures_from_pdf(result, pdfs, folder):
    """A PowerPoint exported as PDF: what the import could not convert (charts,
    SmartArt, .emf pictures) is cut from the PDF page of its slide, at the same
    place. Slides and pages go one to one (hidden slides are not exported)."""
    if not pdfs or not any(e.get("missing") for s in result.get("slides") or [] for e in s.get("elements") or []):
        return ""
    from . import extras
    if extras.load_pymupdf() is None:
        result.setdefault("warnings", []).append(
            f"{os.path.basename(pdfs[0])} was not used for the charts / objects not converted: that needs the PDF component.")
        return "needs-pymupdf"
    from .groundtruth import save_region, slide_words, words
    fitz = extras.load_pymupdf()
    slides = [s for s in result["slides"] if not s.get("hidden")]
    for pdf in pdfs:
        try:
            doc = fitz.open(pdf)
        except Exception:
            continue
        try:
            if doc.page_count != len(slides) or doc[0].rect.width <= doc[0].rect.height:
                continue
            same = [len(slide_words(s) & set(words(doc[i].get_text()))) / len(slide_words(s))
                    for i, s in enumerate(slides) if slide_words(s)]
            if same and sum(same) / len(same) < 0.4:
                continue  # another talk
            scale = (result.get("width") or 1920) / doc[0].rect.width
            got = []
            for i, s in enumerate(slides):
                for e in s.get("elements") or []:
                    if e.get("type") == "figure" and e.get("missing"):
                        rel = re.sub(r"\.(emf|wmf)$", ".png", e["filePath"], flags=re.I)
                        save_region(doc[i], (e["x"], e["y"], e["x"] + e["width"], e["y"] + e["height"]), scale, folder, rel)
                        e["filePath"] = rel
                        got.append(e.pop("missing"))
            if got:
                result.setdefault("warnings", []).append(
                    f"{len(got)} chart{'s' if len(got) > 1 else ''} / object{'s' if len(got) > 1 else ''} not converted shown as "
                    f"pictures from {os.path.basename(pdf)}.")
                result["groundTruth"] = {"pdf": os.path.basename(pdf), "slides": len(slides), "texts": 0,
                                         "figures": len(got), "recovered": len(got)}
            return os.path.basename(pdf)
        finally:
            doc.close()
    return ""
