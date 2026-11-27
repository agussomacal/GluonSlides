"""Shared pieces of the importers: the slide/element dicts they return (the
same shape as the editor's state, see core/state.js; the page writes the
.gl file), colours, and lengths.

An import result:
    {"title", "author", "date", "width", "height",
     "slides":  [{"title", "section"?, "notes"?, "master"?, "elements": [...]}],
     "masters": [{"name", "elements": [...]}],
     "macros": "...",        # LaTeX macros (macros.tex), one per line
     "bib": "...",           # BibTeX (bibliography.bib)
     "warnings": ["..."]}
Elements usually have no ids: the page gives them ids when it builds the project
(the PowerPoint importer numbers its own from 10000, so connectors can name them).
"""

import re

# ---------- colours ----------

SAFE_COLOUR = re.compile(r"^[#@A-Za-z0-9!./ -]+$")


def coloured(text, colour):
    """Text in a colour, as GluonSlides writes it: \\textcolor{red}{text}
    (core/textCommands.js). Braces in the text are escaped."""
    if not colour or not text:
        return text
    colour = colour.strip()
    if not SAFE_COLOUR.match(colour):
        return f'<span style="color:{colour}">{text}</span>'  # rgb(...) and the like
    return "\\textcolor{" + colour + "}{" + text + "}"


def escape_braces(text):
    return re.sub(r"(?<!\\)([{}])", r"\\\1", text)

# xcolor base colours and the common dvipsnames.
NAMED = {
    "black": "000000", "white": "ffffff", "red": "ff0000", "green": "00ff00", "blue": "0000ff",
    "cyan": "00ffff", "magenta": "ff00ff", "yellow": "ffff00", "gray": "808080", "grey": "808080",
    "darkgray": "404040", "lightgray": "bfbfbf", "brown": "bf8040", "lime": "bfff00", "olive": "808000",
    "orange": "ff8000", "pink": "ffbfbf", "purple": "bf0040", "teal": "008080", "violet": "800080",
    "darkred": "8b0000", "navy": "000080",
    "Apricot": "fbb982", "Aquamarine": "00b5be", "Bittersweet": "c04f17", "BlueGreen": "00b3b8",
    "BlueViolet": "473992", "BrickRed": "b6321c", "Brown": "792500", "BurntOrange": "f7921d",
    "CadetBlue": "74729a", "CarnationPink": "f282b4", "Cerulean": "00a2e3", "CornflowerBlue": "41b0e4",
    "Cyan": "00aeef", "Dandelion": "fdbc42", "DarkOrchid": "a4538a", "Emerald": "00a99d",
    "ForestGreen": "009b55", "Fuchsia": "8c368c", "Goldenrod": "ffdf42", "Gray": "949698",
    "Green": "00a64f", "GreenYellow": "dfe674", "JungleGreen": "00a99a", "Lavender": "f49ec4",
    "LimeGreen": "8dc73e", "Magenta": "ec008c", "Mahogany": "a9341f", "Maroon": "af3235",
    "Melon": "f89e7b", "MidnightBlue": "006795", "Mulberry": "a93c93", "NavyBlue": "006eb8",
    "OliveGreen": "3c8031", "Orange": "f58137", "OrangeRed": "ed135a", "Orchid": "af72b0",
    "Peach": "f7965a", "Periwinkle": "7977b8", "PineGreen": "008b72", "Plum": "92268f",
    "ProcessBlue": "00b0f0", "Purple": "99479b", "RawSienna": "974006", "Red": "ed1b23",
    "RedOrange": "f26035", "RedViolet": "a1246b", "Rhodamine": "ef559f", "RoyalBlue": "0071bc",
    "RoyalPurple": "613f99", "RubineRed": "ed017d", "Salmon": "f69289", "SeaGreen": "3fbc9d",
    "Sepia": "671800", "SkyBlue": "46c5dd", "SpringGreen": "c6dc67", "Tan": "da9d76",
    "TealBlue": "00aeb3", "Thistle": "d883b7", "Turquoise": "00b4ce", "Violet": "58429b",
    "VioletRed": "ef58a0", "WildStrawberry": "ee2967", "YellowGreen": "98cc70", "YellowOrange": "faa21a",
}


