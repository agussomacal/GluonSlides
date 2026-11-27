"""Optional components, downloaded the first time they are needed.

PDF import uses PyMuPDF (AGPL-3.0, compatible with GluonSlides' GPL-3.0),
about 20-25 MB, so it is not in the app: the first PDF import asks, then
downloads the wheel for this system from PyPI, checks its SHA-256 against
the value below (a tampered or wrong file is refused), and unpacks it in
the user's data folder. From source, `uv sync --extra pdf` installs it.

The wheels are "abi3": one file per system runs on Python 3.10 and later.
"""

import hashlib
import os
import platform
import sys
import tempfile
import urllib.request
import zipfile

from platformdirs import user_data_dir

PYMUPDF_VERSION = "1.28.2"
_BASE = "https://files.pythonhosted.org/packages/"
PYMUPDF_WHEELS = {  # (system, machine) -> (url, sha256), from uv.lock
    ("linux", "x86_64"): (_BASE + "c7/06/dace3e27af26690cb20bead80dbac42941b0841eb689b8aabbd67dde16f0/pymupdf-1.28.2-cp310-abi3-manylinux_2_28_x86_64.whl",
                          "397d6715c1f0df7548a92d0afd8ce370fc48fa47aeefac16be2bc04a16a8227f"),
    ("linux", "aarch64"): (_BASE + "d2/86/4a68f080b71b46802178346af46486e1697508e760855ff5f3b218a6dff7/pymupdf-1.28.2-cp310-abi3-manylinux_2_28_aarch64.whl",
                           "3050a233dde1211efe89ada74e2add6238436434159f46097a1423aad2842545"),
    ("darwin", "arm64"): (_BASE + "fa/01/3591f781b417b382a8487a2356e927acfe858b1043bab0ec47f6805bb109/pymupdf-1.28.2-cp310-abi3-macosx_11_0_arm64.whl",
                          "7113846b35dbf0a033f088e4f4fb543dabeb4b0b12c112966a1ca1ee2d5eacae"),
    ("darwin", "x86_64"): (_BASE + "b4/51/550c9a75c4ff3245cb4ecb7bb95cbe2ab7374230b8e2b7a1f7259444150b/pymupdf-1.28.2-cp310-abi3-macosx_10_15_x86_64.whl",
                           "5fc315b425ff1f7afdd1ea2f348205cb19b806767daae7ce4d64115799c2bae1"),
    ("win32", "amd64"): (_BASE + "4a/61/d563bbccba262f9dd6d2d35ccb72593648184d886188efb12d9ce8f34dd6/pymupdf-1.28.2-cp310-abi3-win_amd64.whl",
                         "ebd244918798502d7b4504c90410d1711a4d7675a32584ca30f1bab419ecbffe"),
}
PYMUPDF_MESSAGE = ("PDF import needs an extra component (PyMuPDF, about 25 MB, from PyPI). "
                   "It is downloaded once and kept for later imports. Download it now?")


def extras_dir():
    return os.path.join(os.environ.get("GLUONSLIDES_DATA_DIR") or user_data_dir("gluonslides"), "extras")


def _target():
    return os.path.join(extras_dir(), f"pymupdf-{PYMUPDF_VERSION}")


def _system():
    system = "win32" if sys.platform == "win32" else "darwin" if sys.platform == "darwin" else "linux"
    machine = platform.machine().lower()
    machine = {"x86_64": "x86_64", "amd64": "amd64" if system == "win32" else "x86_64",
               "arm64": "arm64" if system == "darwin" else "aarch64", "aarch64": "aarch64"}.get(machine, machine)
    return system, machine


def load_pymupdf():
    """The pymupdf module (installed, or downloaded earlier), or None."""
    try:
        import pymupdf
        return pymupdf
    except ImportError:
        pass
    target = _target()
    if os.path.isdir(os.path.join(target, "pymupdf")):
        if target not in sys.path:
            sys.path.insert(0, target)
        try:
            import pymupdf
            return pymupdf
        except ImportError:
            return None
    return None


