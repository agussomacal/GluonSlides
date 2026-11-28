"""Backend tests: the Python side the editor calls through pywebview.api.

They run the backend modules directly, in temporary folders, without
opening a window. Run from the repository root:

    npm run test:backend
    # or: python3 -m unittest discover -s tests/backend -t . -v
"""

import base64
import glob
import io
import os
import re
import shutil
import subprocess
import sys
import tempfile
import unittest
import time
from pathlib import Path
from unittest import mock

from PIL import Image

from backend import desktop, figures, tables, updates, fonts, pdf_export, presentation, project_io, snap_env, user_settings

REPO = Path(__file__).resolve().parents[2]


def png_bytes(color="red", size=(4, 4)):
    buf = io.BytesIO()
    Image.new("RGB", size, color).save(buf, format="PNG")
    return buf.getvalue()


def a_system_ttf():
    """Some TrueType file on this machine, or None."""
    if shutil.which("fc-match"):
        path = subprocess.run(["fc-match", "-f", "%{file}", "sans"], capture_output=True, text=True).stdout
        if path.lower().endswith(".ttf") and os.path.isfile(path):
            return path
    found = glob.glob("/usr/share/fonts/**/*.ttf", recursive=True)
    return found[0] if found else None


class TempDirTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.mkdtemp(prefix="gluon-test-")

    def tearDown(self):
        shutil.rmtree(self.tmp, ignore_errors=True)


class CopyIntoProjectTest(TempDirTest):
    """Saving/loading project and side files (macros.tex, .bib, macros.gl...)."""

    def test_project_round_trip(self):
        path = os.path.join(self.tmp, "Deck.gl")
        text = ".project {Deck}\n.slide {One} id:1\n"
        self.assertTrue(project_io.save_project_data(path, text)["success"])
        res = project_io.load_project_at(path)
        self.assertTrue(res["success"])
        self.assertEqual(res["content"], text)

    def test_empty_project_file_is_an_error(self):
        path = os.path.join(self.tmp, "Empty.gl")
        Path(path).write_text("  \n")
        self.assertFalse(project_io.load_project_at(path)["success"])

    def test_side_files_stay_inside_the_project_folder(self):
        self.assertTrue(project_io.save_text_file(self.tmp, "macros.gl", "x")["success"])
        self.assertEqual(project_io.load_text_file(self.tmp, "macros.gl")["content"], "x")
        for bad in ("../escape.txt", "sub/dir.txt", "/etc/passwd", "..", ""):
            self.assertFalse(project_io.save_text_file(self.tmp, bad, "x")["success"], bad)
        self.assertFalse(os.path.exists(os.path.join(os.path.dirname(self.tmp), "escape.txt")))

    def test_missing_side_file(self):
        self.assertFalse(project_io.load_text_file(self.tmp, "bibliography.bib")["success"])


class ProjectFilesTest(TempDirTest):
    """Copying into the project only when needed (backend/projectfiles.py), and cleaning up."""

    def setUp(self):
        super().setUp()
        self.project = os.path.join(self.tmp, "project")
        os.makedirs(self.project)

    def write(self, rel, text):
        path = os.path.join(self.tmp, rel)
        os.makedirs(os.path.dirname(path), exist_ok=True)
        Path(path).write_text(text)
        return path

    def test_the_rules(self):
        from backend.projectfiles import copy_into
        a = self.write("exp_a/results.csv", "x,y\n1,2\n")
        b = self.write("exp_b/results.csv", "x,y\n1,2\n")      # the same content, another original
        c = self.write("elsewhere/renamed.csv", "x,y\n1,2\n")  # the same content, no link
        first = copy_into(self.project, a, "data")
        self.assertEqual(first, "data/results.csv")
        # the same original again: its copy
        self.assertEqual(copy_into(self.project, a, "data"), first)
        # the same content under another name, nothing linking it elsewhere: that file
        self.assertEqual(copy_into(self.project, c, "data"), first)
        # the same content but data/results.csv follows exp_a: exp_b gets its own copy
        linked = [{"copy": first, "original": a}]
        self.assertEqual(copy_into(self.project, b, "data", linked), "data/results_1.csv")
        # exp_a linked, its copy not refreshed yet (the original changed): still its copy
        Path(a).write_text("x,y\n1,3\n")
        self.assertEqual(copy_into(self.project, a, "data", linked), first)
        # a file already in the project: used where it is
        inside = os.path.join(self.project, "results", "fit.csv")
        os.makedirs(os.path.dirname(inside))
        Path(inside).write_text("1,2\n")
        self.assertEqual(copy_into(self.project, inside, "data"), "results/fit.csv")
        self.assertEqual(sorted(os.listdir(os.path.join(self.project, "data"))), ["results.csv", "results_1.csv"])

    def test_tables_variables_and_plot_data_share_it(self):
        from backend import tables, variables
        src = self.write("exp/run.csv", "step,loss\n1,0.9\n")
        rels = {tables.link_table_file(self.project, src)["relative_path"],
                tables.link_plot_data(self.project, src)["relative_path"],
                variables.link_vars_file(self.project, src)["relative_path"]}
        self.assertEqual(rels, {"data/run.csv"})

    def test_unused_files_and_deleting(self):
        from backend.projectfiles import unused_files, delete_files
        os.makedirs(os.path.join(self.project, "data"))
        os.makedirs(os.path.join(self.project, "figures"))
        for rel in ("data/used.csv", "data/old_1.csv", "figures/old.png"):
            Path(os.path.join(self.project, rel)).write_text("x")
        unused = [f["path"] for f in unused_files(self.project, ["data/used.csv"])]
        self.assertEqual(unused, ["data/old_1.csv", "figures/old.png"])
        # named in the project's text (a picture in a text box): used
        unused = [f["path"] for f in unused_files(self.project, None, 'see ![](figures/old.png) and {data/used.csv}')]
        self.assertEqual(unused, ["data/old_1.csv"])
        res = delete_files(self.project, ["data/old_1.csv", "../outside.txt", "Gluon.gl"])
        self.assertEqual(res["deleted"], ["data/old_1.csv"])
        self.assertEqual(len(res["errors"]), 2)
        self.assertFalse(os.path.exists(os.path.join(self.project, "data", "old_1.csv")))


class FiguresTest(TempDirTest):
    """Importing figures into <project>/figures/ and loading them as data URIs."""

    def test_import_copies_once_and_names_others_uniquely(self):
        src_dir = os.path.join(self.tmp, "outside")
        os.makedirs(src_dir)
        src = os.path.join(src_dir, "plot.png")
        Path(src).write_bytes(png_bytes())
        project = os.path.join(self.tmp, "project")
        os.makedirs(project)

        first = figures.import_figure(project, src)
        second = figures.import_figure(project, src)
        self.assertTrue(first["success"] and second["success"])
        self.assertEqual(first["relative_path"], "figures/plot.png")
        self.assertEqual(second["relative_path"], "figures/plot.png")  # the same file: its copy
        self.assertTrue(first["data_uri"].startswith("data:image/png;base64,"))
        # another picture of the same name: a copy of its own
        other_dir = os.path.join(self.tmp, "other")
        os.makedirs(other_dir)
        other = os.path.join(other_dir, "plot.png")
        Path(other).write_bytes(png_bytes(color="green"))
        self.assertEqual(figures.import_figure(project, other)["relative_path"], "figures/plot_1.png")
        self.assertEqual(sorted(os.listdir(os.path.join(project, "figures"))), ["plot.png", "plot_1.png"])

    def test_reimporting_a_file_already_in_figures(self):
        project = self.tmp
        os.makedirs(os.path.join(project, "figures"))
        inside = os.path.join(project, "figures", "a.png")
        Path(inside).write_bytes(png_bytes())
        res = figures.import_figure(project, inside)
        self.assertTrue(res["success"], res.get("error"))
        self.assertEqual(res["relative_path"], os.path.join("figures", "a.png"))

    def test_load_relative_to_project(self):
        os.makedirs(os.path.join(self.tmp, "figures"))
        Path(self.tmp, "figures", "b.png").write_bytes(png_bytes("blue"))
        res = figures.load_figure_data_uri(self.tmp, "figures/b.png")
        self.assertTrue(res["success"])
        self.assertTrue(res["data_uri"].startswith("data:image/png;base64,"))
        self.assertFalse(figures.load_figure_data_uri(self.tmp, "figures/missing.png")["success"])


    def test_save_pasted_image(self):
        uri = "data:image/png;base64," + base64.b64encode(png_bytes()).decode()
        first = figures.save_figure_data(self.tmp, uri, "pasted-20260101")
        second = figures.save_figure_data(self.tmp, uri, "pasted-20260101")
        self.assertTrue(first["success"], first.get("error"))
        self.assertEqual(first["relative_path"], os.path.join("figures", "pasted-20260101.png"))
        self.assertEqual(second["relative_path"], os.path.join("figures", "pasted-20260101_1.png"))
        self.assertEqual(Path(self.tmp, first["relative_path"]).read_bytes(), png_bytes())
        # Odd names are cleaned; other content types refused.
        odd = figures.save_figure_data(self.tmp, uri, "../../etc/pass wd.png")
        self.assertEqual(odd["relative_path"], os.path.join("figures", "pass-wd.png"))
        self.assertFalse(figures.save_figure_data(self.tmp, "data:text/html;base64,PGI+", "x")["success"])
        self.assertFalse(figures.save_figure_data("", uri, "x")["success"])

    def test_linked_figure_follows_its_original(self):
        src_dir = os.path.join(self.tmp, "analysis")
        os.makedirs(src_dir)
        original = os.path.join(src_dir, "plot.png")
        Path(original).write_bytes(png_bytes("red"))
        project = os.path.join(self.tmp, "project")
        os.makedirs(project)
        rel = figures.import_figure(project, original)["relative_path"]
        item = [{"filePath": rel, "originalPath": original}]

        self.assertEqual(figures.refresh_linked_figures(project, item)["updated"], [])  # unchanged

        Path(original).write_bytes(png_bytes("blue", size=(8, 8)))  # the script made a new plot
        later = os.stat(original).st_mtime + 5
        os.utime(original, (later, later))
        res = figures.refresh_linked_figures(project, item)
        self.assertEqual([u["filePath"] for u in res["updated"]], [rel])
        self.assertTrue(res["updated"][0]["data_uri"].startswith("data:image/png;base64,"))
        self.assertEqual(Path(project, rel).read_bytes(), Path(original).read_bytes())

        self.assertEqual(figures.refresh_linked_figures(project, item)["updated"], [])  # copied once
        os.remove(original)
        self.assertEqual(figures.refresh_linked_figures(project, item)["updated"], [])  # missing original: kept


class PdfTest(TempDirTest):
    """The raster PDF fallback (images -> PDF pages)."""

    def test_images_to_pdf(self):
        uris = [f"data:image/png;base64,{base64.b64encode(png_bytes(c)).decode()}" for c in ("red", "green")]
        out = os.path.join(self.tmp, "deck.pdf")
        self.assertTrue(pdf_export.images_to_pdf(uris, out)["success"])
        data = Path(out).read_bytes()
        self.assertTrue(data.startswith(b"%PDF"))
        self.assertEqual(data.count(b"/Type /Page\n") + data.count(b"/Type /Page "), 2)

    def test_missing_html_for_vector_pdf(self):
        self.assertFalse(pdf_export.print_html_to_pdf(os.path.join(self.tmp, "none.html"))["success"])


