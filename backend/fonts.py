"""Fonts for the font picker: a project's own font files and fonts
installed on this computer.

Faces are returned with a data URI so the page can register them with
@font-face (project folders are outside the app's web root) and embed
them in exports.
"""

import base64
import os
import re
import shutil
import subprocess

from PIL import ImageFont

try:
    from fontTools.ttLib import TTFont
except ImportError:  # licence details are then reported as unknown
    TTFont = None

FONT_TYPES = {".ttf": "font/ttf", ".otf": "font/otf", ".woff": "font/woff", ".woff2": "font/woff2"}
FONT_DIR = "fonts"
MAX_SYSTEM_FACES = 4  # regular, italic, bold, bold italic
WIDTH_WORDS = re.compile(r"condensed|narrow|compressed|expanded|extended", re.I)


def _weight_style(style_name):
    """CSS (weight, style) from a style name such as 'Bold Italic'."""
    s = (style_name or "").lower().replace("-", " ")
    style = "italic" if ("italic" in s or "oblique" in s) else "normal"
    weight = 400
    for words, w in (
        (("thin", "hairline"), 100), (("extralight", "extra light", "ultralight"), 200),
        (("light",), 300), (("medium",), 500), (("semibold", "semi bold", "demibold"), 600),
        (("extrabold", "extra bold", "ultrabold"), 800), (("black", "heavy"), 900), (("bold",), 700),
    ):
        if any(word in s for word in words):
            weight = w
            break
    return weight, style


def _names_from_filename(path):
    """Fallback (family, style) from a file name like 'MyFont-BoldItalic.woff2'."""
    stem = os.path.splitext(os.path.basename(path))[0]
    family, _, style = stem.partition("-")
    family = re.sub(r"(?<=[a-z])(?=[A-Z])", " ", family.replace("_", " ")).strip()
    style = re.sub(r"(?<=[a-z])(?=[A-Z])", " ", style)
    return family or stem, style or "Regular"


def _font_names(path):
    """(family, style) read from the font file, or guessed from its name."""
    try:
        family, style = ImageFont.truetype(path, 12).getname()
        if family:
            return family, style or "Regular"
    except Exception:
        pass
    return _names_from_filename(path)


OPEN_LICENSE_RE = re.compile(
    r"open font licen[cs]e|\bOFL\b|openfontlicense|apache licen[cs]e|ubuntu font licen[cs]e|"
    r"bitstream vera|public domain|\bGNU\b|\bGPL\b|\bMIT\b|creative commons|\bCC0\b|"
    r"dejavu.sourceforge.net|scripts.sil.org/OFL",
    re.I,
)


def font_license(path):
    """Licence details read from a font file:
    { name, url, open, embeddable, embedding }.

    `embedding` comes from the OS/2 fsType flags: 'installable' or
    'editable' / 'print' allow embedding; 'restricted' forbids it.
    `open` is a best guess from the licence text (OFL, Apache, ...).
    """
    info = {"name": "", "url": "", "open": False, "embeddable": True, "embedding": "unknown"}
    if TTFont is None:
        return info
    try:
        font = TTFont(path, lazy=True, fontNumber=0)
        names = font["name"]
        text = (names.getDebugName(13) or names.getDebugName(0) or "").strip()
        info["name"] = re.sub(r"\s+", " ", text)[:300]
        info["url"] = (names.getDebugName(14) or "").strip()
        info["open"] = bool(OPEN_LICENSE_RE.search(f"{text} {info['url']}"))
        if "OS/2" in font:
            fs_type = font["OS/2"].fsType
            if fs_type & 0x0008:
                info["embedding"] = "editable"
            elif fs_type & 0x0004:
                info["embedding"] = "print"
            elif fs_type & 0x0002:
                info["embedding"] = "restricted"
                info["embeddable"] = False
            else:
                info["embedding"] = "installable"
        font.close()
    except Exception:
        pass
    return info


def _data_uri(path):
    mime = FONT_TYPES.get(os.path.splitext(path)[1].lower(), "font/ttf")
    with open(path, "rb") as f:
        return f"data:{mime};base64,{base64.b64encode(f.read()).decode('ascii')}"


def _face(path, family=None, style_name=None):
    if family is None:
        family, style_name = _font_names(path)
    weight, style = _weight_style(style_name)
    return {
        "family": family, "weight": weight, "style": style,
        "file": os.path.basename(path), "data_uri": _data_uri(path),
        "license": font_license(path),
    }


# ---------- project fonts ----------