def install(name="pymupdf", fetch=None):
    """Downloads and unpacks the component; {"success"} or {"success": False, "error"}."""
    if name == "equations":
        return install_equations(fetch)
    if name != "pymupdf":
        return {"success": False, "error": f"Unknown component: {name}"}
    wheel = PYMUPDF_WHEELS.get(_system())
    if not wheel:
        return {"success": False, "error": f"No PDF component for this system ({' '.join(_system())}); "
                                           "install PyMuPDF yourself (pip install pymupdf)."}
    url, sha = wheel
    from . import progress

    def report(done, total):
        mb = 1024 * 1024
        progress.report("Downloading the PDF component (MB)", done // mb, total // mb if total else 0)

    try:
        data = fetch(url) if fetch else _download(url, report)
    except Exception as e:
        from ..desktop import debug
        debug(f"[extras] could not download {url}: {e!r}")
        return {"success": False, "error": f"Could not download the PDF component: {e}"}
    finally:
        progress.reset()
    if hashlib.sha256(data).hexdigest() != sha:
        return {"success": False, "error": "The downloaded PDF component is not the expected file; nothing was installed."}
    target = _target()
    os.makedirs(extras_dir(), exist_ok=True)
    with tempfile.TemporaryDirectory(dir=extras_dir()) as tmp:
        wheel_path = os.path.join(tmp, "pymupdf.whl")
        with open(wheel_path, "wb") as f:
            f.write(data)
        unpack = os.path.join(tmp, "unpacked")
        with zipfile.ZipFile(wheel_path) as zf:
            root = os.path.realpath(unpack)
            for info in zf.infolist():
                dest = os.path.realpath(os.path.join(unpack, info.filename))
                if not dest.startswith(root + os.sep):
                    continue
                zf.extract(info, unpack)
        if os.path.isdir(target):
            import shutil
            shutil.rmtree(target)
        os.replace(unpack, target)
    if load_pymupdf() is None:
        return {"success": False, "error": "The PDF component was downloaded but could not be loaded."}
    return {"success": True}


def _download(url, report=None):
    """The file at `url`; report(done_bytes, total_bytes) as it comes."""
    from ..net import open_url
    req = urllib.request.Request(url, headers={"User-Agent": "GluonSlides"})
    with open_url(req, timeout=60) as res:
        total = int(res.headers.get("Content-Length") or 0)
        chunks, done = [], 0
        while True:
            chunk = res.read(256 * 1024)
            if not chunk:
                break
            chunks.append(chunk)
            done += len(chunk)
            if report:
                report(done, total)
        return b"".join(chunks)


# ---------- Equation recognition (latex_ocr.py) ----------
# onnxruntime (and numpy if the app has none) from PyPI, the wheel for this
# system and Python checked against PyPI's SHA-256; the model files from the
# RapidLaTeXOCR release, checked against latex_ocr.MODEL_FILES.

ORT_VERSION = "1.32.0"
EQUATIONS_MESSAGE = ("Recognising equations needs an extra component (ONNX Runtime and a LaTeX-OCR model, "
                     "about 220 MB, from PyPI and GitHub). It is downloaded once. Download it now?")


def _equations_dir():
    return os.path.join(extras_dir(), "equations")


def _equations_path():
    site = os.path.join(_equations_dir(), "site")
    if os.path.isdir(site) and site not in sys.path:
        sys.path.insert(0, site)


_reader = None


def equation_reader():
    """The EquationReader, loaded once (its models take a moment to load), or None."""
    global _reader
    if _reader is None:
        _reader = load_equation_reader()
    return _reader


def load_equation_reader():
    """An EquationReader (latex_ocr.py), or None when the component is missing."""
    from . import latex_ocr
    models = os.path.join(_equations_dir(), "models")
    if not all(os.path.isfile(os.path.join(models, n)) and os.path.getsize(os.path.join(models, n)) == size
               for n, (size, _sha) in latex_ocr.MODEL_FILES.items()):
        return None
    _equations_path()
    try:
        import numpy  # noqa: F401
        import onnxruntime  # noqa: F401
    except ImportError:
        return None
    try:
        return latex_ocr.EquationReader(models)
    except Exception:
        return None


def wheel_fits(filename, system=None, py=None):
    """Whether a wheel (name-ver-py-abi-platform.whl) runs here: this Python
    (cp3XY or abi3) and this system and machine."""
    system, machine = system or _system()
    py = py or f"cp{sys.version_info[0]}{sys.version_info[1]}"
    parts = filename[:-4].split("-")
    if len(parts) < 5:
        return False
    pytag, abi, plat = parts[-3], parts[-2], parts[-1]
    free_threaded = bool(getattr(sys, "_is_gil_enabled", lambda: True)() is False)
    if abi.endswith("t") and abi.startswith("cp") and not free_threaded:
        return False  # the build for Python without the GIL
    if not (py in pytag.split(".") or (abi == "abi3" and pytag.startswith("cp3") and int(pytag[3:].split(".")[0]) <= int(py[3:]))):
        return False
    plats = plat.split(".")
    if system == "linux":
        return any(p.startswith("manylinux") and p.endswith(machine) for p in plats)
    if system == "darwin":
        return any(p.startswith("macosx") and (p.endswith(machine) or p.endswith("universal2")) for p in plats)
    if system == "win32":
        return any(p == {"amd64": "win_amd64", "x86_64": "win_amd64", "arm64": "win_arm64"}.get(machine, "") for p in plats)
    return False


def _pypi_wheel(name, version=None, fetch=None):
    """(url, sha256) of the wheel of `name` (`version`, else the latest) that runs here."""
    import json
    fetch = fetch or _download
    url = f"https://pypi.org/pypi/{name}/{version}/json" if version else f"https://pypi.org/pypi/{name}/json"
    info = json.loads(fetch(url).decode("utf-8"))
    fits = [u for u in info.get("urls", []) if u["filename"].endswith(".whl") and wheel_fits(u["filename"])]
    if not fits:
        raise OSError(f"no {name} for this system ({' '.join(_system())}, Python {sys.version_info[0]}.{sys.version_info[1]})")
    fits.sort(key=lambda u: ("abi3" in u["filename"], u["filename"]))  # this Python's own build first
    return fits[0]["url"], fits[0]["digests"]["sha256"]


def _unpack(data, dest):
    os.makedirs(dest, exist_ok=True)
    root = os.path.realpath(dest)
    import io
    with zipfile.ZipFile(io.BytesIO(data)) as zf:
        for info in zf.infolist():
            target = os.path.realpath(os.path.join(dest, info.filename))
            if target.startswith(root + os.sep):
                zf.extract(info, dest)


def install_equations(fetch=None):
    from . import latex_ocr, progress
    fetch = fetch or _download
    site = os.path.join(_equations_dir(), "site")
    models = os.path.join(_equations_dir(), "models")
    mb = 1024 * 1024
    try:
        packages = [("onnxruntime", ORT_VERSION)]
        try:
            import numpy  # noqa: F401
        except ImportError:
            packages.append(("numpy", None))
        for name, version in packages:
            progress.report(f"Downloading {name}", 0, 0)
            url, sha = _pypi_wheel(name, version, fetch)
            data = fetch(url) if fetch is not _download else _download(url, lambda d, t: progress.report(f"Downloading {name} (MB)", d // mb, t // mb))
            if hashlib.sha256(data).hexdigest() != sha:
                return {"success": False, "error": f"The downloaded {name} is not the expected file; nothing was installed."}
            _unpack(data, site)
        os.makedirs(models, exist_ok=True)
        for n, (size, sha) in latex_ocr.MODEL_FILES.items():
            dest = os.path.join(models, n)
            if os.path.isfile(dest) and os.path.getsize(dest) == size:
                continue
            url = latex_ocr.MODEL_URL + n
            data = fetch(url) if fetch is not _download else _download(url, lambda d, t, n=n: progress.report(f"Downloading the model: {n} (MB)", d // mb, t // mb))
            if hashlib.sha256(data).hexdigest() != sha:
                return {"success": False, "error": f"The downloaded {n} is not the expected file; nothing was installed."}
            with open(dest, "wb") as f:
                f.write(data)
    except Exception as e:
        from ..desktop import debug
        debug(f"[extras] equations: {e!r}")
        return {"success": False, "error": f"Could not download the equation component: {e}"}
    finally:
        progress.reset()
    if load_equation_reader() is None:
        return {"success": False, "error": "The equation component was downloaded but could not be loaded."}
    return {"success": True}
