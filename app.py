"""GluonSlides launcher: `python app.py` or `uv run app.py`.

    --version      print the version and exit
    --self-check   check that the app's files and Python packages are all
                   there, without opening a window (used on bundled builds)
    --smoke-test   open the window, check the page started (its JavaScript
                   ran to the end), close it; exit code 0 if it did
    FILE.gl        open this project (what a double-click on a .gl file does)
"""

import os
import sys

from backend import APP_DIR, FROZEN, __version__
from backend.snap_env import sanitize_snap_environment


def self_check():
    """Exit code 0 if this copy of the app can start (files, libraries, imports)."""
    import yaml

    problems = []
    for name in ("index.html", "main.js", "style.css", "present/viewer.js", "dependencies.yaml"):
        if not (APP_DIR / name).is_file():
            problems.append(f"missing {name}")
    config = yaml.safe_load((APP_DIR / "dependencies.yaml").read_text(encoding="utf-8")) if (APP_DIR / "dependencies.yaml").is_file() else {}
    for dep in config.get("dependencies") or []:
        path = APP_DIR / "libs" / dep.get("subdir", "") / dep["name"]
        if not path.is_file():
            problems.append(f"missing library {dep['name']}")
    for font in config.get("fonts") or []:
        if not (APP_DIR / "libs" / "fonts" / font["name"]).is_file():
            problems.append(f"missing font {font['name']}")
    try:
        import webview  # noqa: F401
        from backend.api import Api  # noqa: F401
        import PIL, fontTools, pdf2image, platformdirs  # noqa: F401,E401
    except Exception as e:
        problems.append(f"import failed: {e}")
    if not problems:
        problems += _exercise_backend()
    print(f"GluonSlides {__version__} ({'bundled' if FROZEN else 'from source'}) at {APP_DIR}")
    for p in problems:
        print(f"  problem: {p}")
    print("OK" if not problems else f"{len(problems)} problem(s)")
    return 0 if not problems else 1


def use_desktop_gtk():
    """Bundled on Linux: PyInstaller points GTK/GLib at copies inside the
    bundle (left out to keep it small): use the desktop's own instead."""
    if not FROZEN or not sys.platform.startswith("linux"):
        return
    inside = str(APP_DIR)
    for key in ("GI_TYPELIB_PATH", "GDK_PIXBUF_MODULE_FILE", "GDK_PIXBUF_MODULEDIR", "GTK_DATA_PREFIX",
                "GTK_EXE_PREFIX", "GTK_PATH", "GTK_IM_MODULE_FILE", "GIO_MODULE_DIR", "GSETTINGS_SCHEMA_DIR",
                "XDG_DATA_DIRS", "FONTCONFIG_FILE", "FONTCONFIG_PATH", "GTK_THEME"):
        value = os.environ.get(key)
        if value is None or inside not in value:
            continue
        kept = [p for p in value.split(os.pathsep) if p and inside not in p]
        if kept:
            os.environ[key] = os.pathsep.join(kept)
        else:
            os.environ.pop(key)


def _exercise_backend():
    """Runs each kind of backend work once in a temporary folder, so a bundle
    missing a package fails here, not when someone exports a PDF."""
    import base64
    import io
    import tempfile

    from PIL import Image

    problems = []

    def step(name, fn):
        try:
            res = fn()
            if isinstance(res, dict) and res.get("success") is False:
                problems.append(f"{name}: {res.get('error')}")
        except Exception as e:
            problems.append(f"{name}: {type(e).__name__}: {e}")

    with tempfile.TemporaryDirectory() as tmp:
        from backend import figures, fonts, pdf_export, project_io

        buf = io.BytesIO()
        Image.new("RGB", (8, 4), "red").save(buf, format="PNG")
        png = "data:image/png;base64," + base64.b64encode(buf.getvalue()).decode()
        step("project file", lambda: project_io.save_project_data(f"{tmp}/t.gl", ".project {T} version:2\n"))
        step("project file read", lambda: project_io.load_project_at(f"{tmp}/t.gl"))
        step("figure save", lambda: figures.save_figure_data(tmp, png, "check"))
        step("figure load", lambda: figures.load_figure_data_uri(tmp, "figures/check.png"))
        step("PDF from images", lambda: pdf_export.images_to_pdf([png, png], f"{tmp}/t.pdf"))
        font = next((APP_DIR / "libs" / "fonts").glob("*.woff2"), None)
        if font:  # reading and writing woff2 needs fontTools + brotli
            def woff2_round_trip():
                from fontTools.ttLib import TTFont
                face = TTFont(str(font))
                face.flavor = "woff2"
                face.save(io.BytesIO())
            step("fonts (woff2)", woff2_round_trip)
            step("font licence", lambda: fonts.font_license(str(font)))
        step("system fonts", fonts.list_system_fonts)
    return problems


