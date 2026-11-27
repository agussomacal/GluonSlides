"""Beamer (.tex, or a .zip of a LaTeX project as Overleaf exports) -> slides.

What becomes what:
  \\frame / frame environment       a slide (frame title on top)
  \\section{...}                    the slides' section (+ a section slide when
                                    the preamble has \\AtBeginSection)
  \\titlepage / \\maketitle          title, author, institute, date
  text, \\textbf, \\emph, colours    a text box (Markdown + KaTeX)
  $...$  \\[...\\]  align*  ...      math (align* -> aligned, KaTeX)
  itemize / enumerate              Markdown lists (one box per item with overlays)
  columns                          side by side
  \\includegraphics                 a figure (copied into figures/)
  tabular                          a Markdown table
  tcolorbox, block, custom boxes   a framed box around their content
  \\pause, <2->, \\only, \\onslide     build steps (later versions cover earlier ones)
  \\tableofcontents, bibliography   the app's own fields
  macros (\\newcommand ...)         macros.tex, for the math
LaTeX's own layout isn't available: blocks are stacked with estimated
heights and a frame that is too full is scaled down. It is a draft to tidy.
"""

import os
import re
import shutil

from . import model
from .model import Colours, length_pt

# ---------- reading the source ----------


def strip_comments(text):
    out = []
    for line in text.split("\n"):
        m = re.search(r"(?<!\\)%", line)
        out.append(line[:m.start()] if m else line)
    return "\n".join(out)


def load_tex(path, seen=None):
    """The file with \\input/\\include expanded (relative to its folder)."""
    seen = seen if seen is not None else set()
    real = os.path.realpath(path)
    if real in seen:
        return ""
    seen.add(real)
    with open(path, encoding="utf-8", errors="replace") as f:
        text = strip_comments(f.read())
    base = os.path.dirname(path)

    def include(m):
        name = m.group(2).strip()
        for cand in (name, name + ".tex"):
            p = os.path.join(base, cand)
            if os.path.isfile(p):
                return load_tex(p, seen)
        return ""

    return re.sub(r"\\(input|include)\s*\{([^}]*)\}", include, text)


def find_main_tex(folder):
    """The main .tex of a project folder: the one with \\documentclass{beamer}."""
    cands = []
    for root, _dirs, files in os.walk(folder):
        for f in files:
            if f.lower().endswith(".tex"):
                p = os.path.join(root, f)
                try:
                    with open(p, encoding="utf-8", errors="replace") as fh:
                        head = fh.read()
                except OSError:
                    continue
                if "\\documentclass" in head and "\\begin{document}" in head:
                    score = (("beamer" in head.split("\\begin{document}")[0]) * 2
                             + (f.lower() in ("main.tex", "presentation.tex", "slides.tex", "talk.tex"))
                             + head.count("\\begin{frame}") / 1000)
                    cands.append((score, p))
    if not cands:
        return None
    cands.sort(key=lambda c: (-c[0], len(c[1])))
    return cands[0][1]


# ---------- scanning ----------


def read_group(s, i, open_ch="{", close_ch="}"):
    """s[i] == open_ch: (content, index after the closing char)."""
    depth, j = 0, i
    while j < len(s):
        c = s[j]
        if c == "\\":
            j += 2
            continue
        if c == open_ch:
            depth += 1
        elif c == close_ch:
            depth -= 1
            if depth == 0:
                return s[i + 1:j], j + 1
        j += 1
    return s[i + 1:], len(s)


def skip_ws(s, i):
    while i < len(s) and s[i] in " \t\n":
        i += 1
    return i


def read_args(s, i, n, allow_opt=True):
    """After a command: optional <ov> / [opt] (any order), then n {args}.
    Returns (overlay, option, [args], index)."""
    overlay = option = None
    while True:
        k = skip_ws(s, i)
        if k < len(s) and s[k] == "<" and allow_opt:
            end = s.find(">", k)
            if end < 0:
                break
            overlay, i = s[k + 1:end], end + 1
        elif k < len(s) and s[k] == "[" and allow_opt:
            option, i = read_group(s, k, "[", "]")
        else:
            break
    args = []
    for _ in range(n):
        k = skip_ws(s, i)
        if k < len(s) and s[k] == "{":
            a, i = read_group(s, k)
            args.append(a)
        elif k < len(s) and s[k] == "\\":
            m = re.match(r"\\[A-Za-z@]+", s[k:])
            args.append(m.group(0) if m else s[k:k + 2])
            i = k + len(args[-1])
        elif k < len(s):
            args.append(s[k])
            i = k + 1
        else:
            args.append("")
    return overlay, option, args, i


def command_args(text, name, n):
    """All occurrences of \\name{..}{..} (n args)."""
    out = []
    for m in re.finditer(r"\\" + name + r"(?![A-Za-z])", text):
        out.append(read_args(text, m.end(), n)[1:3])
    return out


def find_env_end(s, i, name):
    """Index of the matching \\end{name} (nesting aware) and the index after it."""
    depth = 1
    pat = re.compile(r"\\(begin|end)\s*\{" + re.escape(name) + r"\}")
    for m in pat.finditer(s, i):
        depth += 1 if m.group(1) == "begin" else -1
        if depth == 0:
            return m.start(), m.end()
    return len(s), len(s)


def overlay_start(spec, counter):
    """'<2->' '3' '1-2' '+-' -> (first step, last step or None)."""
    spec = (spec or "").strip()
    if not spec:
        return None
    spec = spec.split(",")[0].split("|")[0].strip()
    if spec.startswith("+"):
        return counter, None
    m = re.match(r"^(\d*)\s*(-?)\s*(\d*)$", spec)
    if not m:
        return 1, None
    a, dash, b = m.groups()
    first = int(a) if a else 1
    last = None if dash and not b else (int(b) if b else (first if not dash else None))
    return first, last


# ---------- the document ----------

FONTS = {"inter": "Inter", "roboto": "Roboto", "lato": "Lato", "opensans": "Open Sans", "sourcesanspro": "Source Sans 3",
         "sourcesans": "Source Sans 3", "montserrat": "Montserrat", "merriweather": "Merriweather",
         "sourceserifpro": "Source Serif 4", "ebgaramond": "EB Garamond", "playfair": "Playfair Display",
         "firamono": "Fira Code", "jetbrainsmono": "JetBrains Mono"}

THEMES = {  # (title bar fg, title bar bg, title box fg, title box bg)
    "default": ("#3333b3", None, "#3333b3", None),
    "madrid": ("#ffffff", "#3333b3", "#ffffff", "#3333b3"),
    "beaver": ("#8b0000", "#e5e5e5", "#ffffff", "#8b0000"),
}


