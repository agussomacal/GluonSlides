"""PowerPoint (.pptx) -> slides.

  text boxes, placeholders   text boxes (paragraphs, bullets and numbering,
                             bold / italic / underline, colour, size, font,
                             alignment, links)
  pictures                   figures (saved into figures/)
  rectangles, rounded, ovals shapes (fill, outline); their text on top
  lines, connectors          lines (arrowheads)
  tables                     Markdown tables
  groups                     their contents, placed through the group
  layout / master shapes     master slides (one per layout used)
  backgrounds (solid)        a full-slide rectangle at the back
  notes, sections            notes, sections
  click animations           build steps
Charts, SmartArt and freeform drawings are not converted (a placeholder
box, and a warning).
"""

import os
import re

from pptx import Presentation
from pptx.enum.dml import MSO_COLOR_TYPE, MSO_FILL
from pptx.enum.shapes import MSO_AUTO_SHAPE_TYPE, MSO_SHAPE_TYPE, PP_PLACEHOLDER
from pptx.enum.text import MSO_ANCHOR, PP_ALIGN
from pptx.opc.constants import RELATIONSHIP_TYPE as RT

from . import model

NS = {"a": "http://schemas.openxmlformats.org/drawingml/2006/main",
      "p": "http://schemas.openxmlformats.org/presentationml/2006/main",
      "p14": "http://schemas.microsoft.com/office/powerpoint/2010/main"}

THEME_KEYS = {"TEXT_1": "dk1", "BACKGROUND_1": "lt1", "TEXT_2": "dk2", "BACKGROUND_2": "lt2", "DARK_1": "dk1",
              "LIGHT_1": "lt1", "DARK_2": "dk2", "LIGHT_2": "lt2", "HYPERLINK": "hlink",
              **{f"ACCENT_{n}": f"accent{n}" for n in range(1, 7)}}

DEFAULT_PT = {PP_PLACEHOLDER.TITLE: 40, PP_PLACEHOLDER.CENTER_TITLE: 44, PP_PLACEHOLDER.SUBTITLE: 24,
              PP_PLACEHOLDER.BODY: 24, PP_PLACEHOLDER.OBJECT: 24}


