## What's new in 0.4.0

**Your data, straight in.** Drop a CSV or JSON file of results on a slide: a panel asks whether it becomes a **table**, a **plot** or a **choice** (a JSON can also become variables). For a plot, pick lines, points, bars or a histogram, the x column and the columns to draw, or, for long-format data (`run, step, loss`), one line per run. *Let me choose while presenting* adds a dropdown under the plot to switch the column or the runs shown. Everything stays linked to the file: rerun your script and the slide updates.

- **Interactive plots**: plots of formulas (Python or LaTeX) and data, with layers for curves, areas, parametric curves, points with error bars, lines, bars, histograms (also sampled from a formula), heatmaps, contour lines and arrows, or written as a **matplotlib script**. They follow **sliders, checkboxes, number and text boxes, choices** (one or several, options written or from a file) and **animations**, in the editor, while presenting and in the exported HTML.
- **Live numbers**: `\var{err}` shows a value from a JSON or CSV file your script writes; `\var{results[opt].acc}` the one a choice picks.
- **Anything can follow a variable**: right-click → *Follow a variable…*; positions, sizes, opacity, visibility, **colours**, a plot layer's settings and axis ranges can be formulas (`=860 + 300*mu`, `=cmap(err, 0, 0.1)`), and dragging moves the formula's constant. Lines attached to moving shapes follow them, in the exported HTML too.
- **Colour keys**: each run (or category) its colour, the same in every plot and object that uses it, with a legend you can click to show and hide runs while presenting.
- **📊 Example: results that update** (start screen): a project with a small results file and the script that writes it; run the script and watch the slides change. The tutorial shows the new features too, with a sample file to drop.
- **🗂 Project files**: every file of `figures/` and `data/`, what uses it, duplicates (merge) and unused files; removed files go to the project's trash and can be restored. The same file is no longer copied twice. Big data files are thinned to what draws the same picture.
- **Find** (Ctrl+F) over the project's `.gl` text; Ctrl+click on a variable goes to where it is defined.
- On the canvas, inputs work once selected (a first click selects, **Shift**+drag moves them).

## Download

| System | File | Or, without installing |
|---|---|---|
| Windows 10/11 (64-bit) | `GluonSlides-…-windows-x64-setup.exe` | `…-windows-x64.zip` |
| macOS (Apple Silicon: M1 and later) | `GluonSlides-…-macos-arm64.dmg` | |
| Linux (64-bit) | `GluonSlides-…-linux-x86_64.AppImage` | `…-linux-x86_64.tar.gz` |

These builds are not signed yet, so the system warns the first time you open them.

### Windows

1. Run `…-setup.exe`. If Windows says *"Windows protected your PC"*: click **More info → Run anyway**.
2. It installs for your user only (no administrator rights), adds GluonSlides to the Start menu, and optionally a desktop shortcut. Uninstall it from *Settings → Apps*.

Without installing: unzip `…-windows-x64.zip` anywhere and double-click `GluonSlides\GluonSlides.exe`.

The window uses Microsoft Edge WebView2, included in Windows 10 and 11.

### macOS

1. Open the `.dmg` and drag **GluonSlides** to **Applications**.
2. Open it. macOS says it can't check the app: click **Done** (not *Move to Bin*).
3. Open **System Settings → Privacy & Security**, scroll down and click **Open Anyway** next to *GluonSlides*, then confirm.

If macOS says the app *"is damaged"*, run this once in Terminal, then open it again:

```bash
xattr -dr com.apple.quarantine /Applications/GluonSlides.app
```

### Linux

Make the AppImage executable (file properties → *Allow executing as program*, or `chmod +x GluonSlides-*.AppImage`) and double-click it. On first start it adds GluonSlides to your applications menu; to undo, delete `~/.local/share/applications/gluonslides.desktop`.

If double-clicking does nothing, run it from a terminal to see why. Where FUSE isn't available (some containers), `./GluonSlides-*.AppImage --appimage-extract-and-run` works; or use the `.tar.gz`:

```bash
tar xzf GluonSlides-*-linux-x86_64.tar.gz
./GluonSlides/GluonSlides
```

It uses the desktop's own GTK and WebKitGTK. If the window doesn't open, install them (Ubuntu/Debian: `sudo apt install gir1.2-webkit2-4.1`; Fedora: `sudo dnf install webkit2gtk4.1`). Tested on Ubuntu 22.04 and later.

### All systems

- Exporting a **vector PDF** uses Chrome, Chromium or Edge if one is installed; otherwise an image-based PDF is made.
- **PDF/EPS figures** need Poppler (`pdftoppm`).
- Recent projects and settings are kept in your user folder, not in the app: deleting the app keeps them.

Problems? Please open an issue with your system, what you did, and what happened.