class Doc:
    def __init__(self, main_path, warnings):
        self.dir = os.path.dirname(main_path)
        self.src = load_tex(main_path)
        self.warnings = warnings
        pre, _, rest = self.src.partition("\\begin{document}")
        self.pre, self.body = pre, rest.split("\\end{document}")[0]
        self.colours = Colours()
        for name, model_, spec in re.findall(r"\\definecolor\s*\{([^}]*)\}\s*\{([^}]*)\}\s*\{([^}]*)\}", self.src):
            self.colours.define(name.strip(), model_.strip(), spec)
        for name, expr in re.findall(r"\\colorlet\s*\{([^}]*)\}\s*\{([^}]*)\}", self.src):
            self.colours.let(name.strip(), expr)
        dc = re.search(r"\\documentclass\s*(?:\[([^\]]*)\])?\s*\{([^}]*)\}", self.pre)
        opts = (dc.group(1) or "") if dc else ""
        m = re.search(r"(\d+)pt", opts)
        self.font_pt = float(m.group(1)) if m else 11.0
        m = re.search(r"aspectratio\s*=\s*(\d+)", opts)
        ratio = m.group(1) if m else "43"
        paper = {"169": (160, 90), "1610": (160, 100), "149": (140, 90), "54": (125, 100), "32": (135, 90), "43": (128, 96)}
        self.paper_mm = paper.get(ratio, (128, 96))
        self.width, self.height = (1920, 1080) if ratio == "169" else (1280, 960) if ratio == "43" else (round(1080 * self.paper_mm[0] / self.paper_mm[1]), 1080)
        self.px_per_pt = self.width / (self.paper_mm[0] * 2.845)
        # theme colours
        theme = (re.search(r"\\usetheme\s*\{([^}]*)\}", self.pre) or [None, "default"])[1].strip().lower()
        ctheme = (re.search(r"\\usecolortheme\s*\{([^}]*)\}", self.pre) or [None, ""])[1].strip().lower()
        base = THEMES.get(ctheme) or THEMES.get(theme) or THEMES["default"]
        self.ft_fg, self.ft_bg, self.title_fg, self.title_bg = base
        self.madrid_footline = theme in ("madrid", "berlin", "copenhagen", "warsaw", "antibes", "boadilla", "infolines")
        for which, spec in re.findall(r"\\setbeamercolor\s*\{([^}]*)\}\s*\{([^}]*)\}", self.pre):
            fg = re.search(r"fg\s*=\s*([^,}]+)", spec)
            bg = re.search(r"bg\s*=\s*([^,}]+)", spec)
            fg = self.colours.resolve(fg.group(1)) if fg else None
            bg = self.colours.resolve(bg.group(1)) if bg else None
            which = which.strip()
            if which == "frametitle":
                self.ft_fg, self.ft_bg = fg or self.ft_fg, bg or self.ft_bg
            elif which == "title":
                self.title_fg, self.title_bg = fg or self.title_fg, bg or self.title_bg
        self.ft_center = bool(re.search(r"\\setbeamertemplate\s*\{frametitle\}\s*\[default\]\s*\[center\]", self.pre))
        # footline: a page number?
        foot = re.search(r"\\setbeamertemplate\s*\{footline\}", self.pre)
        self.footer = None
        if foot:
            last = [m for m in re.finditer(r"\\setbeamertemplate\s*\{footline\}", self.pre)][-1]
            _, _, args, _ = read_args(self.pre, last.end(), 1)
            ft = args[0] if args else ""
            if "\\insertframenumber" in ft:
                self.footer = "\\slidenumber / \\totalslides" if "\\inserttotalframenumber" in ft else "\\slidenumber"
            self.madrid_footline = False
        # fonts
        self.font = None
        for pkg in re.findall(r"\\usepackage\s*(?:\[[^\]]*\])?\s*\{([^}]*)\}", self.pre):
            for p in pkg.split(","):
                if p.strip().lower() in FONTS:
                    self.font = FONTS[p.strip().lower()]
        # metadata
        self.meta = {k: self._meta(k) for k in ("title", "subtitle", "author", "institute", "date")}
        # section slides
        abs_ = re.search(r"\\AtBeginSection\s*(?:\[[^\]]*\])?\s*\{", self.pre)
        self.section_slides = False
        self.section_bg = None
        if abs_:
            body, _ = read_group(self.pre, abs_.end() - 1)
            if "\\insertsectionhead" in body or "\\tableofcontents" in body:
                self.section_slides = True
                m = re.search(r"\\setbeamercolor\s*\{background canvas\}\s*\{[^}]*bg\s*=\s*([^,}]+)", body)
                self.section_bg = self.colours.resolve(m.group(1)) if m else None

    def _meta(self, key):
        m = re.search(r"\\" + key + r"(?![A-Za-z])", self.pre)
        if not m:
            return ""
        _, _, args, _ = read_args(self.pre, m.end(), 1)
        return args[0] if args else ""

    def pt(self, v):
        return v * self.px_per_pt


# ---------- macros (for KaTeX) ----------

SKIP_IN_MACROS = ("\\begingroup", "\\colorlet", "\\tcb", "\\setbeamer", "\\usebeamer", "@", "\\par", "\\vspace", "\\hspace", "\\includegraphics")


def collect_macros(doc):
    """\\newcommand / \\def / \\DeclareMathOperator of the document, one per line,
    colours resolved (KaTeX knows hex colours, not \\definecolor names)."""
    out = []
    src = doc.src.split("\\begin{document}")[0]
    for m in re.finditer(r"\\(newcommand|renewcommand|providecommand)\*?\s*", src):
        i = m.end()
        k = skip_ws(src, i)
        if k < len(src) and src[k] == "{":
            name, i = read_group(src, k)
        else:
            nm = re.match(r"\\[A-Za-z]+", src[k:])
            if not nm:
                continue
            name, i = nm.group(0), k + len(nm.group(0))
        name = name.strip()
        nargs = None
        k = skip_ws(src, i)
        if k < len(src) and src[k] == "[":
            n, i = read_group(src, k, "[", "]")
            nargs = n.strip()
            k = skip_ws(src, i)
            if k < len(src) and src[k] == "[":  # default for the optional argument: not in KaTeX
                _, i = read_group(src, k, "[", "]")
                k = skip_ws(src, i)
        if k >= len(src) or src[k] != "{":
            continue
        body, _ = read_group(src, k)
        if not re.match(r"^\\[A-Za-z]+$", name) or any(t in body for t in SKIP_IN_MACROS):
            continue
        body = re.sub(r"\\ensuremath\s*\{", "{", body)
        body = fix_colours(" ".join(body.split()), doc.colours)
        out.append(f"\\newcommand{{{name}}}" + (f"[{nargs}]" if nargs else "") + "{" + body + "}")
    for star, name, body in re.findall(r"\\DeclareMathOperator(\*?)\s*\{(\\[A-Za-z]+)\}\s*\{([^}]*)\}", src):
        op = "\\operatorname*" if star else "\\operatorname"
        out.append(f"\\newcommand{{{name}}}{{{op}{{{body}}}}}")
    # \colorboxed{colour}{formula} (a common helper): a framed formula
    if "\\colorboxed" in doc.src:
        out.append("\\newcommand{\\colorboxed}[2]{\\fcolorbox{#1}{transparent}{$\\displaystyle #2$}}")
    return "\n".join(out) + ("\n" if out else "")


COLOUR_CMDS = ("color", "textcolor", "colorbox", "colorboxed", "fcolorbox", "cellcolor", "rowcolor")


def fix_colours(tex, colours):
    """Colour names in \\color{..} etc. -> #rrggbb."""
    def repl(m):
        cmd, model_, name = m.group(1), m.group(2), m.group(3)
        if model_:
            return m.group(0)
        hexv = colours.resolve(name)
        return f"\\{cmd}{{{hexv}}}" if hexv else m.group(0)
    return re.sub(r"\\(" + "|".join(COLOUR_CMDS) + r")\s*(\[[^\]]*\])?\s*\{([^{}]*)\}", repl, tex)


# ---------- frame content -> blocks ----------

MATH_ENVS = {"equation": "", "equation*": "", "align": "aligned", "align*": "aligned", "aligned": "aligned",
             "gather": "gathered", "gather*": "gathered", "multline": "gathered", "multline*": "gathered",
             "eqnarray": "aligned", "eqnarray*": "aligned", "displaymath": "", "flalign": "aligned", "flalign*": "aligned",
             "alignat": "aligned", "alignat*": "aligned"}
BOX_ENVS = ("tcolorbox", "block", "alertblock", "exampleblock", "beamercolorbox", "framed", "mdframed")
CENTER_ENVS = ("center", "figure", "table", "flushright", "flushleft", "minipage", "column")
TEXT_CMDS = {"textbf": ("**", "**"), "textit": ("*", "*"), "emph": ("*", "*"), "textsl": ("*", "*"),
             "underline": ("<u>", "</u>"), "texttt": ("`", "`"), "textsc": ("", ""), "textrm": ("", ""),
             "textsf": ("", ""), "mbox": ("", ""), "text": ("", ""), "structure": ("**", "**")}
DROP_CMDS = ("vspace", "hspace", "vskip", "hskip", "label", "setlength", "addtolength", "usebackgroundtemplate",
             "setbeamercolor", "setbeamertemplate", "setbeamerfont", "usebeamerfont", "usebeamercolor",
             "phantomsection", "nocite", "bibliographystyle", "framesubtitle")