MIME_XML = """<?xml version="1.0" encoding="UTF-8"?>
<mime-info xmlns="http://www.freedesktop.org/standards/shared-mime-info">
  <mime-type type="application/x-gluonslides">
    <comment>GluonSlides project</comment>
    <sub-class-of type="text/plain"/>
    <glob pattern="*.gl"/>
    <icon name="gluonslides"/>
  </mime-type>
</mime-info>
"""


def add_to_applications_menu():
    """Run as an AppImage (Linux sets $APPIMAGE): add GluonSlides to the
    applications menu, pointing at this file (kept up to date if it moves),
    and make .gl files open with it (double-click).
    To undo: remove gluonslides.desktop (~/.local/share/applications),
    gluonslides.xml (~/.local/share/mime/packages) and the icon."""
    appimage = os.environ.get("APPIMAGE")
    if not appimage or not sys.platform.startswith("linux"):
        return
    try:
        from pathlib import Path
        import shutil
        import subprocess

        data = Path(os.environ.get("XDG_DATA_HOME") or Path.home() / ".local" / "share")
        entry = data / "applications" / "gluonslides.desktop"
        mime = data / "mime" / "packages" / "gluonslides.xml"
        icon = data / "icons" / "hicolor" / "256x256" / "apps" / "gluonslides.png"
        text = (
            "[Desktop Entry]\nType=Application\nName=GluonSlides\n"
            "Comment=Presentations as text: a freeform slide editor\n"
            f'Exec="{appimage}" %f\nIcon=gluonslides\nTerminal=false\n'
            "Categories=Office;Presentation;\nStartupWMClass=GluonSlides\n"
            "MimeType=application/x-gluonslides;\n"
        )
        changed = []
        for path, content in ((entry, text), (mime, MIME_XML)):
            if not path.is_file() or path.read_text(encoding="utf-8") != content:
                path.parent.mkdir(parents=True, exist_ok=True)
                path.write_text(content, encoding="utf-8")
                changed.append(path)
        if (APP_DIR / "icon.png").is_file() and not icon.is_file():
            icon.parent.mkdir(parents=True, exist_ok=True)
            shutil.copy2(APP_DIR / "icon.png", icon)
        # Let the desktop notice (quietly; skipped if the tools are missing).
        tools = []
        if mime in changed and shutil.which("update-mime-database"):
            tools.append(["update-mime-database", str(data / "mime")])
        if entry in changed and shutil.which("update-desktop-database"):
            tools.append(["update-desktop-database", str(entry.parent)])
        for cmd in tools:
            subprocess.Popen(cmd, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    except OSError as e:
        print(f"Could not add GluonSlides to the applications menu: {e}")


def _log_to_file_without_console():
    """A window app on Windows has no console: with GLUONSLIDES_LOG set,
    print to that file instead (the build reads --self-check from it)."""
    log = os.environ.get("GLUONSLIDES_LOG")
    if log and (sys.stdout is None or sys.stderr is None):
        stream = open(log, "a", encoding="utf-8", buffering=1)
        sys.stdout = sys.stdout or stream
        sys.stderr = sys.stderr or stream


def startup_file(argv):
    """The .gl project given on the command line (a double-click), or None."""
    for arg in argv[1:]:
        if arg.startswith("-"):
            continue  # options (and macOS's -psn_... process ids)
        path = os.path.abspath(os.path.expanduser(arg))
        if path.lower().endswith(".gl") and os.path.isfile(path):
            return path
    return None


def main():
    _log_to_file_without_console()
    use_desktop_gtk()  # before GTK is loaded
    if "--version" in sys.argv:
        print(__version__)
        return 0
    if "--self-check" in sys.argv:
        return self_check()

    sanitize_snap_environment()  # must run before webview.start()
    add_to_applications_menu()

    import webview
    from backend.api import Api

    if not FROZEN:
        # A bundled app ships them; from source they are fetched once.
        from backend.vendor_libs import check_and_install_dependencies
        check_and_install_dependencies()

    html_path = APP_DIR / "index.html"
    if not html_path.exists():
        print(f"Error: Could not find {html_path}. Make sure index.html is in the same directory.")
        return 1

    api = Api()
    api._startup_file = startup_file(sys.argv)
    window = webview.create_window(
        "GluonSlides",
        str(html_path),
        width=1200,
        height=750,
        resizable=True,
        js_api=api,
    )
    window.events.loaded += lambda: _watch_drops(window, api)
    result = {"code": 0}
    if "--smoke-test" in sys.argv:
        import faulthandler
        import threading
        # Stuck (e.g. on a build machine): show where, and stop.
        if sys.stderr is not None and hasattr(sys.stderr, "fileno"):
            faulthandler.dump_traceback_later(SMOKE_LIMIT_S, exit=True, file=sys.stderr)
        threading.Thread(target=_smoke_test, args=(window, result), daemon=True).start()
    webview.start(http_server=True, icon=_window_icon())
    # The window is closed. Threads still waiting on the page (calls from
    # the page in flight, event handlers) would keep Python from exiting:
    # stop now, as a window app does.
    sys.stdout.flush()
    sys.stderr.flush()
    os._exit(result["code"])


SMOKE_LIMIT_S = 120  # seconds before a stuck smoke test reports where and stops
def _window_icon():
    """The window's icon (used on Linux): bundled, or the one for building."""
    for path in (APP_DIR / "icon.png", APP_DIR / "packaging" / "icon.png", APP_DIR / "packaging" / "generated" / "icon.png"):
        if path.is_file():
            return str(path)
    return None


_STARTED_JS = "window.gluonStarted === true && document.querySelectorAll('script, link').length"


def _smoke_test(window, result, timeout_s=60):
    """--smoke-test: waits for the page to start, then closes the window."""
    import time

    code = 1
    try:
        if window.events.loaded.wait(timeout_s):
            deadline = time.monotonic() + 20
            while time.monotonic() < deadline:
                buttons = window.evaluate_js(_STARTED_JS) or 0
                if buttons:
                    print(f"Smoke test OK: the page started at {window.get_current_url()}")
                    code = 0
                    break
                time.sleep(0.5)
            else:
                print("Smoke test FAILED: the page loaded but its JavaScript did not start")
        else:
            print("Smoke test FAILED: the page did not load")
    except Exception as e:
        print(f"Smoke test FAILED: {e}")
    result["code"] = code
    window.destroy()


def _watch_drops(window, api):
    """Gives the page the full paths of dropped files, and keeps the window
    on the app when something is dropped (see backend/desktop.py)."""
    from webview.dom import DOMEventHandler
    from backend.desktop import guard_navigation, watch_native_drops

    if getattr(window, "_drop_watch", False):  # `loaded` fires again on reloads
        return
    window._drop_watch = True
    guard_navigation(window)
    watch_native_drops(window)

    try:
        window.dom.document.events.drop += DOMEventHandler(api._dropped.on_drop)
    except Exception as e:  # dropping still works, as copies without a link
        print(f"Drag and drop paths unavailable: {e}")


if __name__ == "__main__":
    sys.exit(main())
