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
from pathlib import Path
from unittest import mock

from PIL import Image

from backend import desktop, figures, fonts, pdf_export, presentation, project_io, snap_env, user_settings

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


class ProjectFilesTest(TempDirTest):
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


class FiguresTest(TempDirTest):
    """Importing figures into <project>/figures/ and loading them as data URIs."""

    def test_import_copies_with_unique_names(self):
        src_dir = os.path.join(self.tmp, "outside")
        os.makedirs(src_dir)
        src = os.path.join(src_dir, "plot.png")
        Path(src).write_bytes(png_bytes())
        project = os.path.join(self.tmp, "project")
        os.makedirs(project)

        first = figures.import_figure(project, src)
        second = figures.import_figure(project, src)
        self.assertTrue(first["success"] and second["success"])
        self.assertEqual(first["relative_path"], os.path.join("figures", "plot.png"))
        self.assertEqual(second["relative_path"], os.path.join("figures", "plot_1.png"))
        self.assertTrue(first["data_uri"].startswith("data:image/png;base64,"))

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
