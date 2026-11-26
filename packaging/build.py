"""Build the installable app for this system (Linux, macOS or Windows).

    uv sync --group build
    uv run python packaging/build.py [--smoke] [--archive]
    uv run python packaging/build.py --smoke-only    # open the last build once

1. downloads the JavaScript libraries and fonts (they are bundled),
2. runs PyInstaller with packaging/gluonslides.spec into dist/,
3. runs the built app with --self-check (files, libraries, imports, and
   each kind of backend work once),
4. --smoke: opens the built app once (--smoke-test; needs a display),
5. --archive: packs it into the file people download, in dist/:
     GluonSlides-<version>-linux-x86_64.tar.gz
     GluonSlides-<version>-windows-x64.zip
     GluonSlides-<version>-macos-arm64.dmg

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


def main():
    if "--smoke-only" in sys.argv:
        sys.exit(run_built("--smoke-test", 300))

    from backend import __version__
    from backend.vendor_libs import check_and_install_dependencies

    missing = check_and_install_dependencies()
    if missing:
        sys.exit(f"Could not download: {', '.join(missing)}")

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
    print("Build OK.")


if __name__ == "__main__":
    main()