NOARG_TEXT = {"ldots": "…", "dots": "…", "LaTeX": "LaTeX", "TeX": "TeX", "today": "", "par": "\n\n",
              "newline": "\n", "linebreak": "\n", "quad": " ", "qquad": "  ", "hfill": " ", "vfill": "",
              "centering": "", "raggedright": "", "raggedleft": "", "noindent": "", "medskip": "", "bigskip": "",
              "smallskip": "", "item": "", "pause": "", "footnotesize": "", "small": "", "large": "", "Large": "",
              "LARGE": "", "huge": "", "Huge": "", "normalsize": "", "scriptsize": "", "tiny": "", "bfseries": "",
              "itshape": "", "rmfamily": "", "sffamily": "", "ttfamily": "", "maketitle": "", "titlepage": "",
              "S": "§", "copyright": "©", "textbackslash": "\\", "&": "&", "%": "%", "_": "_", "#": "#", "{": "{",
              "}": "}", "$": "\\$", " ": " ", ",": " ", ";": " ", "!": "", "and": ", ", "And": ", "}


class Ctx:
    def __init__(self, doc, step=1, align="left"):
        self.doc, self.step, self.align = doc, step, align
        self.notes = []
        self.counter = 1
        self.max_step = 1
        self.bounded = False  # content that disappears later (\only<1>)


def new_text(md, ctx, step=None, size=1.0, align=None, **kw):
    return {"kind": "text", "md": md, "step": step or ctx.step, "align": align or ctx.align, "size": size, **kw}


def latex_to_md(s, ctx):
    """Inline LaTeX (text with $math$) -> Markdown with $math$ kept."""
    out, i = [], 0
    doc = ctx.doc
    while i < len(s):
        c = s[i]
        if c == "$":
            if s.startswith("$$", i):
                end = s.find("$$", i + 2)
                end = len(s) if end < 0 else end
                out.append("$$" + fix_math(s[i + 2:end], doc) + "$$")
                i = end + 2
            else:
                end = i + 1
                while end < len(s) and not (s[end] == "$" and s[end - 1] != "\\"):
                    end += 1
                out.append("$" + fix_math(s[i + 1:end], doc) + "$")
                i = end + 1
            continue
        if s.startswith("\\(", i):
            end = s.find("\\)", i)
            end = len(s) if end < 0 else end
            out.append("$" + fix_math(s[i + 2:end], doc) + "$")
            i = end + 2
            continue
        if c == "\\":
            if s.startswith("\\\\", i):
                out.append("\n")
                i += 2
                if i < len(s) and s[i] == "[":
                    _, i = read_group(s, i, "[", "]")
                continue
            m = re.match(r"\\([A-Za-z@]+\*?|.)", s[i:])
            name = m.group(1)
            j = i + len(m.group(0))
            if name.rstrip("*") in TEXT_CMDS:
                _, _, args, j = read_args(s, j, 1)
                a, b = TEXT_CMDS[name.rstrip("*")]
                inner = latex_to_md(args[0], ctx).strip()
                out.append(f"{a}{inner}{b}" if inner else "")
                i = j
            elif name in ("textcolor", "alert"):
                n = 2 if name == "textcolor" else 1
                _, _, args, j = read_args(s, j, n)
                colour = doc.colours.resolve(args[0]) if name == "textcolor" else "#cc0000"
                inner = latex_to_md(args[-1], ctx)
                out.append(model.coloured(inner, colour) if colour else inner)
                i = j
            elif name == "color":
                _, _, args, j = read_args(s, j, 1)
                colour = doc.colours.resolve(args[0])
                rest = latex_to_md(s[j:], ctx)
                out.append(model.coloured(rest, colour) if colour and rest.strip() else rest)
                i = len(s)
            elif name in ("cite", "citep", "citet", "parencite", "textcite", "fullcite"):
                _, opt, args, j = read_args(s, j, 1)
                out.append(f"\\{name}" + (f"[{opt}]" if opt else "") + "{" + args[0] + "}")
                i = j
            elif name in ("url",):
                _, _, args, j = read_args(s, j, 1)
                out.append(f"<{args[0]}>")
                i = j
            elif name == "href":
                _, _, args, j = read_args(s, j, 2)
                out.append(f"[{latex_to_md(args[1], ctx)}]({args[0]})")
                i = j
            elif name == "footnote":
                _, _, args, j = read_args(s, j, 1)
                ctx.notes.append(latex_to_md(args[0], ctx))
                i = j
            elif name == "note":
                _, _, args, j = read_args(s, j, 1)
                ctx.notes.append(latex_to_md(args[0], ctx))
                i = j
            elif name in ("only", "onslide", "uncover", "visible", "alt", "temporal", "invisible"):
                # inline overlays inside text: keep the content (steps are per box)
                ov, _, args, j = read_args(s, j, 2 if name == "alt" else 1)
                if name != "invisible":
                    out.append(latex_to_md(args[0], ctx))
                i = j
            elif name in DROP_CMDS:
                _, _, _, j = read_args(s, j, 1)
                i = j
            elif name in ("rule",):
                _, _, _, j = read_args(s, j, 2)
                i = j
            elif name in NOARG_TEXT:
                out.append(NOARG_TEXT[name])
                i = j
            elif name in ("cancel", "sout"):
                _, _, args, j = read_args(s, j, 1)
                out.append(f"~~{latex_to_md(args[0], ctx)}~~")
                i = j
            else:
                # unknown command: keep its first argument's text, if any
                k = skip_ws(s, j)
                if k < len(s) and s[k] in "{[<":
                    _, _, args, j = read_args(s, j, 1)
                    out.append(latex_to_md(args[0], ctx))
                i = j
            continue
        if c == "{" :
            inner, i = read_group(s, i)
            out.append(latex_to_md(inner, ctx))
            continue
        if c == "}":
            i += 1
            continue
        if c == "~":
            out.append(" ")
            i += 1
            continue
        if s.startswith("---", i):
            out.append("—")
            i += 3
            continue
        if s.startswith("--", i):
            out.append("–")
            i += 2
            continue
        if s.startswith("``", i) or s.startswith("''", i):
            out.append("\u201c" if s[i] == "`" else "\u201d")
            i += 2
            continue
        if c in "*_#|[]`":
            out.append("\\" + c)
            i += 1
            continue
        out.append(c)
        i += 1
    text = "".join(out)
    text = re.sub(r"[ \t]+", " ", text)
    text = re.sub(r" *\n *", "\n", text)
    return re.sub(r" +,", ",", text)


def fix_math(tex, doc):
    tex = re.sub(r"\\(label|tag)\s*\{[^}]*\}", "", tex)
    tex = re.sub(r"\\(nonumber|notag)\b", "", tex)
    tex = re.sub(r"\\(only|onslide|uncover|visible)\s*<[^>]*>", "", tex)
    return fix_colours(tex, doc.colours).strip()


def math_rows(body):
    """Split an aligned body at top-level \\\\ (rows)."""
    rows, depth, start, i = [], 0, 0, 0
    while i < len(body):
        c = body[i]
        if c == "\\" and body.startswith("\\\\", i) and depth == 0:
            rows.append(body[start:i])
            i += 2
            if i < len(body) and body[i] == "[":
                _, i = read_group(body, i, "[", "]")
            start = i
            continue
        if c == "\\":
            i += 2
            continue
        if c == "{":
            depth += 1
        elif c == "}":
            depth -= 1
        i += 1
    rows.append(body[start:])
    return [r for r in rows if r.strip()]


def math_block(env_kind, body, ctx):
    """A display math block; rows wrapped in \\only<n>/\\onslide<n> become steps."""
    rows = math_rows(body) if env_kind else [body]
    row_steps, clean = [], []
    for r in rows:
        m = re.match(r"\s*\\(only|onslide|uncover|visible)\s*<([^>]*)>\s*\{", r)
        if m:
            inner, _ = read_group(r, m.end() - 1)
            first, last = overlay_start(m.group(2), ctx.counter) or (1, None)
            if last is not None:
                ctx.bounded = True
            row_steps.append(max(first, ctx.step))
            clean.append(inner)
        else:
            row_steps.append(ctx.step)
            clean.append(r)
    ctx.max_step = max([ctx.max_step] + row_steps)
    return {"kind": "math", "env": env_kind, "rows": [fix_math(r, ctx.doc) for r in clean],
            "row_steps": row_steps, "step": ctx.step, "align": "center"}


