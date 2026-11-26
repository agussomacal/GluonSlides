"""Build the installable app for this system (Linux, macOS or Windows).

    uv sync --group build
    uv run python packaging/build.py [--smoke] [--archive] [--package]
    uv run python packaging/build.py --smoke-only    # open the last build once
    uv run python packaging/build.py --package-only  # installer from the last build

1. downloads the JavaScript libraries and fonts (they are bundled),
2. runs PyInstaller with packaging/gluonslides.spec into dist/,
3. runs the built app with --self-check (files, libraries, imports, and
   each kind of backend work once),
4. --smoke: opens the built app once (--smoke-test; needs a display),
5. --archive: packs it into the file people download, in dist/:
     GluonSlides-<version>-linux-x86_64.tar.gz
     GluonSlides-<version>-windows-x64.zip
     GluonSlides-<version>-macos-arm64.dmg
6. --package: the installer, in dist/ (macOS: the .dmg above is it):
     GluonSlides-<version>-linux-x86_64.AppImage   (needs appimagetool:
       downloaded, or the path in APPIMAGETOOL)
     GluonSlides-<version>-windows-x64-setup.exe   (needs Inno Setup 6)

The app itself is in dist/GluonSlides/ (dist/GluonSlides.app on macOS).
"""

import os
import platform
import shutil
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DIST = ROOT / "dist"
sys.path.insert(0, str(ROOT))

# Windows consoles may not take every character the app prints (font
# names, paths): never fail the build over printing one.
for _stream in (sys.stdout, sys.stderr):
    if hasattr(_stream, "reconfigure"):
        _stream.reconfigure(errors="replace")


def built_program():
    if sys.platform == "darwin":
        return DIST / "GluonSlides.app" / "Contents" / "MacOS" / "GluonSlides"
    return DIST / "GluonSlides" / ("GluonSlides.exe" if sys.platform == "win32" else "GluonSlides")


def run_built(flag, timeout):
    """Runs the built app with `flag`; its output goes to a log file (a
    Windows window app has no console), printed here. Returns the exit code."""
    log = DIST / f"check{flag.replace('-', '_')}.log"
    log.unlink(missing_ok=True)
    env = dict(os.environ, GLUONSLIDES_LOG=str(log))
    try:
        res = subprocess.run([str(built_program()), flag], cwd=DIST, env=env, timeout=timeout)
        code = res.returncode
    except subprocess.TimeoutExpired:
        print(f"{flag}: still running after {timeout} s")
        code = 1
    if log.is_file():
        print(log.read_text(encoding="utf-8", errors="replace"))
    return code


def archive_name(version):
    machine = platform.machine().lower()
    arch = {"amd64": "x64", "x86_64": "x86_64" if sys.platform.startswith("linux") else "x64",
            "arm64": "arm64", "aarch64": "arm64"}.get(machine, machine)
    system = {"win32": "windows", "darwin": "macos"}.get(sys.platform, "linux")
    return f"GluonSlides-{version}-{system}-{arch}"


def make_archive(version):
    name = archive_name(version)
    if sys.platform == "darwin":
        target = DIST / f"{name}.dmg"
        target.unlink(missing_ok=True)
        subprocess.run(["hdiutil", "create", "-volname", "GluonSlides", "-srcfolder", str(DIST / "GluonSlides.app"),
                        "-ov", "-format", "UDZO", str(target)], check=True)
    elif sys.platform == "win32":
        target = Path(shutil.make_archive(str(DIST / name), "zip", DIST, "GluonSlides"))
    else:
        target = Path(shutil.make_archive(str(DIST / name), "gztar", DIST, "GluonSlides"))
    print(f"Archive: {target} ({target.stat().st_size / 1e6:.0f} MB)")
    return target


ICON_PNG = ROOT / "packaging" / "icon.png"
ICONS = ROOT / "packaging" / "generated"  # made by make_icons(); not in git


