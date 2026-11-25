"""PDF export: from rasterized slide images, or vector via headless Chromium."""

import base64
import io
import os
import shutil
import subprocess
from pathlib import Path

from PIL import Image


def images_to_pdf(image_data_list, file_path):
    """Write base64 image data URIs as pages of one PDF at file_path."""
    try:
        pages = []
        for data_uri in image_data_list:
            _, encoded = data_uri.split(",", 1)
            pages.append(Image.open(io.BytesIO(base64.b64decode(encoded))).convert("RGB"))
        if pages:
            pages[0].save(file_path, "PDF", save_all=True, append_images=pages[1:])
        return {"success": True, "path": file_path}
    except Exception as e:
        return {"success": False, "error": str(e)}


def find_chromium_browser():
    """Locate an installed Chromium-family browser; returns a path or None."""
    candidates = [
        found for name in ("chrome", "chromium", "chromium-browser", "google-chrome")
        if (found := shutil.which(name))
    ]

    if os.name == "nt":
        roots = (
            os.environ.get("PROGRAMFILES", r"C:\Program Files"),
            os.environ.get("PROGRAMFILES(X86)", r"C:\Program Files (x86)"),
            os.environ.get("LOCALAPPDATA", ""),
        )
        for root in filter(None, roots):
            candidates += [
                os.path.join(root, "Microsoft", "Edge", "Application", "msedge.exe"),
                os.path.join(root, "Google", "Chrome", "Application", "chrome.exe"),
            ]
    elif os.uname().sysname == "Darwin":
        candidates += [
            "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
            "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge",
            "/Applications/Chromium.app/Contents/MacOS/Chromium",
        ]
    else:
        candidates += [
            "/usr/bin/google-chrome",
            "/usr/bin/chromium",
            "/usr/bin/chromium-browser",
            "/snap/bin/chromium",
        ]

    return next((c for c in candidates if c and os.path.isfile(c)), None)


def print_html_to_pdf(html_path, pdf_path=None, wait_ms=4000):
    """Render an HTML file to a vector PDF with a headless Chromium-family browser."""
    try:
        if not html_path or not os.path.isfile(html_path):
            return {"success": False, "error": f"HTML file not found: {html_path}"}
        if not pdf_path:
            pdf_path = os.path.splitext(html_path)[0] + ".pdf"

        browser = find_chromium_browser()
        if not browser:
            return {"success": False, "error": "No Chromium-family browser found for headless PDF export."}

        cmd = [
            browser,
            "--headless",
            "--disable-gpu",
            "--no-sandbox",
            "--disable-dev-shm-usage",
            f"--print-to-pdf={os.path.abspath(pdf_path)}",
            "--no-pdf-header-footer",
            f"--virtual-time-budget={wait_ms}",
            Path(html_path).resolve().as_uri(),
        ]
        result = subprocess.run(
            cmd,
            capture_output=True,
            text=True,
            timeout=60,
            creationflags=subprocess.CREATE_NO_WINDOW if os.name == "nt" else 0,
        )

        if os.path.isfile(pdf_path) and os.path.getsize(pdf_path) > 0:
            return {"success": True, "path": pdf_path, "engine": browser}
        return {
            "success": False,
            "error": f"Headless render failed: {result.stderr.strip()[:300] or 'no output file produced'}",
        }
    except subprocess.TimeoutExpired:
        return {"success": False, "error": "Headless render timed out."}
    except Exception as e:
        return {"success": False, "error": str(e)}