def parse_width(spec):
    """'0.5\\textwidth' / '0.45\\linewidth' / '6cm' -> fraction of the region (or pt)."""
    spec = (spec or "").strip()
    m = re.match(r"^([\d.]*)\s*\\(textwidth|linewidth|columnwidth|paperwidth|hsize)", spec)
    if m:
        return float(m.group(1) or 1), None
    if re.match(r"^-?[\d.]+\s*[a-z]+", spec):
        return None, length_pt(spec)
    return None, None


def convert(s, ctx):
    """Frame body -> blocks."""
    blocks, buf, i = [], [], 0

    def flush():
        text = "".join(buf)
        buf.clear()
        if text.strip():
            md = latex_to_md(text, ctx).strip()
            if md:
                blocks.append(new_text(md, ctx))

    while i < len(s):
        if s.startswith("$$", i) or s.startswith("\\[", i):
            flush()
            close = "$$" if s.startswith("$$", i) else "\\]"
            end = s.find(close, i + 2)
            end = len(s) if end < 0 else end
            body = s[i + 2:end]
            env = "aligned" if re.search(r"\\\\", body) and "&" in body and "\\begin" not in body else ""
            blocks.append(math_block(env if env else "", body, ctx) if not env else math_block("aligned", body, ctx))
            i = end + 2
            continue
        if s[i] != "\\":
            buf.append(s[i])
            i += 1
            continue
        m = re.match(r"\\([A-Za-z@]+\*?)", s[i:])
        if not m:
            buf.append(s[i:i + 2])
            i += 2
            continue
        name, j = m.group(1), i + len(m.group(0))
        if name == "begin":
            _, _, args, j = read_args(s, j, 1, allow_opt=False)
            env = args[0].strip()
            start = j
            end_body, after = find_env_end(s, j, env)
            body = s[start:end_body]
            flush()
            blocks.extend(convert_env(env, body, ctx))
            i = after
            continue
        if name == "pause":
            flush()
            ctx.step += 1
            ctx.max_step = max(ctx.max_step, ctx.step)
            i = j
            continue
        if name in ("only", "onslide", "uncover", "visible", "alt"):
            ov, _, args, j2 = read_args(s, j, 1)
            k = skip_ws(s, j)
            has_group = (k < len(s) and (s[k] == "{" or s[k] == "<"))
            span = overlay_start(ov, ctx.counter) if ov else None
            if name == "onslide" and not (k2 := skip_ws(s, j2 - len(args[0]) - 2 if args else j2)) and False:
                pass
            if name == "onslide" and ov and not re.match(r"\s*<[^>]*>\s*\{", s[j:]):
                # \onslide<3-> switch: the rest from step 3
                flush()
                end = s.find(">", j)
                if span:
                    ctx.step = max(ctx.step, span[0])
                    ctx.max_step = max(ctx.max_step, ctx.step)
                i = end + 1
                continue
            if not has_group:
                i = j
                continue
            flush()
            saved = ctx.step
            if span:
                first, last = span
                if last is not None and name == "only":
                    ctx.bounded = True
                ctx.step = max(saved, first)
                ctx.max_step = max(ctx.max_step, ctx.step)
            inner = convert(args[0], ctx)
            if span and name == "only" and span[1] is not None:
                # content shown only for some steps: one unit that a later version covers
                for b in inner:
                    b["cover"] = True
                blocks.append({"kind": "stack", "blocks": inner, "replaces": True, "step": ctx.step if not span else max(saved, span[0])})
            else:
                blocks.extend(inner)
            ctx.step = saved
            i = j2
            continue
        if name == "includegraphics":
            flush()
            ov, opt, args, j = read_args(s, j, 1)
            span = overlay_start(ov, ctx.counter) if ov else None
            blocks.append(image_block(args[0], opt, ctx, span))
            i = j
            continue
        if name in ("titlepage", "maketitle"):
            flush()
            blocks.append({"kind": "titlepage", "step": 1})
            i = j
            continue
        if name == "tableofcontents":
            flush()
            _, _, _, j = read_args(s, j, 0)
            blocks.append(new_text("\\tableofcontents", ctx))
            i = j
            continue
        if name in ("bibliography", "printbibliography"):
            flush()
            _, _, _, j = read_args(s, j, 1 if name == "bibliography" else 0)
            blocks.append(new_text("\\printbibliography", ctx, size=0.8))
            i = j
            continue
        if name == "rule":
            flush()
            _, _, args, j = read_args(s, j, 2)
            wf, wpt = parse_width(args[0])
            blocks.append({"kind": "rule", "frac": wf or 1.0, "colour": ctx.__dict__.get("colour", "#000000"), "step": ctx.step})
            i = j
            continue
        if name in ("vspace", "vspace*", "vskip"):
            flush()
            _, _, args, j = read_args(s, j, 1)
            gap = length_pt(args[0], ctx.doc.font_pt)
            if gap > 0:  # negative spacing would make blocks overlap here
                blocks.append({"kind": "space", "pt": gap})
            i = j
            continue
        if name in ("centering",):
            flush()
            ctx.align = "center"
            i = j
            continue
        if name == "color":
            _, _, args, j2 = read_args(s, j, 1)
            ctx.__dict__["colour"] = ctx.doc.colours.resolve(args[0]) or "#000000"
            buf.append(s[i:j2])
            i = j2
            continue
        if name == "item":
            buf.append(s[i:j])
            i = j
            continue
        if name in ("frametitle", "framesubtitle"):
            _, _, _, j = read_args(s, j, 1)
            i = j
            continue
        if name == "column":
            i = j  # handled by the columns environment
            continue
        buf.append(s[i:j])
        i = j
    flush()
    return blocks


def image_block(path, opt, ctx, span):
    opt = opt or ""
    w = re.search(r"width\s*=\s*([^,\]]+)", opt)
    h = re.search(r"height\s*=\s*([^,\]]+)", opt)
    scale = re.search(r"scale\s*=\s*([\d.]+)", opt)
    block = {"kind": "image", "src": path.strip(), "step": ctx.step, "align": ctx.align}
    if w:
        block["frac"], block["width_pt"] = parse_width(w.group(1))
    if h:
        hf, hpt = parse_width(h.group(1).replace("textheight", "textwidth"))
        block["hfrac"], block["height_pt"] = hf, hpt
    if scale:
        block["scale"] = float(scale.group(1))
    if span:
        first, last = span
        block["step"] = max(ctx.step, first)
        ctx.max_step = max(ctx.max_step, block["step"])
        if last is not None:
            ctx.bounded = True
        block["replaces"] = True
    return block


