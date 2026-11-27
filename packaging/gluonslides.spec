# PyInstaller recipe for the installable app. Build with packaging/build.py
# (it downloads the libraries first), not by calling pyinstaller directly.
#
# Output in dist/:
#   Linux / Windows   GluonSlides/          the program and its files
#   macOS             GluonSlides.app
#
# Kept small: packages the app never uses are excluded (PyInstaller finds
# them as optional imports of other packages), and on Linux the desktop's
# own GTK/WebKitGTK and system libraries are used, not copies.
import sys
from pathlib import Path

ROOT = Path(SPECPATH).parent  # noqa: F821  (SPECPATH is set by PyInstaller)
sys.path.insert(0, str(ROOT))
from backend import __version__  # noqa: E402

# Everything the page loads at runtime, at the same place as in the repository.
FILES = ["index.html", "main.js", "style.css", "text-styles.css", "dependencies.yaml", "LICENSE"]
FOLDERS = ["core", "editor", "elements", "export", "ui", "present", "libs"]

datas = [(str(ROOT / f), ".") for f in FILES]
datas += [(str(ROOT / d), d) for d in FOLDERS]

# Icons made by build.py (from packaging/icon.png, or a placeholder).
ICONS = ROOT / "packaging" / "generated"
icon = None
for candidate in (["icon.ico"] if sys.platform == "win32" else ["icon.icns"] if sys.platform == "darwin" else []):
    if (ICONS / candidate).is_file():
        icon = str(ICONS / candidate)
if (ICONS / "icon.png").is_file():
    datas.append((str(ICONS / "icon.png"), "."))  # the window's icon (Linux)

# Optional imports of other packages that the app does not need.
UNUSED = [
    "tkinter", "numpy", "scipy", "matplotlib", "pandas", "IPython", "jupyter",  # (lxml: python-pptx needs it)
    "cryptography", "bcrypt", "tornado", "psutil", "jinja2", "markupsafe",
    "lz4", "unicodedata2", "sympy", "PyQt5", "PyQt6", "PySide2", "PySide6", "qtpy", "test",
    "pymupdf", "fitz",  # optional: downloaded on the first PDF import (backend/importers/extras.py)
    "onnxruntime",      # optional: downloaded when equations are to be read (extras.py, latex_ocr.py)
    # Linux system packages (seen when the system's packages are visible);
    # Debian's pkg_resources breaks once bundled. Not setuptools/distutils:
    # PyInstaller maps distutils onto setuptools' copy (cffi on Windows needs it).
    # Nothing setuptools vendors (wheel, packaging, jaraco...): PyInstaller
    # maps those names onto setuptools' copies, and an excluded name clashes.
    "pkg_resources",
    "keyring", "httplib2", "zope", "launchpadlib", "lazr", "wadllib", "dbus", "secretstorage", "jeepney",
]
if sys.platform.startswith("linux"):
    UNUSED += ["cffi", "_cffi_backend"]  # Windows needs it (pythonnet's clr_loader)

# Linux: libraries of the system (GTK, GLib, X11, OpenSSL...) come from the
# desktop. Kept: Python itself and libraries shipped inside pip packages
# (e.g. pillow.libs), and Python's own modules (lib-dynload, gi's _gi).
def system_library(src):
    src = str(src)
    if "/python3" in src or "site-packages" in src or "/.venv/" in src:
        return False
    if Path(src).name.startswith("libpython3"):
        return False
    return src.startswith(("/usr/lib", "/lib", "/usr/local/lib"))


GTK_DATA = ("share/icons", "share/themes", "share/locale", "share/glib-2.0", "share/fontconfig",
            "share/mime", "gi_typelibs", "lib/gdk-pixbuf", "lib/gio", "gio_modules", "etc/")

a = Analysis(  # noqa: F821
    [str(ROOT / "app.py")],
    pathex=[str(ROOT)],
    datas=datas,
    hiddenimports=["backend.api"],
    excludes=UNUSED,
    noarchive=False,
)

if sys.platform.startswith("linux"):
    a.binaries = [b for b in a.binaries if not system_library(b[1])]
    a.datas = [d for d in a.datas if not d[0].replace("\\", "/").startswith(GTK_DATA)]

pyz = PYZ(a.pure)  # noqa: F821

exe = EXE(  # noqa: F821
    pyz,
    a.scripts,
    [],
    exclude_binaries=True,
    name="GluonSlides",
    console=False,  # a window app; `--self-check` output still works on Linux/macOS
    argv_emulation=sys.platform == "darwin",  # macOS: a double-clicked .gl arrives as an argument
    icon=icon,
)

coll = COLLECT(exe, a.binaries, a.datas, name="GluonSlides")  # noqa: F821

if sys.platform == "darwin":
    app = BUNDLE(  # noqa: F821
        coll,
        name="GluonSlides.app",
        icon=icon,
        bundle_identifier="io.github.gluonslides",
        version=__version__,
        info_plist={
            "NSHighResolutionCapable": True,
            # .gl project files open in GluonSlides (double-click, Open With)
            "CFBundleDocumentTypes": [{
                "CFBundleTypeName": "GluonSlides project",
                "CFBundleTypeRole": "Editor",
                "LSHandlerRank": "Owner",
                "LSItemContentTypes": ["io.github.gluonslides.project"],
            }],
            "UTExportedTypeDeclarations": [{
                "UTTypeIdentifier": "io.github.gluonslides.project",
                "UTTypeDescription": "GluonSlides project",
                "UTTypeConformsTo": ["public.plain-text"],
                "UTTypeTagSpecification": {"public.filename-extension": ["gl"]},
            }],
        },
    )
