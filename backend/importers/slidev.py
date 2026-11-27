"""Slidev (slides.md, a folder, or a .zip) -> slides.

Slidev is Markdown with KaTeX, like GluonSlides' text, so most content
is kept as it is:
  ---  /  frontmatter / src: pages/x.md   slides (included files too; hide: true skipped)
  # Title                                 the slide title (top)
  Markdown, $math$, <span style=...>      text boxes, unchanged
  Markdown tables                         table elements
  <div class="grid grid-cols-N">          a columns element (boxes per column if it has clicks inside)
  layout: two-cols + ::right::            a columns element
  <div class="absolute left-Npx ...">     placed exactly (Slidev's canvas is 980 x 552)
  <img src width>, background:            figures (copied into figures/)
  v-click, <v-click>, <v-clicks>          build steps
  v-click-hide, v-click="[a, b]"          shown until a later step (until:M)
  <v-switch><template #1>…               options replacing each other, in the same place
  <Arrow x1 y1 x2 y2>                     an arrow
  the last <!-- comment -->               speaker notes
  setup/katex.ts macros                   macros.tex
Other Vue components are not converted (a warning). Positions of the
normal flow are estimated, like the Beamer import.
"""

import json
import os
import re
import shutil

from . import model

CANVAS_W, CANVAS_H = 980, 552
W, H = 1920, 1080
K = W / CANVAS_W          # px per Slidev px
BASE = 17.6 * K           # body text (Slidev's layouts: 1.1rem)


# ---------- files ----------

def find_entry(folder):
    for name in ("slides.md", "presentation.md", "index.md"):
        for root, _dirs, files in os.walk(folder):
            if name in files and "node_modules" not in root:
                return os.path.join(root, name)
    return None


def read(path):
    with open(path, encoding="utf-8", errors="replace") as f:
        return f.read()


def katex_macros(root):
    """setup/katex.ts (defineKatexSetup -> macros) -> \\newcommand lines."""
    p = os.path.join(root, "setup", "katex.ts")
    if not os.path.isfile(p):
        return ""
    text = read(p)
    out = []
    for name, body in re.findall(r'"(\\\\[A-Za-z]+)"\s*:\s*"((?:[^"\\]|\\.)*)"', text):
        try:
            name, body = json.loads(f'"{name}"'), json.loads(f'"{body}"')
        except ValueError:
            continue
        n = max([int(x) for x in re.findall(r"#(\d)", body)] + [0])
        out.append(f"\\newcommand{{{name}}}" + (f"[{n}]" if n else "") + "{" + " ".join(body.split()) + "}")
    return "\n".join(out) + ("\n" if out else "")


# ---------- slides and frontmatter ----------

FM_LINE = re.compile(r"^(\s*#.*|\s+\S.*|[\w-]+\s*:.*|\s*-\s+.*|\s*)$")


def parse_yaml(text):
    """Flat 'key: value' frontmatter (enough for Slidev's options)."""
    out = {}
    key = None
    for line in text.split("\n"):
        if re.match(r"^\s*#", line) or not line.strip():
            continue
        m = re.match(r"^([\w-]+)\s*:\s*(.*)$", line)
        if m:
            key, value = m.group(1), m.group(2).strip()
            out[key] = value.strip("'\"") if value not in ("|", ">") else ""
        elif key and line.startswith((" ", "\t")):
            out[key] = (out[key] + "\n" + line.strip()).strip()
    return out


def split_slides(text):
    """[(frontmatter dict, content)] of a Slidev markdown file."""
    parts = re.split(r"^---[ \t]*$", text.replace("\r\n", "\n"), flags=re.M)
    slides = []
    i = 0
    head = {}
    if parts and not parts[0].strip():  # starts with ---: headmatter
        if len(parts) > 2 and all(FM_LINE.match(l) for l in parts[1].split("\n")):
            head = parse_yaml(parts[1])
            i = 2
            slides.append((head, parts[2] if len(parts) > 2 else ""))
            i = 3
        else:
            i = 1
    elif parts:
        slides.append(({}, parts[0]))
        i = 1
    while i < len(parts):
        chunk = parts[i]
        nxt = parts[i + 1] if i + 1 < len(parts) else None
        is_fm = chunk.strip() and nxt is not None and all(FM_LINE.match(l) for l in chunk.split("\n")) \
            and any(re.match(r"^[\w-]+\s*:", l) for l in chunk.split("\n"))
        if is_fm:
            slides.append((parse_yaml(chunk), nxt))
            i += 2
        else:
            slides.append(({}, chunk))
            i += 1
    return slides


