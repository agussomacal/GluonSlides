"""PowerPoint drawings with no GluonSlides element of their own, as exact SVG
pictures: freeforms (custom geometry: the blobs and arrows people draw) and
curved / elbow connectors. pptx.py saves them in figures/ as figure elements.

Coordinates: a shape's paths are in their own units (<a:path w h>), scaled to
the shape's box (in slide pixels here); flips and rotation turn the drawing
inside a picture large enough to hold it.
"""

import math
import re

A = "{http://schemas.openxmlformats.org/drawingml/2006/main}"
DASHES = {"dash": "4 3", "sysDash": "3 1", "dashDot": "4 3 1 3", "lgDash": "8 3", "lgDashDot": "8 3 1 3",
          "sysDot": "1 1", "dot": "1 2", "sysDashDot": "3 1 1 1"}


def _f(v):
    return f"{v:.2f}".rstrip("0").rstrip(".")


def custom_paths(sp, w, h):
    """SVG path data of a shape's custom geometry, in a w x h box (px), or ''."""
    geom = sp.find(f".//{A}custGeom")
    if geom is None:
        return ""
    out = []
    for path in geom.iter(f"{A}path"):
        pw = float(path.get("w") or 0) or 1.0
        ph = float(path.get("h") or 0) or 1.0
        sx, sy = w / pw, h / ph
        cur = (0.0, 0.0)
        start = (0.0, 0.0)

        def pt(node):
            return float(node.get("x")) * sx, float(node.get("y")) * sy

        for cmd in path:
            tag = cmd.tag.replace(A, "")
            pts = [pt(p) for p in cmd.findall(f"{A}pt")]
            if tag == "moveTo" and pts:
                cur = start = pts[0]
                out.append(f"M{_f(cur[0])} {_f(cur[1])}")
            elif tag == "lnTo" and pts:
                cur = pts[0]
                out.append(f"L{_f(cur[0])} {_f(cur[1])}")
            elif tag == "cubicBezTo" and len(pts) == 3:
                out.append("C" + " ".join(f"{_f(x)} {_f(y)}" for x, y in pts))
                cur = pts[2]
            elif tag == "quadBezTo" and len(pts) == 2:
                out.append("Q" + " ".join(f"{_f(x)} {_f(y)}" for x, y in pts))
                cur = pts[1]
            elif tag == "arcTo":
                wr, hr = float(cmd.get("wR")) * sx, float(cmd.get("hR")) * sy
                st, sw = float(cmd.get("stAng")) / 60000, float(cmd.get("swAng")) / 60000
                # the ellipse's centre from the current point at the start angle
                a0, a1 = math.radians(st), math.radians(st + sw)
                cx, cy = cur[0] - wr * math.cos(a0), cur[1] - hr * math.sin(a0)
                end = (cx + wr * math.cos(a1), cy + hr * math.sin(a1))
                large = 1 if abs(sw) > 180 else 0
                sweep = 1 if sw > 0 else 0
                out.append(f"A{_f(wr)} {_f(hr)} 0 {large} {sweep} {_f(end[0])} {_f(end[1])}")
                cur = end
            elif tag == "close":
                out.append("Z")
                cur = start
    return " ".join(out)


def adjust(sp, name, default):
    """A preset shape's adjustment value (<a:gd name="adj1" fmla="val 50000"/>), in 1/100000."""
    for gd in sp.iter(f"{A}gd"):
        if gd.get("name") == name:
            m = re.match(r"val\s+(-?\d+)", gd.get("fmla") or "")
            if m:
                return int(m.group(1))
    return default


def connector_path(prst, w, h, sp=None):
    """The path of a preset connector in a w x h box (px), as PowerPoint draws it
    (presetShapeDefinitions: the middle of the bend at adj1 of the width)."""
    if prst and prst.startswith("curvedConnector"):
        x2 = w * (adjust(sp, "adj1", 50000) if sp is not None else 50000) / 100000
        x1, x3 = x2 / 2, (w + x2) / 2
        return (f"M0 0 C{_f(x1)} 0 {_f(x2)} {_f(h / 4)} {_f(x2)} {_f(h / 2)} "
                f"C{_f(x2)} {_f(3 * h / 4)} {_f(x3)} {_f(h)} {_f(w)} {_f(h)}")
    if prst and prst.startswith("bentConnector"):
        x1 = w * (adjust(sp, "adj1", 50000) if sp is not None else 50000) / 100000
        return f"M0 0 H{_f(x1)} V{_f(h)} H{_f(w)}"
    return f"M0 0 L{_f(w)} {_f(h)}"


def style_of(sp, fill, stroke, stroke_w):
    """SVG attributes for the shape's fill, outline and dashes."""
    ln = sp.find(f".//{A}ln")
    dash = ""
    if ln is not None:
        d = ln.find(f"{A}prstDash")
        if d is not None and d.get("val") in DASHES:
            dash = " ".join(_f(float(v) * max(1.0, stroke_w)) for v in DASHES[d.get("val")].split())
        if ln.find(f"{A}noFill") is not None:
            stroke = "none"
    attrs = [f'fill="{fill if fill and fill != "transparent" else "none"}"',
             f'stroke="{stroke if stroke and stroke != "transparent" else "none"}"',
             f'stroke-width="{_f(stroke_w or 0)}"', 'stroke-linejoin="round"', 'stroke-linecap="round"']
    if dash:
        attrs.append(f'stroke-dasharray="{dash}"')
    return " ".join(attrs)


