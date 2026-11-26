"""GluonSlides launcher: `python app.py` or `uv run app.py`.

    --version      print the version and exit
    --self-check   check that the app's files and Python packages are all
                   there, without opening a window (used on bundled builds)
    --smoke-test   open the window, check the page started (its JavaScript
                   ran to the end), close it; exit code 0 if it did
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
    print(f"GluonSlides {__version__} ({'bundled' if FROZEN else 'from source'}) at {APP_DIR}")
    for p in problems:
        print(f"  problem: {p}")
    print("OK" if not problems else f"{len(problems)} problem(s)")
    return 0 if not problems else 1


def main():
    if "--version" in sys.argv:
        print(__version__)
        return 0
    if "--self-check" in sys.argv:
        return self_check()

    sanitize_snap_environment()  # must run before webview.start()

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
        faulthandler.dump_traceback_later(SMOKE_LIMIT_S, exit=True)
        threading.Thread(target=_smoke_test, args=(window, result), daemon=True).start()
    webview.start(http_server=True)
    # The window is closed. Threads still waiting on the page (calls from
    # the page in flight, event handlers) would keep Python from exiting:
    # stop now, as a window app does.
    sys.stdout.flush()
    sys.stderr.flush()
    os._exit(result["code"])


SMOKE_LIMIT_S = 120  # seconds before a stuck smoke test reports where and stops
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