def expand(path, depth=0):
    """[(frontmatter, content, base folder)] with src: files included."""
    out = []
    base = os.path.dirname(path)
    for fm, content in split_slides(read(path)):
        if str(fm.get("hide", "")).lower() in ("true", "yes"):
            continue
        src = fm.get("src")
        if src and depth < 5:
            p = os.path.normpath(os.path.join(base, src))
            if os.path.isfile(p):
                inner = expand(p, depth + 1)
                for n, (ifm, icontent, ibase) in enumerate(inner):
                    merged = {**ifm, **{k: v for k, v in fm.items() if k not in ("src",)}} if n == 0 else ifm
                    out.append((merged, icontent, ibase))
            continue
        if not re.sub(r"<!--.*?-->", "", content, flags=re.S).strip() and not fm.get("layout"):
            continue  # only comments: a separator, not a slide
        out.append((fm, content, base))
    return out


# ---------- HTML helpers ----------

TAG = re.compile(r"<(/?)([A-Za-z][\w-]*)([^<>]*?)(/?)>", re.S)


def take_element(s, i):
    """s[i] is '<': (tag, attrs, inner, end index) for a balanced element."""
    m = TAG.match(s, i)
    if not m or m.group(1):
        return None
    name, attrs, selfclose = m.group(2), m.group(3), m.group(4)
    if selfclose or name.lower() in ("img", "br", "hr", "input"):
        return name, attrs, "", m.end()
    depth, j = 1, m.end()
    for t in TAG.finditer(s, j):
        if t.group(2).lower() != name.lower():
            continue
        if t.group(1):
            depth -= 1
            if depth == 0:
                return name, attrs, s[m.end():t.start()], t.end()
        elif not t.group(4):
            depth += 1
    return name, attrs, s[m.end():], len(s)


def attr(attrs, key):
    m = re.search(r'(?:^|\s):?' + re.escape(key) + r'\s*=\s*("([^"]*)"|\'([^\']*)\'|(\S+))', attrs)
    if not m:
        return None
    return next(g for g in m.groups()[1:] if g is not None)


def has_flag(attrs, key):
    return re.search(r'(?:^|\s)' + re.escape(key) + r'(?=[\s=>/]|$)', attrs) is not None


def tw_px(classes, prop):
    """Tailwind position class (left-325px, bottom-20px, left-10, left-[30px]) -> Slidev px."""
    m = re.search(r'(?:^|\s)(-?)' + prop + r'-\[?(\d+(?:\.\d+)?)(px)?\]?(?=\s|$)', classes or "")
    if not m:
        return None
    v = float(m.group(2)) * (1 if m.group(3) else 4)
    return -v if m.group(1) else v


# ---------- content -> blocks ----------

class Ctx:
    def __init__(self, base, assets, warnings):
        self.base, self.assets, self.warnings = base, assets, warnings
        self.clicks = 1      # last click used (steps start at 2)
        self.step = 1        # step of the content being converted: 1 outside v-click
        self.notes = []
        self.center = False

    def next_step(self):
        self.clicks += 1
        return self.clicks


def html_heading(m):
    """<h3 style="color: red; text-align: center">Title</h3> -> ### \\textcolor{red}{Title}
    (alignment: see only_headings, the box is centred)."""
    level, attrs, inner = int(m.group(1)), m.group(2), m.group(3)
    inner = re.sub(r"\s+", " ", inner).strip()
    colour = re.search(r"(?<![-\w])color:\s*([^;\"]+)", attr(attrs, "style") or "")
    if colour and inner:
        inner = model.coloured(inner, colour.group(1).strip())
    return f"\n\n{'#' * level} {inner}\n\n" if inner else "\n"


def only_headings(md):
    """Text that is headings (with equations and images around them): a centred box
    (Slidev authors centre such titles with <h3 style="text-align: center">)."""
    rest = re.sub(r"\$\$.*?\$\$", "", md or "", flags=re.S)
    lines = [l.strip() for l in rest.split("\n") if l.strip()]
    lines = [l for l in lines if not re.match(r"^!\[[^\]]*\]\([^)]*\)$", l)]
    return bool(lines) and all(re.match(r"^#{1,6}\s", l) for l in lines)


