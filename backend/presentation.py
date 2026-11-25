"""The audience window of the presenter view.

While presenting with the presenter view, the app window shows the
presenter view (current/next slide, notes, timer) and a second window
shows the slides to the audience: full screen on another screen when
there is one, otherwise as a normal window you can drag to the projector.

The two windows talk through here: the app sends navigation to the
audience window (`control`), and the audience window reports where it is
and its key presses (`event`) back to the app. Both are small JSON
messages delivered with `evaluate_js`.
"""

import json

import webview

AUDIENCE_PAGE = "present/audience.html"


class Presentation:
    def __init__(self):
        self.html = ""
        self.window = None

    # --- windows -----------------------------------------------------------

    @staticmethod
    def _main_window():
        return webview.windows[0] if webview.windows else None

    @staticmethod
    def _other_screen(main):
        """A screen the app window is not on, or None with a single screen."""
        screens = list(getattr(webview, "screens", []) or [])
        if len(screens) < 2:
            return None
        cx = (main.x or 0) + (main.width or 0) // 2 if main else 0
        cy = (main.y or 0) + (main.height or 0) // 2 if main else 0
        for screen in screens:
            inside = screen.x <= cx < screen.x + screen.width and screen.y <= cy < screen.y + screen.height
            if not inside:
                return screen
        return screens[1]

    def screen_count(self):
        return {"success": True, "count": len(list(getattr(webview, "screens", []) or [])) or 1}

    def open(self, html, js_api):
        """Opens (or reuses) the audience window showing `html`."""
        self.html = html or ""
        if self.window is not None:
            # Already open: reload it with the new presentation.
            self.window.evaluate_js("window.gluonAudienceReload && window.gluonAudienceReload()")
            return {"success": True, "fullscreen": None}
        main = self._main_window()
        if main is None:
            return {"success": False, "error": "The app window is not ready."}
        base = main.get_current_url() or ""
        url = base.rsplit("/", 1)[0] + "/" + AUDIENCE_PAGE if "/" in base else AUDIENCE_PAGE
        screen = self._other_screen(main)
        kwargs = {"js_api": js_api, "background_color": "#000000"}
        if screen is not None:
            kwargs.update(screen=screen, fullscreen=True)
        else:
            kwargs.update(width=1280, height=720)
        self.window = webview.create_window("GluonSlides — Audience", url, **kwargs)
        if self.window is None:
            return {"success": False, "error": "Could not open the audience window."}
        self.window.events.closed += self._on_closed
        return {"success": True, "fullscreen": screen is not None}

    def close(self):
        window, self.window = self.window, None
        if window is not None:
            try:
                window.destroy()
            except Exception:  # already gone
                pass
        return {"success": True}

    def _on_closed(self):
        if self.window is None:
            return  # closed by us
        self.window = None
        self.event({"type": "gluon-audience-closed"})

    # --- messages ----------------------------------------------------------

    def control(self, message):
        """App -> audience window (next, prev, goto...)."""
        if self.window is None:
            return {"success": False, "error": "No audience window."}
        self.window.evaluate_js(f"window.gluonAudience && window.gluonAudience({json.dumps(message)})")
        return {"success": True}

    def event(self, message):
        """Audience window -> app (its position, Esc, S...)."""
        main = self._main_window()
        if main is None:
            return {"success": False}
        payload = json.dumps(message)
        main.evaluate_js(f"window.dispatchEvent(new CustomEvent('gluon-remote', {{ detail: {payload} }}))")
        return {"success": True}
