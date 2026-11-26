# PyInstaller recipe for the installable app. Build with packaging/build.py
# (it downloads the libraries first), not by calling pyinstaller directly.
#
# Output in dist/:
#   Linux / Windows   GluonSlides/          the program and its files
#   macOS             GluonSlides.app
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

# Optional icons: packaging/icon.ico (Windows), icon.icns (macOS).
icon = None
for candidate in (["icon.ico"] if sys.platform == "win32" else ["icon.icns"] if sys.platform == "darwin" else []):
    if (ROOT / "packaging" / candidate).is_file():
        icon = str(ROOT / "packaging" / candidate)

a = Analysis(  # noqa: F821
    [str(ROOT / "app.py")],
    pathex=[str(ROOT)],
    datas=datas,
    hiddenimports=["backend.api"],
    excludes=["tkinter"],
    noarchive=False,
)
pyz = PYZ(a.pure)  # noqa: F821

exe = EXE(  # noqa: F821
    pyz,
    a.scripts,
    [],
    exclude_binaries=True,
    name="GluonSlides",
    console=False,  # a window app; `--self-check` output still works on Linux/macOS
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
        info_plist={"NSHighResolutionCapable": True},
    )