class FontsTest(TempDirTest):
    """Project fonts, licence reading and the helpers behind the font list."""

    def test_style_names(self):
        self.assertEqual(fonts._weight_style("Bold Italic"), (700, "italic"))
        self.assertEqual(fonts._weight_style("SemiBold"), (600, "normal"))
        self.assertEqual(fonts._weight_style("Regular"), (400, "normal"))
        self.assertEqual(fonts._names_from_filename("/x/MyFont-SemiBoldItalic.woff2"), ("My Font", "Semi Bold Italic"))

    def test_builtin_font_licence(self):
        woff2 = REPO / "libs" / "fonts" / "eb-garamond-latin-400-normal.woff2"
        if not woff2.is_file():
            self.skipTest("built-in fonts not downloaded yet (start the app once)")
        lic = fonts.font_license(str(woff2))
        self.assertTrue(lic["open"])
        self.assertTrue(lic["embeddable"])

    def test_restricted_font_is_not_embeddable(self):
        ttf = a_system_ttf()
        if not ttf or fonts.TTFont is None:
            self.skipTest("no TrueType font or fontTools available")
        font = fonts.TTFont(ttf)
        font["OS/2"].fsType = 0x0002  # "restricted licence embedding"
        for rec in font["name"].names:
            if rec.nameID == 13:  # licence description
                rec.string = "Commercial licence, all rights reserved"
            if rec.nameID == 14:  # licence URL
                rec.string = "https://foundry.example/eula"
        path = os.path.join(self.tmp, "Restricted-Regular.ttf")
        font.save(path)
        lic = fonts.font_license(path)
        self.assertFalse(lic["embeddable"])
        self.assertEqual(lic["embedding"], "restricted")
        self.assertFalse(lic["open"])

    def test_project_fonts(self):
        ttf = a_system_ttf()
        if not ttf:
            self.skipTest("no TrueType font on this machine")
        res = fonts.import_font_files(self.tmp, [ttf, os.path.join(self.tmp, "not-a-font.txt")])
        self.assertTrue(res["success"])
        self.assertEqual(len(res["fonts"]), 1)
        face = res["fonts"][0]
        self.assertTrue(face["family"])
        self.assertTrue(face["data_uri"].startswith("data:font/"))
        self.assertIn("license", face)
        self.assertTrue(os.path.isfile(os.path.join(self.tmp, "fonts", os.path.basename(ttf))))

    def test_system_font_list(self):
        res = fonts.list_system_fonts()
        self.assertTrue(res["success"])
        self.assertIsInstance(res["families"], list)


class UserSettingsTest(TempDirTest):
    """Recent projects and inspector settings, in a temporary config folder."""

    def test_default_project_folder(self):
        with mock.patch.dict(os.environ, {"GLUONSLIDES_CONFIG_DIR": self.tmp}):
            talks = os.path.join(self.tmp, "talks")
            os.makedirs(os.path.join(talks, "One"))
            Path(talks, "One", "One.gl").write_text(".project {One} version:2\n")
            self.assertIsNone(user_settings.default_project_parent())
            user_settings.add_recent_project("One", os.path.join(talks, "One", "One.gl"))
            self.assertEqual(user_settings.default_project_parent(), talks)  # where the last project is
            other = os.path.join(self.tmp, "elsewhere")
            os.makedirs(other)
            user_settings.remember_project_parent(other)
            self.assertEqual(user_settings.default_project_parent(), other)  # the folder last used wins
            user_settings.set_ui_pref("hiddenPanes", ["slides"])
            self.assertEqual(user_settings.get_ui_prefs()["hiddenPanes"], ["slides"])

    def setUp(self):
        super().setUp()
        env = mock.patch.dict(os.environ, {"GLUONSLIDES_CONFIG_DIR": os.path.join(self.tmp, "config")})
        # Old settings files in the repo root would otherwise be copied in.
        legacy = mock.patch.object(user_settings, "APP_DIR", Path(self.tmp) / "no-legacy")
        env.start()
        legacy.start()
        self.addCleanup(env.stop)
        self.addCleanup(legacy.stop)

    def test_recents(self):
        project = os.path.join(self.tmp, "A.gl")
        Path(project).write_text(".project {A}\n")
        self.assertTrue(user_settings.add_recent_project("A", project)["success"])
        self.assertTrue(user_settings.add_recent_project("Gone", os.path.join(self.tmp, "deleted.gl"))["success"])
        recents = user_settings.get_recent_projects()["projects"]
        self.assertEqual([r["name"] for r in recents], ["A"])  # missing files are dropped

    def test_inspector_settings(self):
        self.assertTrue(user_settings.save_inspector_settings('{"tabSize": 4}')["success"])
        self.assertEqual(user_settings.get_inspector_settings()["settings"], {"tabSize": 4})
        self.assertFalse(user_settings.save_inspector_settings("[1, 2]")["success"])


class SnapEnvTest(unittest.TestCase):
    """Undoing variables leaked by snap-packaged terminals (VSCodium snap)."""

    def test_snap_paths_are_removed_and_originals_restored(self):
        env = {
            "GTK_PATH": "/snap/codium/495/usr/lib/x86_64-linux-gnu/gtk-3.0",
            "XDG_DATA_HOME": "/home/me/snap/codium/495/.local/share",
            "XDG_DATA_DIRS": "/snap/codium/495/usr/share:/usr/share",
            "XDG_DATA_DIRS_VSCODE_SNAP_ORIG": "/usr/share",
            "GIO_MODULE_DIR_VSCODE_SNAP_ORIG": "",
            "GIO_MODULE_DIR": "/home/me/snap/codium/common/.cache/gio-modules",
            "SNAP_NAME": "codium",
            "HOME": "/home/me",
        }
        snap_env.sanitize_snap_environment(env)
        self.assertEqual(env, {"XDG_DATA_DIRS": "/usr/share", "HOME": "/home/me"})

    def test_normal_environment_is_untouched(self):
        env = {"GTK_PATH": "/usr/lib/gtk-3.0", "HOME": "/home/me"}
        snap_env.sanitize_snap_environment(env)
        self.assertEqual(env, {"GTK_PATH": "/usr/lib/gtk-3.0", "HOME": "/home/me"})


class PresentationTest(unittest.TestCase):
    """The audience window of the presenter view (pywebview is faked)."""

    class FakeWindow:
        def __init__(self, x=0, y=0, width=1200, height=750, url="http://127.0.0.1:5000/index.html"):
            self.x, self.y, self.width, self.height, self.url = x, y, width, height, url
            self.js = []
            self.destroyed = False
            self.events = mock.Mock()
            self.events.closed = []

        def get_current_url(self):
            return self.url

        def evaluate_js(self, code):
            self.js.append(code)

        def destroy(self):
            self.destroyed = True

    class Screen:
        def __init__(self, x, y, width, height):
            self.x, self.y, self.width, self.height = x, y, width, height

    def setUp(self):
        self.main = self.FakeWindow()
        self.created = []

        def create_window(title, url, **kwargs):
            win = self.FakeWindow(url=url)
            win.kwargs = kwargs
            win.events.closed = mock.MagicMock()
            self.created.append(win)
            return win

        fake = mock.Mock(windows=[self.main], screens=[self.Screen(0, 0, 1920, 1080)], create_window=create_window)
        patcher = mock.patch.object(presentation, "webview", fake)
        patcher.start()
        self.addCleanup(patcher.stop)
        self.webview = fake
        self.pres = presentation.Presentation()

    def test_one_screen_opens_a_normal_window(self):
        res = self.pres.open("<html>deck</html>", js_api=None)
        self.assertTrue(res["success"])
        self.assertFalse(res["fullscreen"])
        win = self.created[0]
        self.assertEqual(win.url, "http://127.0.0.1:5000/present/audience.html")
        self.assertNotIn("fullscreen", win.kwargs)
        self.assertEqual(self.pres.html, "<html>deck</html>")

    def test_second_screen_gets_the_audience_full_screen(self):
        projector = self.Screen(1920, 0, 1280, 720)
        self.webview.screens = [self.Screen(0, 0, 1920, 1080), projector]
        res = self.pres.open("x", js_api=None)
        self.assertTrue(res["fullscreen"])
        self.assertIs(self.created[0].kwargs["screen"], projector)
        self.assertTrue(self.created[0].kwargs["fullscreen"])
        self.assertEqual(self.pres.screen_count()["count"], 2)

    def test_audience_screen_is_the_one_without_the_app(self):
        laptop = self.Screen(1280, 0, 1920, 1080)
        self.webview.screens = [self.Screen(0, 0, 1280, 720), laptop]
        self.main.x = 0  # app window on the first screen
        self.pres.open("x", js_api=None)
        self.assertIs(self.created[0].kwargs["screen"], laptop)

    def test_messages_both_ways(self):
        self.pres.open("x", js_api=None)
        self.pres.control({"type": "gluon-control", "action": "goto", "slide": 2, "step": 1})
        self.assertIn('"slide": 2', self.created[0].js[-1])
        self.assertIn("gluonAudience", self.created[0].js[-1])
        self.pres.event({"type": "gluon-position", "slide": 3})
        self.assertIn("gluon-remote", self.main.js[-1])
        self.assertIn('"slide": 3', self.main.js[-1])

    def test_close_and_reopen(self):
        self.pres.open("x", js_api=None)
        self.pres.close()
        self.assertTrue(self.created[0].destroyed)
        self.assertFalse(self.pres.control({"action": "next"})["success"])
        self.pres.open("y", js_api=None)
        self.assertEqual(len(self.created), 2)

    def test_user_closing_the_audience_window_tells_the_app(self):
        self.pres.open("x", js_api=None)
        self.pres._on_closed()
        self.assertIn("gluon-audience-closed", self.main.js[-1])
        self.assertIsNone(self.pres.window)


class DesktopTest(TempDirTest):
    """System clipboard (Ctrl+V on the canvas) and dropped file paths."""

    def test_file_drops_are_taken_from_webkit(self):
        # files known from the drag: the app takes the drop (WebKitGTK froze on a .csv)
        self.assertTrue(desktop.take_over_drop(["/home/me/runs.csv"], 100.0, 101.0))
        self.assertFalse(desktop.take_over_drop([], 100.0, 101.0))  # text into a text field: WebKit's
        self.assertFalse(desktop.take_over_drop(["/old.png"], 100.0, 200.0))  # stale: an earlier drag

    def test_clipboard_screenshot_becomes_a_png_data_uri(self):
        with mock.patch.object(desktop, "_read_with_gtk", return_value={"png": png_bytes()}):
            res = desktop.read_clipboard()
        self.assertTrue(res["success"])
        self.assertTrue(res["data_uri"].startswith("data:image/png;base64,"))
        self.assertEqual(base64.b64decode(res["data_uri"].split(",", 1)[1]), png_bytes())

    def test_copied_image_files_give_their_paths(self):
        img = os.path.join(self.tmp, "my plot.png")
        txt = os.path.join(self.tmp, "notes.txt")
        for p in (img, txt):
            Path(p).write_bytes(b"x")
        uris = ["file://" + img.replace(" ", "%20"), "file://" + txt]
        self.assertEqual(desktop._image_files(desktop._paths_from_uris(uris)), [img])
        with mock.patch.object(desktop, "_read_with_gtk", return_value={"paths": [img]}):
            self.assertEqual(desktop.read_clipboard(), {"success": True, "paths": [img]})

    def test_clipboard_text(self):
        with mock.patch.object(desktop, "_read_with_gtk", return_value={"text": "Hello\nworld"}):
            self.assertEqual(desktop.read_clipboard(), {"success": True, "text": "Hello\nworld"})

    def test_navigation_away_from_the_app_is_blocked(self):
        app = "http://127.0.0.1:8123/index.html"
        block = desktop.should_block_navigation
        self.assertTrue(block(app, "file:///home/me/plot.png", False))       # a dropped file
        self.assertTrue(block(app, "file:///home/me/plot.png", True))
        self.assertTrue(block(app, "https://example.org/pic.png", False))    # a dropped web image
        self.assertFalse(block(app, "http://127.0.0.1:8123/index.html", False))  # reload
        self.assertFalse(block(app, "https://example.org/", True))            # a link
        self.assertFalse(block(app, "about:srcdoc", False))                   # Present mode's frame

    def test_nothing_on_the_clipboard(self):
        with mock.patch.object(desktop, "_read_with_gtk", return_value={}):
            self.assertEqual(desktop.read_clipboard(), {"success": True})

    def test_falls_back_to_a_command_without_gtk(self):
        with mock.patch.object(desktop, "_read_with_gtk", side_effect=ImportError("no gi")), \
                mock.patch.object(desktop, "_read_with_command", return_value={"png": png_bytes()}):
            self.assertIn("data_uri", desktop.read_clipboard())

    def test_dropped_paths_are_taken_once(self):
        drops = desktop.DroppedFiles()
        drops.on_drop({"dataTransfer": {"files": [
            {"name": "a.png", "pywebviewFullPath": "/data/a.png"},
            {"name": "b.png"},  # no path known
        ]}})
        self.assertEqual(drops.take(), ["/data/a.png"])
        self.assertEqual(drops.take(), [])

    def test_old_drops_are_forgotten(self):
        drops = desktop.DroppedFiles()
        drops.on_drop({"dataTransfer": {"files": [{"name": "a.png", "pywebviewFullPath": "/data/a.png"}]}})
        with mock.patch.object(desktop.time, "monotonic", return_value=desktop.time.monotonic() + 60):
            self.assertEqual(drops.take(), [])

    def test_api_exposes_them(self):
        from backend.api import Api
        api = Api()
        for name in ("read_clipboard", "set_clipboard_text", "take_dropped_paths"):
            self.assertTrue(callable(getattr(api, name)))
        self.assertEqual(api.take_dropped_paths(), {"success": True, "paths": []})