def clean_md(md):
    # HTML headings -> Markdown headings
    md = re.sub(r"<h([1-6])\b([^>]*)>(.*?)</h\1>", html_heading, md, flags=re.S | re.I)
    md = re.sub(r"\$\$[ \t]*\{[\d\s|,*\-]*(?:all|none)?[\d\s|,*\-]*\}", "$$", md)  # $${1|all}: line highlights
    # MDC (mdc: true): [text]{style="..."} -> a span; [text]{.class} -> the text
    md = re.sub(r'\[([^\]\n]+)\]\{\s*style="([^"]*)"\s*\}', r'<span style="\2">\1</span>', md)
    # a span that only sets a colour -> \textcolor{colour}{text} (core/textCommands.js)
    md = re.sub(r'<span\s+style="\s*color:\s*([^;"]+?)\s*;?\s*">([^<\n]*)</span>',
                lambda m: model.coloured(m.group(2), m.group(1)), md)
    md = re.sub(r"\[([^\]\n]+)\]\{\s*\.[\w-]+(?:\s+\.[\w-]+)*\s*\}", r"\1", md)
    md = re.sub(r"<br\s*/?>\s*(</br>)?", "\n", md, flags=re.I)
    md = re.sub(r"\n{3,}", "\n\n", md)
    return md.strip()


def img_md(attrs, ctx):
    """<img> inside columns -> a Markdown image (copied into figures/)."""
    src = attr(attrs, "src")
    rel = ctx.assets.copy(src, ctx.base)
    if not rel and src and not re.match(r"^(https?:|data:)", src):
        rel = model.missing_figure_path(src)  # the compiled PDF may give its picture
    return f"![{attr(attrs, 'alt') or ''}]({rel})" if rel else ""


def inline_html_to_md(md, ctx):
    """Images inside text become Markdown images; Vue click wrappers are unwrapped."""
    md = re.sub(r"<img\b([^>]*)/?>", lambda m: img_md(m.group(1), ctx), md, flags=re.I)
    md = re.sub(r"</?v-clicks?\b[^>]*>", "", md)
    md = re.sub(r"\s(v-click|v-after)(=\"[^\"]*\")?", "", md)
    return clean_md(md)


def table_rows(lines):
    rows = []
    for ln in lines:
        s = ln.strip().strip("|")
        cells = [c.strip() for c in re.split(r"(?<!\\)\|", s)]
        if all(re.fullmatch(r":?-{2,}:?", c) for c in cells if c):
            continue
        rows.append(cells)
    return rows


def switch_block(inner, ctx):
    """<v-switch><template #1>A</template><template #2-3>B</template>…: each option
    shown at its clicks (counted from the switch), in the same place."""
    base = ctx.clicks  # the step before the switch's first click
    options, last = [], 0
    templates = re.findall(r"<template\s+(?:#|v-slot:)(\d+)(?:-(\d+))?\s*>(.*?)</template>", inner, flags=re.S)
    for n, (a, b, body) in enumerate(templates):
        a = int(a)
        end = int(b) if b else None
        saved = ctx.step
        ctx.step = max(1, base + a) if a > 0 else saved
        sub = convert(body, ctx)
        ctx.step = saved
        is_last = n == len(templates) - 1
        if end is not None:
            set_until(sub, base + end - 1)
        elif not is_last:
            set_until(sub, base + a)
        last = max(last, end - 1 if end else a)
        options.append(sub)
    ctx.clicks = max(ctx.clicks, base + last)
    return {"kind": "switch", "options": options, "step": 1, "fixed": True}


def merge_ranges(blocks):
    """Consecutive v-click="[a, b]" blocks shown at steps that don't overlap
    replace each other: one place for all, like a v-switch. Authors often
    move each into place with v-motion offsets matched to Slidev's rendered
    heights, which can't be reproduced exactly: moved ones (and a moved block
    that follows them, shown to the end) all take the first one's offset."""
    INF = float("inf")
    shifts = lambda opts: [sb for opt in opts for sb in opt if sb["kind"] == "shift"]
    out = []
    for b in blocks:
        if b["kind"] == "switch" and not b.get("fixed"):
            span, options = b["span"], b["options"]
        elif b["kind"] == "shift" and b.get("step", 1) > 1:
            span, options = (b["step"], INF), [[b]]
        else:
            out.append(b)
            continue
        prev = out[-1] if out else None
        if prev is not None and prev.get("spans") is not None and all(e < span[0] or s > span[1] for s, e in prev["spans"]) \
                and (b["kind"] == "switch" or prev.get("dy0") is not None):
            if prev.get("dy0") is not None:
                for sb in shifts(options):
                    sb["dy"] = prev["dy0"]
            prev["options"].extend(options)
            prev["spans"].append(span)
            continue
        if b["kind"] == "shift":
            out.append(b)  # a moved block on its own: as Slidev moves it
            continue
        moved = shifts(options)
        out.append({**b, "spans": [span], "dy0": moved[0]["dy"] if moved else None})
    return out