def _hex(rgb):
    return "#" + "".join(f"{max(0, min(255, round(c))):02x}" for c in rgb)


def _rgb(hex6):
    return tuple(int(hex6[i:i + 2], 16) for i in (0, 2, 4))


class Colours:
    """Colour names of a document (\\definecolor, \\colorlet) on top of xcolor's."""

    def __init__(self):
        self.defined = {}

    def define(self, name, model, spec):
        spec = spec.strip()
        try:
            if model.upper() == "HTML":
                self.defined[name] = spec.lstrip("#").lower()[:6]
            elif model == "RGB":
                self.defined[name] = _hex([float(v) for v in spec.split(",")])[1:]
            elif model == "rgb":
                self.defined[name] = _hex([float(v) * 255 for v in spec.split(",")])[1:]
            elif model == "gray":
                g = float(spec) * 255
                self.defined[name] = _hex([g, g, g])[1:]
            elif model == "cmyk":
                c, m, y, k = (float(v) for v in spec.split(","))
                self.defined[name] = _hex([255 * (1 - c) * (1 - k), 255 * (1 - m) * (1 - k), 255 * (1 - y) * (1 - k)])[1:]
        except ValueError:
            pass

    def let(self, name, expr):
        value = self.resolve(expr)
        if value:
            self.defined[name] = value[1:]

    def _base(self, name):
        name = name.strip()
        if name.startswith("#") and len(name) in (4, 7):
            return name[1:] if len(name) == 7 else "".join(c * 2 for c in name[1:])
        return self.defined.get(name) or NAMED.get(name) or NAMED.get(name.lower())

    def resolve(self, expr):
        """xcolor expression ('red', 'colorHB!20!white', 'blue!30') -> '#rrggbb' or None."""
        if not expr:
            return None
        expr = expr.strip()
        if expr.startswith("-"):  # complement: rare, keep the colour
            expr = expr[1:]
        parts = expr.split("!")
        first = self._base(parts[0])
        if first is None:
            return None
        rgb = _rgb(first)
        i = 1
        while i < len(parts):
            try:
                pct = float(parts[i]) / 100
            except ValueError:
                return _hex(rgb)
            other_name = parts[i + 1] if i + 1 < len(parts) else "white"
            other = self._base(other_name)
            if other is None:
                return _hex(rgb)
            o = _rgb(other)
            rgb = tuple(a * pct + b * (1 - pct) for a, b in zip(rgb, o))
            i += 2
        return _hex(rgb)


# ---------- lengths ----------

PT_PER = {"pt": 1, "mm": 2.845, "cm": 28.45, "in": 72.27, "bp": 1.00375, "pc": 12, "em": 10, "ex": 4.3}


def length_pt(text, em_pt=10.0):
    """'0.5cm' / '-1em' / '2ex' -> points (em/ex relative to the font size)."""
    m = re.match(r"\s*(-?[\d.]+)\s*([a-z]+)", text or "")
    if not m:
        return 0.0
    value, unit = float(m.group(1)), m.group(2)
    if unit == "em":
        return value * em_pt
    if unit == "ex":
        return value * em_pt * 0.43
    return value * PT_PER.get(unit, 1)


# ---------- elements (core/state.js shapes) ----------

def text(x, y, w, h, content, size, colour="#000000", align="left", valign="top", family=None, **extra):
    el = {"type": "text", "x": round(x), "y": round(y), "width": max(10, round(w)), "height": max(10, round(h)),
          "content": content, "fontSize": max(6, round(size)), "fontColor": colour,
          "textAlign": align, "verticalAlign": valign, "bg": "transparent", "borderCol": "transparent",
          "borderWidth": 0, "borderStyle": "solid"}
    if family:
        el["fontFamily"] = family
    el.update(extra)
    return el


