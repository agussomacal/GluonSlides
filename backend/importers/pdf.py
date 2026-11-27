"""PDF -> slides (needs PyMuPDF: see extras.py).

Modes:
  editable  (default) text, shapes and images as GluonSlides objects:
            text blocks -> text boxes (bold, italics, colour, size, font)
            lines with math (TeX math fonts) -> snapshots of those regions
            rectangles / rounded / ellipses -> shapes; lines -> lines;
            polygons and short curves -> paths
            dense vector drawings (plots) -> one snapshot of the region
            embedded pictures -> figures (the original image)
  overlay   the page as a picture without its text, editable text on top
  images    each page as a picture (exact, not editable)
Also (all modes): content repeated on most pages -> a master slide, with
page numbers as \\slidenumber / \\totalslides; consecutive pages that only
add content (Beamer overlays, \\pause) -> one slide with build steps.
"""

import hashlib
import os
import re
import statistics

from . import model
from .extras import load_pymupdf

MATH_FONT = re.compile(r"CMMI|CMSY|CMEX|CMBSY|MSBM|MSAM|EUFM|EURM|EUSM|RSFS|LMMath|LatinModernMath|STIX.*Math|CambriaMath|"
                       r"Asana|XITSMath|TeXGyre.*Math|Symbol|LINE10|LCIRCLE", re.I)
FONTS = {"inter": "Inter", "roboto": "Roboto", "lato": "Lato", "opensans": "Open Sans", "sourcesans": "Source Sans 3",
         "montserrat": "Montserrat", "merriweather": "Merriweather", "sourceserif": "Source Serif 4",
         "ebgaramond": "EB Garamond", "playfairdisplay": "Playfair Display", "firacode": "Fira Code",
         "jetbrainsmono": "JetBrains Mono"}


def family(font):
    base = re.sub(r"^[A-Z]{6}\+", "", font or "")  # subset prefix
    key = re.sub(r"[-,](Regular|Bold|Italic|BoldItalic|Medium|Light|Semibold|SemiBold|Oblique|Roman|Book).*$", "", base)
    key = re.sub(r"[^a-z]", "", key.lower())
    for k, v in FONTS.items():
        if key.startswith(k):
            return v
    if re.search(r"cmtt|sftt|courier|mono|consol", key):
        return "monospace"
    if re.search(r"cmr|lmroman|times|serif|georgia|garamond|palatino|cmbx|cmti", key) and "sans" not in key:
        return "serif"
    return "sans-serif"


def hex_colour(c):
    if c is None:
        return None
    if isinstance(c, int):
        return f"#{c:06x}"
    return "#" + "".join(f"{max(0, min(255, round(v * 255))):02x}" for v in c[:3])


def union(rects):
    x0 = min(r[0] for r in rects)
    y0 = min(r[1] for r in rects)
    return (x0, y0, max(r[2] for r in rects), max(r[3] for r in rects))


def touches(a, b, gap=1.5):
    return not (a[2] + gap < b[0] or b[2] + gap < a[0] or a[3] + gap < b[1] or b[3] + gap < a[1])


def merge_rects(rects, gap=1.5):
    rects = [tuple(r) for r in rects]
    changed = True
    while changed:
        changed = False
        out = []
        while rects:
            r = rects.pop()
            for i, o in enumerate(out):
                if touches(r, o, gap):
                    out[i] = union([r, o])
                    changed = True
                    break
            else:
                out.append(r)
        rects = out
    return rects


def grow_math(regions, lines, gap=2.5):
    """A displayed equation is several 'lines' (fractions, limits, text-font
    parts like '(v) ='): lines on the same row that touch a math region join it."""
    regions = list(regions)
    changed = True
    while changed:
        changed = False
        for ln in lines:
            for i, m in enumerate(regions):
                if inside(ln, m, 0.5):
                    break
                overlap = min(ln[3], m[3]) - max(ln[1], m[1])
                same_row = overlap > 0.35 * min(ln[3] - ln[1], m[3] - m[1])
                near = ln[0] <= m[2] + gap and m[0] <= ln[2] + gap
                if same_row and near:
                    regions[i] = union([m, ln])
                    changed = True
                    break
        if changed:
            regions = merge_rects(regions, 1.2)
    return regions