def convert(text, ctx, step=None):
    """Slidev content -> blocks: text / table / image / columns / abs / arrow."""
    blocks, buf, i = [], [], 0
    step = step or ctx.step

    def flush():
        md = "".join(buf)
        buf.clear()
        # Markdown tables become tables; the rest stays text
        lines = md.split("\n")
        chunk = []
        n = 0
        while n < len(lines):
            if lines[n].strip().startswith("|") and n + 1 < len(lines) and re.match(r"^\s*\|?\s*:?-{2,}", lines[n + 1]):
                if "".join(chunk).strip():
                    blocks.append({"kind": "text", "md": inline_html_to_md("\n".join(chunk), ctx), "step": ctx.step})
                chunk = []
                tl = []
                while n < len(lines) and lines[n].strip().startswith("|"):
                    tl.append(lines[n])
                    n += 1
                blocks.append({"kind": "table", "rows": table_rows(tl), "step": ctx.step})
                continue
            chunk.append(lines[n])
            n += 1
        md = inline_html_to_md("\n".join(chunk), ctx)
        if md:
            blocks.append({"kind": "text", "md": md, "step": ctx.step})

    while i < len(text):
        if text.startswith("<!--", i):
            end = text.find("-->", i)
            end = len(text) if end < 0 else end
            note = text[i + 4:end].strip()
            if note and not re.fullmatch(r"=+.*=+", note):
                ctx.notes.append(note)
            i = end + 3
            continue
        if text[i] == "<" and re.match(r"<[A-Za-z]", text[i:i + 2]):
            el = take_element(text, i)
            if not el:
                buf.append(text[i])
                i += 1
                continue
            name, attrs, inner, end = el
            lname = name.lower()
            cls = attr(attrs, "class") or ""
            if lname == "div" and re.search(r"grid-cols-(\d+)", cls):
                flush()
                blocks.append(grid_block(int(re.search(r"grid-cols-(\d+)", cls).group(1)), inner, cls, ctx))
            elif lname == "div" and "absolute" in cls.split():
                flush()
                saved = ctx.step
                if has_flag(attrs, "v-click"):
                    ctx.step = ctx.next_step()
                sub = convert(inner, ctx)
                ctx.step = saved
                blocks.append({"kind": "abs", "left": tw_px(cls, "left"), "right": tw_px(cls, "right"),
                               "top": tw_px(cls, "top"), "bottom": tw_px(cls, "bottom"), "blocks": sub})
            elif lname == "v-switch":
                flush()
                blocks.append(switch_block(inner, ctx))
            elif lname == "div" and has_flag(attrs, "v-motion"):
                # where the motion leaves it (:enter, else :initial): moved, still taking its place
                flush()
                spec = attr(attrs, ":enter") or attr(attrs, ":initial") or ""
                num = lambda key: float((re.search(key + r"\s*:\s*(-?\d+(?:\.\d+)?)", spec) or [0, 0])[1])
                blocks.append({"kind": "shift", "dx": num("x"), "dy": num("y"), "blocks": convert(inner, ctx), "step": ctx.step})
            elif lname == "div" and has_flag(attrs, "v-click-hide") or (lname == "v-click" and has_flag(attrs, "hide")):
                # shown now, gone at the next click
                flush()
                gone = ctx.next_step()
                sub = convert(inner, ctx)
                set_until(sub, gone - 1)
                blocks.extend(sub)
            elif (lname in ("v-click", "div")) and re.fullmatch(r"\[\s*\d+\s*,\s*\d+\s*\]", (attr(attrs, "at") or attr(attrs, "v-click") or "").strip()):
                # v-click="[2, 4]": from click 2, gone at click 4
                flush()
                a, b = (int(v) for v in re.findall(r"\d+", attr(attrs, "at") or attr(attrs, "v-click")))
                saved = ctx.step
                ctx.step = a + 1
                ctx.clicks = max(ctx.clicks, b + 1)
                sub = convert(inner, ctx)
                set_until(sub, b)
                blocks.append({"kind": "switch", "options": [sub], "span": (a + 1, b), "step": 1})
                ctx.step = saved
            elif lname in ("v-click", "v-after") or (lname == "div" and (has_flag(attrs, "v-click") or has_flag(attrs, "v-after"))):
                flush()
                at = attr(attrs, "at") or (attr(attrs, "v-click") if lname == "div" else None)
                saved = ctx.step
                if lname == "v-after" or has_flag(attrs, "v-after"):
                    ctx.step = ctx.clicks  # with the previous click
                elif at and re.fullmatch(r"\d+", at):
                    ctx.clicks = max(ctx.clicks, int(at) + 1)
                    ctx.step = int(at) + 1
                else:
                    ctx.step = ctx.next_step()
                blocks.extend(convert(inner, ctx))
                ctx.step = saved
            elif lname == "v-clicks":
                flush()
                items = re.split(r"\n(?=\s*(?:[-*+]|\d+\.)\s)", "\n" + inner.strip())
                for it in [x for x in items if x.strip()]:
                    blocks.append({"kind": "text", "md": inline_html_to_md(it, ctx), "step": ctx.next_step(), "item": True})
            elif lname == "img":
                flush()
                blocks.append({"kind": "image", "src": attr(attrs, "src"), "width": float(attr(attrs, "width") or 0) or None,
                               "step": ctx.step, "center": "margin: 0 auto" in (attr(attrs, "style") or "") or ctx.center})
            elif lname == "arrow":
                flush()
                try:
                    pts = [float(attr(attrs, k)) for k in ("x1", "y1", "x2", "y2")]
                    blocks.append({"kind": "arrow", "pts": pts, "color": attr(attrs, "color") or "#000000",
                                   "width": float(attr(attrs, "width") or 2), "step": ctx.step})
                except (TypeError, ValueError):
                    pass
            elif name[0].isupper():
                flush()
                ctx.warnings.append(f"A <{name}> component was not converted.")
            elif lname == "div":
                flush()
                blocks.extend(convert(inner, ctx))
            else:  # inline / text HTML (h3, p, span, b ...): kept in the Markdown
                buf.append(text[i:end])
            i = end
            continue
        buf.append(text[i])
        i += 1
    flush()
    return merge_ranges(blocks)


