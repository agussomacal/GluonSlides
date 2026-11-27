"""The compiled PDF of an imported talk as ground truth for its layout.

The Beamer / Slidev converters guess where things go from the source; the
PDF the author compiled shows where they really are. align_with_pdf()
takes an import result (model.py) and that PDF and:

  - matches slides to pages: Beamer numbers pages by frame (page labels),
    so a frame's overlay pages share a label and the last one (everything
    uncovered) is used; then slides and frames are paired in order by
    their words, allowing for slides or pages the other side doesn't have;
  - fixes the slide size when the PDF's aspect ratio differs;
  - places each text (and columns / table) element on the PDF text blocks
    holding its words, with the font size found there;
  - places figures on the page's images of the same shape, in order;
  - moves boxes (shapes) with the text they contain.

Content is never changed, only positions and sizes; anything not found in
the PDF keeps the converter's layout. Returns False (and changes nothing)
when the PDF does not look like this talk.
"""

import os
import re
from statistics import median

from . import extras

WORD = re.compile(r"[^\W\d_]{2,}|\d{2,}", re.UNICODE)
MIN_SLIDE_MATCH = 0.35  # share of a slide's words found on its page
MIN_BLOCK_SHARE = 0.6   # share of a block's words that belong to the element
MIN_ELEMENT_COVER = 0.5  # share of the element's words found in its blocks
TEXT_TYPES = ("text", "columns", "table")


# ---------- words ----------

def _strip_source(text):
    """Markdown / LaTeX source -> the words a reader sees."""
    t = re.sub(r"\$\$.*?\$\$|\$[^$]*\$", " ", text, flags=re.S)       # math (rendered as glyphs)
    t = re.sub(r"\\(cite|ref|label|eqref|url|includegraphics)\*?(\[[^\]]*\])?\{[^}]*\}", " ", t)
    t = re.sub(r"\\(textcolor|highlight|colorbox)\{[^{}]*\}", " ", t)        # a colour is not a word on the slide
    t = re.sub(r"\\[A-Za-z]+\*?", " ", t)                              # other commands: keep their arguments
    t = re.sub(r"</?(?!https?:|mailto:)[A-Za-z][^>]*>|!\[[^\]]*\]\([^)]*\)|\]\([^)]*\)", " ", t)  # html tags (not <https://…>), images, link targets
    t = re.sub(r"[<>]", " ", t)
    return t


def words(text):
    return [w.lower() for w in WORD.findall(text or "")]


def element_source(el):
    if el.get("type") == "text":
        return el.get("content") or ""
    if el.get("type") == "columns":
        return "\n".join(c.get("content") or "" for c in el.get("columns") or [])
    if el.get("type") == "table":
        return "\n".join(" ".join(r) for r in el.get("rows") or [])
    return ""


def element_words(el):
    return set(words(_strip_source(element_source(el))))


def slide_words(slide):
    out = set(words(_strip_source(slide.get("title") or "")))
    for el in slide.get("elements") or []:
        out |= element_words(el)
    return out


# ---------- the PDF ----------

class Page:
    """Text blocks and images of one PDF page, in slide pixels."""

    def __init__(self, page, scale):
        self.blocks = []
        for b in page.get_text("dict")["blocks"]:
            if b.get("type") != 0:
                continue
            spans = [s for line in b["lines"] for s in line["spans"] if s["text"].strip()]
            text = " ".join(s["text"] for s in spans)
            ws = set(words(text))
            if not ws:
                continue
            chars = {}
            for sp in spans:
                k = round(sp["size"], 1)
                chars[k] = chars.get(k, 0) + len(sp["text"].strip())
            self.blocks.append({"box": [v * scale for v in b["bbox"]], "words": ws,
                                "size": max(chars, key=chars.get) * scale})
        self.images = []
        area = page.rect.width * page.rect.height
        for im in page.get_image_info():
            x0, y0, x1, y1 = im["bbox"]
            if (x1 - x0) * (y1 - y0) > 0.01 * area:
                self.images.append([x0 * scale, y0 * scale, x1 * scale, y1 * scale])
        self.words = set().union(*(b["words"] for b in self.blocks)) if self.blocks else set()