class OtherSystemsClipboardTest(unittest.TestCase):
    """macOS / Windows clipboard (simulated here): Pillow for images, commands for text."""

    def test_image_on_macos_or_windows(self):
        from PIL import ImageGrab
        for platform in ("darwin", "win32"):
            with mock.patch.object(desktop.sys, "platform", platform), \
                    mock.patch.object(ImageGrab, "grabclipboard", return_value=Image.new("RGB", (3, 2), "blue")):
                res = desktop.read_clipboard()
            self.assertTrue(res["data_uri"].startswith("data:image/png;base64,"), platform)

    def test_files_copied_in_explorer(self):
        from PIL import ImageGrab
        with tempfile.TemporaryDirectory() as tmp:
            img = os.path.join(tmp, "plot.png")
            Path(img).write_bytes(b"x")
            with mock.patch.object(desktop.sys, "platform", "win32"), \
                    mock.patch.object(ImageGrab, "grabclipboard", return_value=[img, os.path.join(tmp, "a.txt")]):
                self.assertEqual(desktop.read_clipboard(), {"success": True, "paths": [img]})

    def test_text_through_pbpaste_and_powershell(self):
        from PIL import ImageGrab
        for platform, out, expected_cmd in (("darwin", b"hello", "pbpaste"), ("win32", b"hello\r\n", "powershell")):
            done = subprocess.CompletedProcess([], 0, stdout=out)
            with mock.patch.object(desktop.sys, "platform", platform), \
                    mock.patch.object(ImageGrab, "grabclipboard", return_value=None), \
                    mock.patch.object(desktop.subprocess, "run", return_value=done) as run:
                self.assertEqual(desktop.read_clipboard(), {"success": True, "text": "hello"}, platform)
            self.assertEqual(run.call_args[0][0][0], expected_cmd)

    def test_setting_text(self):
        for platform, expected_cmd in (("darwin", "pbcopy"), ("win32", "powershell")):
            with mock.patch.object(desktop.sys, "platform", platform), \
                    mock.patch.object(desktop.subprocess, "run") as run:
                self.assertEqual(desktop.set_clipboard_text("GluonSlides objects"), {"success": True})
            self.assertEqual(run.call_args[0][0][0], expected_cmd)
            self.assertEqual(run.call_args[1]["input"], b"GluonSlides objects")


class UpdatesTest(TempDirTest):
    """'A new version is available' (nothing is downloaded): GitHub faked."""

    def setUp(self):
        super().setUp()
        patcher = mock.patch.dict(os.environ, {"GLUONSLIDES_CONFIG_DIR": self.tmp})
        patcher.start()
        self.addCleanup(patcher.stop)

    @staticmethod
    def release(tag):
        return lambda: {"tag_name": tag, "html_url": f"https://github.com/x/releases/tag/{tag}"}

    def test_versions_are_compared_as_numbers(self):
        self.assertEqual(updates.parse_version("v0.10.0"), (0, 10, 0))
        self.assertGreater(updates.parse_version("v0.10.0"), updates.parse_version("0.9.9"))
        self.assertEqual(updates.parse_version("v1.2.0-rc1"), (1, 2, 0))
        self.assertIsNone(updates.parse_version("latest"))

    def test_newer_release(self):
        r = updates.check_for_update("0.2.1", self.release("v0.3.0"))
        self.assertTrue(r["newer"])
        self.assertEqual((r["version"], r["current"]), ("0.3.0", "0.2.1"))
        self.assertTrue(r["url"].endswith("v0.3.0"))

    def test_same_or_older_release(self):
        self.assertFalse(updates.check_for_update("0.2.1", self.release("v0.2.1"))["newer"])
        self.assertFalse(updates.check_for_update("0.2.1", self.release("v0.2.0"))["newer"])

    def test_skipped_version_is_not_mentioned_again(self):
        updates.set_preferences(skipped="0.3.0")
        self.assertFalse(updates.check_for_update("0.2.1", self.release("v0.3.0"))["newer"])
        self.assertTrue(updates.check_for_update("0.2.1", self.release("v0.4.0"))["newer"])

    def test_turned_off_means_no_request(self):
        updates.set_preferences(check=False)
        asked = mock.Mock(side_effect=AssertionError("GitHub was asked"))
        r = updates.check_for_update("0.2.1", asked)
        self.assertFalse(r["newer"])
        self.assertFalse(r["check"])
        asked.assert_not_called()

    def test_offline_is_quiet(self):
        def offline():
            raise OSError("no network")
        r = updates.check_for_update("0.2.1", offline)
        self.assertTrue(r["success"])
        self.assertFalse(r["newer"])
        self.assertIn("no network", r["error"])


BEAMER_FIXTURE = REPO / "tests" / "backend" / "fixtures" / "beamer"


class BeamerImportTest(TempDirTest):
    """Beamer .tex / .zip -> slides (backend/importers/beamer.py), on a small talk using each feature."""

    def setUp(self):
        super().setUp()
        from backend.importers import import_talk
        self.import_talk = import_talk
        res = import_talk(str(BEAMER_FIXTURE / "talk.tex"), self.tmp, "Test Talk")
        self.assertTrue(res["success"], res)
        self.res, self.p = res, res["project"]
        self.slides = {s["title"]: s for s in self.p["slides"]}

    def texts(self, title):
        return [e for e in self.slides[title]["elements"] if e["type"] == "text"]

    def test_document_settings(self):
        self.assertEqual((self.p["width"], self.p["height"]), (1920, 1080))  # aspectratio=169
        self.assertEqual((self.p["title"], self.p["author"], self.p["date"]), ("A Test Talk", "Ana, Bo", "2026"))
        self.assertTrue(self.res["path"].endswith(os.path.join("Test Talk", "Test Talk.gl")))

    def test_slides_sections_and_section_slides(self):
        titles = [s["title"] for s in self.p["slides"]]
        self.assertEqual(titles, ["A Test Talk", "Intro", "First x^2 frame", "Columns", "End", "References"])
        self.assertEqual(self.slides["Columns"]["section"], "Intro")
        self.assertEqual(self.slides["References"]["section"], "End")
        self.assertEqual(self.slides["Intro"]["master"], "Plain")  # \AtBeginSection slide

    def test_masters_title_bar_and_page_number(self):
        beamer = next(m for m in self.p["masters"] if m["name"] == "Beamer")
        bar = next(e for e in beamer["elements"] if e["type"] == "shape")
        self.assertEqual(bar["bg"], "#d9d9d9")  # \setbeamercolor{frametitle}{bg=barbg}
        self.assertIn("\\slidenumber / \\totalslides", [e.get("content") for e in beamer["elements"]])
        title = self.texts("Columns")[0]
        self.assertEqual((title["content"], title["textAlign"]), ("Columns", "center"))

    def test_text_formatting_math_and_notes(self):
        body = [e["content"] for e in self.texts("First x^2 frame")]
        self.assertIn("Some **bold** and *italic* text with $a_k + \\R$ inline.", body)
        self.assertIn("$$\\argmin_{x \\in \\R} \\cL(x)$$", body)
        self.assertEqual(self.slides["First x^2 frame"]["notes"], "Say hello first.")
        self.assertEqual(self.texts("First x^2 frame")[0]["fontFamily"], "Inter")

    def test_overlays_become_steps(self):
        steps = {e["content"]: e.get("step", 1) for e in self.texts("First x^2 frame")}
        self.assertEqual((steps["- One"], steps["- Two"], steps["- Three"]), (1, 2, 3))
        self.assertEqual(steps["$$\\argmin_{x \\in \\R} \\cL(x)$$"], 2)  # after \pause
        # a row shown from step 2: two versions, the first gone when the second comes
        rows = [e for e in self.texts("Columns") if "aligned" in e["content"]]
        self.assertEqual([(e.get("step", 1), e.get("until")) for e in rows], [(1, 1), (2, None)])
        self.assertIn("\\phantom{c }", rows[0]["content"])
        self.assertEqual(rows[1]["bg"], "transparent")  # no covering needed
        figs = [e for e in self.slides["Columns"]["elements"] if e["type"] == "figure"]
        # \includegraphics<1> then <2->: the first is gone at step 2, same place
        self.assertEqual([(f.get("step", 1), f.get("until")) for f in figs], [(1, 1), (2, None)])
        self.assertEqual((figs[0]["x"], figs[0]["y"]), (figs[1]["x"], figs[1]["y"]))

    def test_alternating_images_share_their_place(self):
        figs = [e for e in self.slides["Columns"]["elements"] if e["type"] == "figure"]
        self.assertEqual([f["filePath"] for f in figs], ["figures/plot.png", "figures/plot2.png"])
        self.assertEqual([f.get("step", 1) for f in figs], [1, 2])
        self.assertEqual((figs[0]["x"], figs[0]["y"]), (figs[1]["x"], figs[1]["y"]))
        self.assertAlmostEqual(figs[0]["height"] / figs[0]["width"], 0.75, places=2)
        for f in ("plot.png", "plot2.png"):
            self.assertTrue(os.path.isfile(os.path.join(self.tmp, "Test Talk", "figures", f)))
        self.assertTrue(figs[0]["originalPath"].endswith("plot.png") and figs[0]["sync"] == "yes")

    def test_nested_columns_become_a_columns_element_inside_their_column(self):
        inner = next(e for e in self.slides["Columns"]["elements"] if e["type"] == "columns")
        self.assertEqual([c["content"] for c in inner["columns"]], ["Inner left", "Inner right"])
        self.assertEqual([c["width"] for c in inner["columns"]], [50, 50])
        fig = next(e for e in self.slides["Columns"]["elements"] if e["type"] == "figure")
        self.assertLess(inner["x"] + inner["width"], fig["x"] + 2)  # within the 0.6 column

    def test_boxes_tables_citations_bibliography(self):
        box = next(e for e in self.slides["Columns"]["elements"] if e["type"] == "shape")
        self.assertEqual((box["borderStyle"], box["borderCol"], box["bg"]), ("dashed", "#d8e2ec", "#ffffff"))  # colorV!20!white
        contents = [e["content"] for e in self.texts("Columns")]
        self.assertIn("Boxed note, see \\cite{smith2020}.", contents)
        table = next(e for e in self.slides["Columns"]["elements"] if e["type"] == "table")
        self.assertEqual(table["rows"], [["$x$", "one"], ["$y$", "two"]])
        self.assertEqual((table["header"], table["borders"]), ("no", "none"))  # no rules in the tabular
        self.assertIn("\\printbibliography", [e["content"] for e in self.texts("References")])
        self.assertIn("@article{smith2020", self.p["bib"])

    def test_macros_for_katex(self):
        m = self.p["macros"]
        self.assertIn("\\newcommand{\\R}{\\mathbb{R}}", m)
        self.assertIn("\\newcommand{\\colorV}{\\color{#3e6e9e}}", m)  # colour name resolved
        self.assertIn("\\newcommand{\\argmin}{\\operatorname*{arg\\,min}}", m)
        self.assertIn("\\newcommand{\\pair}[2]", m)

    def test_from_a_zip_like_overleaf(self):
        import zipfile
        z = os.path.join(self.tmp, "talk.zip")
        with zipfile.ZipFile(z, "w") as zf:
            for f in BEAMER_FIXTURE.rglob("*"):
                if f.is_file():
                    zf.write(f, f.relative_to(BEAMER_FIXTURE))
            zf.writestr("../escape.txt", "must not be written outside")
        res = self.import_talk(z, self.tmp, "From Zip")
        self.assertTrue(res["success"], res)
        self.assertEqual(len(res["project"]["slides"]), 6)
        fig = next(e for s in res["project"]["slides"] for e in s["elements"] if e["type"] == "figure")
        self.assertEqual((fig["originalPath"], fig.get("sync")), ("", None))  # a temporary copy: not linked
        self.assertFalse(os.path.exists(os.path.join(os.path.dirname(self.tmp), "escape.txt")))

    def test_errors(self):
        self.assertFalse(self.import_talk(os.path.join(self.tmp, "nope.tex"), self.tmp, "X")["success"])
        doc = os.path.join(self.tmp, "a.docx")
        Path(doc).write_text("x")
        self.assertIn("Choose", self.import_talk(doc, self.tmp, "X")["error"])
        again = self.import_talk(str(BEAMER_FIXTURE / "talk.tex"), self.tmp, "Test Talk")
        self.assertIn("already exists", again["error"])  # never mixed into an earlier import