def grid_block(n, inner, cls, ctx):
    """CSS grid: its children fill the columns in turn (row by row)."""
    items = []
    i, buf = 0, []

    def push_buf():
        md = "".join(buf)
        buf.clear()
        for part in re.split(r"\n\s*\n", md):
            if part.strip():
                items.append(part)
    s = inner
    while i < len(s):
        if s[i] == "<" and re.match(r"<[A-Za-z]", s[i:i + 2]):
            el = take_element(s, i)
            if el:
                push_buf()
                items.append(s[i:el[3]])
                i = el[3]
                continue
        if s.startswith("$$", i):
            end = s.find("$$", i + 2)
            end = len(s) if end < 0 else end + 2
            push_buf()
            items.append(s[i:end])
            i = end
            continue
        buf.append(s[i])
        i += 1
    push_buf()
    columns = [[] for _ in range(n)]
    for k, it in enumerate(items):
        columns[k % n].append(it)
    has_clicks = re.search(r"v-click|v-after|v-switch", inner) is not None
    cols = []
    for parts in columns:
        sub_ctx_blocks = convert("\n\n".join(parts), ctx) if has_clicks else None
        md = None if has_clicks else inline_html_to_md("\n\n".join(re.sub(r"^<div[^>]*>|</div>$", "", p.strip()) for p in parts), ctx)
        # its natural width (Slidev px): the widest <img width=...> in it
        natural = max([float(w) for w in re.findall(r'<img\b[^>]*\bwidth="(\d+(?:\.\d+)?)"', "\n".join(parts))] or [0])
        cols.append({"md": md, "blocks": sub_ctx_blocks, "natural": natural})
    return {"kind": "columns", "cols": cols, "gap": 5 * 4 if "gap-5" in cls else (40 if "gap-10" in cls else 16), "step": ctx.step}


# ---------- assets ----------