def arrows_of(sp):
    """(start, end): whether the line has an arrowhead at each end."""
    ln = sp.find(f".//{A}ln")
    if ln is None:
        return False, False
    has = lambda tag: ln.find(f"{A}{tag}") is not None and ln.find(f"{A}{tag}").get("type", "none") != "none"
    return has("headEnd"), has("tailEnd")


def transform_of(sp):
    """(rotation in degrees, flipH, flipV) of the shape."""
    xfrm = sp.find(f".//{A}xfrm")
    if xfrm is None:
        return 0.0, False, False
    return (float(xfrm.get("rot") or 0) / 60000, xfrm.get("flipH") == "1", xfrm.get("flipV") == "1")


def svg_picture(d, box, sp, fill, stroke, stroke_w, arrows=(False, False), extent=None):
    """(svg text, (x, y, w, h)): the drawing `d` of a shape in `box` (x, y, w, h,
    slide px), flipped and rotated as the shape is, in a picture that holds it.
    `extent`: the drawing's own bounds in the box's units when it goes beyond
    the box (a connector's bend), else the box."""
    x, y, w, h = box
    rot, fh, fv = transform_of(sp)
    pad = max(2.0, stroke_w * 2 + (stroke_w * 4 if any(arrows) else 0))
    lx0, ly0, lx1, ly1 = extent or (0.0, 0.0, w, h)
    # where the drawing's corners go once flipped and turned about the box's centre
    a = math.radians(rot)

    def place(px, py):
        dx, dy = px - w / 2, py - h / 2
        if fh:
            dx = -dx
        if fv:
            dy = -dy
        return dx * math.cos(a) - dy * math.sin(a), dx * math.sin(a) + dy * math.cos(a)
    corners = [place(px, py) for px in (lx0, lx1) for py in (ly0, ly1)]
    minx, maxx = min(c[0] for c in corners), max(c[0] for c in corners)
    miny, maxy = min(c[1] for c in corners), max(c[1] for c in corners)
    vw, vh = maxx - minx + 2 * pad, maxy - miny + 2 * pad
    ox, oy = x + w / 2 + minx - pad, y + h / 2 + miny - pad
    # inside: the box's centre at its place in the picture, then flip / turn about it
    cx, cy = -minx + pad, -miny + pad
    t = [f"translate({_f(cx)} {_f(cy)})"]
    if rot:
        t.append(f"rotate({_f(rot)})")
    if fh or fv:
        t.append(f"scale({-1 if fh else 1} {-1 if fv else 1})")
    t.append(f"translate({_f(-w / 2)} {_f(-h / 2)})")
    marker = ""
    ends = ""
    if any(arrows):
        colour = stroke if stroke and stroke != "transparent" else "#000000"
        marker = (f'<defs><marker id="a" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="4" markerHeight="4" '
                  f'orient="auto-start-reverse"><path d="M0 0 L10 5 L0 10 z" fill="{colour}"/></marker></defs>')
        ends = (' marker-start="url(#a)"' if arrows[0] else "") + (' marker-end="url(#a)"' if arrows[1] else "")
    svg = (f'<svg xmlns="http://www.w3.org/2000/svg" width="{_f(vw)}" height="{_f(vh)}" viewBox="0 0 {_f(vw)} {_f(vh)}">'
           f'{marker}<g transform="{" ".join(t)}"><path d="{d}" {style_of(sp, fill, stroke, stroke_w)}{ends}/></g></svg>')
    return svg, (ox, oy, vw, vh)


def connector_extent(prst, w, h, sp):
    """A connector's bounds in its box's units (its bend can leave the box)."""
    if prst and (prst.startswith("curvedConnector") or prst.startswith("bentConnector")):
        x2 = w * adjust(sp, "adj1", 50000) / 100000
        return (min(0.0, x2), 0.0, max(w, x2), h)
    return (0.0, 0.0, w, h)


def rotated_endpoints(sp, p0, p1):
    """A straight line's ends turned with the shape (python-pptx gives them unturned)."""
    rot = transform_of(sp)[0]
    if not rot:
        return p0, p1
    cx, cy = (p0[0] + p1[0]) / 2, (p0[1] + p1[1]) / 2
    a = math.radians(rot)

    def turn(p):
        dx, dy = p[0] - cx, p[1] - cy
        return cx + dx * math.cos(a) - dy * math.sin(a), cy + dx * math.sin(a) + dy * math.cos(a)
    return turn(p0), turn(p1)


def preset_of(sp):
    g = sp.find(f".//{A}prstGeom")
    return g.get("prst") if g is not None else ""


def is_plain_line(sp):
    """A straight line (an editable line element); curved / elbow connectors are drawn as pictures."""
    return not re.search(r"curved|bent", preset_of(sp))