def placeholder_icon(size=1024):
    """A simple icon (a G on a rounded square) while there is no packaging/icon.png."""
    from PIL import Image, ImageDraw, ImageFont

    img = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    draw = ImageDraw.Draw(img)
    draw.rounded_rectangle((40, 40, size - 40, size - 40), radius=size // 5, fill=(37, 99, 235, 255))
    try:
        font = ImageFont.load_default(size=int(size * 0.62))
    except TypeError:  # old Pillow: tiny bitmap font
        font = ImageFont.load_default()
    draw.text((size / 2, size / 2), "G", fill="white", font=font, anchor="mm")
    return img


def make_icons():
    """icon.png (square) -> packaging/generated/icon.{png,ico,icns}: the window
    and AppImage icon, Windows (.ico) and macOS (.icns). The recipe uses them."""
    from PIL import Image

    ICONS.mkdir(parents=True, exist_ok=True)
    img = Image.open(ICON_PNG).convert("RGBA") if ICON_PNG.is_file() else placeholder_icon()
    img = img.resize((1024, 1024))
    img.resize((256, 256)).save(ICONS / "icon.png")
    img.save(ICONS / "icon.ico", sizes=[(s, s) for s in (16, 24, 32, 48, 64, 128, 256)])
    img.save(ICONS / "icon.icns")


APPIMAGETOOL_URL = "https://github.com/AppImage/appimagetool/releases/download/continuous/appimagetool-x86_64.AppImage"


def appimagetool():
    tool = os.environ.get("APPIMAGETOOL")
    if tool:
        return Path(tool)
    tool = ROOT / "build" / "tools" / "appimagetool"
    if not tool.is_file():
        import urllib.request
        tool.parent.mkdir(parents=True, exist_ok=True)
        print(f"Downloading appimagetool from {APPIMAGETOOL_URL}")
        urllib.request.urlretrieve(APPIMAGETOOL_URL, tool)
        tool.chmod(0o755)
    return tool


def make_appimage(version):
    """dist/GluonSlides/ -> one-file AppImage (it still uses the desktop's
    WebKitGTK; on first start it adds itself to the applications menu)."""
    appdir = ROOT / "build" / "AppDir"
    shutil.rmtree(appdir, ignore_errors=True)
    shutil.copytree(DIST / "GluonSlides", appdir / "usr" / "lib" / "gluonslides", symlinks=True)
    shutil.copy2(ROOT / "packaging" / "linux" / "AppRun", appdir / "AppRun")
    (appdir / "AppRun").chmod(0o755)
    shutil.copy2(ROOT / "packaging" / "linux" / "gluonslides.desktop", appdir / "gluonslides.desktop")
    icons = appdir / "usr" / "share" / "icons" / "hicolor" / "256x256" / "apps"
    icons.mkdir(parents=True)
    for target in (appdir / "gluonslides.png", icons / "gluonslides.png"):
        shutil.copy2(ICONS / "icon.png", target)
    (appdir / ".DirIcon").symlink_to("gluonslides.png")
    target = DIST / f"{archive_name(version)}.AppImage"
    target.unlink(missing_ok=True)
    # --appimage-extract-and-run: works without FUSE (build machines, containers)
    subprocess.run([str(appimagetool()), "--appimage-extract-and-run", "--no-appstream", str(appdir), str(target)],
                   check=True, env=dict(os.environ, ARCH="x86_64"))
    print(f"AppImage: {target} ({target.stat().st_size / 1e6:.0f} MB)")
    return target


def inno_setup_compiler():
    found = shutil.which("iscc")
    if found:
        return found
    for base in (os.environ.get("ProgramFiles(x86)", r"C:\Program Files (x86)"), os.environ.get("ProgramFiles", r"C:\Program Files")):
        candidate = Path(base) / "Inno Setup 6" / "ISCC.exe"
        if candidate.is_file():
            return str(candidate)
    sys.exit("Inno Setup 6 not found (https://jrsoftware.org/isinfo.php, or: choco install innosetup)")


def make_installer(version):
    subprocess.run([inno_setup_compiler(), f"/DAppVersion={version}", str(ROOT / "packaging" / "windows" / "gluonslides.iss")],
                   check=True)
    target = DIST / f"GluonSlides-{version}-windows-x64-setup.exe"
    print(f"Installer: {target} ({target.stat().st_size / 1e6:.0f} MB)")
    return target


def package(version):
    if sys.platform.startswith("linux"):
        make_appimage(version)
    elif sys.platform == "win32":
        make_installer(version)
    else:
        print("macOS: the .dmg (--archive) is the installer.")


def main():
    if "--smoke-only" in sys.argv:
        sys.exit(run_built("--smoke-test", 300))
    if "--package-only" in sys.argv:
        from backend import __version__
        make_icons()
        package(__version__)
        return

    from backend import __version__
    from backend.vendor_libs import check_and_install_dependencies

    missing = check_and_install_dependencies()
    if missing:
        sys.exit(f"Could not download: {', '.join(missing)}")
    make_icons()

    subprocess.run(
        [sys.executable, "-m", "PyInstaller", "--noconfirm", "--clean",
         "--distpath", str(DIST), "--workpath", str(ROOT / "build"),
         str(ROOT / "packaging" / "gluonslides.spec")],
        check=True, cwd=ROOT,
    )

    print(f"\nChecking {built_program()} ...")
    if run_built("--self-check", 300) != 0:
        sys.exit("The built app failed its self-check.")
    if "--smoke" in sys.argv and run_built("--smoke-test", 300) != 0:
        sys.exit("The built app did not start.")
    if "--archive" in sys.argv:
        make_archive(__version__)
    if "--package" in sys.argv:
        package(__version__)
    print("Build OK.")


if __name__ == "__main__":
    main()
