# Tests

There are two kinds of tests. Neither opens the real app window or needs a project of yours.

| Kind | Where | What it exercises | Run with |
|---|---|---|---|
| **End-to-end (browser)** | `tests/e2e/` | The editor itself, from a user's point of view: clicking, dragging, typing, menus, the `.gl` text, exports | `npm test` |
| **Backend (Python)** | `tests/backend/` | The Python functions the editor calls through `pywebview.api`: files, figures, fonts, PDF, settings | `npm run test:backend` |

## Running them

One-time setup, from the repository root:

```bash
npm install          # installs playwright-core (the browser driver), nothing else
```

Requirements: Node.js 18+, Python 3 (the project's `.venv` for the backend tests), and Google Chrome or Chromium installed. If the browser isn't found, set `CHROME_PATH=/path/to/chrome`.

```bash
npm test                         # all end-to-end suites (about a minute)
npm test -- macros lines-curves  # only some suites
npm test -- --verbose            # list every check, not just failures
npm run test:backend             # backend tests (under a second)
```

Output looks like this; the exit code is 1 if any check fails or a suite crashes:

```
ok   macros             35 passed  (4.6s)
FAIL shapes             25 passed, 1 failed  (3.2s)
       FAIL locked circle stays square on edge drag — 400x380
```

## End-to-end tests (`tests/e2e/`)

`run.mjs` serves the repository with `python3 -m http.server` on a free port and runs each file in `suites/` in a headless Chrome, driven by [playwright-core](https://playwright.dev).

Each suite:

1. **Opens the app** (`index.html`) exactly as the desktop window does: same HTML, JavaScript and CSS.
2. **Replaces the Python backend** where needed: `window.pywebview.api` is swapped for a small fake (defined at the top of the suite) that keeps files in memory. This makes tests fast and repeatable, and lets them simulate situations that are hard to create for real (a missing `macros.gl`, a font whose licence forbids embedding...).
3. **Acts like a user**: real mouse moves, clicks (held as long as a person would where it matters), drags, typing, keyboard shortcuts.
4. **Checks the result** in three places: the app's state (`core/state.js`), what is drawn (computed styles, positions, fonts actually loaded), and the saved `.gl` text or exported HTML.

It prints one line per check, `PASS name` or `FAIL name — details`, plus any JavaScript errors the page raised (those also fail the suite).

### The suites

| Suite | What it checks |
|---|---|
| `welcome` | The start window: recent projects appear however and whenever the Python bridge becomes ready (empty bridge at start, missed ready event, slow or failing first call, no bridge at all), opening a recent project, Open before the bridge is ready, names shown as text |
| `selection` | Rubber-band selection (drag on empty space, Ctrl to add), clicking to deselect, autosave timing |
| `groups` | Grouping (Ctrl+G), resizing scales the contents, double-click to edit inside, drag in a stretched group, Esc, ungroup bakes the scale, undo, export, paste |
| `properties-panel` | Every kind of control in the properties panel (numbers, colors, selects, checkboxes), multi-selection, figure buttons; no inline handlers or globals |
| `shapes` | Shape variants (rectangle, rounded, ellipse, circle, dot), keeping proportions (locked or Shift), resize from corners of ellipses, toolbar menus |
| `lines-curves` | Drawing lines/arrows/curves/polygons/freehand, point and corner handles, add/remove points, stroke options, export, strokes scaling in groups |
| `drawing-tools` | Drawing with human-speed clicks: the preview stays visible and shows every point, double-click/Enter/closing on the first point, no stray clicks |
| `macros` | Make macro, the Macros menu, overrides (`::name`), hidden/extra elements, editing `macros.gl`, save and reopen, missing library, Detach, loops |
| `macro-editing` | Editing an instance on the canvas (changes become overrides), Reset to macro, Edit definition, Go to definition, menu thumbnails, autocomplete |
| `dropdowns` | The styled option lists (mouse, keyboard, Esc, click outside) |
| `fonts` | Font list sections, search, previews, built-in/project/system fonts on the canvas and embedded in exports |
| `font-licences` | Licence notices under the font list, not embedding restricted fonts, export warnings |
| `font-inheritance` | The chosen font reaches the text (and thumbnails); math keeps its fonts; the UI keeps its own font |
| `project-defaults` | Project defaults: inheritance, the settings dialog, overriding and ↺, converting old projects, undo, export, macros |
| `panel-labels` | Labels stay on one line, so fields never move when a value becomes overridden |
| `styles-colors` | Named styles and theme colors: the color picker, opacity, editing/renaming/removing colors, styles from elements, cascade, file format, export |
| `presenting` | Build steps (field, badge, saving), speaker notes, Present mode (keys, steps, black screen, go to slide, Esc back on the right slide, F5/Shift+F5), the exported viewer, printing and the PDF (one page per step, also in the image-based fallback); the presenter view: two screens, S to switch, both windows following each other, Black only for the audience, timer, the audience page (`present/audience.html`), and S in the exported HTML |
| `citations` | BibTeX accents and names, `\cite` / `\citet` / `\citep` with page notes in both styles, the reference list, unknown keys (highlight, ⚠ count, dialog, export warning), `\cite{` autocomplete on the canvas and in the inspector, long reference lists continuing on extra slides (canvas badge, export, PDF, presenting) and `\printbibliography[from-to]` |
| `fields` | Fields (`\slidenumber`, `\sectiontitle`, `\tableofcontents`...) per slide on the canvas, thumbnails and exports, numbering with continuation pages, sections (`.section`, Section field, sidebar headers and folding), Fields ▾, Project settings → Presentation, `\` autocomplete on the canvas and in the inspector |
| `masters` | Master slides: creating and editing one on the canvas, drawn under every slide (canvas, thumbnails, export), fields with each slide's values, `master:none` and several masters, rename/delete, the `.gl` format, undo, slide shortcuts off while editing one |
| `figures` | Pasting an image (saved into `figures/`, centred, in proportion), copy/paste of objects unaffected, linked figures redrawn when the original changes (periodic check, once per change), the sync option and ↻, figures on master slides loaded |
| `paste-drop` | In the app (fake backend): Ctrl+V of a screenshot, of copied image files or of text (a new text box) through the backend, Ctrl+C replacing the system clipboard, Ctrl+V in a text field left alone; dropped files never opening in the window (also when given only as `file://` uris, or as a web address), images added where dropped and linked to the original, replacing a figure, non-images refused, text dragged into a text field left alone |
| `arrange` | Align on the slide and to each other, distribute, undo, layer order (buttons, disabled states, Ctrl+[ ]), locking (no drag/arrows/align, a drag on it selects with a rectangle, a click selects it, `locked:yes`, Ctrl+Shift+L), smart guides while moving, resizing and moving several, Alt to place freely |
| `file-format` | The `.gl` files in `fixtures/` (and your local `Slides/` projects, if present) parse, keep their content and round-trip; friendly errors |

### Fixtures

`tests/e2e/fixtures/` holds test projects:

- `everything.gl` uses every feature of the format (palette, defaults, styles, a macro definition, groups, paths, overrides, escaped body lines, speaker notes, build steps, sections, author and date, a master slide).
- `legacy-unindented.gl` is in the format older versions saved (text bodies not indented).

If a change to the format makes `file-format` fail, either the change broke reading old files or the fixture needs updating on purpose.

### Writing a new suite

Copy a short suite (e.g. `panel-labels.mjs`) into `suites/`. The essentials:

```js
import { launchBrowser, BASE_URL } from '../helpers.mjs';

const browser = await launchBrowser();
const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
const errors = [];
page.on('pageerror', e => errors.push(e.message));
const out = [];
const check = (name, ok, details = '') => out.push(`${ok ? 'PASS' : 'FAIL'} ${name}${details !== '' ? ' — ' + details : ''}`);

await page.goto(`${BASE_URL}/index.html`);
await page.evaluate(async () => (await import('/ui/project.js')).openSampleProject());
// ... act like a user, then:
check('something works', true);

console.log(out.join('\n'));
console.log('--- errors ---\n' + (errors.join('\n') || '(none)'));
await browser.close();
```

Suites can import the app's own modules inside `page.evaluate(...)` (as above) to set up a situation quickly or to read the state. Screenshots go to `tests/e2e/output/` (ignored by git).

## Backend tests (`tests/backend/`)

Plain Python `unittest` tests that call the backend modules directly, in temporary folders:

| Area | Checks |
|---|---|
| Project files | save/load round-trip, empty files, side files can't escape the project folder |
| Figures | import into `figures/` with unique names, re-importing, loading as data URIs, saving pasted images, re-copying linked figures whose original changed |
| PDF | the image-based PDF fallback produces one page per slide |
| Fonts | style names, licences of built-in fonts, restricted fonts are not embeddable, project fonts, system font list |
| User settings | recent projects (missing ones dropped), inspector settings — in a temporary config folder, never your real one |
| Snap environment | variables leaked by snap terminals are removed, normal environments untouched |
| Desktop | the clipboard image as a PNG data URI, copied image files as paths, text, which navigations would leave the app, the fallback without GTK, dropped file paths taken once and forgotten when old |
| Presenter view | the audience window: which screen it goes to, full screen or not, messages both ways, closing (pywebview faked) |

Tests that need something the machine may not have (a TrueType font, the downloaded built-in fonts) are skipped rather than failed.

## What is not covered

- The **real desktop window** (pywebview + WebKitGTK): the end-to-end tests use Chrome with the same page. GTK-specific behaviour (native dialogs, the snap environment fix in practice, the real clipboard and drag and drop) is checked by hand.
- **Vector PDF export** end to end (it needs a headless Chrome writing a file): its HTML input is covered by the suites; the PDF step was checked manually.
