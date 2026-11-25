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

    webview.create_window(
        "GluonSlides",
        str(html_path),
        width=1200,
        height=750,
        resizable=True,
        js_api=Api(),
    )
    webview.start(http_server=True)


if __name__ == "__main__":
    main()