class PptxImportTest(TempDirTest):
    """PowerPoint -> slides (backend/importers/pptx.py), on a deck built by tests/backend/pptx_fixture.py."""

    def setUp(self):
        super().setUp()
        import sys as _sys
        _sys.path.insert(0, str(REPO / "tests" / "backend"))
        import pptx_fixture
        from backend.importers import import_talk
        src = pptx_fixture.build(os.path.join(self.tmp, "deck.pptx"))
        res = import_talk(src, self.tmp, "Deck")
        self.assertTrue(res["success"], res)
        self.p = res["project"]
        self.title, self.content = self.p["slides"]

    def els(self, slide, kind):
        return [e for e in slide["elements"] if e["type"] == kind]

    def test_deck_settings_and_titles(self):
        self.assertEqual((self.p["width"], self.p["height"]), (1920, 1080))
        self.assertEqual((self.p["title"], self.p["author"]), ("Imported Deck", "Ana"))
        self.assertEqual([s["title"] for s in self.p["slides"]], ["Imported Deck", "Content"])

    def test_layouts_become_masters_with_their_shapes(self):
        names = {m["name"]: m for m in self.p["masters"]}
        self.assertEqual(set(names), {"Title Slide", "Title and Content"})
        self.assertEqual([e["bg"] for e in names["Title and Content"]["elements"]], ["#aa0000"])  # the layout's logo
        self.assertEqual(self.content["master"], "Title and Content")

    def test_background_sections_notes(self):
        bg = self.els(self.title, "shape")[0]
        self.assertEqual((bg["bg"], bg["width"], bg["height"], bg.get("locked")), ("#102030", 1920, 1080, "yes"))
        self.assertEqual((self.title["section"], self.content["section"]), ("Opening", "Main"))
        self.assertEqual(self.content["notes"], "Speaker notes here")

    def test_text_bullets_formatting_links(self):
        body = next(e["content"] for e in self.els(self.content, "text") if "First point" in e["content"])
        lines = body.split("\n")
        self.assertEqual(lines[0], "- First point")
        self.assertEqual(lines[1], "    - **bold sub**")
        self.assertEqual(lines[2], '- [\\textcolor{#ff0000}{red link}](https://example.org)')
        self.assertEqual(lines[3], "1. Numbered")
        boxed = next(e for e in self.els(self.content, "text") if e["content"] == "In a box")
        self.assertEqual(boxed["textAlign"], "center")
        self.assertEqual(boxed["fontSize"], 40)  # 20 pt on a 13.33 in wide slide -> 1920 px

    def test_shapes_lines_tables_groups_pictures(self):
        shapes = self.els(self.content, "shape")
        kinds = [(s["kind"], s["bg"]) for s in shapes]
        self.assertIn(("rect", "#228844"), kinds)
        self.assertIn(("ellipse", "#ffcc00"), kinds)
        rounded = next(s for s in shapes if s["bg"] == "#8888ff")
        self.assertGreater(rounded.get("radius", 0), 0)
        self.assertIn(("rect", "#aa0000"), kinds)  # inside a group
        line = self.els(self.content, "path")[0]
        self.assertEqual((line.get("end"), line["stroke"]), ("arrow", "#333333"))
        table = self.els(self.content, "table")[0]
        self.assertEqual(table["rows"], [["h1", "h2"], ["a", "b"]])
        self.assertEqual((table["header"], table["stripes"]), ("yes", "yes"))  # python-pptx default table style
        fig = self.els(self.content, "figure")[0]
        self.assertTrue(os.path.isfile(os.path.join(self.tmp, "Deck", fig["filePath"])))
        self.assertAlmostEqual(fig["width"] / fig["height"], 2.0, places=1)

    def test_click_animations_become_steps(self):
        fig = self.els(self.content, "figure")[0]
        oval = next(s for s in self.els(self.content, "shape") if s["kind"] == "ellipse")
        self.assertEqual((fig.get("step"), oval.get("step")), (2, 3))
        self.assertEqual(fig.get("until"), 3)  # it exits on the 3rd click: last shown at step 3


class PptxDrawingsTest(TempDirTest):
    """PowerPoint shapes without an element of their own (backend/importers/pptx_draw.py),
    cropped pictures, mixed sizes, fields, and a chart taken from the deck's PDF."""

    def setUp(self):
        super().setUp()
        import sys as _sys
        _sys.path.insert(0, str(REPO / "tests" / "backend"))
        import pptx_fixture
        from backend.importers import import_talk
        self.import_talk = import_talk
        os.makedirs(os.path.join(self.tmp, "src"))
        self.src = pptx_fixture.build_drawings(os.path.join(self.tmp, "src", "deck.pptx"))

    def run_import(self, source, name):
        res = self.import_talk(source, self.tmp, name, {})
        self.assertTrue(res["success"], res)
        return res, res["project"]["slides"][0]["elements"]

    def test_cropped_pictures_freeforms_connectors_text(self):
        res, els = self.run_import(self.src, "Plain")
        figs = [e for e in els if e["type"] == "figure"]
        with Image.open(os.path.join(res["folder"], figs[0]["filePath"])) as im:
            self.assertEqual(im.size, (200, 100))  # the middle half, as shown
            self.assertEqual(im.getpixel((100, 50)), (0, 128, 0))
        svgs = [f for f in figs if f["filePath"].endswith(".svg")]
        self.assertEqual(len(svgs), 2)  # the freeform and the curved connector
        tri = Path(res["folder"], svgs[0]["filePath"]).read_text()
        self.assertIn('fill="#ccddee"', tri.lower())
        self.assertRegex(tri, r'd="M[^"]*L[^"]*Z')
        self.assertIn(" C", Path(res["folder"], svgs[1]["filePath"]).read_text())
        texts = [e["content"] for e in els if e["type"] == "text"]
        self.assertIn("Bibliography &#91;4&#93; costs 5\\$ <span style=\"font-size:0.50em\">small print</span>", texts)
        self.assertIn("\\slidenumber", texts)
        # no PDF: the chart is a dashed box saying so
        self.assertTrue(any("Chart (not imported)" in t for t in texts))
        self.assertFalse(any(f.get("missing") for f in figs))

    def test_connectors_attached_in_powerpoint_come_attached(self):
        _res, els = self.run_import(self.src, "Links")
        boxes = [e for e in els if e["type"] == "shape" and e.get("kind", "rect") == "rect" and e["width"] < 400 and e["y"] > 700]
        link = next(e for e in els if e["type"] == "path" and e.get("from"))
        self.assertEqual((link["from"], link["to"], link["route"]), (f"{boxes[0]['id']}@right", f"{boxes[1]['id']}@left", "straight"))

    def test_the_decks_pdf_gives_the_chart(self):
        try:
            import pymupdf as fz
        except ImportError:
            self.skipTest("PyMuPDF not installed")
        doc = fz.open()
        p = doc.new_page(width=960, height=540)
        p.insert_text((72, 300), "Bibliography [4] costs 5$ small print", fontsize=14)
        p.draw_rect(fz.Rect(576, 288, 864, 504), color=(0, 0, 1), fill=(0.6, 0.7, 0.9))  # the chart as drawn
        doc.save(os.path.join(self.tmp, "src", "deck.pdf"))  # next to the .pptx: used
        res, els = self.run_import(self.src, "WithPdf")
        texts = [e.get("content") for e in els if e["type"] == "text"]
        self.assertFalse(any("Chart (not imported)" in (t or "") for t in texts))
        chart = next(e for e in els if e["type"] == "figure" and "chart" in e["filePath"])
        self.assertTrue(os.path.isfile(os.path.join(res["folder"], chart["filePath"])))
        self.assertEqual(res["ground_truth"], "deck.pdf")