def frame_groups(doc):
    """The pages of each frame, one per step: runs of equal page labels
    (Beamer numbers pages by frame, overlays included), or one page each."""
    labels = []
    for i in range(doc.page_count):
        try:
            labels.append(doc[i].get_label() or "")
        except Exception:
            labels.append("")
    if not any(labels):
        return [[i] for i in range(doc.page_count)]
    groups = []
    for i, lab in enumerate(labels):
        if groups and lab and labels[i - 1] == lab:
            groups[-1].append(i)
        else:
            groups.append([i])
    return groups


def frame_pages(doc):
    """The page index showing each frame complete: its last page."""
    return [g[-1] for g in frame_groups(doc)]


def page_for(el, group):
    """The page of a frame to look for an element on: the last step it is
    shown at (content that disappears is not on the frame's last page)."""
    until = el.get("until")
    if isinstance(until, (int, float)) and until >= 1:
        return group[min(int(until), len(group)) - 1]
    return group[-1]


def pair_slides(slide_sets, page_sets):
    """Pairs slides with pages in order, maximising the words they share
    (either side may have extra ones): [(slide index, page index, score)]."""
    n, m = len(slide_sets), len(page_sets)
    sim = [[(len(s & p) / len(s)) if s else 0.0 for p in page_sets] for s in slide_sets]
    best = [[0.0] * (m + 1) for _ in range(n + 1)]
    for i in range(n - 1, -1, -1):
        for j in range(m - 1, -1, -1):
            take = sim[i][j] + best[i + 1][j + 1] if sim[i][j] >= MIN_SLIDE_MATCH else -1
            best[i][j] = max(take, best[i + 1][j], best[i][j + 1])
    pairs, i, j = [], 0, 0
    while i < n and j < m:
        if sim[i][j] >= MIN_SLIDE_MATCH and best[i][j] == sim[i][j] + best[i + 1][j + 1]:
            pairs.append((i, j, sim[i][j]))
            i, j = i + 1, j + 1
        elif best[i][j] == best[i + 1][j]:
            i += 1
        else:
            j += 1
    return pairs


# ---------- placing ----------

def _union(boxes):
    return [min(b[0] for b in boxes), min(b[1] for b in boxes), max(b[2] for b in boxes), max(b[3] for b in boxes)]


def _inside(inner, outer, slack=4):
    return (inner["x"] >= outer["x"] - slack and inner["y"] >= outer["y"] - slack
            and inner["x"] + inner["width"] <= outer["x"] + outer["width"] + slack
            and inner["y"] + inner["height"] <= outer["y"] + outer["height"] + slack)


def place_text(elements, page, W, H):
    """Moves text-like elements onto their blocks; returns {id(el): (dx, dy)} moved."""
    texts = [(el, element_words(el)) for el in elements if el.get("type") in TEXT_TYPES]
    texts = [(el, ws) for el, ws in texts if ws]
    owner = {}  # block index -> element
    for bi, b in enumerate(page.blocks):
        best, best_key = None, None
        for el, ws in texts:
            inter = len(ws & b["words"])
            if inter / len(b["words"]) < MIN_BLOCK_SHARE:
                continue
            centre = el.get("y", 0) + el.get("height", 0) / 2
            key = (inter, -abs(centre - (b["box"][1] + b["box"][3]) / 2))
            if best_key is None or key > best_key:
                best, best_key = el, key
        if best is not None:
            owner[bi] = best
    moved = {}
    for el, ws in texts:
        blocks = [page.blocks[bi] for bi, o in owner.items() if o is el]
        if not blocks or len(ws & set().union(*(b["words"] for b in blocks))) / len(ws) < MIN_ELEMENT_COVER:
            continue
        x0, y0, x1, y1 = _union([b["box"] for b in blocks])
        fs = median([b["size"] for b in blocks])
        before = (el["x"], el["y"])
        kind = el.get("type")
        if kind == "text" and (not el.get("fontSize") or abs(fs - el["fontSize"]) > 0.15 * el["fontSize"]):
            el["fontSize"] = round(fs)
        size = el.get("fontSize") or fs
        pad = 0.15 * size
        align = el.get("textAlign") or el.get("align") or "left"
        w = el.get("width", 0)
        if kind == "table":
            w = max(w, x1 - x0 + 2 * pad)  # cells with only math have no words: never narrower
        w = min(w, W)
        # across: the text's own alignment decides which edge (or the centre) is kept
        if kind == "text" and align == "center":
            x = (x0 + x1) / 2 - w / 2
        elif kind == "text" and align == "right":
            x = x1 + pad - w
        else:
            x = x0 - pad
            if x + w > W:
                w = W - x  # narrower rather than moved off its margin
        if kind == "columns":
            x = el.get("x", 0)  # the first block found may be in any column: only move down
        x = max(0, min(W - w, x))
        # down: vertically centred text (a title in its box) keeps its box, centred on the PDF's
        if kind == "text" and el.get("verticalAlign") == "center":
            h = el.get("height", 0)
            y = (y0 + y1) / 2 - h / 2
        else:
            y = y0 - pad
            h = max(el.get("height", 0), y1 - y0 + 2 * pad, 1.2 * size)
        y = max(0, min(H - h, y))
        el["x"], el["y"], el["width"], el["height"] = round(x), round(y), round(w), round(min(h, H))
        moved[id(el)] = (el["x"] - before[0], el["y"] - before[1])
    return moved


