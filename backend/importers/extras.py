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
    if name != "pymupdf":
        return {"success": False, "error": f"Unknown component: {name}"}
    wheel = PYMUPDF_WHEELS.get(_system())
    if not wheel:
        return {"success": False, "error": f"No PDF component for this system ({' '.join(_system())}); "
                                           "install PyMuPDF yourself (pip install pymupdf)."}
    url, sha = wheel
    fetch = fetch or _download
    try:
        data = fetch(url)
    except Exception as e:
        return {"success": False, "error": f"Could not download the PDF component: {e}"}
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


def _download(url):
    req = urllib.request.Request(url, headers={"User-Agent": "GluonSlides"})
    with urllib.request.urlopen(req, timeout=120) as res:
        return res.read()
