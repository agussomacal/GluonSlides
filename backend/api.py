"""The Api object exposed to JS as `pywebview.api`.

Method names, signatures and return dicts are the JS contract; keep them
stable. Logic lives in the sibling modules.
"""

import os
import webbrowser

import webview

from . import __version__, desktop, dialogs, figures, fonts, pdf_export, project_io, tables, updates, user_settings
from .presentation import Presentation



def _cancelled():
    return {"success": False, "error": "Cancelled"}

PROJECT_FILE_TYPES = ("Slide Project Files (*.gl)", "Legacy Projects (*.ssproj;*.json)", "All Files (*.*)")
FIGURE_FILE_TYPES = ("Figure Files (*.png;*.jpg;*.jpeg;*.svg;*.pdf;*.eps)", "All Files (*.*)")
PDF_FILE_TYPES = ("PDF Files (*.pdf)", "All Files (*.*)")
TABLE_FILE_TYPES = ("Tables (*.csv;*.tsv;*.txt)", "All Files (*.*)")
IMPORT_FILE_TYPES = ("Talks (*.tex;*.md;*.zip;*.pptx;*.pdf)", "All Files (*.*)")  # several: a split talk + its PDF
FONT_FILE_TYPES = ("Font Files (*.ttf;*.otf;*.woff;*.woff2)", "All Files (*.*)")


class Api:
    def __init__(self):
        # Leading underscore: pywebview does not expose it to JS.
        self._presentation = Presentation()
        self._dropped = desktop.DroppedFiles()
        self._startup_file = None  # set by app.py: a .gl given on the command line

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

    def save_figure_data(self, project_folder, data_uri, name_hint=""):
        """Save a pasted image into <project>/figures/."""
        return figures.save_figure_data(project_folder, data_uri, name_hint)

    def refresh_linked_figures(self, project_folder, items):
        """Re-copy linked figures whose original file changed; returns the updated ones."""
        return figures.refresh_linked_figures(project_folder, items)

    # --- version and updates ------------------------------------------------

    def get_version(self):
        return {"success": True, "version": __version__}

    def check_for_update(self):
        """Is a newer release published on GitHub? (nothing is downloaded)"""
        return updates.check_for_update()

    def set_update_preferences(self, check=None, skipped=None):
        """check: look for updates at start; skipped: a version not to mention again."""
        return updates.set_preferences(check=check, skipped=skipped)

    def get_startup_file(self):
        """The project to open at start (double-clicked .gl file), once."""
        path, self._startup_file = self._startup_file, None
        return {"success": True, "path": path}

    def read_clipboard(self):
        """The image (data URI), image files (paths) or text on the system clipboard."""
        return desktop.read_clipboard()

    def set_clipboard_text(self, text):
        """Replace the system clipboard (objects copied in the app)."""
        return desktop.set_clipboard_text(text)

    def take_dropped_paths(self):
        """Full paths of the files just dropped on the window (once)."""
        return {"success": True, "paths": self._dropped.take()}

    # --- tables: CSV files (backend/tables.py) --------------------------------

    def select_table_file(self):
        """Pick a CSV / TSV file for a table."""
        path = dialogs.ask_open(TABLE_FILE_TYPES)
        return {"success": True, "path": path} if path else _cancelled()

    def read_table_file(self, project_folder, path, max_rows=None):
        """The first `max_rows` rows of a CSV (all when None) and how many it has."""
        return tables.read_table_file(project_folder, path, max_rows)

    def link_table_file(self, project_folder, source, max_rows=None):
        """Copy a CSV into <project>/data/ and return its first rows (a linked table)."""
        return tables.link_table_file(project_folder, source, max_rows)

    def refresh_tables(self, project_folder, items):
        """Re-copy linked CSVs whose original changed; return the cells that changed."""
        return tables.refresh_tables(project_folder, items)

    # --- importing talks (backend/importers/) -------------------------------

    def select_import_file(self):
        """Pick a Beamer .tex/.zip, a .pptx or a .pdf to import."""
        path = dialogs.ask_open(IMPORT_FILE_TYPES)
        return {"success": True, "path": path} if path else _cancelled()

    def select_import_files(self):
        """Pick the talk's files: one, or all of a talk split over several (and its PDF)."""
        paths = dialogs.ask_open_many(IMPORT_FILE_TYPES)
        return {"success": True, "paths": paths} if paths else _cancelled()

    def select_import_folder(self):
        """Pick the talk's project folder."""
        path = dialogs.ask_folder()
        return {"success": True, "paths": [path]} if path else _cancelled()

    def import_talk(self, source, parent_folder, name, options=None):
        """Convert `source` (a path or a list of files / folders) into a new project
        folder <parent>/<name>/; returns its slides."""
        from . import importers
        return importers.import_talk(source, parent_folder, name, options or {})

    def import_progress(self):
        """How far the running import is: {"stage", "done", "total"}."""
        from .importers import progress
        return {"success": True, **progress.get()}

    def install_extra(self, name):
        """Download an optional component (PDF import), after the user agreed."""
        from .importers import extras
        return extras.install(name)

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