def place_figures(elements, page):
    """Figures onto page images of a similar shape, in reading order."""
    figs = sorted((el for el in elements if el.get("type") == "figure" and el.get("width") and el.get("height")),
                  key=lambda e: (e["y"], e["x"]))
    images = sorted(page.images, key=lambda b: (b[1], b[0]))
    used, n = set(), 0
    placed = {}
    for el in figs:
        key = (el["x"], el["y"], el["width"], el["height"])
        if key in placed:  # a figure that replaces another on a later step: same place
            el["x"], el["y"], el["width"], el["height"] = placed[key]
            continue
        ratio = el["width"] / el["height"]
        for k, b in enumerate(images):
            if k in used:
                continue
            w, h = b[2] - b[0], b[3] - b[1]
            if h > 0 and abs(w / h - ratio) / ratio < 0.25:
                used.add(k)
                placed[key] = (round(b[0]), round(b[1]), round(w), round(h))
                el["x"], el["y"], el["width"], el["height"] = placed[key]
                n += 1
                break
    # Columns holding only images (a row of plots): onto a row of as many page images
    md_img = re.compile(r"!\[[^\]]*\]\([^)]*\)")
    for el in elements:
        if el.get("type") != "columns":
            continue
        cols = [c.get("content") or "" for c in el.get("columns") or []]
        k = sum(len(md_img.findall(c)) for c in cols)
        if not k or any(md_img.sub("", c).strip() for c in cols):
            continue
        free = [b for i, b in enumerate(images) if i not in used]
        for a in free:
            row = sorted((b for b in free if abs(b[1] - a[1]) < 0.3 * (a[3] - a[1])), key=lambda b: b[0])
            if len(row) == k:
                x0, y0, x1, y1 = _union(row)
                pad = 0.02 * (x1 - x0)
                el["x"], el["y"] = round(x0 - pad), round(y0 - pad)
                el["width"], el["height"] = round(x1 - x0 + 2 * pad), round(y1 - y0 + 2 * pad)
                used.update(images.index(b) for b in row)
                n += k
                break
    return n


def follow_text(elements, moved, before):
    """Boxes (shapes) that held a moved text element move with it."""
    for el in elements:
        if el.get("type") != "shape" or id(el) in moved:
            continue
        box = before.get(id(el))
        for other in elements:
            if id(other) in moved and box and _inside(before[id(other)], box):
                dx, dy = moved[id(other)]
                el["x"] += dx
                el["y"] += dy
                break


def follow_above(elements, moved, before):
    """Elements with no words to match (formulas, unmatched figures) keep
    their place under the nearest moved element above them in the same
    column: they move down (or up) with it."""
    anchors = [el for el in elements if id(el) in moved]
    for el in elements:
        if id(el) in moved or (el.get("x"), el.get("y")) != (before[id(el)]["x"], before[id(el)]["y"]):
            continue  # placed already (or moved with its text)
        b = before[id(el)]
        best = None
        for a in anchors:
            ab = before[id(a)]
            overlap = min(ab["x"] + ab["width"], b["x"] + b["width"]) - max(ab["x"], b["x"])
            if ab["y"] <= b["y"] and overlap > 0.3 * min(ab["width"], b["width"]) and (best is None or ab["y"] > before[id(best)]["y"]):
                best = a
        if best is not None:
            el["y"] = max(0, el["y"] + moved[id(best)][1])
            moved[id(el)] = (0, moved[id(best)][1])