def convert_env(env, body, ctx):
    base = env.rstrip("*")
    if env in MATH_ENVS:
        if env.startswith("eqnarray"):
            body = re.sub(r"&\s*=\s*&", "&=", body)
        return [math_block(MATH_ENVS[env], body, ctx)]
    if base in ("itemize", "enumerate", "description"):
        return [list_block(body, ctx, ordered=base == "enumerate")]
    if base == "columns":
        return [columns_block(body, ctx)]
    if base in ("tabular", "tabularx", "array"):
        return [table_block(body, ctx)]
    if base == "tikzpicture":
        ctx.doc.warnings.append("A TikZ drawing was not imported (shown as a placeholder).")
        return [{"kind": "box", "blocks": [new_text("*TikZ drawing (not imported)*", ctx)], "border": "#999999",
                 "bg": None, "dashed": True, "title": None, "step": ctx.step}]
    box = box_style(env, ctx)
    if box is not None:
        m = re.match(r"\s*\[", body)
        if m:  # \begin{tcolorbox}[options]
            opts, k = read_group(body, m.end() - 1, "[", "]")
            box.update({k2: v for k2, v in tcb_options(opts, ctx.doc).items() if v not in (None, False) or k2 == "bg"})
            body = body[k:]
        title = box.pop("title_text", None)
        if env in ("block", "alertblock", "exampleblock"):
            m = re.match(r"\s*\{", body)
            if m:
                title, k = read_group(body, m.end() - 1)
                body = body[k:]
        inner = convert(body, Ctx_child(ctx))
        if title:
            inner.insert(0, new_text("**" + latex_to_md(title, ctx).strip() + "**", ctx))
        return [{"kind": "box", "blocks": inner, "title": title, "step": ctx.step, **box}]
    saved = ctx.align
    if base in ("center", "figure", "table"):
        ctx.align = "center"
    elif base == "flushright":
        ctx.align = "right"
    if base == "minipage":
        body = re.sub(r"^\s*(\[[^\]]*\])?\s*\{[^}]*\}", "", body, count=1)
    if base == "column":
        body = re.sub(r"^\s*\{[^}]*\}", "", body, count=1)
    out = convert(body, ctx)
    ctx.align = saved
    return out


def Ctx_child(ctx):
    return ctx  # same steps and notes; alignment restored by callers


def box_style(env, ctx):
    """Framed boxes: beamer blocks, tcolorbox and \\newtcolorbox environments."""
    doc = ctx.doc
    if env in ("block", "alertblock", "exampleblock"):
        colour = {"block": doc.title_bg or "#3333b3", "alertblock": "#cc0000", "exampleblock": "#008000"}[env]
        return {"border": colour, "bg": None, "dashed": False, "radius": 6, "title_text": None}
    defs = dict(re.findall(r"\\newtcolorbox\s*\{([^}]*)\}\s*(?:\[[^\]]*\])?\s*\{((?:[^{}]|\{[^{}]*\})*)\}", doc.src))
    if env == "tcolorbox" or env in defs:
        opts = defs.get(env, "")
        style = tcb_options(opts, doc)
        return style
    return None


def tcb_options(opts, doc):
    """tcolorbox keys (and \\tcbset styles they use) -> border, background, dashed, radius."""
    styles = {}
    for name, body in re.findall(r"([A-Za-z-]+)/\.style\s*=\s*\{((?:[^{}]|\{[^{}]*\})*)\}", doc.src):
        styles[name] = body
    keys = {}

    def apply(text):
        for part in re.split(r",(?![^{]*\})", text):
            part = part.strip()
            if not part:
                continue
            if "=" in part:
                k, v = part.split("=", 1)
                keys[k.strip()] = v.strip().strip("{}")
            elif part in styles:
                apply(styles[part])
            else:
                keys[part] = True
    apply(opts)
    border = doc.colours.resolve(keys.get("colframe", "black")) or "#000000"
    back = keys.get("colback")
    bg = doc.colours.resolve(back) if back else None
    if str(keys.get("opacityback", "1")).strip() == "0":
        bg = None
    dashed = "dashed" in str(keys.get("frame style", "")) or "dashed" in keys
    arc = length_pt(str(keys.get("arc", "1mm")))
    return {"border": border, "bg": bg, "dashed": dashed, "radius": arc, "title_text": keys.get("title")}


def list_block(body, ctx, ordered):
    items, i = [], 0
    for m in re.finditer(r"\\item(?![A-Za-z])", body):
        items.append(m)
    out = []
    for n, m in enumerate(items):
        end = items[n + 1].start() if n + 1 < len(items) else len(body)
        ov, opt, _, j = read_args(body, m.end(), 0)
        text = body[j:end]
        span = overlay_start(ov, ctx.counter) if ov else None
        step = ctx.step
        if span:
            step = max(ctx.step, span[0])
            if ov.strip().startswith("+"):
                ctx.counter += 1
        # nested lists inside an item
        nested = []
        for env in ("itemize", "enumerate"):
            for nm in re.finditer(r"\\begin\{" + env + r"\}", text):
                e0, e1 = find_env_end(text, nm.end(), env)
                nested.append((nm.start(), e1, text[nm.end():e0], env == "enumerate"))
        main = text
        for a, b, _, _ in sorted(nested, reverse=True):
            main = main[:a] + main[b:]
        # \pause inside items
        parts = re.split(r"\\pause\b", main)
        md = latex_to_md(parts[0], ctx).strip()
        label = (latex_to_md(opt, ctx).strip() + " ") if opt and not ordered else ""
        out.append({"md": (f"**{label.strip()}** " if label else "") + md, "step": step, "level": 0})
        for sub_body, sub_ordered in [(x[2], x[3]) for x in nested]:
            sub = list_block(sub_body, ctx, sub_ordered)
            for it in sub["items"]:
                out.append({**it, "level": it["level"] + 1, "step": max(it["step"], step)})
        ctx.max_step = max(ctx.max_step, step)
    return {"kind": "list", "items": out, "ordered": ordered, "step": ctx.step, "align": "left"}


def columns_block(body, ctx):
    cols = []
    if re.search(r"\\begin\{column\}", re.sub(r"\\begin\{columns\}.*?\\end\{columns\}", "", body, flags=re.S)):
        depth_ok = []
        for m in re.finditer(r"\\begin\{column\}", body):
            before = body[:m.start()]
            if before.count("\\begin{columns}") - before.count("\\end{columns}") > 0:
                continue  # inside a nested columns environment
            depth_ok.append(m)
        for m in depth_ok:
            _, _, args, j = read_args(body, m.end(), 1)
            e0, _ = find_env_end(body, j, "column")
            cols.append((args[0], body[j:e0]))
    else:
        nested = []
        for nm in re.finditer(r"\\begin\{columns\}", body):
            _, e1 = find_env_end(body, nm.end(), "columns")
            nested.append((nm.start(), e1))
        marks = [m for m in re.finditer(r"\\column(?![A-Za-z])", body)
                 if not any(a <= m.start() < b for a, b in nested)]
        for n, m in enumerate(marks):
            _, _, args, j = read_args(body, m.end(), 1)
            end = marks[n + 1].start() if n + 1 < len(marks) else len(body)
            cols.append((args[0], body[j:end]))
    out = []
    for spec, cbody in cols:
        frac, _ = parse_width(spec)
        saved = ctx.align
        sub = convert(cbody, ctx)
        ctx.align = saved
        out.append({"frac": frac or 1.0 / max(1, len(cols)), "blocks": sub})
    return {"kind": "columns", "cols": out, "step": ctx.step}


def table_block(body, ctx):
    m = re.match(r"^\s*(\[[^\]]*\])?\s*\{([^{}]*(?:\{[^{}]*\}[^{}]*)*)\}", body)
    spec = m.group(2) if m else ""
    body = body[m.end():] if m else body
    raw_rows = [r for r in math_rows(body)]
    # a rule after the first row: a header; vertical bars in the spec: all borders
    rule = r"\\(hline|toprule|midrule|bottomrule|cline\{[^}]*\})"
    header = len(raw_rows) > 1 and re.search(rule, raw_rows[1]) is not None
    any_rule = re.search(rule, body) is not None
    borders = "all" if "|" in spec else ("horizontal" if any_rule else "none")
    rows = [re.sub(rule, "", r) for r in raw_rows]
    rows = [r for r in rows if r.strip()]
    cells = [[latex_to_md(c, ctx).strip().replace("\n", " ") for c in re.split(r"(?<!\\)&", r)] for r in rows]
    if not cells:
        return new_text("", ctx)
    n = max(len(r) for r in cells)
    cells = [r + [""] * (n - len(r)) for r in cells]
    esc = [[c.replace("|", "\\|") for c in r] for r in cells]
    lines = ["| " + " | ".join(esc[0]) + " |", "|" + "---|" * n] + ["| " + " | ".join(r) + " |" for r in esc[1:]]
    return {"kind": "table", "md": "\n".join(lines), "cells": cells, "rows": len(cells), "header": header,
            "borders": borders, "step": ctx.step, "align": ctx.align}


