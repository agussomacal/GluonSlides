"""Pictures of equations in an imported talk turned back into LaTeX.

PowerPoint (equations pasted as pictures) and PDF imports (equations kept
as pictures of their region, pdf.py's figures/pdf-math-*.png) bring
equations as images. With the optional component (extras.py, latex_ocr.py)
each picture that looks like a formula is read; when the model is sure
enough, the picture is replaced by an editable text box `$\\displaystyle …$`
of about the same size, named "Recognised equation" so it is easy to find
and check. The picture stays in figures/. Colours inside the equation are
not read (a single ink colour is kept).
"""

import os
import re

SURE_ENOUGH = -0.06      # mean log-probability per token (0: certain); below, the picture stays
NAME = "Recognised equation"


def _ink(img):
    """(ink box (x0, y0, x1, y1) in pixels, ink colour '#rrggbb', share of ink) of a picture on white."""
    from PIL import Image
    im = img.convert("RGBA")
    white = Image.new("RGBA", im.size, (255, 255, 255, 255))
    flat = Image.alpha_composite(white, im).convert("RGB")
    grey = flat.convert("L")
    mask = grey.point(lambda v: 255 if v < 200 else 0)
    box = mask.getbbox()
    if not box:
        return None, None, 0.0
    hist = mask.histogram()
    share = hist[255] / (im.width * im.height)
    # the ink's colour: from its solid pixels (not the soft edges); black unless clearly coloured
    rgb, lum = flat.tobytes(), grey.tobytes()
    solid = [(rgb[3 * i], rgb[3 * i + 1], rgb[3 * i + 2]) for i, g in enumerate(lum) if g < 110]
    colour = "#000000"
    if solid:
        r, g, b = (sum(c[i] for c in solid) / len(solid) for i in range(3))
        if max(r, g, b) - min(r, g, b) > 60:
            colour = "#%02x%02x%02x" % (round(r), round(g), round(b))
    return box, colour, share


def looks_like_equation(img, box_h, slide_h):
    """A picture that may be a formula: light background, a little thin ink, few colours, not tall."""
    if img.width < 12 or img.height < 8 or box_h > 0.35 * slide_h:
        return False
    box, _colour, share = _ink(img)
    if not box or not (0.002 < share < 0.3):
        return False
    rgb = img.convert("RGB").resize((min(img.width, 160), min(img.height, 60)))
    raw = rgb.tobytes()
    colours = {raw[i:i + 3] for i in range(0, len(raw), 3)}
    return len(colours) < 600 and img.width / img.height > 0.8


def single_symbol(latex):
    """One letter or symbol (a label like M): too little for the model to be trusted."""
    core = re.sub(r"\\(mathcal|mathbb|mathbf|mathrm|boldsymbol|mathit|mathscr|operatorname)\s*", "", latex)
    core = re.sub(r"[{}\s]", "", core)
    return len(core) <= 2 or bool(re.fullmatch(r"\\[A-Za-z]+", core))


def recognise_equations(result, folder, reader, report=None):
    """Replaces pictures of equations in `result`'s slides; returns how many."""
    from PIL import Image
    slide_h = result.get("height") or 1080
    todo = []
    for s in (result.get("slides") or []) + (result.get("masters") or []):
        for el in s.get("elements") or []:
            path = el.get("filePath") or ""
            if el.get("type") != "figure" or not re.search(r"\.(png|jpe?g|gif|webp|bmp)$", path, re.I):
                continue
            full = os.path.join(folder, path)
            if not os.path.isfile(full):
                continue
            try:
                with Image.open(full) as im:
                    im.load()
                    pdf_math = "pdf-math" in os.path.basename(path)
                    if pdf_math or looks_like_equation(im, el.get("height", 0), slide_h):
                        todo.append((s, el, im.copy()))
            except Exception:
                continue
    done = 0
    for n, (s, el, im) in enumerate(todo):
        if report:
            report(n, len(todo))
        try:
            latex, sure = reader.read(im)
        except Exception:
            continue
        if not latex or sure < SURE_ENOUGH or single_symbol(latex):
            continue
        text = equation_element(el, im, latex)
        s["elements"][s["elements"].index(el)] = text
        done += 1
    return done


def equation_element(el, im, latex):
    """The text element `$\\displaystyle latex$` replacing the figure `el` (picture `im`):
    same place, its ink's colour, a font size from the ink's height."""
    box, colour, _share = _ink(im)
    ky = el["height"] / im.height
    ink_h = ((box[3] - box[1]) * ky) if box else el["height"] * 0.6
    tall = re.search(r"\\(frac|dfrac|sum|prod|int|oint|begin|underbrace|overbrace|binom|sqrt)|_\{[^}]*\}\^|\\limits|\\operatorname\*", latex)
    size = max(8, round(ink_h / (2.4 if tall else 1.35)))
    text = {"type": "text", "x": el["x"], "y": el["y"], "width": el["width"], "height": el["height"],
            "content": f"$\\displaystyle {latex}$", "fontSize": size, "fontColor": colour or "#000000",
            "textAlign": "center", "verticalAlign": "center", "bg": "transparent", "borderCol": "transparent",
            "borderWidth": 0, "borderStyle": "solid", "name": NAME}
    for key in ("step", "until", "rotate", "id"):
        if key in el:
            text[key] = el[key]
    return text


def read_figure(folder, el, reader):
    """One figure read on request (right-click "Convert to LaTeX"): {"success",
    "element", "sure"} whatever the model's confidence (the page warns when
    it is low), or why not."""
    from PIL import Image
    path = el.get("filePath") or ""
    full = path if os.path.isabs(path) else os.path.join(folder or "", path)
    if not re.search(r"\.(png|jpe?g|gif|webp|bmp)$", path, re.I) or not os.path.isfile(full):
        return {"success": False, "error": "Only pictures (PNG, JPEG, …) in the project can be read."}
    try:
        with Image.open(full) as im:
            im.load()
            im = im.copy()
    except Exception as e:
        return {"success": False, "error": f"Could not open the picture: {e}"}
    try:
        latex, sure = reader.read(im)
    except Exception as e:
        return {"success": False, "error": f"Could not read the picture: {type(e).__name__}: {e}"}
    if not latex:
        return {"success": False, "error": "No equation could be read in this picture."}
    return {"success": True, "element": equation_element(el, im, latex), "sure": sure,
            "unsure": sure < SURE_ENOUGH}