class Converter:
    def __init__(self, path, folder):
        self.prs = Presentation(path)
        self.folder = folder
        self.warnings = []
        sw, sh = self.prs.slide_width, self.prs.slide_height
        ratio = sw / sh
        if abs(ratio - 16 / 9) < 0.02:
            self.W, self.H = 1920, 1080
        elif abs(ratio - 4 / 3) < 0.02:
            self.W, self.H = 1280, 960
        else:
            self.W, self.H = 1920, round(1920 / ratio)
        self.k = self.W / sw                     # px per EMU
        self.pt = self.W / (sw / 12700)          # px per point
        self.theme = self._theme_colours()
        self.images = 0

    # ---------- colours ----------

    def _theme_colours(self):
        out = {}
        try:
            master = self.prs.slide_masters[0]
            theme = master.part.part_related_by(RT.THEME)
            from lxml import etree
            root = etree.fromstring(theme.blob)
            scheme = root.find(".//a:clrScheme", NS)
            for child in scheme:
                name = etree.QName(child).localname
                srgb = child.find("a:srgbClr", NS)
                sysc = child.find("a:sysClr", NS)
                if srgb is not None:
                    out[name] = "#" + srgb.get("val").lower()
                elif sysc is not None and sysc.get("lastClr"):
                    out[name] = "#" + sysc.get("lastClr").lower()
        except Exception:
            pass
        return out

    def colour(self, color_format, default=None):
        try:
            if color_format.type == MSO_COLOR_TYPE.RGB:
                return "#" + str(color_format.rgb).lower()
            if color_format.type == MSO_COLOR_TYPE.SCHEME:
                key = THEME_KEYS.get(color_format.theme_color.name)
                return self.theme.get(key, default)
        except Exception:
            pass
        return default

    def fill(self, shape):
        try:
            f = shape.fill
            if f.type == MSO_FILL.SOLID:
                return self.colour(f.fore_color, "#cccccc")
            if f.type == MSO_FILL.BACKGROUND:
                return "transparent"
        except Exception:
            pass
        return "transparent"

    def line(self, shape):
        try:
            ln = shape.line
            if ln.fill.type == MSO_FILL.SOLID:
                return self.colour(ln.color, "#000000"), max(1.0, (ln.width or 12700) * self.k)
        except Exception:
            pass
        return "transparent", 0

    # ---------- text ----------

    def run_md(self, run):
        t = model.md_escape(run.text)
        if not t.strip():
            return t
        lead, core, trail = re.match(r"^(\s*)(.*?)(\s*)$", t, re.S).groups()
        f = run.font
        if f.bold:
            core = f"**{core}**"
        if f.italic:
            core = f"*{core}*"
        if f.underline:
            core = f"<u>{core}</u>"
        try:
            c = self.colour(f.color) if f.color and f.color.type is not None else None
        except Exception:
            c = None
        if c and c not in ("#000000",):
            core = model.coloured(model.escape_braces(core), c)
        try:
            if run.hyperlink and run.hyperlink.address:
                core = f"[{core}]({run.hyperlink.address})"
        except Exception:
            pass
        return lead + core + trail

    def text_of(self, tf, bulleted_default):
        """(markdown, first size pt or None, alignment, colour)."""
        lines, size, align, numbers = [], None, "left", {}
        run_colours = []
        for p in tf.paragraphs:
            text = "".join(self.run_md(r) for r in p.runs).rstrip()
            ppr = p._p.find("a:pPr", NS)
            bullet = bulleted_default
            numbered = False
            if ppr is not None:
                if ppr.find("a:buNone", NS) is not None:
                    bullet = False
                if ppr.find("a:buChar", NS) is not None:
                    bullet = True
                if ppr.find("a:buAutoNum", NS) is not None:
                    bullet, numbered = True, True
            level = p.level or 0
            if not text:
                lines.append("")
                continue
            if bullet:
                indent = "    " * level
                if numbered:
                    numbers[level] = numbers.get(level, 0) + 1
                    text = f"{indent}{numbers[level]}. {text}"
                else:
                    text = f"{indent}- {text}"
            lines.append(text)
            for r in p.runs:
                if size is None and r.font.size:
                    size = r.font.size.pt
                if r.text.strip():
                    try:
                        has = r.font.color and r.font.color.type is not None
                        run_colours.append(self.colour(r.font.color) if has else None)
                    except Exception:
                        run_colours.append(None)
            if p.alignment in (PP_ALIGN.CENTER,):
                align = "center"
            elif p.alignment in (PP_ALIGN.RIGHT,):
                align = "right"
        md = "\n".join(lines).strip("\n")
        md = re.sub(r"\n{3,}", "\n\n", md)
        # one colour for the whole box only if every run has it (else it stays on its runs)
        colour = run_colours[0] if run_colours and all(c == run_colours[0] for c in run_colours) else None
        return md, size, align, colour

    # ---------- shapes ----------

    def convert_shapes(self, shapes, out, xf, slide_steps=None, in_layout=False):
        for sh in shapes:
            x, y, w, h = xf(sh)
            timing = (slide_steps or {}).get(sh.shape_id, {})
            step = timing.get("step", 1)
            extra = {"step": step} if step > 1 else {}
            if timing.get("until") is not None and timing["until"] >= step:
                extra["until"] = timing["until"]
            st = sh.shape_type
            if in_layout and sh.is_placeholder:
                continue  # layout placeholders only shape the slides' own
            if st == MSO_SHAPE_TYPE.GROUP:
                self.convert_shapes(sh.shapes, out, self.group_transform(sh, xf), slide_steps, in_layout)
                continue
            if st == MSO_SHAPE_TYPE.PICTURE or (sh.is_placeholder and hasattr(sh, "image")):
                try:
                    rel = self.save_image(sh.image)
                    out.append(model.figure(x, y, w, h, rel, **extra))
                except Exception as e:
                    self.warnings.append(f"A picture could not be read ({e}).")
                continue
            if getattr(sh, "has_table", False) and sh.has_table:
                out.append(self.table(sh, x, y, w, h, extra))
                continue
            if getattr(sh, "has_chart", False) and sh.has_chart:
                self.warnings.append("A chart was not converted (placeholder box).")
                out.append(model.shape(x, y, w, h, border="#999999", border_w=2, dashed=True, **extra))
                out.append(model.text(x, y, w, h, "*Chart (not imported)*", 18 * self.pt / 2, align="center", valign="center", **extra))
                continue
            if st in (MSO_SHAPE_TYPE.LINE,) or sh.__class__.__name__ == "Connector":
                out.append(self.connector(sh, xf, extra))
                continue
            if st == MSO_SHAPE_TYPE.FREEFORM:
                self.warnings.append("A freeform drawing was not converted.")
                continue
            if st not in (MSO_SHAPE_TYPE.AUTO_SHAPE, MSO_SHAPE_TYPE.TEXT_BOX, MSO_SHAPE_TYPE.PLACEHOLDER, None):
                if "graphicFrame" in sh._element.tag:
                    self.warnings.append("A SmartArt or embedded object was not converted.")
                continue
            # an auto shape: its outline / fill, then its text
            if st == MSO_SHAPE_TYPE.AUTO_SHAPE:
                fill = self.fill(sh)
                border, bw = self.line(sh)
                if fill != "transparent" or bw:
                    kind, radius = "rect", 0
                    try:
                        ast = sh.auto_shape_type
                        if ast == MSO_AUTO_SHAPE_TYPE.OVAL:
                            kind = "ellipse"
                        elif ast == MSO_AUTO_SHAPE_TYPE.ROUNDED_RECTANGLE:
                            adj = sh.adjustments[0] if len(sh.adjustments) else 0.1667
                            radius = adj * min(w, h)
                    except Exception:
                        pass
                    out.append(model.shape(x, y, w, h, fill=fill, border=border, border_w=bw, kind=kind, radius=radius, **extra))
            if sh.has_text_frame and sh.text_frame.text.strip():
                ph = sh.placeholder_format.type if sh.is_placeholder else None
                bulleted = ph in (PP_PLACEHOLDER.BODY, PP_PLACEHOLDER.OBJECT)
                md, size, align, colour = self.text_of(sh.text_frame, bulleted)
                size = size or DEFAULT_PT.get(ph, 18)
                if ph in (PP_PLACEHOLDER.CENTER_TITLE, PP_PLACEHOLDER.SUBTITLE) and align == "left":
                    align = "center"  # PowerPoint's default for title-slide placeholders
                anchor = sh.text_frame.vertical_anchor
                valign = "center" if anchor == MSO_ANCHOR.MIDDLE or (anchor is None and ph in (PP_PLACEHOLDER.TITLE, PP_PLACEHOLDER.CENTER_TITLE)) \
                    else "bottom" if anchor == MSO_ANCHOR.BOTTOM else "top"
                family = None
                for p in sh.text_frame.paragraphs:
                    for r in p.runs:
                        family = family or r.font.name
                out.append(model.text(x, y, w, h, md, size * self.pt, colour=colour or "#000000", align=align,
                                      valign=valign, family=family, **extra))

    def group_transform(self, group, outer):
        gx, gy, gw, gh = outer(group)
        xfrm = group._element.find(".//a:xfrm", NS)
        ch_off = xfrm.find("a:chOff", NS) if xfrm is not None else None
        ch_ext = xfrm.find("a:chExt", NS) if xfrm is not None else None
        if ch_off is None or ch_ext is None or not int(ch_ext.get("cx")) or not int(ch_ext.get("cy")):
            return outer
        cx0, cy0 = int(ch_off.get("x")), int(ch_off.get("y"))
        sx, sy = gw / int(ch_ext.get("cx")), gh / int(ch_ext.get("cy"))

        def inner(sh):
            return (gx + ((sh.left or 0) - cx0) * sx, gy + ((sh.top or 0) - cy0) * sy, (sh.width or 0) * sx, (sh.height or 0) * sy)
        return inner

    def connector(self, sh, xf, extra):
        x, y, w, h = xf(sh)
        try:
            bx, by, ex, ey = sh.begin_x, sh.begin_y, sh.end_x, sh.end_y
            x0, y0 = xf(sh)[:2]
            left, top = min(bx, ex), min(by, ey)
            scale_x = w / max(1, abs(ex - bx)) if abs(ex - bx) else self.k
            scale_y = h / max(1, abs(ey - by)) if abs(ey - by) else self.k
            p0 = (x0 + (bx - left) * scale_x, y0 + (by - top) * scale_y)
            p1 = (x0 + (ex - left) * scale_x, y0 + (ey - top) * scale_y)
        except Exception:
            p0, p1 = (x, y), (x + w, y + h)
        colour, width = self.line(sh)
        ln = sh._element.find(".//a:ln", NS)
        start = end = "none"
        if ln is not None:
            if ln.find("a:headEnd", NS) is not None and ln.find("a:headEnd", NS).get("type", "none") != "none":
                start = "arrow"
            if ln.find("a:tailEnd", NS) is not None and ln.find("a:tailEnd", NS).get("type", "none") != "none":
                end = "arrow"
        return model.path([p0, p1], stroke=colour if colour != "transparent" else "#000000", width=width or 2,
                          start=start, end=end, **extra)

    def table(self, sh, x, y, w, h, extra):
        """A table element: the cells (Markdown), PowerPoint's header row and banded rows."""
        rows, size = [], None
        for r in sh.table.rows:
            cells = []
            for c in r.cells:
                md, s, _, _ = self.text_of(c.text_frame, False)
                size = size or s
                cells.append(md)
            rows.append(cells)
        n = max((len(r) for r in rows), default=1)
        rows = [r + [""] * (n - len(r)) for r in rows] or [[""]]
        widths = [c.width for c in sh.table.columns]
        total = sum(widths) or 1
        el = {"type": "table", "x": round(x), "y": round(y), "width": round(w), "height": round(h), "rows": rows,
              "header": "yes" if sh.table.first_row else "no", "borders": "all",
              "stripes": "yes" if sh.table.horz_banding else "no",
              "fontSize": round((size or 18) * self.pt), **extra}  # 18 pt: PowerPoint's table default
        if len(set(widths)) > 1:
            el["widths"] = [round(cw / total * 100, 1) for cw in widths]
        return el

    def save_image(self, image):
        self.images += 1
        ext = (image.ext or "png").lower()
        if ext in ("wmf", "emf"):
            self.warnings.append("A Windows metafile picture (.emf/.wmf) may not show; replace it with a PNG.")
        rel = f"figures/image-{self.images}.{ext}"
        dest = os.path.join(self.folder, rel)
        os.makedirs(os.path.dirname(dest), exist_ok=True)
        with open(dest, "wb") as f:
            f.write(image.blob)
        return rel

    # ---------- slides ----------

    def xf(self, sh):
        return ((sh.left or 0) * self.k, (sh.top or 0) * self.k, (sh.width or 0) * self.k, (sh.height or 0) * self.k)

    def background(self, holder):
        try:
            f = holder.background.fill
            if f.type == MSO_FILL.SOLID:
                c = self.colour(f.fore_color)
                if c and c != "#ffffff":
                    return model.shape(0, 0, self.W, self.H, fill=c, locked="yes")
        except Exception:
            pass
        return None

    def click_steps(self, slide):
        """shape id -> {"step", "until"?}, from the slide's click animations:
        an entrance makes it appear at that step, an exit makes the step
        before it its last one."""
        steps = {}
        timing = slide._element.find("p:timing", NS)
        if timing is None:
            return steps
        step = 1
        for ctn in timing.iter("{%s}cTn" % NS["p"]):
            kind = ctn.get("presetClass")
            if ctn.get("nodeType") == "clickEffect" and kind in ("entr", "exit"):
                step += 1
            if kind in ("entr", "exit"):
                for tgt in ctn.iter("{%s}spTgt" % NS["p"]):
                    entry = steps.setdefault(int(tgt.get("spid")), {"step": 1})
                    if kind == "entr" and "entered" not in entry:
                        entry.update(step=step, entered=True)
                    elif kind == "exit" and "until" not in entry:
                        entry["until"] = step - 1
        return steps

    def sections(self):
        """slide id -> section name (PowerPoint's sections)."""
        out = {}
        for sec in self.prs.part._element.iter("{%s}section" % NS["p14"]):
            for sid in sec.iter("{%s}sldId" % NS["p14"]):
                out[int(sid.get("id"))] = sec.get("name")
        return out

    def convert(self):
        masters, used = [], {}
        sections = self.sections()
        slides = []
        from . import progress
        for n, slide in enumerate(self.prs.slides):
            progress.report("Converting the slides", n, len(self.prs.slides))
            layout = slide.slide_layout
            name = layout.name or "Layout"
            key = str(layout.part.partname)
            if key not in used:
                els = []
                bg = self.background(layout.slide_master)
                if bg:
                    els.append(bg)
                self.convert_shapes(layout.slide_master.shapes, els, self.xf, in_layout=True)
                self.convert_shapes(layout.shapes, els, self.xf, in_layout=True)
                unique = name
                k = 2
                while any(m["name"] == unique for m in masters):
                    unique = f"{name} {k}"
                    k += 1
                used[key] = unique
                masters.append({"name": unique, "elements": els})
            els = []
            bg = self.background(slide) if not slide.follow_master_background else None
            if bg:
                els.append(bg)
            self.convert_shapes(slide.shapes, els, self.xf, self.click_steps(slide))
            title = ""
            try:
                if slide.shapes.title is not None:
                    title = slide.shapes.title.text_frame.text.strip().split("\n")[0]
            except Exception:
                pass
            s = {"title": title or f"Slide {n + 1}", "elements": els, "master": used[key]}
            if slide.has_notes_slide:
                notes = slide.notes_slide.notes_text_frame.text.strip() if slide.notes_slide.notes_text_frame else ""
                if notes:
                    s["notes"] = notes
            if slide.slide_id in sections:
                s["section"] = sections[slide.slide_id]
            slides.append(s)
        # masters' order: the most used first (it becomes the default)
        counts = {m["name"]: sum(1 for s in slides if s["master"] == m["name"]) for m in masters}
        masters.sort(key=lambda m: -counts[m["name"]])
        core = self.prs.core_properties
        return {
            "title": (core.title or "").strip(),
            "author": (core.author or "").strip(),
            "date": "",
            "width": self.W, "height": self.H,
            "slides": slides,
            "masters": masters,
            "macros": "",
            "bib": "",
            "warnings": sorted(set(self.warnings), key=self.warnings.index),
        }


def import_pptx(path, folder):
    return Converter(path, folder).convert()