# ---------- layout: blocks -> elements ----------


KATEX_SCALE = 1.21  # KaTeX's .katex { font-size: 1.21em }


class Layout:
    """Measures blocks (in pt of the Beamer page) and places them."""

    def __init__(self, doc, assets):
        self.doc, self.assets = doc, assets
        self.fs = doc.font_pt
        self.k, self.ox, self.oy = doc.px_per_pt, 0.0, 0.0

    def text_lines(self, md, width_pt, size):
        """Lines of text (a displayed equation counts as the lines it takes)."""
        extra = 0.0
        for m in re.finditer(r"\$\$(.*?)\$\$", md, flags=re.S):
            extra += self.math_height(math_rows(m.group(1)) or [m.group(1)], size) / (self.fs * size * 1.3)
        md = re.sub(r"\$\$.*?\$\$", "", md, flags=re.S)
        plain = re.sub(r"\$[^$]*\$", lambda m: "x" * max(1, len(m.group(0)) // 3), md)
        plain = re.sub(r"<[^>]+>|\*\*|\*|~~|`", "", plain)
        cpl = max(8, width_pt / (0.52 * self.fs * size))
        lines = [ln for ln in plain.split("\n")]
        return extra + sum(max(1 if ln.strip() or not extra else 0, -(-len(ln) // int(cpl))) for ln in lines)

    def math_height(self, rows, size):
        h = 0.0
        for r in rows:
            tall = 2.9 if re.search(r"\\(frac|dfrac|sum|int|prod|lim|begin)", r) else 1.9
            h += tall * self.fs * size
        return h + 0.5 * self.fs * size

    def height(self, b, width):
        fs = self.fs * b.get("size", 1.0)
        k = b["kind"]
        if k == "text":
            return self.text_lines(b["md"], width, b.get("size", 1.0)) * fs * 1.3 + 0.35 * fs
        if k == "math":
            return self.math_height(b["rows"], b.get("size", 1.0))
        if k == "list":
            return sum(self.text_lines(it["md"], width - (it["level"] + 1) * 1.6 * fs, 1.0) * fs * 1.3 + 0.25 * fs
                       for it in b["items"]) + 0.3 * fs
        if k == "table":
            per_row = 2.3 if "$" in b["md"] else 1.75
            return b["rows"] * fs * per_row + 0.5 * fs
        if k == "image":
            w, h = self.image_size(b, width)
            return h + 0.3 * fs
        if k == "space":
            return b["pt"]
        if k == "rule":
            return 0.6 * fs
        if k == "columns":
            return max([self.stack_height(c["blocks"], width * c["frac"]) for c in b["cols"]] + [0])
        if k == "box":
            return self.stack_height(b["blocks"], width - 1.4 * fs) + 1.2 * fs
        if k == "stack":
            return self.stack_height(b["blocks"], width)
        return fs

    def stack_height(self, blocks, width):
        """Height of a column of blocks; consecutive alternatives (replacing
        images, \\only groups) share one place: the tallest counts."""
        total, alt = 0.0, None
        for b in blocks:
            h = self.height(b, width)
            if b.get("replaces"):
                if alt is None:
                    alt = h
                    total += h
                elif h > alt:
                    total += h - alt
                    alt = h
                continue
            alt = None
            total += h
        return total

    def image_size(self, b, width):
        aspect = self.assets.aspect(b["src"])
        if b.get("frac"):
            w = width * b["frac"]
        elif b.get("width_pt"):
            w = b["width_pt"]
        elif b.get("hfrac") or b.get("height_pt"):
            h = b.get("height_pt") or b["hfrac"] * self.doc.paper_mm[1] * 2.845 * 0.8
            return min(width, h / aspect), h
        elif b.get("scale"):
            w = width * min(1.0, b["scale"])
        else:
            w = width * 0.6
        w = min(w, width)
        return w, w * aspect

    # --- placing: block coordinates in pt; self.k px per pt, (ox, oy) offset in px ---

    def X(self, v):
        return self.ox + v * self.k

    def Y(self, v):
        return self.oy + v * self.k

    def L(self, v):
        return v * self.k

    def place(self, blocks, x, y, width, out):
        """Elements for blocks stacked from (x, y) (pt); returns the bottom (pt)."""
        doc = self.doc
        alt_top = None  # replacing alternatives (images, \only) share the place of the first
        for b in blocks:
            k = b["kind"]
            fs = self.fs * b.get("size", 1.0)
            h = self.height(b, width)
            if b.get("replaces") and alt_top is not None:
                yy = alt_top
            else:
                yy = y
                alt_top = yy if b.get("replaces") else None
            step = b.get("step", 1)
            extra = {"step": step} if step > 1 else {}
            cover = {"bg": "#ffffff"} if (b.get("replaces") or b.get("cover")) else {}
            if k == "text":
                out.append(model.text(self.X(x), self.Y(yy), self.L(width), self.L(h), b["md"], self.L(fs),
                                      align=b["align"], family=doc.font, **cover, **extra))
            elif k == "math":
                out.extend(self.math_elements(b, self.X(x), self.Y(yy), self.L(width), self.L(h), self.L(fs) / KATEX_SCALE))
            elif k == "list":
                self.list_elements(b, x, yy, width, fs, out)
            elif k == "table":
                out.append({"type": "table", "x": round(self.X(x)), "y": round(self.Y(yy)), "width": round(self.L(width)),
                            "height": round(self.L(h)), "rows": b["cells"], "header": "yes" if b.get("header") else "no",
                            "borders": b.get("borders", "horizontal"), "fontSize": round(self.L(fs)),
                            **({"fontFamily": doc.font} if doc.font else {}), **extra})
            elif k == "image":
                w, ih = self.image_size(b, width)
                ix = x + ((width - w) / 2 if b.get("align") == "center" else (width - w if b.get("align") == "right" else 0))
                rel, original = self.assets.copy(b["src"])
                if rel:
                    out.append(model.figure(self.X(ix), self.Y(yy), self.L(w), self.L(ih), rel, original,
                                            sync=bool(original), **cover, **extra))
            elif k == "rule":
                ry = self.Y(yy + h / 2)
                out.append(model.path([(self.X(x), ry), (self.X(x + width * b["frac"]), ry)],
                                      stroke=b.get("colour") or "#000000", width=max(1, self.L(0.6)), **extra))
            elif k == "columns":
                mds = self.columns_markdown(b)
                if mds is not None:  # plain content, no steps: one columns element
                    total = sum(c["frac"] for c in b["cols"]) or 1
                    out.append({"type": "columns", "x": round(self.X(x)), "y": round(self.Y(yy)), "width": round(self.L(width)),
                                "height": round(self.L(h)), "gap": round(self.L(self.fs)), "fontSize": round(self.L(fs)),
                                **({"fontFamily": doc.font} if doc.font else {}),
                                "columns": [{"width": round(c["frac"] / total * 100, 1), "content": md,
                                             **({"align": "center"} if c.get("center") else {})}
                                            for c, md in zip(b["cols"], mds)], **extra})
                else:
                    cx = x
                    for c in b["cols"]:
                        cw = width * c["frac"]
                        self.place(c["blocks"], cx, yy, cw, out)
                        cx += cw
            elif k == "stack":
                self.place(b["blocks"], x, yy, width, out)
            elif k == "box":
                pad = 0.7 * self.fs
                out.append(model.shape(self.X(x), self.Y(yy + pad * 0.3), self.L(width), self.L(h - pad * 0.5),
                                       fill=b.get("bg") or "transparent", border=b.get("border") or "#000000",
                                       border_w=max(1, self.L(0.8)), radius=self.L(b.get("radius") or 0),
                                       dashed=b.get("dashed"), **extra))
                self.place(b["blocks"], x + pad, yy + pad * 0.8, width - 2 * pad, out)
            if not (b.get("replaces") and yy != y):
                y = yy + h
        return y

    PLAIN = ("text", "math", "list", "image", "table", "space")

    def columns_markdown(self, b):
        """Each column's blocks as Markdown, or None (boxes, nested columns, steps)."""
        out = []
        for c in b["cols"]:
            parts = []
            for blk in c["blocks"]:
                if blk["kind"] not in self.PLAIN or blk.get("step", 1) > b.get("step", 1) or blk.get("replaces") \
                        or any(st > blk.get("step", 1) for st in blk.get("row_steps", [])) \
                        or any(it["step"] > blk.get("step", 1) for it in blk.get("items", [])):
                    return None
                k = blk["kind"]
                if k == "text":
                    parts.append(blk["md"])
                elif k == "math":
                    body = " \\\\ ".join(blk["rows"])
                    parts.append(f"$$\\begin{{{blk['env']}}}{body}\\end{{{blk['env']}}}$$" if blk["env"] else f"$${body}$$")
                elif k == "list":
                    n, lines = 1, []
                    for it in blk["items"]:
                        if it["level"] == 0:
                            lines.append((f"{n}. " if blk["ordered"] else "- ") + it["md"])
                            n += 1
                        else:
                            lines.append("    " * it["level"] + "- " + it["md"])
                    parts.append("\n".join(lines))
                elif k == "image":
                    rel, _ = self.assets.copy(blk["src"])
                    if rel:
                        parts.append(f"![]({rel})")
                elif k == "table":
                    parts.append(blk["md"])
            c["center"] = all(blk.get("align") == "center" for blk in c["blocks"] if blk["kind"] in ("text", "image")) and c["blocks"]
            out.append("\n\n".join(p for p in parts if p))
        return out

    def math_elements(self, b, x, y, w, h, fs):
        rows, steps = b["rows"], b["row_steps"]
        env = b["env"]
        base_step = b.get("step", 1)

        def tex_for(visible_upto):
            shown = []
            for r, st in zip(rows, steps):
                if st <= visible_upto:
                    shown.append(r)
                elif env:  # keeps its place, invisible
                    shown.append(" & ".join("\\phantom{" + c + "}" for c in re.split(r"(?<!\\)&", r)))
            body = " \\\\ ".join(shown)
            return f"$$\\begin{{{env}}}{body}\\end{{{env}}}$$" if env else f"$${body}$$"

        distinct = sorted(set(steps))
        cover = {"bg": "#ffffff"} if b.get("replaces") else {}
        if len(distinct) <= 1:
            step = max(distinct + [base_step])
            return [model.text(x, y, w, h, tex_for(10 ** 6), fs, align="center", **cover, **({"step": step} if step > 1 else {}))]
        out = []
        for n, st in enumerate(distinct):
            out.append(model.text(x, y, w, h, tex_for(st), fs, align="center",
                                  **({"bg": "#ffffff"} if n or cover else {}), **({"step": st} if st > 1 else {})))
        return out

    def list_elements(self, b, x, y, width, fs, out):
        doc = self.doc
        items = b["items"]

        def line(it, n):
            if it["level"] == 0:
                return (f"{n}. " if b["ordered"] else "- ") + it["md"]
            return "    " * it["level"] + "- " + it["md"]

        if len({it["step"] for it in items}) <= 1:
            md, n = [], 1
            for it in items:
                md.append(line(it, n))
                n += it["level"] == 0
            step = items[0]["step"] if items else 1
            out.append(model.text(self.X(x), self.Y(y), self.L(width), self.L(self.height(b, width)), "\n".join(md),
                                  self.L(fs), family=doc.font, **({"step": step} if step > 1 else {})))
            return
        n = 1
        for it in items:  # one box per item: each its own step
            md = line(it, n)
            if b["ordered"] and it["level"] == 0:
                md = f"{n}\\. " + it["md"]
            n += it["level"] == 0
            h = self.text_lines(it["md"], width - (it["level"] + 1) * 1.6 * fs, 1.0) * fs * 1.3 + 0.25 * fs
            out.append(model.text(self.X(x), self.Y(y), self.L(width), self.L(h), md, self.L(fs), family=doc.font,
                                  **({"step": it["step"]} if it["step"] > 1 else {})))
            y += h


class Assets:
    """Figures: found next to the .tex (with \\graphicspath), copied into figures/."""

    def __init__(self, doc, project_folder, linked):
        self.doc, self.folder, self.linked = doc, project_folder, linked
        self.paths = [""] + [p for p in re.findall(r"\{([^{}]*)\}", (re.search(r"\\graphicspath\s*\{(.*)\}", doc.pre) or [None, ""])[1])]
        self.cache = {}

    def find(self, name):
        for base in self.paths:
            for ext in ("", ".pdf", ".png", ".jpg", ".jpeg", ".eps", ".svg", ".PNG", ".JPG"):
                p = os.path.normpath(os.path.join(self.doc.dir, base, name + ext))
                if os.path.isfile(p):
                    return p
        return None

    def aspect(self, name):
        p = self.find(name)
        if not p:
            return 0.75
        if p in self.cache:
            return self.cache[p]
        a = 0.75
        try:
            if p.lower().endswith(".pdf"):
                from pdf2image import pdfinfo_from_path
                size = pdfinfo_from_path(p).get("Page size", "")
                m = re.match(r"([\d.]+) x ([\d.]+)", size)
                if m:
                    a = float(m.group(2)) / float(m.group(1))
            else:
                from PIL import Image
                with Image.open(p) as im:
                    a = im.height / im.width
        except Exception:
            pass
        self.cache[p] = a
        return a

    def copy(self, name):
        """-> (path relative to the project, original path for linking or '')."""
        p = self.find(name)
        if not p:
            self.doc.warnings.append(f"Figure not found: {name}")
            return None, ""
        rel_src = os.path.relpath(p, self.doc.dir)
        if rel_src.startswith(".."):
            rel_src = os.path.basename(p)
        rel = rel_src if rel_src.replace("\\", "/").startswith("figures/") else os.path.join("figures", rel_src)
        dest = os.path.join(self.folder, rel)
        os.makedirs(os.path.dirname(dest), exist_ok=True)
        if not os.path.exists(dest):
            shutil.copy2(p, dest)
        return rel.replace("\\", "/"), (p if self.linked else "")


# ---------- frames -> slides ----------


def frames(doc):
    """[(kind, payload)]: ('section', name) / ('frame', (options, title, body))."""
    out, s, i = [], doc.body, 0
    pat = re.compile(r"\\(section|subsection|begin\s*\{frame\}|frame(?![A-Za-z])|againframe|note)")
    while True:
        m = pat.search(s, i)
        if not m:
            break
        kind = m.group(1)
        j = m.end()
        if kind == "section":
            _, opt, args, j = read_args(s, j, 1)
            out.append(("section", args[0]))
        elif kind == "subsection":
            _, _, args, j = read_args(s, j, 1)
        elif kind.startswith("begin"):
            ov, opt, _, j = read_args(s, j, 0)
            e0, e1 = find_env_end(s, j, "frame")
            body = s[j:e0]
            title = ""
            k = skip_ws(body, 0)
            if k < len(body) and body[k] == "{":
                title, k = read_group(body, k)
                k2 = skip_ws(body, k)
                if k2 < len(body) and body[k2] == "{" and "\\" not in body[k2:k2 + 1]:
                    pass
                body = body[k:]
            out.append(("frame", (opt or "", title, body)))
            j = e1
        elif kind == "frame":
            ov, opt, args, j = read_args(s, j, 1)
            out.append(("frame", (opt or "", "", args[0])))
        elif kind == "note":
            _, _, args, j = read_args(s, j, 1)
            out.append(("note", args[0]))
        i = j
    return out


def build_slides(doc, layout):
    W, H = doc.width, doc.height
    fs = doc.font_pt
    paper_w = doc.paper_mm[0] * 2.845
    paper_h = doc.paper_mm[1] * 2.845
    margin = 28.45 * 0.8  # ~1cm
    title_h = fs * 2.6
    foot_h = fs * 1.4 if (doc.footer or doc.madrid_footline) else fs * 0.6
    slides, section = [], None
    font = doc.font

    def title_md(t):
        return latex_to_md(t, Ctx(doc)).strip()

    from . import progress
    all_frames = frames(doc)
    for n_frame, (kind, payload) in enumerate(all_frames):
        progress.report("Converting the frames", n_frame, len(all_frames))
        if kind == "section":
            section = latex_to_md(payload, Ctx(doc)).strip()
            if doc.section_slides:
                els = []
                if doc.section_bg:
                    els.append(model.shape(0, 0, W, H, fill=doc.section_bg, locked="yes"))
                bw, bh = W * 0.62, doc.pt(fs * 3.2)
                els.append(model.shape((W - bw) / 2, (H - bh) / 2, bw, bh, fill=doc.title_bg or "#ffffff",
                                       radius=doc.pt(4)))
                els.append(model.text((W - bw) / 2, (H - bh) / 2, bw, bh, f"**{section}**", doc.pt(fs * 1.44),
                                      colour=doc.title_fg or "#000000", align="center", valign="center", family=font))
                slides.append({"title": section, "section": section, "master": "Plain", "elements": els})
            continue
        if kind == "note":
            if slides:
                note = latex_to_md(payload, Ctx(doc)).strip()
                slides[-1]["notes"] = (slides[-1].get("notes", "") + "\n" + note).strip()
            continue
        opt, title, body = payload
        ctx = Ctx(doc)
        m = re.search(r"\\frametitle\s*(?:<[^>]*>)?\s*(?:\[[^\]]*\])?\s*\{", body)
        if m and not title:
            title, _ = read_group(body, m.end() - 1)
        blocks = convert(body, ctx)
        els = []
        is_title_page = any(b["kind"] == "titlepage" for b in blocks)
        if is_title_page:
            els += title_page(doc, layout)
            blocks = [b for b in blocks if b["kind"] != "titlepage"]
        plain = "plain" in opt
        top = (title_h + fs * 0.6) if title else margin * 0.6
        avail = paper_h - top - foot_h - fs * 0.4
        width = paper_w - 2 * margin
        need = layout.stack_height(blocks, width) * 1.12  # estimates run short: keep a margin
        scale = min(1.0, avail / need) if need > 0 else 1.0
        if scale < 0.6:
            doc.warnings.append(f"Slide {len(slides) + 1} ({title_md(title) or 'untitled'}) was very full and is shown smaller.")
        y0 = top
        if need * scale < avail and not re.search(r"(^|,)\s*t\s*(,|$)", opt):
            y0 = top + (avail - need * scale) / 2
        # too full: lay out on a page 1/scale larger, then shrink it to fit
        layout.k = doc.px_per_pt * scale
        layout.ox, layout.oy = doc.pt(margin), doc.pt(y0)
        layout.place(blocks, 0, 0, width / scale, els)
        if title:
            els.insert(0, model.text(doc.pt(margin * 0.5), 0, W - doc.pt(margin), doc.pt(title_h), title_md(title),
                                     doc.pt(fs * 1.44), colour=doc.ft_fg or "#000000",
                                     align="center" if doc.ft_center else "left", valign="center", family=font))
        if ctx.bounded:
            doc.warnings.append(f"Slide {len(slides) + 1}: content that disappears in Beamer (\\only<n>) is covered by the next step here; check its steps.")
        fallback = (plain_text(doc.meta["title"], doc) or "Title") if is_title_page else f"Slide {len(slides) + 1}"
        slide = {"title": re.sub(r"[*$\\]", "", title_md(title)) or fallback, "elements": els}
        if section:
            slide["section"] = section
        if ctx.notes:
            slide["notes"] = "\n".join(ctx.notes)
        slide["master"] = "none" if plain else ("Beamer" if title else "Plain")
        slides.append(slide)
    return slides


def title_page(doc, layout):
    W, H = doc.width, doc.height
    fs = doc.font_pt
    font = doc.font
    ctx = Ctx(doc)
    els = []
    meta = {k: latex_to_md(v, ctx).strip() for k, v in doc.meta.items()}
    y = H * 0.22
    bw = W * 0.78
    th = doc.pt(fs * (1.44 * 1.4 * (1 + meta["title"].count("\n")) + 1.4))
    if doc.title_bg:
        els.append(model.shape((W - bw) / 2, y, bw, th, fill=doc.title_bg, radius=doc.pt(4)))
    els.append(model.text((W - bw) / 2, y, bw, th, f"**{meta['title']}**" if meta["title"] else "\\presentationtitle",
                          doc.pt(fs * 1.44), colour=doc.title_fg or "#000000", align="center", valign="center", family=font))
    y += th + doc.pt(fs)
    for key, size in (("subtitle", 1.1), ("author", 1.0), ("institute", 0.8), ("date", 0.9)):
        if not meta[key]:
            continue
        lines = meta[key].count("\n") + 1
        h = doc.pt(fs * size * 1.4 * lines + fs * 0.6)
        els.append(model.text(W * 0.1, y, W * 0.8, h, meta[key], doc.pt(fs * size), align="center", family=font))
        y += h + doc.pt(fs * 0.5)
    return els


def masters(doc):
    W, H = doc.width, doc.height
    fs = doc.font_pt
    margin = 28.45 * 0.8
    footer = []
    if doc.footer:
        footer.append(model.text(W * 0.6, H - doc.pt(fs * 1.5), W * 0.4 - doc.pt(margin * 0.5), doc.pt(fs * 1.3),
                                 doc.footer, doc.pt(fs * 0.8), align="right", valign="center", family=doc.font))
    elif doc.madrid_footline:
        h = doc.pt(fs * 1.25)
        thirds = [("\\author", doc.title_bg or "#3333b3", "#ffffff"), ("\\presentationtitle", "#c8c8e6", "#000000"),
                  ("\\date    \\slidenumber / \\totalslides", "#e6e6f5", "#000000")]
        for n, (txt, bg, fg) in enumerate(thirds):
            footer.append(model.shape(W * n / 3, H - h, W / 3 + 1, h, fill=bg))
            footer.append(model.text(W * n / 3, H - h, W / 3, h, txt, doc.pt(fs * 0.6), colour=fg, align="center",
                                     valign="center", family=doc.font))
    bar = []
    if doc.ft_bg:
        bar.append(model.shape(0, 0, W, doc.pt(fs * 2.6), fill=doc.ft_bg))
    return [{"name": "Beamer", "elements": bar + footer}, {"name": "Plain", "elements": list(footer)}]


def _read(path):
    with open(path, encoding="utf-8", errors="replace") as f:
        return f.read()


def bibliography(doc):
    names = []
    for args in command_args(doc.src, "bibliography", 1) + command_args(doc.src, "addbibresource", 1):
        names += [n.strip() for n in args[1][0].split(",")] if args[1] else []
    out = []
    for n in names:
        p = os.path.join(doc.dir, n if n.endswith(".bib") else n + ".bib")
        if os.path.isfile(p):
            out.append(_read(p))
    if not out:  # a .bib next to the document
        for f in sorted(os.listdir(doc.dir)):
            if f.endswith(".bib"):
                out.append(_read(os.path.join(doc.dir, f)))
    return "\n".join(out)


def plain_text(tex, doc):
    """LaTeX -> plain text (a slide or project title)."""
    md = latex_to_md(tex, Ctx(doc))
    md = re.sub(r"<[^>]+>", "", md)
    return re.sub(r"\*\*|\*|~~|`", "", md).replace("\n", ", ").strip()


def import_beamer(main_tex, project_folder, linked=True):
    warnings = []
    doc = Doc(main_tex, warnings)
    assets = Assets(doc, project_folder, linked)
    layout = Layout(doc, assets)
    slides = build_slides(doc, layout)
    plain_meta = {k: plain_text(v, doc) for k, v in doc.meta.items()}
    return {
        "title": plain_meta["title"],
        "author": plain_meta["author"],
        "date": plain_meta["date"],
        "width": doc.width,
        "height": doc.height,
        "slides": slides,
        "masters": masters(doc),
        "macros": collect_macros(doc),
        "bib": bibliography(doc),
        "warnings": sorted(set(warnings), key=warnings.index),
    }
