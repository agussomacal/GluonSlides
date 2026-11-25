"""The Api object exposed to JS as `pywebview.api`.

Method names, signatures and return dicts are the JS contract; keep them
stable. Logic lives in the sibling modules.
"""

import os
import webbrowser

import webview

from . import dialogs, figures, fonts, pdf_export, project_io, user_settings
from .presentation import Presentation



def _cancelled():
    return {"success": False, "error": "Cancelled"}

PROJECT_FILE_TYPES = ("Slide Project Files (*.gl)", "Legacy Projects (*.ssproj;*.json)", "All Files (*.*)")
FIGURE_FILE_TYPES = ("Figure Files (*.png;*.jpg;*.jpeg;*.svg;*.pdf;*.eps)", "All Files (*.*)")
PDF_FILE_TYPES = ("PDF Files (*.pdf)", "All Files (*.*)")
FONT_FILE_TYPES = ("Font Files (*.ttf;*.otf;*.woff;*.woff2)", "All Files (*.*)")


class Api:
    def __init__(self):
        # Leading underscore: pywebview does not expose it to JS.
        self._presentation = Presentation()

    # --- per-user settings -------------------------------------------------

    def get_inspector_settings(self):
        """Load persisted .gl inspector and syntax highlight settings."""
        return user_settings.get_inspector_settings()

    def save_inspector_settings(self, settings_data):
        """Persist .gl inspector and syntax highlight settings."""
        return user_settings.save_inspector_settings(settings_data)

    def get_recent_projects(self):
        """Recent projects, minus those whose files no longer exist."""
        return user_settings.get_recent_projects()

    def add_recent_project(self, name, path):
        """Add or move a project to the top of the recents list."""
        return user_settings.add_recent_project(name, path)

    # --- projects ----------------------------------------------------------

    def select_folder(self):
        """Native folder picker. Returns {success, path}."""
        path = dialogs.ask_folder()
        return {"success": True, "path": path} if path else _cancelled()

    def create_project(self, name):
        """Ask for a parent folder, create a subfolder named after the
        project, and return the path of the project file to create."""
        parent = dialogs.ask_folder()
        return project_io.project_paths(parent, name) if parent else _cancelled()

    def save_project_data(self, path, content):
        """Silently write project data (.gl text) — used by autosave."""
        return project_io.save_project_data(path, content)

    def load_project_at(self, path):
        """Load a project file from a known path (raw text)."""
        return project_io.load_project_at(path)

    def load_project(self):
        """Open dialog to pick a project file."""
        path = dialogs.ask_open(PROJECT_FILE_TYPES)
        return project_io.load_project_at(path) if path else _cancelled()

    # --- generic files -----------------------------------------------------

    def save_file(self, content, default_filename="presentation.html", file_type="html", start_dir=None):
        """Save dialog for a text file of the given type (extension enforced)."""
        ext = "." + (file_type or "html").lstrip(".").lower()
        file_types = (f"{ext[1:].upper()} Files (*{ext})", "All Files (*.*)")
        path = dialogs.ask_save(default_filename, file_types, start_dir)
        if not path:
            return _cancelled()
        if not path.lower().endswith(ext):
            path = os.path.splitext(path)[0] + ext
        return project_io.write_file(path, content)

    def save_text_file(self, folder_path, filename, content):
        """Silently save a text file inside the given folder."""
        return project_io.save_text_file(folder_path, filename, content)

    def load_text_file(self, folder_path, filename):
        """Silently load a text file from the given folder."""
        return project_io.load_text_file(folder_path, filename)

    def save_direct_file(self, folder_path, filename, content):
        """Save a file in an existing project folder without a dialog."""
        return project_io.save_direct_file(folder_path, filename, content)

    def open_file_with_system(self, file_path):
        """Open a file using the OS default viewer or browser."""
        return project_io.open_file_with_system(file_path)

    # --- PDF export --------------------------------------------------------

    def save_pdf_from_images(self, image_data_list, default_filename="presentation.pdf", start_dir=None):
        """Fallback path: save dialog, then build a PDF from slide images."""
        path = dialogs.ask_save(default_filename, PDF_FILE_TYPES, start_dir)
        return pdf_export.images_to_pdf(image_data_list, path) if path else _cancelled()

    def save_direct_pdf_from_images(self, folder_path, filename, image_data_list):
        """Build a PDF from slide images in the project folder, no dialog."""
        if not folder_path or not os.path.exists(folder_path):
            return {"success": False, "error": "Project folder not set or does not exist."}
        return pdf_export.images_to_pdf(image_data_list, os.path.join(folder_path, filename))

    def print_html_to_pdf(self, html_path, pdf_path=None, wait_ms=4000):
        """Render an HTML file to a vector PDF via headless Chromium/Edge."""
        return pdf_export.print_html_to_pdf(html_path, pdf_path, wait_ms)

    # --- figures -----------------------------------------------------------

    def load_figure_data_uri(self, project_folder, file_path):
        """Load a figure image from disk into a data URI."""
        return figures.load_figure_data_uri(project_folder, file_path)

    def import_figure(self, project_folder, source_path):
        """Copy an external figure into the project's figures/ folder."""
        return figures.import_figure(project_folder, source_path)

    def select_figure_file(self):
        """Open dialog to pick a figure file; returns its path and data URI."""
        path = dialogs.ask_open(FIGURE_FILE_TYPES)
        if not path:
            return _cancelled()
        loaded = figures.load_figure_data_uri(None, path)
        if not loaded.get("success"):
            return {"success": False, "error": f"Could not load figure: {loaded.get('error')}"}
        return loaded

    # --- fonts -------------------------------------------------------------

    def list_project_fonts(self, project_folder):
        """Font files in <project>/fonts/ (family, weight, style, data_uri)."""
        return fonts.list_project_fonts(project_folder)

    def import_font_files(self, project_folder):
        """Pick font files and copy them into <project>/fonts/."""
        paths = webview.windows[0].create_file_dialog(
            webview.OPEN_DIALOG, allow_multiple=True, file_types=FONT_FILE_TYPES)
        if not paths:
            return _cancelled()
        return fonts.import_font_files(project_folder, list(paths))

    def list_system_fonts(self):
        """Font families installed on this computer."""
        return fonts.list_system_fonts()

    def system_font_faces(self, family):
        """Regular/italic/bold faces of an installed family, for embedding in exports."""
        return fonts.system_font_faces(family)

    def system_font_license(self, family):
        """Licence text/URL and embedding permission of an installed family."""
        return fonts.system_font_license(family)

    def open_url(self, url):
        """Open an http(s) link (e.g. a font licence) in the default browser."""
        if not isinstance(url, str) or not url.lower().startswith(("http://", "https://")):
            return {"success": False, "error": "Only http(s) links can be opened."}
        webbrowser.open(url)
        return {"success": True}

    # --- presenter view: the audience window ------------------------------

    def screen_count(self):
        """How many screens are connected (2+: the audience gets its own)."""
        return self._presentation.screen_count()

    def open_audience_window(self, html):
        """Show `html` (the exported presentation) in the audience window."""
        return self._presentation.open(html, self)

    def get_audience_html(self):
        """Called by present/audience.html to get the presentation."""
        return {"success": True, "html": self._presentation.html}

    def close_audience_window(self):
        return self._presentation.close()

    def audience_control(self, message):
        """App -> audience window: navigation."""
        return self._presentation.control(message)

    def audience_event(self, message):
        """Audience window -> app: position and key presses."""
        return self._presentation.event(message)
