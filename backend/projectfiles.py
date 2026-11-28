"""Copying a file into the project (figures/, data/): the one step that
figures, tables, plot data, choices and variable files use when they link
or import a file, so the same file isn't copied twice.

  1. a file already inside the project is used where it is;
  2. an original another element already links: its copy;
  3. a file with the same content already in the folder (any name; sizes
     compared first, then SHA-256): that file, unless an element links it
     to a different original (two experiments' results.csv, equal today,
     may differ after a rerun: each keeps its own copy);
  4. otherwise a new copy, with a name not used yet (run.csv, run_1.csv…).

`linked`: [{"copy": "data/run.csv", "original": "/home/me/exp/run.csv"}]
— what the project's elements link now (the page knows it).
"""

import hashlib
import os
import shutil


def _rel(path, project_folder):
    return os.path.relpath(path, project_folder).replace("\\", "/")


def _inside(path, folder):
    path, folder = os.path.abspath(path), os.path.abspath(folder)
    return os.path.commonpath([path, folder]) == folder


def file_hash(path):
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def _linked_map(project_folder, linked):
    """{copy (relative, /): original (absolute)} for the links given."""
    out = {}
    for item in linked or []:
        copy, original = (item or {}).get("copy"), (item or {}).get("original")
        if not copy or not original:
            continue
        copy_abs = copy if os.path.isabs(copy) else os.path.join(project_folder, copy)
        out[_rel(copy_abs, project_folder)] = os.path.abspath(original)
    return out


def copy_into(project_folder, source, subdir, linked=None):
    """The path (relative to the project, with /) of `source` inside the project, copying it into `subdir` only when needed."""
    if not project_folder or not os.path.isdir(project_folder):
        raise ValueError("Save the project first: the file is copied into its folder.")
    src = os.path.abspath(source)
    if not os.path.isfile(src):
        raise FileNotFoundError(f"{os.path.basename(src)}: no such file")
    # 1. already in the project
    if _inside(src, project_folder):
        return _rel(src, project_folder)
    links = _linked_map(project_folder, linked)
    # 2. this original is linked already
    for copy, original in links.items():
        if original == src and os.path.isfile(os.path.join(project_folder, copy)):
            return copy
    folder = os.path.join(project_folder, subdir)
    os.makedirs(folder, exist_ok=True)
    # 3. the same content, under any name
    size = os.path.getsize(src)
    wanted = None
    for name in sorted(os.listdir(folder)):
        path = os.path.join(folder, name)
        if not os.path.isfile(path) or os.path.getsize(path) != size:
            continue
        rel = _rel(path, project_folder)
        if links.get(rel, src) != src:
            continue  # another original's copy
        if wanted is None:
            wanted = file_hash(src)
        if file_hash(path) == wanted:
            return rel
    # 4. a new copy
    base, ext = os.path.splitext(os.path.basename(src))
    dest = os.path.join(folder, base + ext)
    n = 1
    while os.path.exists(dest):
        dest = os.path.join(folder, f"{base}_{n}{ext}")
        n += 1
    shutil.copy2(src, dest)
    return _rel(dest, project_folder)


def unused_files(project_folder, used=None, text="", folders=("data", "figures")):
    """Files in data/ and figures/ that nothing uses: [{"path", "size"}]. `used`: relative
    paths in use; `text`: the project's text (its .gl, macros…): a file named there is used."""
    keep = set()
    for u in used or []:
        if not u:
            continue
        p = u if os.path.isabs(u) else os.path.join(project_folder, u)
        keep.add(os.path.abspath(p))
    out = []
    for sub in folders:
        folder = os.path.join(project_folder or "", sub)
        if not os.path.isdir(folder):
            continue
        for name in sorted(os.listdir(folder)):
            path = os.path.join(folder, name)
            rel = _rel(path, project_folder)
            if text and (rel in text or rel.replace("/", "\\") in text):
                continue
            if os.path.isfile(path) and not name.startswith(".") and os.path.abspath(path) not in keep:
                out.append({"path": _rel(path, project_folder), "size": os.path.getsize(path)})
    return out


def delete_files(project_folder, paths, folders=("data", "figures")):
    """Deletes these files (only inside data/ and figures/): {"deleted": [...], "errors": [...]}."""
    deleted, errors = [], []
    allowed = [os.path.join(project_folder, f) for f in folders]
    for rel in paths or []:
        path = os.path.abspath(os.path.join(project_folder, rel))
        if not any(_inside(path, a) for a in allowed) or not os.path.isfile(path):
            errors.append(f"{rel}: not a file of data/ or figures/")
            continue
        try:
            os.remove(path)
            deleted.append(rel)
        except OSError as e:
            errors.append(f"{rel}: {e}")
    return {"deleted": deleted, "errors": errors}