def rescale_height(result, new_h):
    """The PDF has another aspect ratio: the slide height follows it."""
    old_h = result.get("height") or new_h
    k = new_h / old_h
    for s in (result.get("slides") or []) + (result.get("masters") or []):
        for el in s.get("elements") or []:
            if "y" in el:
                el["y"] = round(el["y"] * k)
            if "height" in el:
                el["height"] = round(el["height"] * k)
    result["height"] = new_h


# ---------- all together ----------

# ---------- figures the source didn't have: the PDF's picture of them ----------

MD_IMAGE = re.compile(r"!\[[^\]]*\]\(([^)\s]+)\)")


def figure_regions(fpage, scale):
    """Where the page has figures, in slide pixels: its pictures and the
    regions dense with drawing (plots, diagrams included as PDF / TikZ)."""
    from .pdf import dense_regions
    area = fpage.rect.width * fpage.rect.height
    out = []
    for im in fpage.get_image_info():
        x0, y0, x1, y1 = im["bbox"]
        if 0.01 * area < (x1 - x0) * (y1 - y0) < 0.8 * area:
            out.append((x0, y0, x1, y1))
    try:
        for r in dense_regions(fpage.get_drawings(), fpage):
            if (r[2] - r[0]) * (r[3] - r[1]) > 0.01 * area and not any(_overlap(r, o) > 0.5 for o in out):
                out.append(tuple(r))
    except Exception:
        pass
    return [tuple(v * scale for v in r) for r in out]


def _overlap(a, b):
    """Share of the smaller box covered by the other."""
    w = min(a[2], b[2]) - max(a[0], b[0])
    h = min(a[3], b[3]) - max(a[1], b[1])
    if w <= 0 or h <= 0:
        return 0.0
    small = min((a[2] - a[0]) * (a[3] - a[1]), (b[2] - b[0]) * (b[3] - b[1])) or 1
    return w * h / small


def _box(el):
    return (el.get("x", 0), el.get("y", 0), el.get("x", 0) + el.get("width", 0), el.get("y", 0) + el.get("height", 0))


def save_region(fpage, box, scale, folder, rel):
    """The region (slide pixels) of the PDF page as a PNG at `rel` in the project."""
    import pymupdf as fz
    clip = fz.Rect(*(v / scale for v in box)) & fpage.rect
    pix = fpage.get_pixmap(matrix=fz.Matrix(2 * scale, 2 * scale), clip=clip, alpha=False)
    dest = os.path.join(folder, rel)
    os.makedirs(os.path.dirname(dest), exist_ok=True)
    pix.save(dest)


def fill_missing(elements, fpage, scale, folder):
    """Figures not found in the source (placeholders with `missing`), and
    Markdown images of columns whose files are missing: taken from the
    page, where it shows a figure nobody else uses. Returns the names filled."""
    if not folder:
        return []
    regions = figure_regions(fpage, scale)
    taken = [_box(el) for el in elements if el.get("type") == "figure" and not el.get("missing")]
    free = [r for r in regions if not any(_overlap(r, t) > 0.5 for t in taken)]
    filled = []
    # placeholders: the free region nearest to where the converter put them
    for el in sorted((e for e in elements if e.get("type") == "figure" and e.get("missing")), key=lambda e: (e["y"], e["x"])):
        if not free:
            break
        cx, cy = el["x"] + el["width"] / 2, el["y"] + el["height"] / 2
        best = min(free, key=lambda r: abs((r[0] + r[2]) / 2 - cx) + abs((r[1] + r[3]) / 2 - cy))
        free.remove(best)
        save_region(fpage, best, scale, folder, el["filePath"])
        el["x"], el["y"] = round(best[0]), round(best[1])
        el["width"], el["height"] = round(best[2] - best[0]), round(best[3] - best[1])
        filled.append(el.pop("missing"))
    # columns of images (a row of plots) whose files are missing: a row of as many regions
    for el in elements:
        if el.get("type") != "columns":
            continue
        rels = [r for c in el.get("columns") or [] for r in MD_IMAGE.findall(c.get("content") or "")]
        absent = [r for r in rels if not os.path.isfile(os.path.join(folder, r))]
        if not absent:
            continue
        for a in list(free):
            row = sorted((r for r in free if abs(r[1] - a[1]) < 0.3 * (a[3] - a[1])), key=lambda r: r[0])
            if len(row) == len(rels):
                for rel, r in zip(rels, row):
                    if rel in absent:
                        save_region(fpage, r, scale, folder, rel)
                        filled.append(rel)
                x0, y0 = min(r[0] for r in row), min(r[1] for r in row)
                x1, y1 = max(r[2] for r in row), max(r[3] for r in row)
                el["x"], el["y"], el["width"], el["height"] = round(x0), round(y0), round(x1 - x0), round(y1 - y0)
                for r in row:
                    free.remove(r)
                break
    return filled


