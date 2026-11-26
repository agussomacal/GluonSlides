"""Build the installable app for this system (Linux, macOS or Windows).

    uv sync --group build
    uv run python packaging/build.py           # add --smoke to also open it once

1. downloads the JavaScript libraries and fonts (they are bundled),
2. runs PyInstaller with packaging/gluonslides.spec into dist/,
3. runs the built app with --self-check (files, libraries, imports),
   and with --smoke, --smoke-test (opens the window; needs a display).

The result is in dist/GluonSlides/ (dist/GluonSlides.app on macOS).
"""

import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))


def built_program():
    if sys.platform == "darwin":
        return ROOT / "dist" / "GluonSlides.app" / "Contents" / "MacOS" / "GluonSlides"
    return ROOT / "dist" / "GluonSlides" / ("GluonSlides.exe" if sys.platform == "win32" else "GluonSlides")


def main():
    from backend.vendor_libs import check_and_install_dependencies

    missing = check_and_install_dependencies()
    if missing:
        sys.exit(f"Could not download: {', '.join(missing)}")

    subprocess.run(
        [sys.executable, "-m", "PyInstaller", "--noconfirm", "--clean",
         "--distpath", str(ROOT / "dist"), "--workpath", str(ROOT / "build"),
         str(ROOT / "packaging" / "gluonslides.spec")],
        check=True, cwd=ROOT,
    )

    program = built_program()
    print(f"\nChecking {program} ...")
    res = subprocess.run([str(program), "--self-check"], cwd=ROOT / "dist")
    if res.returncode != 0:
        sys.exit("The built app failed its self-check.")
    if "--smoke" in sys.argv:
        res = subprocess.run([str(program), "--smoke-test"], cwd=ROOT / "dist", timeout=180)
        if res.returncode != 0:
            sys.exit("The built app did not start.")
    print("Build OK.")


if __name__ == "__main__":
    main()