def missing_figure_path(name):
    """Where a figure that was not found goes (figures/<name>.png): the
    compiled PDF's picture of it may fill it (groundtruth.py)."""
    rel = re.sub(r"^(\./|\.\./)+", "", (name or "figure").replace("\\", "/")).lstrip("/")
    rel = re.sub(r"^public/", "", rel)
    rel = rel if rel.startswith("figures/") else "figures/" + rel
    return re.sub(r"\.(pdf|eps|svg|png|jpe?g|gif|webp|bmp|tiff?)$", "", rel, flags=re.I) + ".png"


def figure(x, y, w, h, file_path, original="", sync=False, **extra):
    el = {"type": "figure", "x": round(x), "y": round(y), "width": max(4, round(w)), "height": max(4, round(h)),
          "filePath": file_path, "originalPath": original, "bg": "transparent",
          "borderCol": "transparent", "borderWidth": 0, "borderStyle": "solid"}
    if sync:
        el["sync"] = "yes"
    el.update(extra)
    return el


def shape(x, y, w, h, fill="transparent", border="transparent", border_w=0, kind="rect", radius=0, dashed=False, **extra):
    el = {"type": "shape", "kind": kind, "x": round(x), "y": round(y), "width": max(1, round(w)), "height": max(1, round(h)),
          "bg": fill, "borderCol": border, "borderWidth": round(border_w, 1), "borderStyle": "dashed" if dashed else "solid"}
    if radius:
        el["radius"] = round(radius)
    el.update(extra)
    return el


def path(points, stroke="#000000", width=2, closed=False, fill="none", start="none", end="none", dash="solid", curve="straight", **extra):
    """A line / polyline / polygon from absolute points (as the drawing tools do)."""
    xs, ys = [p[0] for p in points], [p[1] for p in points]
    x0, y0 = min(xs), min(ys)
    w, h = max(1.0, max(xs) - x0), max(1.0, max(ys) - y0)
    if max(ys) - y0 < 1:  # horizontal: a 1px box, points in the middle
        y0 -= 0.5
    if max(xs) - x0 < 1:
        x0 -= 0.5
    el = {"type": "path", "x": round(x0, 1), "y": round(y0, 1), "width": round(w, 1), "height": round(h, 1),
          "points": [[round((px - x0) / w, 4), round((py - y0) / h, 4)] for px, py in points],
          "stroke": stroke, "strokeWidth": round(width, 1), "dash": dash, "curve": curve}
    if closed:
        el["closed"] = "yes"
        el["fill"] = fill
    if start != "none":
        el["start"] = start
    if end != "none":
        el["end"] = end
    el.update(extra)
    return el


def md_escape(s):
    """Plain text safe in Markdown and math: Markdown's own characters escaped,
    brackets as entities (\\[ would start a display equation), $ as \\$."""
    s = re.sub(r"([\\`*_#|<>])", r"\\\1", s)
    s = s.replace("[", "&#91;").replace("]", "&#93;")
    return s.replace("$", "\\$")


def finish_fallbacks(result):
    """After the PDF step: a `missing` figure the PDF filled replaces the
    placeholder that came with it (same `_fallback`); one it didn't fill
    goes, except a picture kept as it is (`_keep`: an .emf / .wmf file)."""
    for s in (result.get("slides") or []) + (result.get("masters") or []):
        els = s.get("elements") or []
        filled = {e["_fallback"] for e in els if e.get("_fallback") and e.get("type") == "figure" and not e.get("missing")}
        out = []
        for e in els:
            n, keep = e.pop("_fallback", None), e.pop("_keep", None)
            if n and e.get("type") == "figure" and e.get("missing"):
                if keep:
                    e.pop("missing", None)
                    out.append(e)  # the picture as it is (may not show)
                continue
            if n and e.get("type") != "figure" and n in filled:
                continue  # its picture from the PDF replaces the placeholder box
            out.append(e)
        s["elements"] = out