class Assets:
    def __init__(self, root, folder, linked, warnings):
        self.root, self.folder, self.linked, self.warnings = root, folder, linked, warnings
        self.copied = {}

    def find(self, src, base):
        if not src or re.match(r"^(https?:|data:)", src):
            return None
        cands = [os.path.join(self.root, "public", src.lstrip("/"))] if src.startswith("/") else []
        cands += [os.path.normpath(os.path.join(base, src)), os.path.normpath(os.path.join(self.root, src))]
        inside = re.sub(r"^(\./|\.\./)+", "", src)  # "./../figures/x" from the deck: its own figures/
        cands += [os.path.join(self.root, inside), os.path.join(self.root, "public", inside)]
        return next((c for c in cands if os.path.isfile(c)), None)

    def copy(self, src, base):
        p = self.find(src, base)
        if not p:
            if src and not re.match(r"^(https?:|data:)", src):
                self.warnings.append(f"Image not found: {src}")
            return None
        if p in self.copied:
            return self.copied[p]
        rel = os.path.relpath(p, self.root).replace("\\", "/")
        rel = re.sub(r"^(\.\./)+", "", rel)
        rel = rel if rel.startswith("figures/") else "figures/" + re.sub(r"^public/", "", rel)
        dest = os.path.join(self.folder, rel)
        os.makedirs(os.path.dirname(dest), exist_ok=True)
        if not os.path.exists(dest):
            shutil.copy2(p, dest)
        self.copied[p] = rel
        return rel

    def aspect(self, rel):
        try:
            from PIL import Image
            with Image.open(os.path.join(self.folder, rel)) as im:
                return im.height / im.width
        except Exception:
            return 0.75


# ---------- layout ----------