class EquationsTest(TempDirTest):
    """Pictures of equations read back to LaTeX (backend/importers/equations.py), with a stand-in
    for the model (the real one is an optional 220 MB download), and choosing its wheels."""

    def deck(self, pictures):
        from PIL import ImageDraw
        from pptx import Presentation
        from pptx.util import Inches
        prs = Presentation()
        prs.slide_width, prs.slide_height = Inches(13.333), Inches(7.5)
        s = prs.slides.add_slide(prs.slide_layouts[6])
        for i, (kind, size) in enumerate(pictures):
            if kind == "formula":  # dark thin strokes on white: looks like an equation
                im = Image.new("RGB", size, "white")
                d = ImageDraw.Draw(im)
                d.text((10, size[1] // 3), "a + b = c", fill="black")
                d.line((10, size[1] - 10, size[0] - 10, size[1] - 10), fill="black", width=2)
            else:  # a photo: many colours
                import random
                random.seed(1)
                im = Image.new("RGB", size)
                im.putdata([(random.randrange(256), random.randrange(256), random.randrange(256)) for _ in range(size[0] * size[1])])
            buf = io.BytesIO()
            im.save(buf, format="PNG")
            buf.seek(0)
            s.shapes.add_picture(buf, Inches(1 + 4 * i), Inches(1), Inches(3), Inches(3 * size[1] / size[0]))
        path = os.path.join(self.tmp, "eq.pptx")
        prs.save(path)
        return path

    class Reader:
        def __init__(self, answers):
            self.answers, self.seen = list(answers), 0

        def read(self, img):
            self.seen += 1
            return self.answers.pop(0)

    def run_import(self, path, reader):
        from backend.importers import import_talk
        with mock.patch("backend.importers.extras.load_equation_reader", return_value=reader):
            res = import_talk(path, self.tmp, f"Eq{len(os.listdir(self.tmp))}", {"equations": True})
        self.assertTrue(res["success"], res)
        return res["project"]["slides"][0]["elements"]

    def test_a_sure_reading_replaces_the_picture(self):
        reader = self.Reader([("a+b=c", -0.01)])
        els = self.run_import(self.deck([("formula", (300, 80)), ("photo", (120, 120))]), reader)
        self.assertEqual(reader.seen, 1)  # the photo is not tried
        text = next(e for e in els if e["type"] == "text")
        self.assertEqual((text["content"], text["name"], text["textAlign"]), ("$\\displaystyle a+b=c$", "Recognised equation", "center"))
        self.assertEqual(sum(e["type"] == "figure" for e in els), 1)  # the photo stays

    def test_unsure_readings_and_single_symbols_keep_the_picture(self):
        for answer in (("a+b=c", -0.2), ("\\mathcal{N}", -0.001)):
            els = self.run_import(self.deck([("formula", (300, 80))]), self.Reader([answer]))
            self.assertEqual([e["type"] for e in els], ["figure"])

    def test_without_the_component_it_asks_for_it(self):
        from backend.importers import import_talk
        with mock.patch("backend.importers.extras.load_equation_reader", return_value=None):
            res = import_talk(self.deck([("formula", (300, 80))]), self.tmp, "Ask", {"equations": True})
        self.assertEqual(res.get("needs_extra"), "equations")

    def test_one_picture_on_request(self):
        """Right-click "Convert to LaTeX": used even when unsure (flagged), in the figure's place."""
        from backend.importers.equations import read_figure
        os.makedirs(os.path.join(self.tmp, "figures"))
        Image.new("RGB", (300, 80), "white").save(os.path.join(self.tmp, "figures", "eq.png"))
        el = {"type": "figure", "id": 9, "x": 10, "y": 20, "width": 600, "height": 160, "filePath": "figures/eq.png", "step": 2}
        res = read_figure(self.tmp, el, self.Reader([("x^2", -0.3)]))
        self.assertTrue(res["success"], res)
        self.assertTrue(res["unsure"])
        t = res["element"]
        self.assertEqual((t["type"], t["content"], t["id"], t["x"], t["step"]), ("text", "$\\displaystyle x^2$", 9, 10, 2))
        self.assertFalse(read_figure(self.tmp, dict(el, filePath="figures/plot.pdf"), self.Reader([]))["success"])
        self.assertFalse(read_figure(self.tmp, el, self.Reader([("", float("-inf"))]))["success"])
        from backend.api import Api
        with mock.patch("backend.importers.extras.equation_reader", return_value=None):
            self.assertEqual(Api().read_equation(self.tmp, el).get("needs_extra"), "equations")

    def test_the_wheel_for_this_system(self):
        from backend.importers.extras import wheel_fits
        name = "onnxruntime-1.32.0-cp312-cp312-manylinux_2_28_x86_64.whl"
        self.assertTrue(wheel_fits(name, ("linux", "x86_64"), "cp312"))
        self.assertFalse(wheel_fits(name, ("linux", "x86_64"), "cp313"))
        self.assertFalse(wheel_fits(name, ("linux", "aarch64"), "cp312"))
        self.assertFalse(wheel_fits("onnxruntime-1.32.0-cp314-cp314t-manylinux_2_28_x86_64.whl", ("linux", "x86_64"), "cp314"))
        self.assertTrue(wheel_fits("numpy-2.5.5-cp313-cp313-macosx_14_0_arm64.whl", ("darwin", "arm64"), "cp313"))
        self.assertTrue(wheel_fits("onnxruntime-1.32.0-cp313-cp313-win_amd64.whl", ("win32", "amd64"), "cp313"))


class PdfImportTest(TempDirTest):
    """PDF -> slides (backend/importers/pdf.py), on a PDF built by tests/backend/pdf_fixture.py."""

    def setUp(self):
        super().setUp()
        try:
            import pymupdf  # noqa: F401
        except ImportError:
            self.skipTest("PyMuPDF not installed (uv sync --extra pdf)")
        import sys as _sys
        _sys.path.insert(0, str(REPO / "tests" / "backend"))
        import pdf_fixture
        from backend.importers import import_talk
        self.import_talk = import_talk
        self.src = pdf_fixture.build(os.path.join(self.tmp, "deck.pdf"))

    def run_import(self, mode="editable", name="Deck"):
        res = self.import_talk(self.src, self.tmp, name, {"pdfMode": mode})
        self.assertTrue(res["success"], res)
        return res["project"]

    def test_editable_text_shapes_pictures(self):
        p = self.run_import()
        self.assertEqual((p["width"], p["height"], p["title"], p["author"]), (1920, 1080, "PDF Deck", "Ana"))
        first = p["slides"][0]
        texts = {e["content"]: e for e in first["elements"] if e["type"] == "text"}
        self.assertIn("**Results**", texts)
        self.assertIn("Plain text and *italic*", texts)  # two runs on one baseline: one line
        self.assertEqual(texts["Red words"]["fontColor"], "#ff0000")
        self.assertEqual(texts["**Results**"]["fontSize"], 64)  # 24 pt on a 720 pt page -> 1920 px
        shapes = [(e["kind"], e["bg"]) for e in first["elements"] if e["type"] == "shape"]
        self.assertIn(("rect", "#33994d"), shapes)
        self.assertIn(("ellipse", "#ffcc00"), shapes)
        line = next(e for e in first["elements"] if e["type"] == "path")
        self.assertEqual(line["stroke"], "#333333")

    def test_math_and_dense_drawings_become_pictures(self):
        p = self.run_import()
        figs = [e["filePath"] for e in p["slides"][0]["elements"] if e["type"] == "figure"]
        self.assertTrue(any("pdf-math-" in f for f in figs))      # the Symbol-font line
        self.assertTrue(any("pdf-drawing-" in f for f in figs))   # the 80-segment "plot"
        self.assertTrue(any("pdf-image-" in f for f in figs))     # the embedded picture
        for f in figs:
            self.assertTrue(os.path.isfile(os.path.join(self.tmp, "Deck", f)))
        self.assertFalse(any("abc" in e.get("content", "") for e in p["slides"][0]["elements"]))
        self.assertTrue(any("Equations are pictures" in w for w in p["warnings"]))

    def test_repeated_content_goes_to_a_master_with_page_numbers(self):
        p = self.run_import()
        master = p["masters"][0]["elements"]
        self.assertIn(("shape", "#cc0000"), [(e["type"], e.get("bg")) for e in master])  # the logo
        self.assertIn("\\slidenumber / \\totalslides", [e.get("content") for e in master])
        self.assertFalse(any(e.get("bg") == "#cc0000" for s in p["slides"] for e in s["elements"]))

    def test_overlay_pages_merge_into_steps(self):
        p = self.run_import()
        self.assertEqual([s["title"] for s in p["slides"]], ["Results", "Steps"])  # 3 pages, 2 slides
        steps = {e["content"]: e.get("step", 1) for e in p["slides"][1]["elements"] if e["type"] == "text"}
        self.assertEqual((steps["First point"], steps["Second point"]), (1, 2))

    def test_content_that_disappears_between_overlay_pages(self):
        import pymupdf as fz
        doc = fz.open()
        for opt in ("Option A", "Option B", "Option C"):  # one frame: three overlay pages
            p = doc.new_page(width=720, height=405)
            p.insert_text((40, 50), "Swapping", fontsize=24, fontname="hebo")
            p.insert_text((40, 110), "A line that stays on every page", fontsize=14)
            p.insert_text((40, 160), opt, fontsize=14)
        for title in ("Other slide", "Third slide", "Fourth slide", "Fifth slide", "Last slide"):  # (the frame isn't "most pages": no master)
            p = doc.new_page(width=720, height=405)
            p.insert_text((40, 50), title, fontsize=24, fontname="hebo")
            p.insert_text((40, 110), f"Something else on {title}", fontsize=14)
        src = os.path.join(self.tmp, "swap.pdf")
        doc.save(src)
        res = self.import_talk(src, self.tmp, "Swap", {"pdfMode": "editable"})
        self.assertTrue(res["success"], res)
        slide = res["project"]["slides"][0]
        spans = {e["content"]: (e.get("step", 1), e.get("until")) for e in slide["elements"] if e["type"] == "text"}
        self.assertEqual([spans.get(f"Option {c}") for c in "ABC"], [(1, 1), (2, 2), (3, None)], (spans, [s["title"] for s in res["project"]["slides"]]))
        self.assertEqual(spans["A line that stays on every page"], (1, None))

    def test_picture_with_editable_text(self):
        p = self.run_import("overlay")
        first = p["slides"][0]["elements"]
        self.assertEqual((first[0]["type"], first[0].get("locked"), first[0]["width"]), ("figure", "yes", 1920))
        self.assertIn("Red words", [e.get("content") for e in first])

    def test_pages_as_pictures(self):
        p = self.run_import("images")
        self.assertEqual([s["title"] for s in p["slides"]], ["Results", "Steps", "Steps"])
        self.assertTrue(all(len(s["elements"]) == 1 and s["elements"][0]["type"] == "figure" for s in p["slides"]))


GT_TEX = r"""\documentclass{beamer}
\begin{document}
\begin{frame}{Hello world}
Alpha beta gamma delta.
\end{frame}
\begin{frame}{Second frame}
\begin{itemize}
\item Epsilon zeta
\pause
\item Theta iota
\end{itemize}
\end{frame}
\end{document}
"""


def build_compiled_pdf(path, unrelated=False):
    """What pdflatex would give for GT_TEX (16:9, frame page labels 1, 2, 2), drawn by PyMuPDF."""
    import pymupdf as fz
    doc = fz.open()
    W, H = 453.5, 255.1
    p = doc.new_page(width=W, height=H)
    p.insert_text((180, 22), "Other things" if unrelated else "Hello world", fontsize=14)
    p.insert_text((40, 120), "Nothing alike here" if unrelated else "Alpha beta gamma delta.", fontsize=10)
    for items in (["Epsilon zeta"], ["Epsilon zeta", "Theta iota"]):
        p = doc.new_page(width=W, height=H)
        p.insert_text((170, 22), "Second frame", fontsize=14)
        for k, item in enumerate(items):
            p.insert_text((50, 100 + 30 * k), item, fontsize=10)
    doc.set_page_labels([{"startpage": 0, "prefix": "", "style": "D", "firstpagenum": 1},
                         {"startpage": 1, "prefix": "", "style": "D", "firstpagenum": 2},
                         {"startpage": 2, "prefix": "", "style": "D", "firstpagenum": 2}])
    doc.save(path)
    return path


class ImportSourcesTest(TempDirTest):
    """Several files, folders, a zip: which file is the talk (backend/importers/__init__.py)."""

    def setUp(self):
        super().setUp()
        from backend.importers import resolve_sources
        self.resolve = resolve_sources

    def write(self, rel, text="x"):
        p = os.path.join(self.tmp, rel)
        os.makedirs(os.path.dirname(p), exist_ok=True)
        with open(p, "w") as f:
            f.write(text)
        return p

    def test_split_tex_files_find_the_main_one(self):
        part = self.write("talk/sections/intro.tex", "\\begin{frame}{Intro}\\end{frame}")
        main = self.write("talk/main.tex", GT_TEX.replace("\\begin{document}", "\\begin{document}\\input{sections/intro}"))
        self.assertEqual(self.resolve([part, main])["path"], main)
        self.assertEqual(self.resolve([os.path.join(self.tmp, "talk")])["path"], main)  # a folder

    def test_only_parts_says_what_is_missing(self):
        part = self.write("talk/sections/intro.tex", "\\begin{frame}{Intro}\\end{frame}")
        self.assertIn("main one", self.resolve([part])["error"] if "error" in self.resolve([part]) else self.resolve([part, part])["error"])

    def test_slidev_entry_among_md_files(self):
        page = self.write("deck/pages/extra.md", "# More")
        entry = self.write("deck/slides.md", "---\ntheme: default\n---\n# Hi")
        self.assertEqual(self.resolve([page, entry])["path"], entry)

    def test_compiled_pdf_candidates(self):
        main = self.write("talk/talk.tex", GT_TEX)
        self.write("talk/figures/plot.pdf")   # a figure: never the talk
        other = self.write("talk/handout.pdf")
        same = self.write("talk/talk.pdf")
        got = self.resolve(main)
        self.assertEqual(got["pdfs"], [same, other])  # the one named like the .tex first
        self.assertEqual(self.resolve([main, other])["pdfs"][0], other)  # given along: before the rest


class GroundTruthTest(TempDirTest):
    """A compiled PDF given with the source corrects the layout (backend/importers/groundtruth.py)."""

    def setUp(self):
        super().setUp()
        try:
            import pymupdf  # noqa: F401
        except ImportError:
            self.skipTest("PyMuPDF not installed (uv sync --extra pdf)")
        from backend.importers import import_talk
        self.import_talk = import_talk
        os.makedirs(os.path.join(self.tmp, "src"))
        self.tex = os.path.join(self.tmp, "src", "talk.tex")
        with open(self.tex, "w") as f:
            f.write(GT_TEX)

    def run_import(self, source, name, **opts):
        res = self.import_talk(source, self.tmp, name, opts)
        self.assertTrue(res["success"], res)
        return res

    def text(self, project, slide, words):
        return next(e for e in project["slides"][slide]["elements"] if e["type"] == "text" and words in e["content"])

    def test_without_a_pdf_nothing_changes(self):
        res = self.run_import(self.tex, "Plain")
        self.assertEqual(res["ground_truth"], "")
        self.assertNotIn("groundTruth", res["project"])

    def test_the_pdf_places_text_and_fixes_the_aspect_ratio(self):
        plain = self.run_import(self.tex, "Plain")["project"]
        pdf = build_compiled_pdf(os.path.join(self.tmp, "src", "talk.pdf"))
        res = self.run_import([self.tex, pdf], "Checked")
        p = res["project"]
        self.assertEqual(res["ground_truth"], "talk.pdf")
        self.assertEqual(p["groundTruth"]["slides"], 2)
        self.assertEqual((p["width"], p["height"]), (1280, 720))  # the PDF is 16:9, not Beamer's default 4:3
        k = p["width"] / 453.5
        alpha = self.text(p, 0, "Alpha")
        self.assertLess(abs(alpha["y"] - (120 - 9) * k), 30, alpha)  # where the PDF has it
        self.assertLess(abs(alpha["x"] - 40 * k), 15, alpha)
        self.assertNotEqual(self.text(plain, 0, "Alpha")["y"], alpha["y"])
        items = self.text(p, 1, "Theta")
        self.assertLess(abs(items["y"] - (100 - 9) * k), 30, items)
        # it reaches the second item: only on the frame's last overlay page
        self.assertGreater(items["y"] + items["height"], 130 * k, items)
        self.assertEqual(alpha["content"], self.text(plain, 0, "Alpha")["content"])  # content untouched

    def test_a_pdf_next_to_the_tex_is_used(self):
        build_compiled_pdf(os.path.join(self.tmp, "src", "talk.pdf"))
        self.assertEqual(self.run_import(self.tex, "Next")["ground_truth"], "talk.pdf")
        self.assertEqual(self.run_import(self.tex, "Off", usePdf=False)["ground_truth"], "")

    def test_a_pdf_of_another_talk_is_ignored(self):
        plain = self.run_import(self.tex, "Plain")["project"]
        pdf = build_compiled_pdf(os.path.join(self.tmp, "other.pdf"), unrelated=True)
        res = self.run_import([self.tex, pdf], "Other")
        self.assertEqual(res["ground_truth"], "")
        self.assertEqual(self.text(res["project"], 0, "Alpha")["y"], self.text(plain, 0, "Alpha")["y"])

    def test_content_that_disappears_is_placed_from_its_own_page(self):
        import pymupdf as fz
        tex = os.path.join(self.tmp, "src", "swap.tex")
        with open(tex, "w") as f:
            f.write(r"""\documentclass{beamer}
\begin{document}
\begin{frame}{Swapping frame}
\only<1>{Earlier version of this sentence.}
\only<2>{Later wording replaces the sentence.}
\end{frame}
\end{document}
""")
        doc = fz.open()
        for y, text in ((80, "Earlier version of this sentence."), (190, "Later wording replaces the sentence.")):
            p = doc.new_page(width=453.5, height=255.1)  # two overlay pages of one frame (labels 1, 1)
            p.insert_text((160, 22), "Swapping frame", fontsize=14)
            p.insert_text((40, y), text, fontsize=10)
        doc.set_page_labels([{"startpage": 0, "prefix": "", "style": "D", "firstpagenum": 1},
                             {"startpage": 1, "prefix": "", "style": "D", "firstpagenum": 1}])
        pdf = os.path.join(self.tmp, "src", "swap.pdf")
        doc.save(pdf)
        p = self.run_import([tex, pdf], "Swap")["project"]
        k = p["width"] / 453.5
        early, late = self.text(p, 0, "Earlier"), self.text(p, 0, "Later")
        self.assertEqual((early.get("until"), late.get("step")), (1, 2))
        self.assertLess(abs(early["y"] - (80 - 9) * k), 30, early)   # from page 1, where it is
        self.assertLess(abs(late["y"] - (190 - 9) * k), 30, late)    # from page 2

    MISSING_TEX = r"""\documentclass{beamer}
\begin{document}
\begin{frame}{Results here}
Convergence of the method shown below.

\includegraphics[width=0.5\linewidth]{figures/lost_plot}
\end{frame}
\begin{frame}{Drawn plot}
A plot drawn in the PDF itself.

\includegraphics[width=0.5\linewidth]{figures/lost_vector.pdf}
\end{frame}
\end{document}
"""

    def missing_figure_talk(self):
        import pymupdf as fz
        from PIL import Image as PILImage
        tex = os.path.join(self.tmp, "src", "lost.tex")
        with open(tex, "w") as f:
            f.write(self.MISSING_TEX)
        png = os.path.join(self.tmp, "picture.png")
        PILImage.new("RGB", (300, 200), "green").save(png)
        doc = fz.open()
        p = doc.new_page(width=453.5, height=255.1)
        p.insert_text((160, 22), "Results here", fontsize=14)
        p.insert_text((40, 70), "Convergence of the method shown below.", fontsize=10)
        p.insert_image(fz.Rect(150, 100, 300, 200), filename=png)
        p = doc.new_page(width=453.5, height=255.1)
        p.insert_text((160, 22), "Drawn plot", fontsize=14)
        p.insert_text((40, 70), "A plot drawn in the PDF itself.", fontsize=10)
        for i in range(80):  # a vector plot: many small segments
            p.draw_line(fz.Point(120 + i * 2.5, 200), fz.Point(121 + i * 2.5, 200 - (i % 9) * 10), color=(0, 0, 1), width=0.5)
        doc.set_page_labels([{"startpage": 0, "prefix": "", "style": "D", "firstpagenum": 1}])
        pdf = os.path.join(self.tmp, "src", "lost.pdf")
        doc.save(pdf)
        return tex, pdf

    def test_figures_missing_from_the_source_are_taken_from_the_pdf(self):
        tex, pdf = self.missing_figure_talk()
        res = self.run_import([tex, pdf], "Lost")
        p, folder = res["project"], res["folder"]
        figs = [e for s in p["slides"] for e in s["elements"] if e["type"] == "figure"]
        self.assertEqual([f["filePath"] for f in figs], ["figures/lost_plot.png", "figures/lost_vector.png"])
        for f in figs:
            self.assertTrue(os.path.isfile(os.path.join(folder, f["filePath"])), f)
            self.assertNotIn("missing", f)
        k = p["width"] / 453.5
        self.assertLess(abs(figs[0]["x"] - 150 * k), 10, figs[0])  # where the PDF shows it
        self.assertLess(abs(figs[0]["width"] - 150 * k), 10, figs[0])
        self.assertEqual(p["groundTruth"]["recovered"], 2)
        self.assertFalse([w for w in p["warnings"] if "not found" in w.lower()], p["warnings"])
        self.assertTrue(any("taken from lost.pdf" in w for w in p["warnings"]), p["warnings"])

    def test_without_a_pdf_a_missing_figure_stays_a_placeholder(self):
        tex, _ = self.missing_figure_talk()
        p = self.run_import(tex, "NoPdf", usePdf=False)["project"]
        fig = next(e for e in p["slides"][0]["elements"] if e["type"] == "figure")
        self.assertEqual(fig["filePath"], "figures/lost_plot.png")
        self.assertTrue(any("Figure not found" in w for w in p["warnings"]))

    def test_in_a_zip(self):
        import zipfile
        pdf = build_compiled_pdf(os.path.join(self.tmp, "talk.pdf"))
        z = os.path.join(self.tmp, "talk.zip")
        with zipfile.ZipFile(z, "w") as zf:
            zf.write(self.tex, "talk.tex")
            zf.write(pdf, "talk.pdf")
        self.assertEqual(self.run_import(z, "Zipped")["ground_truth"], "talk.pdf")


class SlidevImageRowTest(TempDirTest):
    """A row of images in an absolute box (<div class="absolute ..."><div class="grid grid-cols-3"><img width=300>...)."""

    MD = """---
theme: default
---
# Toy example

Nonlinear manifold of functions.

<div class="absolute left-10px bottom-7px">
<div class="grid grid-cols-3">
<img src="./figures/a.png" width="300">
<img src="./figures/b.png" width="300">
<img src="./figures/c.png" width="300">
</div>
</div>
"""

    def setUp(self):
        super().setUp()
        from backend.importers import import_talk
        self.import_talk = import_talk
        self.src = os.path.join(self.tmp, "talk")
        os.makedirs(os.path.join(self.src, "figures"))
        for n in "abc":
            Image.new("RGB", (400, 300), "blue").save(os.path.join(self.src, "figures", f"{n}.png"))
        with open(os.path.join(self.src, "slides.md"), "w") as f:
            f.write(self.MD)

    def row(self, res):
        self.assertTrue(res["success"], res)
        return next(e for e in res["project"]["slides"][0]["elements"] if e["type"] == "columns")

    def test_missing_images_of_the_row_come_from_the_compiled_pdf(self):
        import pymupdf as fz
        for n in "abc":
            os.rename(os.path.join(self.src, "figures", f"{n}.png"), os.path.join(self.tmp, f"{n}.png"))
        doc = fz.open()
        p = doc.new_page(width=980, height=551)
        p.insert_text((60, 60), "Toy example", fontsize=30)
        p.insert_text((60, 110), "Nonlinear manifold of functions.", fontsize=18)
        for i, n in enumerate("abc"):
            p.insert_image(fz.Rect(140 + i * 240, 300, 360 + i * 240, 465), filename=os.path.join(self.tmp, f"{n}.png"))
        doc.save(os.path.join(self.src, "slides-export.pdf"))
        res = self.import_talk(self.src, self.tmp, "Recovered", {})
        row = self.row(res)
        for n in "abc":
            self.assertTrue(os.path.isfile(os.path.join(res["folder"], "figures", f"{n}.png")), n)
        self.assertLess(abs(row["x"] - 140 * 1920 / 980), 40, row)

    def test_the_row_is_as_wide_as_its_images(self):
        row = self.row(self.import_talk(self.src, self.tmp, "Plain", {}))
        k = 1920 / 980
        self.assertGreater(row["width"], 900 * k * 0.95)  # 3 x 300 px (+ gaps), not the 360 px of a text box
        self.assertTrue(all("![" in c["content"] for c in row["columns"]))
        self.assertGreater(row["height"], 0.7 * row["width"] / 3 * 0.75)  # the images' own height
        self.assertLessEqual(row["y"] + row["height"], 1080)  # anchored at the bottom

    def test_the_compiled_pdf_places_the_row(self):
        try:
            import pymupdf as fz
        except ImportError:
            self.skipTest("PyMuPDF not installed")
        doc = fz.open()
        p = doc.new_page(width=980, height=551)
        p.insert_text((60, 60), "Toy example", fontsize=30)
        p.insert_text((60, 110), "Nonlinear manifold of functions.", fontsize=18)
        png = os.path.join(self.src, "figures", "a.png")
        for i in range(3):  # centred, larger than converted
            p.insert_image(fz.Rect(140 + i * 240, 300, 360 + i * 240, 465), filename=png)
        pdf = os.path.join(self.src, "slides-export.pdf")
        doc.save(pdf)
        row = self.row(self.import_talk(self.src, self.tmp, "Checked", {}))
        k = 1920 / 980
        self.assertLess(abs(row["x"] - 140 * k), 40, row)
        self.assertLess(abs(row["y"] - 300 * k), 40, row)
        self.assertLess(abs(row["width"] - 700 * k), 60, row)


class SlidevSwitchTest(TempDirTest):
    """Content shown at some steps only: v-switch, v-click-hide, v-click="[a, b]" (until:M)."""

    MD = """---
theme: default
---
# Switching

<v-switch>
<template #1>First option</template>
<template #2>Second option</template>
<template #3>Third option</template>
</v-switch>

<div v-click-hide>Gone at the next click</div>

<div v-click="[1, 3]">From click one to three</div>

<div v-click="[5, 6]">Range one replaced</div>

<div v-click="[6, 7]">Range two replacing</div>
"""

    def setUp(self):
        super().setUp()
        from backend.importers import import_talk
        src = os.path.join(self.tmp, "talk")
        os.makedirs(src)
        with open(os.path.join(src, "slides.md"), "w") as f:
            f.write(self.MD)
        res = import_talk(src, self.tmp, "Switch", {})
        self.assertTrue(res["success"], res)
        self.els = {e["content"]: e for e in res["project"]["slides"][0]["elements"] if e["type"] == "text"}

    def span(self, words):
        e = next(v for k, v in self.els.items() if words in k)
        return e.get("step", 1), e.get("until")

    def test_switch_options_replace_each_other_in_one_place(self):
        self.assertEqual([self.span(w) for w in ("First", "Second", "Third")], [(2, 2), (3, 3), (4, None)])
        ys = {next(v for k, v in self.els.items() if w in k)["y"] for w in ("First", "Second", "Third")}
        self.assertEqual(len(ys), 1)  # the same place, not one under the other

    def test_ranges_that_follow_each_other_share_a_place(self):
        one = next(v for k, v in self.els.items() if "Range one" in k)
        two = next(v for k, v in self.els.items() if "Range two" in k)
        self.assertEqual((one.get("step"), one.get("until"), two.get("step"), two.get("until")), (6, 6, 7, 7))
        self.assertEqual(one["y"], two["y"])

    def test_v_motion_moves_content_where_slidev_shows_it(self):
        from backend.importers import import_talk
        src = os.path.join(self.tmp, "motion")
        os.makedirs(src)
        with open(os.path.join(src, "slides.md"), "w") as f:
            f.write("""---
theme: default
---
# Moving

<div v-click="[1, 2]">
<div v-motion :initial="{ y: 0, x: 0 }">

First block of text
</div>
</div>

<div v-click="[2, 3]">
<div v-motion :initial="{ y: -40, x: 10 }">

Second block of text
</div>
</div>
""")
        res = import_talk(src, self.tmp, "Motion", {})
        els = {e["content"]: e for e in res["project"]["slides"][0]["elements"] if e["type"] == "text"}
        first, second = els["First block of text"], els["Second block of text"]
        k = 1920 / 980
        # ranges moved into place one over the other: the first one's place (offsets
        # tuned to Slidev's rendered heights can't be reproduced), its own x offset kept
        self.assertEqual(second["y"], first["y"], (first, second))
        self.assertLess(abs(second["x"] - (first["x"] + 10 * k)), 2)
        self.assertEqual((first.get("until"), second.get("step"), second.get("until")), (2, 3, 3))

    def test_hide_and_ranges(self):
        self.assertEqual(self.span("Gone"), (1, 4))       # shown, gone at the click after the switch
        self.assertEqual(self.span("From click"), (2, 3))  # [1, 3]: clicks 1 and 2


class ExtrasTest(TempDirTest):
    """The PDF component download (backend/importers/extras.py), with a fake download."""

    def test_certificate_errors_retry_with_the_systems_certificates(self):
        import ssl
        import urllib.error
        from backend import net
        calls = []

        def fake(req, timeout, context=None):
            calls.append(context)
            if len(calls) == 1:
                raise urllib.error.URLError(ssl.SSLCertVerificationError("unable to get local issuer certificate"))
            return "response"

        with mock.patch.object(net, "ssl_contexts", return_value=[None, "system"]), \
                mock.patch("urllib.request.urlopen", fake):
            self.assertEqual(net.open_url("https://example.org", 5), "response")
        self.assertEqual(calls, [None, "system"])

        def offline(req, timeout, context=None):
            calls.append(context)
            raise urllib.error.URLError(OSError("Network is unreachable"))

        calls.clear()
        with mock.patch.object(net, "ssl_contexts", return_value=[None, "system"]), \
                mock.patch("urllib.request.urlopen", offline):
            with self.assertRaises(urllib.error.URLError):
                net.open_url("https://example.org", 5)
        self.assertEqual(calls, [None])  # not a certificate problem: no retries

    def test_a_wrong_file_is_refused(self):
        from backend.importers import extras
        with mock.patch.dict(os.environ, {"GLUONSLIDES_DATA_DIR": self.tmp}), \
                mock.patch.object(extras, "_system", return_value=("linux", "x86_64")):
            res = extras.install("pymupdf", fetch=lambda url: b"not the wheel")
        self.assertFalse(res["success"])
        self.assertIn("not the expected file", res["error"])
        self.assertFalse(os.path.exists(os.path.join(self.tmp, "extras", f"pymupdf-{extras.PYMUPDF_VERSION}")))

    def test_each_system_has_its_wheel(self):
        from backend.importers import extras
        for system in (("linux", "x86_64"), ("darwin", "arm64"), ("darwin", "x86_64"), ("win32", "amd64")):
            url, sha = extras.PYMUPDF_WHEELS[system]
            self.assertIn(extras.PYMUPDF_VERSION, url)
            self.assertRegex(sha, r"^[0-9a-f]{64}$")
        with mock.patch.object(extras, "_system", return_value=("plan9", "mips")):
            self.assertFalse(extras.install("pymupdf", fetch=lambda u: b"")["success"])
        self.assertFalse(extras.install("other")["success"])

    def test_pinned_wheels_match_the_lock_file(self):
        from backend.importers import extras
        lock = (REPO / "uv.lock").read_text()
        for url, sha in extras.PYMUPDF_WHEELS.values():
            self.assertIn(f'{{ url = "{url}", hash = "sha256:{sha}"', lock)


class VariablesTest(TempDirTest):
    """Variable files (backend/variables.py): JSON and CSV, linked into data/ and followed."""

    def write(self, name, text):
        path = os.path.join(self.tmp, name)
        with open(path, "w", encoding="utf-8") as f:
            f.write(text)
        return path

    def test_json_nested_and_types(self):
        from backend.variables import read_vars_file
        p = self.write("s.json", '{"err": 0.0123, "n": 12, "name": "NGD", "fit": {"a": 2.5, "b": [1, 2]}, "ok": true, "2nd": 3}')
        res = read_vars_file(self.tmp, p)
        self.assertTrue(res["success"], res)
        self.assertEqual(res["values"], {"err": 0.0123, "n": 12, "name": "NGD", "fit.a": 2.5, "ok": 1, "_2nd": 3})

    def test_csv_pairs_header_and_last_row(self):
        from backend.variables import read_vars_file
        pairs = self.write("p.csv", "name,value\nalpha,0.05\nmethod,Adam\n")
        self.assertEqual(read_vars_file(self.tmp, pairs)["values"], {"alpha": 0.05, "method": "Adam"})
        log = self.write("log.csv", "step;loss;acc\n1;0.9;0.5\n2;0.4;0.81\n")
        self.assertEqual(read_vars_file(self.tmp, log)["values"], {"step": 2, "loss": 0.4, "acc": 0.81})

    def test_bad_files_say_why(self):
        from backend.variables import read_vars_file
        self.assertFalse(read_vars_file(self.tmp, self.write("bad.json", "[1, 2]"))["success"])
        self.assertFalse(read_vars_file(self.tmp, self.write("x.xlsx", ""))["success"])
        self.assertFalse(read_vars_file(self.tmp, "missing.json")["success"])

    def test_link_and_follow_the_original(self):
        from backend.variables import link_vars_file, refresh_vars
        project = os.path.join(self.tmp, "proj")
        os.makedirs(project)
        src = self.write("summary.json", '{"err": 1}')
        res = link_vars_file(project, src)
        self.assertTrue(res["success"], res)
        self.assertEqual((res["relative_path"], res["values"]), ("data/summary.json", {"err": 1}))
        item = {"src": res["relative_path"], "original": src, "mtime": res["mtime"]}
        self.assertEqual(refresh_vars(project, [item])["updated"], [])  # nothing changed
        self.write("summary.json", '{"err": 0.5, "n": 3}')
        os.utime(src, (time.time() + 5, time.time() + 5))
        up = refresh_vars(project, [item])["updated"]
        self.assertEqual(up[0]["values"], {"err": 0.5, "n": 3})


class PlotDataTest(TempDirTest):
    """CSV files for plots (backend/tables.py read_plot_data / link / refresh)."""

    def write(self, name, text):
        path = os.path.join(self.tmp, name)
        with open(path, "w", encoding="utf-8") as f:
            f.write(text)
        return path

    def test_header_only_when_the_first_row_is_names(self):
        from backend.tables import read_plot_data
        res = read_plot_data(self.tmp, self.write("run.csv", "step;loss\n1;0.9\n2;0.4\n"))
        self.assertEqual((res["header"], res["rows"]), (["step", "loss"], [["1", "0.9"], ["2", "0.4"]]))
        bars = read_plot_data(self.tmp, self.write("bars.csv", "Adam,3\nSGD,5\n"))
        js = read_plot_data(self.tmp, self.write("results.json", '{"adam": {"acc": 0.91}, "sgd": {"acc": 0.85}}'))
        self.assertTrue(js["success"])
        self.assertEqual(list(js["json"].keys()), ["adam", "sgd"])
        self.assertFalse(read_plot_data(self.tmp, self.write("bad.json", "{oops"))["success"])
        self.assertEqual((bars["header"], len(bars["rows"])), (None, 2))  # "Adam,3" is data

    def test_big_files_are_thinned_keeping_the_last_row(self):
        from backend import tables
        lines = "x,y\n" + "".join(f"{i},{i * i}\n" for i in range(50000))
        res = tables.read_plot_data(self.tmp, self.write("big.csv", lines))
        self.assertEqual((res["total"], len(res["rows"])), (50000, tables.MAX_PLOT_ROWS))
        self.assertEqual(res["rows"][-1], ["49999", str(49999 * 49999)])

    def test_link_and_follow(self):
        from backend.tables import link_plot_data, refresh_plot_data
        project = os.path.join(self.tmp, "proj")
        os.makedirs(project)
        src = self.write("run.csv", "step,loss\n1,0.9\n")
        res = link_plot_data(project, src)
        self.assertEqual((res["relative_path"], res["rows"]), ("data/run.csv", [["1", "0.9"]]))
        item = {"src": res["relative_path"], "original": src, "mtime": res["mtime"]}
        self.assertEqual(refresh_plot_data(project, [item])["updated"], [])
        self.write("run.csv", "step,loss\n1,0.9\n2,0.5\n")
        os.utime(src, (time.time() + 5, time.time() + 5))
        self.assertEqual(refresh_plot_data(project, [item])["updated"][0]["rows"], [["1", "0.9"], ["2", "0.5"]])
        self.assertFalse(refresh_plot_data(project, [{"src": "data/none.csv", "mtime": 0}])["updated"][0]["success"])
        # linked again: the same copy, not data/run_1.csv
        self.assertEqual(link_plot_data(project, src)["relative_path"], res["relative_path"])


class TablesTest(TempDirTest):
    """CSV files for tables (backend/tables.py)."""

    def test_delimiters_and_quoting(self):
        rows = lambda text: tables.parse_csv(text)[0]
        self.assertEqual(rows("a,b\n1,2\n"), [["a", "b"], ["1", "2"]])
        self.assertEqual(rows("a;b\n1;2"), [["a", "b"], ["1", "2"]])
        self.assertEqual(rows("a\tb\n1\t2"), [["a", "b"], ["1", "2"]])
        self.assertEqual(rows('"x, y",z\n1,2'), [["x, y", "z"], ["1", "2"]])
        self.assertEqual(rows("a,b,c\n1\n"), [["a", "b", "c"], ["1", "", ""]])  # padded

    def test_a_big_file_gives_its_first_rows(self):
        big = os.path.join(self.tmp, "big.csv")
        Path(big).write_text("step,loss,grad,time\n" + "".join(f"{i},{i * 0.5},{i},{i}\n" for i in range(50000)))
        res = tables.read_table_file(self.tmp, big, 20)
        self.assertTrue(res["success"], res)
        self.assertEqual((len(res["rows"]), res["total"], res["rows"][0][0]), (20, 50001, "step"))
        self.assertFalse(tables.read_table_file(self.tmp, big)["success"])  # all of it: too large for a slide
        project = os.path.join(self.tmp, "talk")
        os.makedirs(project)
        linked = tables.link_table_file(project, big, 20)
        self.assertEqual((len(linked["rows"]), linked["total"]), (20, 50001))
        up = tables.refresh_tables(project, [{"src": linked["relative_path"], "original": big, "mtime": 0, "rows": 5}])["updated"]
        self.assertEqual(len(up[0]["rows"]), 5)

    def test_link_copies_into_data_and_refresh_follows_the_original(self):
        project = os.path.join(self.tmp, "talk")
        os.makedirs(project)
        original = os.path.join(self.tmp, "results.csv")
        Path(original).write_text("m,e\nNGD,0.1\n")
        res = tables.link_table_file(project, original)
        self.assertTrue(res["success"], res)
        self.assertEqual((res["relative_path"], res["rows"][1]), ("data/results.csv", ["NGD", "0.1"]))
        item = {"src": res["relative_path"], "original": original, "mtime": res["mtime"]}
        self.assertEqual(tables.refresh_tables(project, [item])["updated"], [])  # nothing changed
        Path(original).write_text("m,e\nNGD,0.05\nNHB,0.01\n")
        os.utime(original, (os.path.getmtime(original) + 5,) * 2)
        up = tables.refresh_tables(project, [item])["updated"]
        self.assertEqual(up[0]["rows"][2], ["NHB", "0.01"])
        self.assertIn("NHB", Path(project, "data", "results.csv").read_text())

    def test_errors(self):
        self.assertFalse(tables.read_table_file(self.tmp, "missing.csv")["success"])
        self.assertFalse(tables.link_table_file("", "x.csv")["success"])


SLIDEV_FIXTURE = REPO / "tests" / "backend" / "fixtures" / "slidev"


class SlidevImportTest(TempDirTest):
    """Slidev -> slides (backend/importers/slidev.py), on a small deck using each feature."""

    def setUp(self):
        super().setUp()
        from backend.importers import import_talk
        self.import_talk = import_talk
        res = import_talk(str(SLIDEV_FIXTURE / "slides.md"), self.tmp, "Slidev Talk")
        self.assertTrue(res["success"], res)
        self.p = res["project"]
        self.s = {s["title"]: s for s in self.p["slides"]}

    def els(self, title, kind=None):
        return [e for e in self.s[title]["elements"] if kind is None or e["type"] == kind]

    def test_slides_includes_hidden_and_separators(self):
        self.assertEqual([s["title"] for s in self.p["slides"]], ["A Slidev Talk", "Results", "Clicks in a grid", "Two columns"])
        self.assertEqual((self.p["title"], self.p["author"], self.p["width"], self.p["height"]), ("A Slidev Talk", "Ana", 1920, 1080))

    def test_katex_macros(self):
        self.assertIn("\\newcommand{\\R}{\\mathbb{R}}", self.p["macros"])
        self.assertIn("\\newcommand{\\pair}[2]{\\langle #1, #2 \\rangle}", self.p["macros"])

    def test_cover_background_title_and_notes(self):
        bg = self.els("A Slidev Talk", "figure")[0]
        self.assertEqual((bg["filePath"], bg["width"], bg.get("locked")), ("figures/bg.png", 1920, "yes"))
        texts = [e["content"] for e in self.els("A Slidev Talk", "text")]
        self.assertIn("**A Slidev Talk**", texts)
        self.assertTrue(all(e["textAlign"] == "center" for e in self.els("A Slidev Talk", "text")))  # class: text-center
        self.assertEqual(self.s["A Slidev Talk"]["notes"], "Welcome everyone.")
        self.assertEqual(self.s["Results"]["notes"], "Say the results slowly.")

    def test_html_headings_become_markdown(self):
        from backend.importers.slidev import clean_md, only_headings
        md = clean_md('<h3 style="text-align: center">Gradient descent</h3>\n\n$$x = y$$\n'
                      '<h3 style="color: white; text-align: center"> <span style="color: black">Ghost</span></h3>')
        self.assertEqual(md, '### Gradient descent\n\n$$x = y$$\n\n### \\textcolor{white}{\\textcolor{black}{Ghost}}')
        self.assertTrue(only_headings(md))  # titles over equations: a centred box
        self.assertFalse(only_headings("### Title\n\nA paragraph."))

    def test_text_mdc_grid_table(self):
        texts = [e["content"] for e in self.els("Results", "text")]
        self.assertIn('Text with $x \\in \\R$ and \\textcolor{white}{a ghost}.', texts)
        cols = self.els("Results", "columns")[0]
        self.assertEqual([c["content"] for c in cols["columns"]], ["Left column", "Right column"])
        table = self.els("Results", "table")[0]
        self.assertEqual(table["rows"], [["Method", "Error"], ["NGD", "0.1"]])
        two = self.els("Two columns", "columns")[0]
        self.assertEqual([c["content"] for c in two["columns"]], ["Left side", "Right side"])  # layout: two-cols

    def test_clicks_become_steps(self):
        steps = {e.get("content", e["type"]): e.get("step", 1) for e in self.els("Results")}
        self.assertEqual(steps["$$\\pair{u}{v}$$"], 2)
        self.assertEqual((steps["- first"], steps["- second"]), (3, 4))  # <v-clicks>: one per item
        self.assertEqual((steps["figure"], steps["path"]), (1, 1))       # no click: from the start
        grid = {e["content"]: e for e in self.els("Clicks in a grid", "text")}
        self.assertEqual((grid["A"].get("step", 1), grid["B later"]["step"]), (1, 2))
        self.assertGreater(grid["B later"]["x"], grid["A"]["x"])  # its own column

    def test_absolute_boxes_and_arrows_are_placed_exactly(self):
        fig = self.els("Results", "figure")[0]
        k = 1920 / 980
        self.assertAlmostEqual(fig["x"], 325 * k, delta=1)
        self.assertAlmostEqual(fig["y"] + fig["height"], 1080 - 20 * k, delta=2)  # bottom-20px
        self.assertAlmostEqual(fig["width"], 200 * k, delta=1)
        arrow = self.els("Results", "path")[0]
        self.assertEqual((arrow["stroke"], arrow.get("end")), ("#ff0000", "arrow"))
        self.assertAlmostEqual(arrow["x"], 100 * k, delta=1)

    def test_from_a_zip(self):
        import zipfile
        z = os.path.join(self.tmp, "deck.zip")
        with zipfile.ZipFile(z, "w") as zf:
            for f in SLIDEV_FIXTURE.rglob("*"):
                if f.is_file():
                    zf.write(f, Path("deck") / f.relative_to(SLIDEV_FIXTURE))
        res = self.import_talk(z, self.tmp, "From Zip")
        self.assertTrue(res["success"], res)
        self.assertEqual(len(res["project"]["slides"]), 4)


class PackagingTest(unittest.TestCase):
    """What the installable app relies on (packaging/)."""

    def test_version_matches_pyproject(self):
        import re
        from backend import __version__
        declared = re.search(r'^version = "([^"]+)"', (REPO / "pyproject.toml").read_text(), re.M).group(1)
        self.assertEqual(__version__, declared)

    def test_self_check_passes_from_source(self):
        if not (REPO / "libs" / "katex.min.js").is_file():
            self.skipTest("libraries not downloaded yet (start the app once)")
        res = subprocess.run([sys.executable, str(REPO / "app.py"), "--self-check"], capture_output=True, text=True, cwd=REPO, timeout=60)
        self.assertEqual(res.returncode, 0, res.stdout + res.stderr)
        self.assertIn("OK", res.stdout)

    def test_github_workflows_are_valid(self):
        """A workflow GitHub can't read fails silently (a red run with no steps)."""
        import yaml
        for path in sorted((REPO / ".github" / "workflows").glob("*.yml")):
            with self.subTest(path.name):
                wf = yaml.safe_load(path.read_text(encoding="utf-8"))
                self.assertIn("jobs", wf)
                self.assertTrue("on" in wf or True in wf)  # YAML 1.1 reads `on:` as True
                for job in wf["jobs"].values():
                    for step in job.get("steps", []):
                        self.assertTrue("uses" in step or "run" in step, step)

    def test_excluded_packages_dont_clash_with_setuptools(self):
        """PyInstaller maps distutils and setuptools' bundled packages (wheel,
        packaging, jaraco...) onto setuptools' copies; excluding one of those
        names fails the build where setuptools is pulled in (Windows)."""
        try:
            import setuptools
        except ImportError:
            self.skipTest("setuptools not installed")
        vendor = Path(setuptools.__file__).parent / "_vendor"
        vendored = {p.name.split("-")[0].split(".")[0] for p in vendor.iterdir()} if vendor.is_dir() else set()
        spec = (REPO / "packaging" / "gluonslides.spec").read_text()
        block = spec[spec.index("UNUSED = ["):spec.index("]", spec.index("UNUSED = ["))]
        excluded = set(re.findall(r'"([A-Za-z_][\w.]*)"', block))
        clashes = excluded & (vendored | {"setuptools", "distutils", "_distutils_hack"})
        self.assertFalse(clashes, f"excluded but needed by PyInstaller's setuptools support: {clashes}")

    def test_appimage_adds_itself_to_the_applications_menu(self):
        import app
        with tempfile.TemporaryDirectory() as tmp:
            env = {"APPIMAGE": "/home/me/Apps/GluonSlides.AppImage", "XDG_DATA_HOME": tmp}
            with mock.patch.dict(os.environ, env), mock.patch.object(app.sys, "platform", "linux"):
                app.add_to_applications_menu()
                entry = Path(tmp) / "applications" / "gluonslides.desktop"
                self.assertIn('Exec="/home/me/Apps/GluonSlides.AppImage" %f', entry.read_text())
                self.assertIn("MimeType=application/x-gluonslides;", entry.read_text())
                mime = (Path(tmp) / "mime" / "packages" / "gluonslides.xml").read_text()
                self.assertIn('<glob pattern="*.gl"/>', mime)
                os.environ["APPIMAGE"] = "/home/me/Moved/GluonSlides.AppImage"  # the file was moved
                app.add_to_applications_menu()
                self.assertIn("/Moved/", entry.read_text())
        with tempfile.TemporaryDirectory() as tmp:  # not an AppImage: nothing written
            with mock.patch.dict(os.environ, {"XDG_DATA_HOME": tmp}, clear=False):
                os.environ.pop("APPIMAGE", None)
                app.add_to_applications_menu()
                self.assertFalse((Path(tmp) / "applications").exists())

    def test_a_gl_file_on_the_command_line_is_opened(self):
        import app
        with tempfile.TemporaryDirectory() as tmp:
            project = Path(tmp) / "My talk.gl"
            project.write_text(".project {T}\n")
            other = Path(tmp) / "notes.txt"
            other.write_text("x")
            self.assertEqual(app.startup_file(["GluonSlides", str(project)]), str(project))
            self.assertEqual(app.startup_file(["GluonSlides", "-psn_0_123", str(project)]), str(project))
            self.assertIsNone(app.startup_file(["GluonSlides", str(other)]))
            self.assertIsNone(app.startup_file(["GluonSlides", str(Path(tmp) / "missing.gl")]))
            self.assertIsNone(app.startup_file(["GluonSlides"]))
        from backend.api import Api
        api = Api()
        api._startup_file = "/p/t.gl"
        self.assertEqual(api.get_startup_file(), {"success": True, "path": "/p/t.gl"})
        self.assertEqual(api.get_startup_file(), {"success": True, "path": None})  # only once

    def test_bundle_lists_every_folder_the_page_loads(self):
        spec = (REPO / "packaging" / "gluonslides.spec").read_text()
        html = (REPO / "index.html").read_text()
        for folder in ("core", "editor", "elements", "export", "ui", "present", "libs"):
            self.assertIn(f'"{folder}"', spec)
        # Every local file index.html loads is inside a bundled folder or listed.
        for ref in re.findall(r'(?:src|href)="(?!https?:|#|data:)([^"]+)"', html):
            top = ref.split("/")[0]
            self.assertTrue(f'"{top}"' in spec, f"{ref} is not bundled")


if __name__ == "__main__":
    unittest.main()