def inside(inner, outer, slack=1.0):
    return inner[0] >= outer[0] - slack and inner[1] >= outer[1] - slack and inner[2] <= outer[2] + slack and inner[3] <= outer[3] + slack


class Converter:
    def __init__(self, path, folder, mode):
        self.fitz = load_pymupdf()
        self.doc = self.fitz.open(path)
        self.path, self.folder, self.mode = path, folder, mode
        self.warnings = []
        r = self.doc[0].rect
        ratio = r.width / r.height
        if abs(ratio - 16 / 9) < 0.03:
            self.W, self.H = 1920, 1080
        elif abs(ratio - 4 / 3) < 0.03:
            self.W, self.H = 1280, 960
        else:
            self.W, self.H = 1920, round(1920 / ratio)
        self.saved = {}  # content hash -> relative path
        self.page_titles = {}  # pages as pictures: their titles, from their text

    # ---------- files ----------

    def save_png(self, data, prefix):
        h = hashlib.sha1(data).hexdigest()[:12]
        if h not in self.saved:
            rel = f"figures/{prefix}-{h}.png"
            dest = os.path.join(self.folder, rel)
            os.makedirs(os.path.dirname(dest), exist_ok=True)
            with open(dest, "wb") as f:
                f.write(data)
            self.saved[h] = rel
        return self.saved[h], h

    def snapshot(self, page, rect, k, prefix="pdf-region"):
        """A region of the page as a PNG at twice the slide's resolution."""
        fz = self.fitz
        pad = 0.8
        clip = fz.Rect(rect[0] - pad, rect[1] - pad, rect[2] + pad, rect[3] + pad) & page.rect
        zoom = max(1.0, 2 * k)
        pix = page.get_pixmap(matrix=fz.Matrix(zoom, zoom), clip=clip, alpha=False)
        rel, h = self.save_png(pix.tobytes("png"), prefix)
        return rel, h, (clip.x0, clip.y0, clip.x1, clip.y1)

    def image_png(self, xref):
        fz = self.fitz
        pix = fz.Pixmap(self.doc, xref)
        smask = self.doc.extract_image(xref).get("smask") if xref else 0
        if smask:
            try:
                pix = fz.Pixmap(pix, fz.Pixmap(self.doc, smask))
            except Exception:
                pass
        if pix.n - pix.alpha >= 4:
            pix = fz.Pixmap(fz.csRGB, pix)
        return pix.tobytes("png")

    # ---------- one page ----------

    def page_elements(self, page):
        """[(element, signature)] for a page."""
        k = self.W / page.rect.width
        self.page_width = page.rect.width
        fz = self.fitz
        out = []
        if self.mode == "images":
            pix = page.get_pixmap(matrix=fz.Matrix(2 * k, 2 * k), alpha=False)
            rel, h = self.save_png(pix.tobytes("png"), "pdf-page")
            self.page_titles[page.number] = self.text_title(page, k)
            return [(model.figure(0, 0, self.W, self.H, rel, locked="yes"), "page:" + h)]

        text = page.get_text("dict", flags=fz.TEXT_PRESERVE_WHITESPACE | fz.TEXT_PRESERVE_LIGATURES)
        blocks = [b for b in text["blocks"] if b.get("type") == 0]

        # math: lines with a TeX math font, merged into regions (fractions span several lines)
        math_lines = []
        for b in blocks:
            for ln in b["lines"]:
                if any(MATH_FONT.search(s["font"]) for s in ln["spans"] if s["text"].strip()):
                    math_lines.append(tuple(ln["bbox"]))
        math_regions = grow_math(merge_rects(math_lines, gap=1.2),
                                 [tuple(ln["bbox"]) for b in blocks for ln in b["lines"]
                                  if "".join(s["text"] for s in ln["spans"]).strip()])

        # vector drawings: dense clusters (plots) become snapshots
        drawings = [d for d in page.get_drawings() if d.get("rect") is not None]
        clusters = self.dense_regions(drawings, page)

        if self.mode == "overlay":
            out.append(self.background_without_text(page, k, math_regions))
        else:
            for rect in clusters:
                rel, h, clip = self.snapshot(page, rect, k, "pdf-drawing")
                out.append((model.figure(clip[0] * k, clip[1] * k, (clip[2] - clip[0]) * k, (clip[3] - clip[1]) * k, rel), f"snap:{h}:{self.r(clip)}"))
            for d in drawings:
                if any(inside(tuple(d["rect"]), c) for c in clusters):
                    continue
                el = self.drawing(d, page, k)
                if el:
                    out.append((el, "draw:" + self.sig(el)))
            for info in page.get_image_info(xrefs=True):
                bbox = tuple(info["bbox"])
                if any(inside(bbox, c) for c in clusters):
                    continue
                xref = info.get("xref", 0)
                try:
                    if xref:
                        rel, h = self.save_png(self.image_png(xref), "pdf-image")
                    else:
                        rel, h, bbox = self.snapshot(page, bbox, k, "pdf-image")
                except Exception as e:
                    self.warnings.append(f"A picture could not be read ({e}).")
                    continue
                out.append((model.figure(bbox[0] * k, bbox[1] * k, (bbox[2] - bbox[0]) * k, (bbox[3] - bbox[1]) * k, rel),
                            f"img:{h}:{self.r(bbox)}"))
            for rect in math_regions:
                rel, h, clip = self.snapshot(page, rect, k, "pdf-math")
                # compared by its text: a frame shifted by part of a pixel renders different pixels
                words = re.sub(r"\s+", " ", page.get_textbox(self.fitz.Rect(rect))).strip().replace(":", ";")
                out.append((model.figure(clip[0] * k, clip[1] * k, (clip[2] - clip[0]) * k, (clip[3] - clip[1]) * k, rel),
                            f"math:{words}:{self.r(clip)}"))
        # text: blocks without the lines that are math or inside a snapshot
        skip = math_regions + (clusters if self.mode == "editable" else [])
        for b in blocks:
            lines = [ln for ln in b["lines"] if not any(touches(tuple(ln["bbox"]), m, 0) and inside(tuple(ln["bbox"]), m, 1.5) for m in skip)]
            lines = [ln for ln in lines if "".join(s["text"] for s in ln["spans"]).strip()]
            if lines:
                el = self.text_block(lines, k)
                out.append((el, "text:" + self.sig(el)))
        return out

    def r(self, rect):
        return ",".join(str(round(v)) for v in rect)

    def sig(self, el):
        keys = ("type", "kind", "content", "bg", "borderCol", "stroke", "filePath")
        geo = [round(el.get(k, 0) / 4) for k in ("x", "y", "width", "height")]
        return "|".join(str(el.get(k, "")) for k in keys) + "|" + ",".join(map(str, geo))

    def dense_regions(self, drawings, page):
        """Regions where many drawing pieces meet (plots, diagrams): snapshots."""
        rects = [tuple(d["rect"]) for d in drawings if d["rect"].width < page.rect.width * 0.95 or d["rect"].height < page.rect.height * 0.95]
        groups = []
        for d in drawings:
            r = tuple(d["rect"])
            n = len(d.get("items", []))
            for g in groups:
                if touches(r, g["rect"], 2.0):
                    g["rect"] = union([g["rect"], r])
                    g["n"] += n
                    g["count"] += 1
                    break
            else:
                groups.append({"rect": r, "n": n, "count": 1})
        dense = [g["rect"] for g in groups if g["n"] > 60 or g["count"] > 25]
        return merge_rects(dense, 2.0) if rects else []

    def background_without_text(self, page, k, keep):
        """The page as a picture with its text removed (math kept), at the back."""
        fz = self.fitz
        doc2 = fz.open(self.path)
        p2 = doc2[page.number]
        for b in p2.get_text("dict")["blocks"]:
            for ln in b.get("lines", []):
                if any(inside(tuple(ln["bbox"]), m, 1.5) for m in keep):
                    continue
                for s in ln["spans"]:
                    p2.add_redact_annot(fz.Rect(s["bbox"]))
        p2.apply_redactions(images=fz.PDF_REDACT_IMAGE_NONE, graphics=fz.PDF_REDACT_LINE_ART_NONE, text=fz.PDF_REDACT_TEXT_REMOVE)
        pix = p2.get_pixmap(matrix=fz.Matrix(2 * k, 2 * k), alpha=False)
        rel, h = self.save_png(pix.tobytes("png"), "pdf-page")
        doc2.close()
        return model.figure(0, 0, self.W, self.H, rel, locked="yes"), "page:" + h

    # ---------- drawings ----------

    def drawing(self, d, page, k):
        items = d.get("items", [])
        rect = d["rect"]
        fill = hex_colour(d.get("fill")) if d.get("fill") is not None else None
        stroke = hex_colour(d.get("color")) if d.get("color") is not None else None
        width = (d.get("width") or 1) * k
        if (d.get("fill_opacity") or 1) < 0.05:
            fill = None
        x, y, w, h = rect.x0 * k, rect.y0 * k, rect.width * k, rect.height * k
        full = rect.width >= page.rect.width * 0.98 and rect.height >= page.rect.height * 0.98
        if full and fill in ("#ffffff", None):
            return None  # the white page
        dashed = bool(d.get("dashes")) and d.get("dashes") not in ("[] 0", "[] 0.0")
        kinds = [it[0] for it in items]
        if kinds == ["re"] or kinds == ["qu"] or (full and fill):
            return model.shape(x, y, w, h, fill=fill or "transparent", border=stroke or "transparent",
                               border_w=width if stroke else 0, dashed=dashed, **({"locked": "yes"} if full else {}))
        ends_where_it_started = items and abs(items[0][1].x - items[-1][-1].x) < 0.5 and abs(items[0][1].y - items[-1][-1].y) < 0.5
        if len(kinds) == 4 and all(c == "c" for c in kinds) and (d.get("closePath") or ends_where_it_started):
            return model.shape(x, y, w, h, fill=fill or "transparent", border=stroke or "transparent",
                               border_w=width if stroke else 0, kind="ellipse", dashed=dashed)
        if "c" in kinds and "l" in kinds and len(kinds) <= 10 and kinds.count("c") == 4:
            c = next(it for it in items if it[0] == "c")
            radius = min(abs(c[1].x - c[4].x), abs(c[1].y - c[4].y)) * k
            return model.shape(x, y, w, h, fill=fill or "transparent", border=stroke or "transparent",
                               border_w=width if stroke else 0, radius=radius, dashed=dashed)
        points = []
        for it in items:
            if it[0] == "l":
                if not points:
                    points.append((it[1].x * k, it[1].y * k))
                points.append((it[2].x * k, it[2].y * k))
            elif it[0] == "c":
                p0, p1, p2, p3 = it[1], it[2], it[3], it[4]
                if not points:
                    points.append((p0.x * k, p0.y * k))
                for n in range(1, 9):
                    t = n / 8
                    a, b, c2, e = (1 - t) ** 3, 3 * (1 - t) ** 2 * t, 3 * (1 - t) * t ** 2, t ** 3
                    points.append(((a * p0.x + b * p1.x + c2 * p2.x + e * p3.x) * k, (a * p0.y + b * p1.y + c2 * p2.y + e * p3.y) * k))
            elif it[0] == "re":
                r = it[1]
                return model.shape(r.x0 * k, r.y0 * k, r.width * k, r.height * k, fill=fill or "transparent",
                                   border=stroke or "transparent", border_w=width if stroke else 0)
        if len(points) < 2:
            return None
        closed = bool(d.get("closePath")) or (fill is not None and len(points) > 2)
        if fill and not stroke and not closed:
            closed = True
        return model.path(points, stroke=stroke or fill or "#000000", width=width if stroke else 0.5, closed=closed,
                          fill=fill or "none", dash="dashed" if dashed else "solid")

    # ---------- text ----------

    @staticmethod
    def rows(lines):
        """PDF 'lines' on the same baseline (separate text runs) -> one row."""
        rows = []
        for ln in sorted(lines, key=lambda l: (round(l["bbox"][1]), l["bbox"][0])):
            if rows:
                last = rows[-1]
                a, b = last["bbox"], ln["bbox"]
                overlap = min(a[3], b[3]) - max(a[1], b[1])
                if overlap > 0.6 * min(a[3] - a[1], b[3] - b[1]) and b[0] >= a[0]:
                    gap = b[0] - a[2]
                    spans = last["spans"] + ([{**ln["spans"][0], "text": " "}] if gap > 1 and ln["spans"] else []) + ln["spans"]
                    rows[-1] = {"bbox": (min(a[0], b[0]), min(a[1], b[1]), max(a[2], b[2]), max(a[3], b[3])), "spans": spans}
                    continue
            rows.append({"bbox": tuple(ln["bbox"]), "spans": list(ln["spans"])})
        return rows

    def text_block(self, lines, k):
        lines = self.rows(lines)
        sizes, colours, fams = [], [], []
        md_lines = []
        for ln in lines:
            parts = []
            for s in ln["spans"]:
                t = s["text"]
                if not t:
                    continue
                sizes.append(s["size"])
                colours.append(hex_colour(s["color"]))
                fams.append(family(s["font"]))
                txt = model.md_escape(t)
                lead, core, trail = re.match(r"^(\s*)(.*?)(\s*)$", txt, re.S).groups()
                if core:
                    bold = bool(s["flags"] & 16) or "bold" in s["font"].lower()
                    italic = bool(s["flags"] & 2) or "italic" in s["font"].lower() or "oblique" in s["font"].lower()
                    if bold:
                        core = f"**{core}**"
                    if italic:
                        core = f"*{core}*"
                parts.append((lead + core + trail, hex_colour(s["color"])))
            md_lines.append(parts)
        main_colour = statistics.mode(colours) if colours else "#000000"
        text_lines = []
        for parts in md_lines:
            line = "".join(t if c == main_colour else model.coloured(model.escape_braces(t), c) for t, c in parts)
            text_lines.append(line.strip())
        md = "\n".join(text_lines)
        md = re.sub(r"\*\*\s*\*\*", "", md)
        bbox = union([tuple(ln["bbox"]) for ln in lines])
        size = statistics.median(sizes) if sizes else 10
        lefts = [ln["bbox"][0] for ln in lines]
        rights = [ln["bbox"][2] for ln in lines]
        centers = [(ln["bbox"][0] + ln["bbox"][2]) / 2 for ln in lines]
        align = "left"
        if len(lines) > 1 and max(lefts) - min(lefts) > 3:
            if max(centers) - min(centers) < 2.5:
                align = "center"
            elif max(rights) - min(rights) < 2.5:
                align = "right"
        x0, y0, x1, y1 = bbox
        page_mid = self.page_width / 2
        if len(lines) == 1 and abs((x0 + x1) / 2 - page_mid) < self.page_width * 0.03 and x0 > self.page_width * 0.12:
            align = "center"  # a line centred on the page (titles, names, dates)
        extra_w = (x1 - x0) * 0.12 + size * 1.5  # fonts and padding differ a little: room so lines don't wrap
        if align == "center":
            x0 -= extra_w / 2
            x1 += extra_w / 2
        elif align == "right":
            x0 -= extra_w
        else:
            x1 += extra_w
        fam = statistics.mode(fams) if fams else None
        return model.text(x0 * k, y0 * k, (x1 - x0) * k, (y1 - y0) * k + size * k * 0.4, md, size * k,
                          colour=main_colour or "#000000", align=align, family=fam)

    # ---------- all pages ----------

    def convert(self):
        from . import progress
        pages = []
        for n, page in enumerate(self.doc):
            progress.report("Reading the pages", n, self.doc.page_count)
            pages.append(self.page_elements(page))
        pages = [self.page_number_fields(p) for p in pages]
        master, pages, uses_master = self.find_master(pages)
        slides = self.merge_overlays(pages, uses_master)
        if master:
            masters = [{"name": "PDF", "elements": master}]
        else:
            masters = []
        meta = self.doc.metadata or {}
        if self.mode == "editable" and any(e[1].startswith("math:") for p in pages for e in p):
            self.warnings.append("Equations are pictures (a PDF doesn't keep their LaTeX); import the .tex to edit them.")
        if self.mode == "editable" and any(e[1].startswith("snap:") for p in pages for e in p):
            self.warnings.append("Complex drawings (plots, diagrams) are pictures of that region.")
        return {
            "title": (meta.get("title") or "").strip(),
            "author": (meta.get("author") or "").strip(),
            "date": "",
            "width": self.W, "height": self.H,
            "slides": slides,
            "masters": masters,
            "macros": "", "bib": "",
            "warnings": sorted(set(self.warnings), key=self.warnings.index),
        }

    def page_number_fields(self, items):
        """'3 / 19' near the bottom -> \\slidenumber / \\totalslides (same on every page)."""
        out = []
        for el, sig in items:
            c = el.get("content", "") if el["type"] == "text" else ""
            if c and el["y"] > self.H * 0.85 and re.fullmatch(r"\s*\d+\s*(/|of)\s*\d+\s*", c):
                el = {**el, "content": "\\slidenumber / \\totalslides"}
                sig = "pagenumber:" + self.r((el["x"] / 8, el["y"] / 8))
            elif c and el["y"] > self.H * 0.85 and re.fullmatch(r"\s*\d+\s*", c):
                el = {**el, "content": "\\slidenumber"}
                sig = "pagenumber:" + self.r((el["x"] / 8, el["y"] / 8))
            out.append((el, sig))
        return out

    def find_master(self, pages):
        """Content on at least half of the pages (and 3+) -> the master slide."""
        if len(pages) < 3:
            return [], pages, [False] * len(pages)
        counts = {}
        for p in pages:
            for sig in {s for _, s in p}:
                if not sig.startswith("page:"):
                    counts[sig] = counts.get(sig, 0) + 1
        common = {s for s, n in counts.items() if n >= max(3, len(pages) / 2)}
        master, seen = [], set()
        for p in pages:
            for el, sig in p:
                if sig in common and sig not in seen:
                    master.append(el)
                    seen.add(sig)
        uses = [sum(1 for _, s in p if s in common) >= len(common) / 2 for p in pages] if common else [False] * len(pages)
        pages = [[(el, s) for el, s in p if s not in common] for p in pages]
        return master, pages, uses

    def csig(self, el, sig):
        """What an element is, without its vertical position: Beamer centres a
        frame vertically, so content added by a step moves the rest a little."""
        if sig.startswith("math:"):
            return "math:" + sig.split(":")[1]  # its text: the same equation wherever the frame puts it
        if sig.startswith(("img:", "snap:", "page:")):
            kind, h = sig.split(":")[:2]
            return f"{kind}:{h}:{round(el['x'] / 6)},{round(el['width'] / 6)}"
        keys = ("type", "kind", "content", "bg", "borderCol", "stroke", "filePath")
        return "|".join(str(el.get(k, "")) for k in keys) + f"|{round(el['x'] / 6)},{round(el['width'] / 6)},{round(el['height'] / 6)}"

    def kept(self, before, after):
        """Share of a page's elements still on the next page (a text block may
        have grown: a list that got an item counts as kept)."""
        after_cs = {self.csig(el, sg) for el, sg in after}
        texts = [el for el, _ in after if el["type"] == "text"]
        n = 0
        for el, sg in before:
            if self.csig(el, sg) in after_cs:
                n += 1
            elif el["type"] == "text" and any(abs(t["x"] - el["x"]) < 8 and t["content"].startswith(el["content"].rstrip())
                                              for t in texts):
                n += 1
        return n / max(1, len(before))

    def largest_text(self, items):
        texts = [el for el, _ in items if el["type"] == "text" and el["content"].strip()]
        if not texts:
            return ""
        best = max(texts, key=lambda e: e["fontSize"])
        return re.sub(r"<[^>]+>|\*\*|\*|\\", "", best["content"]).replace("\n", " ").strip()[:80]

    def merge_overlays(self, pages, uses_master):
        """Consecutive pages of one frame (same title, most content kept: Beamer
        overlays, \\pause) -> one slide with build steps, laid out like the last
        page; each element appears at the step where it first appeared."""
        groups = []
        for n, items in enumerate(pages):
            title = self.title_of(items) or self.largest_text(items) or self.page_titles.get(n, "")
            cs = {self.csig(el, sg) for el, sg in items}
            if groups:
                g = groups[-1]
                prev_items = g["pages"][-1]
                kept = self.kept(prev_items, items)
                if title and title == g["title"] and kept >= 0.5 and uses_master[n] == g["uses"]:
                    g["pages"].append(items)
                    g["csigs"].append(cs)
                    continue
            groups.append({"title": title, "pages": [items], "csigs": [cs], "uses": uses_master[n]})
        slides = []
        for g in groups:
            first = {}
            for step, items in enumerate(g["pages"], 1):
                for el, sg in items:
                    first.setdefault(self.csig(el, sg), step)
            last = g["pages"][-1]
            last_cs = {self.csig(el, sg) for el, sg in last}
            elements = []
            # replaced content (on earlier pages only): at its own place, under what replaces it
            seen = set()
            grew_from = {}  # final text block -> step of its first (shorter) version
            last_texts = [(el, sg) for el, sg in last if el["type"] == "text"]
            for items in g["pages"][:-1]:
                for el, sg in items:
                    c = self.csig(el, sg)
                    if c in last_cs or c in seen:
                        continue
                    seen.add(c)
                    grown = None
                    if el["type"] == "text":
                        grown = next((self.csig(t, ts) for t, ts in last_texts
                                      if abs(t["x"] - el["x"]) < 8 and t["content"].startswith(el["content"].rstrip())), None)
                    elif c.startswith("math:") and len(c) > 8:  # an equation line that grew into a larger snapshot
                        grown = next((fc for fc in last_cs if fc.startswith("math:") and c[5:] in fc[5:]), None)
                    if grown:  # grew (a list that got items, a longer equation line): the full one, from the first step
                        grew_from[grown] = min(grew_from.get(grown, 99), first[c])
                        continue
                    elements.append((first[c], el))
            for el, sg in last:
                c = self.csig(el, sg)
                elements.append((min(first[c], grew_from.get(c, 99)), el))
            elements.sort(key=lambda t: t[0])  # later steps drawn on top
            out = []
            for step, el in elements:
                el = dict(el)
                if step > 1:
                    el["step"] = step
                    if el["type"] == "text" and len(g["pages"]) > 1:
                        el["bg"] = "#ffffff"  # covers what it replaces
                out.append(el)
            slide = {"title": g["title"] or f"Slide {len(slides) + 1}", "elements": out}
            if not g["uses"] and any(uses_master):
                slide["master"] = "none"
            slides.append(slide)
        return slides

    def text_title(self, page, k):
        """The largest text near the top of a page (pages imported as pictures)."""
        best = None
        for b in page.get_text("dict")["blocks"]:
            for ln in b.get("lines", []):
                text = "".join(sp["text"] for sp in ln["spans"]).strip()
                if text and ln["bbox"][1] < page.rect.height * 0.25:
                    size = max(sp["size"] for sp in ln["spans"])
                    if best is None or size > best[0]:
                        best = (size, text)
        return best[1][:80] if best else ""

    def title_of(self, items):
        best = None
        for el, _ in items:
            if el["type"] == "text" and el["y"] < self.H * 0.18 and el["content"].strip():
                if best is None or el["fontSize"] > best["fontSize"]:
                    best = el
        if not best:
            return ""
        t = re.sub(r"<[^>]+>|\*\*|\*|\\", "", best["content"]).split("\n")[0].strip()
        return t[:80]


def import_pdf(path, folder, mode="editable"):
    return Converter(path, folder, mode if mode in ("editable", "overlay", "images") else "editable").convert()