def align_with_pdf(result, pdf_path, folder=None):
    fitz = extras.load_pymupdf()
    if fitz is None:
        return False
    slides = result.get("slides") or []
    doc = fitz.open(pdf_path)
    try:
        return _align(result, doc, pdf_path, folder, slides)
    finally:
        doc.close()


def _align(result, doc, pdf_path, folder, slides):
    if doc.page_count == 0 or doc.page_count < 0.6 * len(slides):
        return False
    rect = doc[0].rect
    if rect.width <= rect.height:
        return False  # a portrait page: an article / a figure, not slides
    W = result.get("width") or 1920
    scale = W / rect.width
    from . import progress
    name = pdf_path.replace("\\", "/").split("/")[-1]
    groups = frame_groups(doc)
    read = {}  # page index -> Page (every overlay page: content may disappear before the last)
    for n, i in enumerate(i for g in groups for i in g):
        progress.report(f"Reading {name}", n, doc.page_count)
        read[i] = Page(doc[i], scale)
    pages = [read[g[-1]] for g in groups]
    pairs = pair_slides([slide_words(s) for s in slides], [p.words for p in pages])
    worded = [s for s in slides if slide_words(s)]
    if not pairs or len(pairs) < 0.6 * len(worded):
        return False  # not this talk

    new_h = round(rect.height * scale)
    if abs(new_h - (result.get("height") or new_h)) > 0.02 * new_h:
        rescale_height(result, new_h)
    H = result["height"] if result.get("height") else new_h

    texts = figures = 0
    recovered = []
    for n, (si, pi, _score) in enumerate(pairs):
        progress.report(f"Placing things as in {name}", n, len(pairs))
        elements = slides[si].get("elements") or []
        before = {id(el): {k: el.get(k, 0) for k in ("x", "y", "width", "height")} for el in elements}
        # each element on the page of the last step it is shown at
        moved = {}
        for idx in sorted({page_for(el, groups[pi]) for el in elements}):
            subset = [el for el in elements if page_for(el, groups[pi]) == idx]
            moved.update(place_text(subset, read[idx], W, H))
            figures += place_figures([el for el in subset if not el.get("missing")], read[idx])
            got = fill_missing(subset, doc[idx], scale, folder)
            recovered.extend(got)
            figures += len(got)
        texts += len(moved)
        for el in elements:  # placed figures are anchors too
            if el.get("type") == "figure" and (el["x"], el["y"]) != (before[id(el)]["x"], before[id(el)]["y"]):
                moved[id(el)] = (el["x"] - before[id(el)]["x"], el["y"] - before[id(el)]["y"])
        follow_text(elements, moved, before)  # boxes around moved text first
        follow_above(elements, moved, before)  # then formulas, rules, the rest

    paired = {si for si, _pi, _s in pairs}
    missing = [s.get("title") or f"slide {i + 1}" for i, s in enumerate(slides) if i not in paired and slide_words(s)]
    result["groundTruth"] = {"pdf": name, "slides": len(pairs), "texts": texts, "figures": figures, "recovered": len(recovered)}
    if recovered:
        # "not found" no more: say where they came from instead
        names = {r.split("/")[-1].rsplit(".", 1)[0] for r in recovered}
        result["warnings"] = [w for w in result.get("warnings", [])
                              if not (re.match(r"^(Figure|Image) not found: ", w) and w.split(": ", 1)[1].replace("\\", "/").split("/")[-1].rsplit(".", 1)[0] in names)]
        result["warnings"].append(f"{len(recovered)} figure{'s' if len(recovered) > 1 else ''} not in the source taken from {name} "
                                  f"(pictures of them at twice the slide's resolution): {', '.join(sorted(set(r.split('/')[-1] for r in recovered))[:6])}")
    if missing:
        shown = ", ".join(f"“{t}”" for t in missing[:5]) + (" …" if len(missing) > 5 else "")
        result.setdefault("warnings", []).append(
            f"Not found in {name} (layout as converted): {shown}")
    return True
