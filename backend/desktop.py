"""The desktop around the app window: the system clipboard and dropped files.

WebKitGTK only sends a paste event to the page when a text field has
focus, so Ctrl+V on the canvas asks Python for the clipboard instead:
an image, image files copied in a file manager, or text. Linux: through
GTK, or `wl-paste` / `xclip`. macOS and Windows: Pillow's ImageGrab for
images (and copied files on Windows), pbpaste / PowerShell for text.

A file dropped where the page does not take it would make WebKit open
it in place of the app, with no way back: `guard_navigation` keeps the
main window on the app.

A file dropped on the window reaches the page without its path; the
GTK window knows it. `DroppedFiles` keeps the paths of the latest drop
(registered as a DOM drop handler in app.py) until the page asks.
"""

import base64
import io
import os
import shutil
import subprocess
import sys
import threading
import time
import urllib.parse

IMAGE_EXTENSIONS = {".png", ".jpg", ".jpeg", ".gif", ".webp", ".svg", ".pdf", ".eps", ".bmp", ".tif", ".tiff"}

_GTK_TIMEOUT_S = 3.0


def _on_gtk_thread(fn):
    """Runs `fn` on the GTK main thread and returns its result.

    pywebview calls the API from worker threads; GTK objects must only be
    touched from the main loop.
    """
    from gi.repository import GLib

    if threading.current_thread() is threading.main_thread():
        return fn()
    done = threading.Event()
    box = {}

    def run():
        try:
            box["value"] = fn()
        except Exception as e:  # reported to the caller
            box["error"] = e
        done.set()
        return False

    GLib.idle_add(run)
    if not done.wait(_GTK_TIMEOUT_S):
        raise TimeoutError("The clipboard did not answer.")
    if "error" in box:
        raise box["error"]
    return box.get("value")


def _gtk_clipboard():
    import gi

    gi.require_version("Gtk", "3.0")
    gi.require_version("Gdk", "3.0")
    from gi.repository import Gdk, Gtk

    return Gtk.Clipboard.get(Gdk.SELECTION_CLIPBOARD)


def _image_files(paths):
    return [p for p in paths if os.path.isfile(p) and os.path.splitext(p)[1].lower() in IMAGE_EXTENSIONS]


def _paths_from_uris(uris):
    out = []
    for uri in uris or []:
        uri = str(uri).strip()
        if uri.startswith("file://"):
            out.append(urllib.parse.unquote(urllib.parse.urlparse(uri).path))
        elif uri.startswith("/"):
            out.append(uri)
    return out


def _read_with_gtk():
    def read():
        clip = _gtk_clipboard()
        # Files copied in a file manager: keep their paths (linked figures).
        if clip.wait_is_uris_available():
            files = _image_files(_paths_from_uris(clip.wait_for_uris()))
            if files:
                return {"paths": files}
            return {}  # other files: nothing to paste on a slide
        if clip.wait_is_image_available():
            pixbuf = clip.wait_for_image()
            if pixbuf is not None:
                ok, data = pixbuf.save_to_bufferv("png", [], [])
                if ok:
                    return {"png": bytes(data)}
        if clip.wait_is_text_available():
            text = clip.wait_for_text()
            if text:
                return {"text": text}
        return {}

    return _on_gtk_thread(read)


def _read_with_command():
    """Fallback without GTK: wl-paste (Wayland) or xclip (X11)."""
    for cmd in (["wl-paste", "--no-newline", "--type", "image/png"],
                ["xclip", "-selection", "clipboard", "-t", "image/png", "-o"]):
        if not shutil.which(cmd[0]):
            continue
        try:
            res = subprocess.run(cmd, capture_output=True, timeout=_GTK_TIMEOUT_S)
        except Exception:
            continue
        if res.returncode == 0 and res.stdout.startswith(b"\x89PNG"):
            return {"png": res.stdout}
    for cmd in (["wl-paste", "--no-newline"], ["xclip", "-selection", "clipboard", "-o"]):
        if not shutil.which(cmd[0]):
            continue
        try:
            res = subprocess.run(cmd, capture_output=True, timeout=_GTK_TIMEOUT_S)
        except Exception:
            continue
        if res.returncode == 0 and res.stdout:
            return {"text": res.stdout.decode("utf-8", errors="replace")}
    return {}


