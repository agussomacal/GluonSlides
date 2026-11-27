"""Variable files (core/variables.js): values that text (\\var{name}) and
plots use, read from a JSON or CSV file your scripts write.

    .vars {data/summary.json} sync:yes original:"/home/me/run/summary.json"

Like a linked table, the file is copied into <project>/data/ and the copy
follows the original when it changes.

JSON: an object; nested objects give dotted names ({"fit": {"err": 0.1}}
-> fit.err); lists are skipped. CSV: two columns are name,value rows (a
first row "name,value" is a header); more columns are a header of names
and a row of values (the last row: a log your script appends to).
Numbers become numbers, the rest stays text.
"""

import json
import os
import re

from . import tables

NAME = re.compile(r"^[A-Za-z_][A-Za-z0-9_.]*$")
HEADER_WORDS = {"name", "names", "key", "keys", "variable", "variables", "var", "parameter", "parameters"}


def _value(v):
    """A number when it reads as one, else the text."""
    if isinstance(v, bool):
        return 1 if v else 0
    if isinstance(v, (int, float)):
        return v
    s = str(v).strip()
    try:
        f = float(s)
        return int(f) if re.fullmatch(r"[+-]?\d+", s) else f
    except ValueError:
        return s


def _clean_name(name):
    n = re.sub(r"[^A-Za-z0-9_.]", "_", str(name).strip())
    if n and n[0].isdigit():
        n = "_" + n
    return n


def flatten(obj, prefix=""):
    out = {}
    for k, v in (obj or {}).items():
        name = _clean_name(f"{prefix}{k}")
        if isinstance(v, dict):
            out.update(flatten(v, name + "."))
        elif isinstance(v, (list, tuple)) or v is None:
            continue
        elif name and NAME.match(name):
            out[name] = _value(v)
    return out


def parse_vars(text, ext):
    """{name: value} from a file's text."""
    if ext == ".json":
        data = json.loads(text.lstrip("﻿") or "{}")
        if not isinstance(data, dict):
            raise ValueError("The JSON file should hold an object: {\"name\": value, ...}")
        return flatten(data)
    rows, _total = tables.parse_csv(text)
    rows = [r for r in rows if any(c.strip() for c in r)]
    if not rows:
        return {}
    width = max(len(r) for r in rows)
    out = {}
    if width <= 2:
        if rows[0][0].strip().lower() in HEADER_WORDS:
            rows = rows[1:]
        for r in rows:
            name = _clean_name(r[0]) if r else ""
            if name and NAME.match(name) and len(r) > 1:
                out[name] = _value(r[1])
        return out
    header = [_clean_name(c) for c in rows[0]]
    if len(rows) < 2:
        return {}
    last = rows[-1]
    for name, value in zip(header, last):
        if name and NAME.match(name) and str(value).strip() != "":
            out[name] = _value(value)
    return out


def read_vars_file(project_folder, path):
    """{"success", "values", "mtime"} for a variable file (relative to the project, or absolute)."""
    try:
        p = tables._resolve(project_folder, path)
        ext = os.path.splitext(p)[1].lower()
        if ext not in (".json", ".csv", ".tsv", ".txt"):
            return {"success": False, "error": "Variables come from a .json or .csv file."}
        with open(p, encoding="utf-8-sig", errors="replace", newline="") as f:
            values = parse_vars(f.read(), ext)
        return {"success": True, "values": values, "mtime": os.path.getmtime(p)}
    except Exception as e:
        return {"success": False, "error": f"{os.path.basename(str(path))}: {e}"}


def link_vars_file(project_folder, source):
    """Copies `source` into <project>/data/ (a unique name): its variables, and where it went."""
    import shutil
    try:
        if not project_folder or not os.path.isdir(project_folder):
            return {"success": False, "error": "Save the project first: the file is copied into its folder."}
        if os.path.splitext(source)[1].lower() not in (".json", ".csv", ".tsv", ".txt"):
            return {"success": False, "error": "Variables come from a .json or .csv file."}
        data_dir = os.path.join(project_folder, "data")
        os.makedirs(data_dir, exist_ok=True)
        base, ext = os.path.splitext(os.path.basename(source))
        dest = os.path.join(data_dir, base + ext)
        n = 1
        while os.path.exists(dest) and os.path.abspath(dest) != os.path.abspath(source):
            dest = os.path.join(data_dir, f"{base}_{n}{ext}")
            n += 1
        if os.path.abspath(dest) != os.path.abspath(source):
            shutil.copy2(source, dest)
        rel = os.path.relpath(dest, project_folder).replace("\\", "/")
    except Exception as e:
        return {"success": False, "error": str(e)}
    got = read_vars_file(project_folder, rel)
    if not got.get("success"):
        return got
    return {**got, "relative_path": rel, "original": os.path.abspath(source)}


def refresh_vars(project_folder, items):
    """items: [{"src", "original", "mtime"}]. Re-copies originals that changed and
    returns the values of every copy newer than `mtime` (what the page has)."""
    updated = []
    try:
        for item in items or []:
            src = item.get("src") or ""
            tables.refresh_tables(project_folder, [{"src": src, "original": item.get("original") or "", "mtime": -1, "rows": 1}])
            local = tables._resolve(project_folder, src)
            if os.path.isfile(local) and os.path.getmtime(local) != (item.get("mtime") or 0):
                res = read_vars_file(project_folder, src)
                updated.append({"src": src, **res})
        return {"success": True, "updated": updated}
    except Exception as e:
        return {"success": False, "error": str(e), "updated": updated}
