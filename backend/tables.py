"""CSV files for tables (elements/table/table.js).

A table can import a CSV once (its cells go into the .gl file) or link one:
the file is copied into <project>/data/ and, like linked figures, the copy
is refreshed when the original changes (a results file rewritten by a
script); the table shows the copy's cells.
"""

import csv
import io
import os
import shutil

MAX_CELLS = 20000      # what a slide table may hold
DEFAULT_ROWS = 20      # a big file shows its first rows (header included) until asked for more


def parse_csv(text, max_rows=None):
    """Rows of cells; the delimiter (comma, semicolon, tab) is detected."""
    text = text.lstrip("﻿")
    sample = text[:4096]
    try:
        dialect = csv.Sniffer().sniff(sample, delimiters=",;\t|")
    except csv.Error:
        dialect = csv.excel_tab if sample.count("\t") > sample.count(",") else csv.excel
    rows = [row for row in csv.reader(io.StringIO(text), dialect)]
    while rows and not any(c.strip() for c in rows[-1]):
        rows.pop()
    total = len(rows)
    if max_rows:
        rows = rows[:max(1, int(max_rows))]
    width = max((len(r) for r in rows), default=0)
    rows = [r + [""] * (width - len(r)) for r in rows]
    if width * len(rows) > MAX_CELLS:
        raise ValueError(f"Too large for a slide table ({len(rows)} rows × {width} columns): show fewer rows.")
    return rows, total


def _resolve(project_folder, path):
    if os.path.isabs(path):
        return path
    return os.path.join(project_folder or "", path)


def read_table_file(project_folder, path, max_rows=None):
    """{"success", "rows", "total", "mtime"} for a CSV (relative to the project, or
    absolute): its first `max_rows` rows (all when None), and how many it has."""
    try:
        p = _resolve(project_folder, path)
        with open(p, encoding="utf-8-sig", errors="replace", newline="") as f:
            rows, total = parse_csv(f.read(), max_rows)
        return {"success": True, "rows": rows, "total": total, "mtime": os.path.getmtime(p)}
    except Exception as e:
        return {"success": False, "error": str(e)}


def link_table_file(project_folder, source, max_rows=None):
    """Copies `source` into <project>/data/ (unique name): the table's data."""
    try:
        if not project_folder or not os.path.isdir(project_folder):
            return {"success": False, "error": "Save the project first: the data is copied into its folder."}
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
        res = read_table_file(project_folder, rel, max_rows)
        if not res.get("success"):
            return res
        return {**res, "relative_path": rel, "original": os.path.abspath(source)}
    except Exception as e:
        return {"success": False, "error": str(e)}


def refresh_tables(project_folder, items):
    """items: [{"src", "original", "mtime", "rows"?}]. Re-copies originals that changed
    and returns the cells of every copy newer than `mtime` (what the page has)."""
    updated = []
    try:
        for item in items or []:
            src, original = item.get("src") or "", item.get("original") or ""
            local = _resolve(project_folder, src)
            if original and os.path.isfile(original) and os.path.abspath(original) != os.path.abspath(local):
                o, l = os.stat(original), (os.stat(local) if os.path.isfile(local) else None)
                if l is None or int(o.st_mtime) != int(l.st_mtime) or o.st_size != l.st_size:
                    os.makedirs(os.path.dirname(local), exist_ok=True)
                    shutil.copy2(original, local)
            if os.path.isfile(local) and os.path.getmtime(local) != (item.get("mtime") or 0):
                res = read_table_file(project_folder, src, item.get("rows"))
                if res.get("success"):
                    updated.append({"src": src, "rows": res["rows"], "total": res["total"], "mtime": res["mtime"]})
        return {"success": True, "updated": updated}
    except Exception as e:
        return {"success": False, "error": str(e), "updated": updated}