def text_height(md, width, fs):
    h = 0.0
    for m in re.finditer(r"\$\$(.*?)\$\$", md, flags=re.S):
        rows = max(1, m.group(1).count("\\\\") + 1)
        tall = 2.6 if re.search(r"\\(frac|sum|int|begin)", m.group(1)) else 1.8
        h += rows * tall * fs + 0.6 * fs
    md = re.sub(r"\$\$.*?\$\$", "", md, flags=re.S)
    plain = re.sub(r"<[^>]+>|\*\*|\*|`|\$", "", md)
    cpl = max(10, width / (0.5 * fs))
    lines = sum(max(1, -(-len(l) // int(cpl))) if l.strip() else 0.5 for l in plain.split("\n"))
    heading = len(re.findall(r"^#{1,6} ", md, flags=re.M))
    return h + lines * fs * 1.35 + heading * fs * 0.5 + 0.3 * fs


class Layout:
    def __init__(self, assets, fs):
        self.assets, self.fs = assets, fs

    def height(self, b, width, spacing=True):
        fs = self.fs
        k = b["kind"]
        if k == "text":
            return text_height(b["md"], width, fs)
        if k == "table":
            return len(b["rows"]) * fs * 1.8 + 0.4 * fs
        if k == "image":
            rel = self.assets.copy(b["src"], b.get("base", "")) if b.get("rel") is None else b["rel"]
            if not rel and b.get("src") and not re.match(r"^(https?:|data:)", b["src"]):
                rel = model.missing_figure_path(b["src"])  # a placeholder the compiled PDF may fill
                b["missing"] = b["src"]
            b["rel"] = rel
            if not rel:
                return 0
            w = min(width, (b["width"] or 400) * K)
            return w * self.assets.aspect(rel) + (0.3 * fs if spacing else 0)
        if k == "columns":
            n = len(b["cols"])
            cw = (width - b["gap"] * K * (n - 1)) / n
            return max(self.col_height(c, cw) for c in b["cols"])
        if k == "shift":  # moved, but taking its place in the flow (as in Slidev)
            return sum(self.height(sb, width) for sb in b["blocks"])
        if k == "switch":  # the options take the same place: the tallest one
            return max([sum(self.height(sb, width) for sb in opt) for opt in b["options"]] or [0])
        return 0

    def natural_width(self, blocks):
        """How wide blocks want to be (Slidev px): images by their width, grids
        by their columns; 0 when unknown (text wraps to any width)."""
        out = 0
        for b in blocks:
            if b["kind"] == "image":
                out = max(out, b["width"] or 400)
            elif b["kind"] == "columns":
                cols = [c.get("natural") or self.natural_width(c.get("blocks") or []) for c in b["cols"]]
                if all(cols):
                    out = max(out, sum(cols) + b["gap"] * (len(cols) - 1))
        return out

    def col_height(self, c, cw):
        if c["md"] is not None:
            # Markdown images fill the column's width, at their own aspect ratio
            imgs = re.findall(r"!\[[^\]]*\]\(([^)]+)\)", c["md"])
            text = re.sub(r"!\[[^\]]*\]\(([^)]+)\)", "", c["md"])
            h = sum(cw * self.assets.aspect(rel) for rel in imgs)
            return h + (text_height(text, cw, self.fs) if text.strip() else 0)
        return sum(self.height(b, cw) for b in c["blocks"] if b["kind"] not in ("abs", "arrow"))

    def place(self, blocks, x, y, width, out, base, center=False):
        fs = self.fs
        for b in blocks:
            b["base"] = base
            k = b["kind"]
            extra = {"step": b["step"]} if b.get("step", 1) > 1 else {}
            if b.get("until") is not None:
                extra["until"] = b["until"]
            if k == "shift":
                h = self.height(b, width)
                self.place(b["blocks"], x + b["dx"] * K, y + b["dy"] * K, width, out, base, center)
                y += h
                continue
            if k == "switch":
                h = self.height(b, width)
                for opt in b["options"]:
                    self.place(opt, x, y, width, out, base, center)
                y += h
                continue
            if k == "abs":
                left, right, top, bottom = b["left"], b["right"], b["top"], b["bottom"]
                # as wide as its content (a row of images), at least the usual box
                bw = max(360, self.natural_width(b["blocks"])) * K
                bw = min(bw, W - (left * K if left is not None else 0) - (right * K if right is not None else 0))
                hs = sum(self.height(sb, bw, spacing=False) for sb in b["blocks"])  # anchored: exact size
                ax = left * K if left is not None else (W - right * K - bw if right is not None else x)
                ay = top * K if top is not None else (H - bottom * K - hs if bottom is not None else y)
                self.place(b["blocks"], ax, ay, bw, out, base)
                continue
            if k == "arrow":
                x1, y1, x2, y2 = (v * K for v in b["pts"])
                out.append(model.path([(x1, y1), (x2, y2)], stroke=b["color"], width=b["width"] * K, end="arrow", **extra))
                continue
            h = self.height(b, width)
            if k == "text":
                out.append(model.text(x, y, width, h, b["md"], fs, align="center" if center or only_headings(b["md"]) else "left", **extra))
            elif k == "table":
                rows = b["rows"]
                out.append({"type": "table", "x": round(x), "y": round(y), "width": round(width), "height": round(h),
                            "rows": rows, "header": "yes", "borders": "horizontal", "fontSize": round(fs), **extra})
            elif k == "image" and b.get("rel"):
                w = min(width, (b["width"] or 400) * K)
                ix = x + (width - w) / 2 if (b.get("center") or center) else x
                out.append(model.figure(ix, y, w, w * self.assets.aspect(b["rel"]), b["rel"],
                                        **({"missing": b["missing"]} if b.get("missing") else {}), **extra))
            elif k == "columns":
                n = len(b["cols"])
                gap = b["gap"] * K
                cw = (width - gap * (n - 1)) / n
                if all(c["md"] is not None for c in b["cols"]):
                    out.append({"type": "columns", "x": round(x), "y": round(y), "width": round(width), "height": round(h),
                                "gap": round(gap), "fontSize": round(fs),
                                "columns": [{"width": round(100 / n), "content": c["md"],
                                             **({"align": "center"} if center or only_headings(c["md"]) else {})} for c in b["cols"]],
                                **extra})
                else:
                    for j, c in enumerate(b["cols"]):
                        self.place(c["blocks"], x + j * (cw + gap), y, cw, out, base, center)
            y += h
        return y


# ---------- slides ----------


def set_until(blocks, until):
    """`until` (the last step shown) on blocks that have none (nested ones too)."""
    for b in blocks or []:
        b.setdefault("until", until)
        set_until(b.get("blocks"), until)
        for c in b.get("cols") or []:
            set_until(c.get("blocks"), until)
        for opt in b.get("options") or []:
            set_until(opt, until)


def set_base(blocks, base):
    """The folder images are relative to, on every block (nested ones too)."""
    for b in blocks or []:
        b["base"] = base
        set_base(b.get("blocks"), base)
        for c in b.get("cols") or []:
            set_base(c.get("blocks"), base)
        for opt in b.get("options") or []:
            set_base(opt, base)

LAYOUT_CENTER = ("center", "cover", "intro", "section", "end", "fact", "statement", "quote")


def convert_slide(fm, content, base, assets, warnings, first):
    ctx = Ctx(base, assets, warnings)
    layout = fm.get("layout") or ("cover" if first else "default")
    ctx.center = "text-center" in (fm.get("class") or "") or layout in LAYOUT_CENTER
    els = []
    bg = fm.get("background") or (fm.get("image") if layout == "cover" else None)
    dark = False
    if bg:
        rel = assets.copy(bg, base)
        if rel:
            els.append(model.figure(0, 0, W, H, rel, locked="yes"))
            dark = layout == "cover"
    title = ""
    m = re.search(r"^#\s+(.+)$", content, flags=re.M)
    body = content
    if m:
        title = m.group(1).strip()
        body = content[:m.start()] + content[m.end():]
    fs = BASE
    margin_x = 56 * K
    top = 40 * K
    if title:
        tsize = (48 if layout in LAYOUT_CENTER else 36) * K
        if layout not in LAYOUT_CENTER:
            els.append(model.text(margin_x, top, W - 2 * margin_x, tsize * 1.5, f"**{title}**", tsize,
                                  colour="#ffffff" if dark else "#000000", align="center" if ctx.center else "left", valign="center"))
            top += tsize * 1.5 + 0.6 * fs
    # two-cols layout: ::right:: slot
    if layout in ("two-cols", "two-cols-header") and "::right::" in body:
        left, right = body.split("::right::", 1)
        left = re.sub(r"::left::", "", left)
        blocks = [{"kind": "columns", "gap": 16, "step": 1,
                   "cols": [{"md": inline_html_to_md(left, ctx), "blocks": None}, {"md": inline_html_to_md(right, ctx), "blocks": None}]}]
    else:
        blocks = convert(body, ctx)
    layout_engine = Layout(assets, fs)
    width = W - 2 * margin_x
    set_base(blocks, base)
    flow = [b for b in blocks if b["kind"] not in ("abs", "arrow")]
    need = sum(layout_engine.height(b, width) for b in flow) * 1.1
    avail = H - top - 30 * K
    scale = min(1.0, avail / need) if need else 1.0
    if scale < 1:
        layout_engine.fs = fs * max(0.55, scale)
        if scale < 0.6:
            warnings.append(f"A slide ({title or 'untitled'}) was very full and is shown smaller.")
    y0 = top
    if layout in LAYOUT_CENTER and need * scale < avail:
        y0 = top + (avail - need * scale) / 2
    if layout in LAYOUT_CENTER and title:
        tsize = 48 * K
        th = text_height(title, W - 2 * margin_x, tsize) * 1.05  # a long title wraps
        y0 = max(top, (H - need * scale - th) / 2)
        els.append(model.text(margin_x, y0, W - 2 * margin_x, th, f"**{title}**", tsize,
                              colour="#ffffff" if dark else "#000000", align="center", valign="center"))
        y0 += th + 0.4 * fs
    layout_engine.place(blocks, margin_x, y0, width, els, base, ctx.center)
    if dark:
        for e in els:
            if e["type"] == "text" and e.get("fontColor") == "#000000":
                e["fontColor"] = "#ffffff"
    slide = {"title": re.sub(r"[*$\\]", "", title) or "Slide", "elements": els}
    notes = [n for n in ctx.notes if len(n) > 1]
    if notes:
        slide["notes"] = notes[-1]
    return slide


def import_slidev(entry, project_folder, linked=True):
    warnings = []
    root = os.path.dirname(entry)
    assets = Assets(root, project_folder, linked, warnings)
    slides_src = expand(entry)
    head = slides_src[0][0] if slides_src else {}
    slides = []
    from . import progress
    for n, (fm, content, base) in enumerate(slides_src):
        progress.report("Converting the slides", n, len(slides_src))
        slides.append(convert_slide(fm, content, base, assets, warnings, n == 0))
    title = head.get("title") or (slides[0]["title"] if slides else "")
    if title == "Welcome to Slidev" and slides:
        title = slides[0]["title"]
    return {
        "title": title, "author": head.get("author", ""), "date": "",
        "width": W, "height": H,
        "slides": slides, "masters": [],
        "macros": katex_macros(root), "bib": "",
        "warnings": sorted(set(warnings), key=warnings.index),
    }