_NO_WINDOW = getattr(subprocess, "CREATE_NO_WINDOW", 0)  # no console flashing on Windows
_PS = ["powershell", "-NoProfile", "-NonInteractive", "-Command"]


def _system_text():
    """Clipboard text on macOS / Windows ('' if none)."""
    if sys.platform == "darwin":
        cmd = ["pbpaste"]
    elif sys.platform == "win32":
        cmd = _PS + ["[Console]::OutputEncoding = [Text.Encoding]::UTF8; Get-Clipboard -Raw"]
    else:
        return ""
    try:
        res = subprocess.run(cmd, capture_output=True, timeout=_GTK_TIMEOUT_S, creationflags=_NO_WINDOW)
    except Exception:
        return ""
    text = res.stdout.decode("utf-8", errors="replace") if res.returncode == 0 else ""
    return text[:-2] if sys.platform == "win32" and text.endswith("\r\n") else text


def _read_with_pillow():
    """macOS / Windows: a copied image, copied image files, or text."""
    from PIL import ImageGrab

    try:
        grabbed = ImageGrab.grabclipboard()
    except Exception:
        grabbed = None
    if isinstance(grabbed, list):  # files copied in Explorer (Windows)
        files = _image_files([str(p) for p in grabbed])
        return {"paths": files} if files else {}
    if grabbed is not None:
        buf = io.BytesIO()
        grabbed.save(buf, format="PNG")
        return {"png": buf.getvalue()}
    text = _system_text()
    return {"text": text} if text else {}


def _read_system():
    if sys.platform in ("darwin", "win32"):
        return _read_with_pillow()
    try:
        return _read_with_gtk()
    except Exception:
        return _read_with_command()


def read_clipboard():
    """What Ctrl+V on the canvas pastes from the system clipboard.

    Returns {"success": True, "data_uri": ...} for a copied image
    (a screenshot), {"success": True, "paths": [...]} for image files
    copied in a file manager, {"success": True, "text": ...} for text,
    or {"success": True} when there is nothing usable.
    """
    try:
        found = _read_system()
        if found.get("png"):
            return {"success": True, "data_uri": "data:image/png;base64," + base64.b64encode(found["png"]).decode("ascii")}
        if found.get("paths"):
            return {"success": True, "paths": found["paths"]}
        if found.get("text"):
            return {"success": True, "text": found["text"]}
        return {"success": True}
    except Exception as e:
        return {"success": False, "error": str(e)}


def set_clipboard_text(text):
    """Puts `text` on the system clipboard (replacing an older screenshot)."""
    if sys.platform in ("darwin", "win32"):
        cmd = ["pbcopy"] if sys.platform == "darwin" else _PS + [
            "[Console]::InputEncoding = [Text.Encoding]::UTF8; Set-Clipboard -Value ([Console]::In.ReadToEnd())"]
        try:
            subprocess.run(cmd, input=str(text).encode("utf-8"), timeout=_GTK_TIMEOUT_S,
                           check=True, creationflags=_NO_WINDOW)
            return {"success": True}
        except Exception as e:
            return {"success": False, "error": str(e)}
    try:
        def write():
            clip = _gtk_clipboard()
            clip.set_text(str(text), -1)
            clip.store()
            return True

        _on_gtk_thread(write)
        return {"success": True}
    except Exception as e:
        return {"success": False, "error": str(e)}


def should_block_navigation(app_url, uri, navigation_type_is_link):
    """Whether the main window may not go to `uri` (it would leave the app).

    Dropped files open as file:// pages, dropped web images as their
    http(s) address; following a link inside the app is left alone.
    """
    target = urllib.parse.urlparse(uri or "")
    if target.scheme == "file":
        return True
    if target.scheme in ("http", "https") and not navigation_type_is_link:
        app = urllib.parse.urlparse(app_url or "")
        return (target.scheme, target.netloc) != (app.scheme, app.netloc)
    return False


