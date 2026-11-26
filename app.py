"""GluonSlides launcher: `python app.py` or `uv run app.py`."""

from backend import APP_DIR
from backend.snap_env import sanitize_snap_environment


def main():
    sanitize_snap_environment()  # must run before webview.start()

    import webview
    from backend.api import Api
    from backend.vendor_libs import check_and_install_dependencies

    check_and_install_dependencies()

    html_path = APP_DIR / "index.html"
    if not html_path.exists():
        print(f"Error: Could not find {html_path}. Make sure index.html is in the same directory.")
        return

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
    webview.start(http_server=True)


def _watch_drops(window, api):
    """Gives the page the full paths of dropped files (see backend/desktop.py)."""
    from webview.dom import DOMEventHandler

    try:
        window.dom.document.events.drop += DOMEventHandler(api._dropped.on_drop)
    except Exception as e:  # dropping still works, as copies without a link
        print(f"Drag and drop paths unavailable: {e}")


if __name__ == "__main__":
    main()
