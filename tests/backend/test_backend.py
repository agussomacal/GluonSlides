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
import shutil
import subprocess
import tempfile
import unittest
from pathlib import Path
from unittest import mock

from PIL import Image

from backend import figures, fonts, pdf_export, project_io, snap_env, user_settings

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


if __name__ == "__main__":
    unittest.main()