def guard_navigation(window):
    """Keeps the pywebview window on the app (GTK only; elsewhere a no-op)."""
    try:
        from gi.repository import GLib
        from webview.platforms.gtk import BrowserView, webkit
    except Exception:
        return False
    app_url = window.get_current_url() or ""

    def on_policy(_webview, decision, _decision_type):
        if not isinstance(decision, webkit.NavigationPolicyDecision):
            return False
        action = decision.get_navigation_action()
        if action.get_frame_name():  # target="_blank" etc.: pywebview handles it
            return False
        is_link = action.get_navigation_type() == webkit.NavigationType.LINK_CLICKED
        if should_block_navigation(app_url, action.get_request().get_uri(), is_link):
            decision.ignore()
            return True
        return False

    def connect():
        view = BrowserView.instances.get(window.uid)
        if view is not None:
            view.webview.connect("decide-policy", on_policy)
        return False

    GLib.idle_add(connect)
    return True


def watch_native_drops(window):
    """Files dropped on the window, from GTK's own drag signals.

    WebKitGTK does not reliably give the page the dropped files, so the
    paths and the drop point are passed to the page directly:
    window.gluonNativeDrop(paths, x, y) (editor/fileDrop.js).
    Returns the (data, drop) signal handlers, or None without GTK.
    """
    import json

    try:
        from gi.repository import GLib
        from webview.platforms.gtk import BrowserView
    except Exception:
        return None

    pending = {"paths": [], "received": 0.0, "point": None}

    def deliver():
        if pending["point"] is None or not pending["paths"]:
            return False
        if time.monotonic() - pending["received"] > 60:
            pending["paths"] = []
            return False
        view = BrowserView.instances.get(window.uid)
        zoom = view.webview.get_zoom_level() if view is not None else 1.0
        (x, y), paths = pending["point"], pending["paths"]
        pending.update(paths=[], point=None)
        print(f"[drop] {len(paths)} file(s) at ({x}, {y})")
        js = f"window.gluonNativeDrop && window.gluonNativeDrop({json.dumps(paths)}, {x / zoom}, {y / zoom})"
        # evaluate_js waits for the page: not from the GTK thread.
        threading.Thread(target=window.evaluate_js, args=(js,), daemon=True).start()
        return False

    def on_data(_widget, _context, _x, _y, data, _info, _time):
        try:
            uris = list(data.get_uris() or []) or (data.get_text() or "").split()
        except Exception:
            uris = []
        paths = [p for p in _paths_from_uris(uris) if os.path.isfile(p)]
        if paths:
            pending.update(paths=paths, received=time.monotonic())
            deliver()
        return False  # WebKit handles the drop too (the page prevents opening it)

    def on_drop(_widget, _context, x, y, _time):
        pending["point"] = (x, y)
        deliver()  # the data may have come while dragging, or comes next
        GLib.timeout_add(1500, lambda: pending.update(point=None) and False)
        return False

    def connect():
        view = BrowserView.instances.get(window.uid)
        if view is not None:
            view.webview.connect("drag-data-received", on_data)
            view.webview.connect("drag-drop", on_drop)
        return False

    GLib.idle_add(connect)
    return on_data, on_drop


class DroppedFiles:
    """Full paths of the files in the latest drop on the window."""

    MAX_AGE_S = 5.0

    def __init__(self):
        self._lock = threading.Lock()
        self._paths = []
        self._at = 0.0

    def on_drop(self, event):
        """pywebview DOM drop handler: files carry `pywebviewFullPath`."""
        files = ((event or {}).get("dataTransfer") or {}).get("files") or []
        paths = [f.get("pywebviewFullPath") for f in files if isinstance(f, dict) and f.get("pywebviewFullPath")]
        if paths:
            with self._lock:
                self._paths = paths
                self._at = time.monotonic()

    def take(self):
        """The paths of a recent drop (once), or []."""
        with self._lock:
            fresh = time.monotonic() - self._at <= self.MAX_AGE_S
            paths, self._paths = (self._paths if fresh else []), []
        return paths