def list_project_fonts(project_folder):
    """Every font file in <project>/fonts/ as a face with a data URI."""
    try:
        folder = os.path.join(project_folder or "", FONT_DIR)
        if not project_folder or not os.path.isdir(folder):
            return {"success": True, "fonts": []}
        faces = [
            _face(os.path.join(folder, name))
            for name in sorted(os.listdir(folder))
            if os.path.splitext(name)[1].lower() in FONT_TYPES
        ]
        return {"success": True, "fonts": faces}
    except Exception as e:
        return {"success": False, "error": str(e), "fonts": []}


def import_font_files(project_folder, paths):
    """Copy font files into <project>/fonts/, then list the project fonts."""
    try:
        if not project_folder or not os.path.isdir(project_folder):
            return {"success": False, "error": "No project folder set."}
        dest_dir = os.path.join(project_folder, FONT_DIR)
        os.makedirs(dest_dir, exist_ok=True)
        for src in paths or []:
            if os.path.splitext(src)[1].lower() not in FONT_TYPES:
                continue
            dest = os.path.join(dest_dir, os.path.basename(src))
            if os.path.abspath(dest) != os.path.abspath(src):
                shutil.copy2(src, dest)
        return list_project_fonts(project_folder)
    except Exception as e:
        return {"success": False, "error": str(e)}


# ---------- fonts installed on this computer ----------

def _system_font_dirs():
    if os.name == "nt":
        return [os.path.join(os.environ.get("WINDIR", r"C:\Windows"), "Fonts"),
                os.path.join(os.environ.get("LOCALAPPDATA", ""), "Microsoft", "Windows", "Fonts")]
    if os.uname().sysname == "Darwin":
        return ["/System/Library/Fonts", "/Library/Fonts", os.path.expanduser("~/Library/Fonts")]
    return ["/usr/share/fonts", "/usr/local/share/fonts", os.path.expanduser("~/.local/share/fonts"),
            os.path.expanduser("~/.fonts")]


def _scan_system_fonts():
    """(family, style, path) for font files in the usual folders (no fontconfig)."""
    found = []
    for root_dir in _system_font_dirs():
        for root, _dirs, files in os.walk(root_dir):
            for name in files:
                if os.path.splitext(name)[1].lower() in FONT_TYPES:
                    path = os.path.join(root, name)
                    family, style = _font_names(path)
                    found.append((family, style, path))
    return found


def _fc_list(*args):
    """Run fc-list (fontconfig) if available; None when it is not installed."""
    if not shutil.which("fc-list"):
        return None
    try:
        out = subprocess.run(["fc-list", *args], capture_output=True, text=True, timeout=20)
        return out.stdout.splitlines()
    except Exception:
        return None


def list_system_fonts():
    """Font family names installed on this computer, sorted."""
    try:
        lines = _fc_list(":", "family")
        if lines is not None:
            families = {line.split(",")[0].strip() for line in lines if line.strip()}
        else:
            families = {family for family, _style, _path in _scan_system_fonts()}
        families = sorted((f for f in families if f and not f.startswith(".")), key=str.lower)
        return {"success": True, "families": families}
    except Exception as e:
        return {"success": False, "error": str(e), "families": []}


def _system_font_candidates(family):
    """(style, path) of an installed family's files, best first."""
    candidates = []
    lines = _fc_list("-f", "%{file}|%{family}|%{style[0]}\n", f":family={family}")
    if lines is not None:
        for line in lines:
            parts = line.split("|")
            if len(parts) == 3:
                candidates.append((parts[2] or "Regular", parts[0].strip(), parts[1].count(",")))
        # Normal-width faces first: "DejaVu Sans" also matches its
        # Condensed files (style "Condensed Bold", extra family name).
        candidates.sort(key=lambda c: (bool(WIDTH_WORDS.search(c[0])), c[2]))
        return [(style, path) for style, path, _n in candidates]
    return [(style, path) for fam, style, path in _scan_system_fonts() if fam == family]


def system_font_license(family):
    """Licence details of an installed family (from its regular file)."""
    try:
        for _style, path in _system_font_candidates(family):
            if os.path.isfile(path):
                return {"success": True, "license": font_license(path), "file": path}
        return {"success": False, "error": f"Font not found: {family}"}
    except Exception as e:
        return {"success": False, "error": str(e)}


def system_font_faces(family):
    """Regular / italic / bold / bold italic faces of an installed family,
    with data URIs, so exports can embed the font."""
    try:
        candidates = _system_font_candidates(family)

        faces, seen = [], set()
        for style_name, path in candidates:
            weight, style = _weight_style(style_name)
            key = ("bold" if weight >= 600 else "regular", style)
            if weight not in (400, 700) or key in seen or not os.path.isfile(path):
                continue
            seen.add(key)
            faces.append(_face(path, family, style_name))
            if len(faces) >= MAX_SYSTEM_FACES:
                break
        return {"success": True, "fonts": faces}
    except Exception as e:
        return {"success": False, "error": str(e), "fonts": []}
