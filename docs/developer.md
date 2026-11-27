# Developer notes

How the code is organised and how to extend it. To run and test it, see [Getting started](../README.md#getting-started) and [Tests](../README.md#tests) in the README, and [tests/README.md](../tests/README.md).

## Architecture in one minute

```
app.py              launcher: snap env fix, library download, the window, --self-check / --smoke-test / --debug
main.js             entry point: wires index.html controls (data-action) to the modules
index.html, style.css, text-styles.css

core/               the model and what works on it (no editor UI)
  state.js          app state, undo/redo, autosave, the .gl <-> state boundary
  registry.js       element plugin registry + contract validation
  gl/glformat.js    the .gl format: serializer and parser, driven by each element's gl block
  render.js         shared styling, Markdown/KaTeX rendering, grid
  textCommands.js   \textcolor, \highlight, \textbf ... and text macros in text
  fields.js         \slidenumber, \sectiontitle, \tableofcontents ...
  citations.js      BibTeX parsing, \cite and \printbibliography
  bibPages.js       long reference lists continued on extra slides
  defaults.js       project defaults and named styles (the cascade)
  colors.js         theme colours (palette), colour values with opacity
  fonts.js          built-in, project and system fonts, licences
  geometry.js       drag/resize/snap math, smart guides, rotation
  arrange.js        align, distribute, layer order, lock, rotated boxes
  connectors.js     lines attached to shapes (from / to / route)
  steps.js          builds: step / until
  masters.js        master slides
  macros.js         macro definitions, instances and overrides
  clipboard.js      cut / copy / paste / delete, and the editor's key handler
  shortcuts.js      the changeable keyboard shortcuts (commands, default keys, matching)
  projectTransfer.js  what pasted objects bring from another project (figures, tables, macros, styles)
  prefs.js          interface choices kept between runs (panes, shortcuts, tour seen)
editor/             the editing UI
  editor.js         canvas, thumbnails, properties panel, slide operations
  toolbar.js        the toolbar, built from the registry's categories and variants
  tools.js          drawing tools (lines, curves, freehand, boxes)
  marquee.js        rectangle selection
  groupOps.js macroOps.js   group / ungroup; make and detach macros
  formatBar.js      the bar over selected words (bold, italic, colours)
  clickedWord.js    double-click: the clicked word selected in the source
  textAutocomplete.js  suggestions after \ and \cite{ in text boxes
  fileDrop.js       files dropped on the window
  inspector/        the .gl source view (bottom drawer)
    index.js          drawer + two-way sync with the canvas
    codeEditor.js     CodeMirror 5 wrapper + .gl syntax mode
    tokenizer.js      the .gl tokenizer used by the syntax mode
    completions.js    autocomplete from the live registry and macro library
    glNavigation.js   line <-> slide/element mapping
    settings.js       inspector settings + popover
    contextMenu.js    the right-click menu (Go to Gluon file + element entries)
ui/                 windows, dialogs and chrome
  project.js        create / open / sample project, recents, start screen
  tabs.js           several projects open in tabs
  panes.js          hiding and resizing the side panes
  modals.js         new-project, macros and bibliography dialogs
  projectSettings.js  Project settings (presentation, defaults, styles, colours)
  importTalk.js     Import Talk dialog
  present.js        Present / presenter view from the editor
  busy.js           busy bar, placeholders, progress bars
  colorPicker.js selectMenu.js   colour fields; styled dropdowns
  updateNotice.js   "a new version is available"
  help.js           the ? menu and the keyboard shortcuts dialog
  tour.js           the quick tour
  tutorial.js       the tutorial presentation
elements/           one folder per element type, each self-registering
  index.js          one import per type
  text/ shape/ figure/ path/ columns/ table/ group/ macro/
  figure/toLatex.js   "Convert to LaTeX" on a picture
export/
  html.js           the interactive HTML presentation
  pdf.js            vector PDF via headless Chromium
  index.js          export buttons -> files in the project folder
present/
  viewer.js         the slide show (inlined into every exported HTML)
  audience.html     the audience window of the presenter view
backend/            Python, exposed to the page as pywebview.api
  api.py            the Api class: every call the page makes
  project_io.py dialogs.py figures.py tables.py fonts.py pdf_export.py
  presentation.py   presenter view: the second window
  desktop.py        system clipboard, dropped file paths, --debug logging
  net.py            HTTPS with the system's certificates
  updates.py        checks GitHub for a newer release
  user_settings.py  recents, inspector settings, interface prefs (~/.config/gluonslides)
  vendor_libs.py    downloads JS/CSS libs listed in dependencies.yaml
  snap_env.py       undoes env leaked by snap-packaged terminals
  importers/        Import Talk
    __init__.py       finding the sources, running the importer, the PDF and equation steps
    beamer.py slidev.py pptx.py pdf.py   one converter per format
    pptx_draw.py      PowerPoint freeforms and connectors as SVG
    groundtruth.py    the compiled PDF as ground truth (positions, sizes, missing figures)
    equations.py      pictures of equations -> LaTeX text boxes
    latex_ocr.py      the LaTeX-OCR model with onnxruntime + numpy
    extras.py         optional components (PyMuPDF, the equation model): download and load
    model.py          the slide / element dicts importers return, colours, lengths
    progress.py       how far the running import is
packaging/          the installable app: PyInstaller recipe, build.py, icons, installers
tests/              e2e/ (the editor in headless Chrome), backend/ (Python unittest)
```

The in-memory model is plain JS objects; `.gl` is a projection applied only at the file boundary (`serializeProject` / `deserializeProject`), which keeps rendering, selection, and history logic format-agnostic. Element modules don't import the editor: they talk to it through DOM events (`slide-content-changed`, `slide-thumbnail-changed`), so there are no circular dependencies. Importers return the same slide and element dicts as the editor's state (`backend/importers/model.py`); the page gives ids to the elements that have none and writes the `.gl` file.

## Adding a new element type

Elements are plugins registered in a central registry (`core/registry.js`). To add one — say, a table element:

1. **Create `elements/shape2/shape2.js`** and export an object implementing the element contract:

   ```javascript
    // ============================================================
    // elements/shape/shape.js — Rectangle shape element
    // ============================================================
    
    import { state } from '../../core/state.js';
    import { ElementRegistry } from '../../core/registry.js';
    
    const ShapeElement = {
        type: 'shape',
        label: 'Add Rectangle',
        icon: '⬛',
        className: 'element-shape',
    
        gl: {
            props: ['x', 'y', 'width', 'height', 'bg', 'borderCol', 'borderWidth', 'borderStyle'],
            numericProps: ['x', 'y', 'width', 'height', 'borderWidth'],
            body: null,
        },
    
        defaults(ctx) {
            const scale = state.slideWidth / 1920;
            return {
                type: 'shape',
                x: 0, y: 0,
                width: Math.round(400 * scale),
                height: Math.round(300 * scale),
                bg: state.isDarkMode ? '#334155' : '#cbd5e1',
                borderCol: state.isDarkMode ? '#64748b' : '#475569',
                borderWidth: 2,
                borderStyle: 'solid',
            };
        },
    
        renderDom(domEl, el, ctx) {
            // Shapes are purely visual boxes — common box styles handle layout/appearance.
        },
    
        exportInner(el) {
            return '';
        },
    
        properties(el, elIndex) {
            return '';
        },
    };
    
    ElementRegistry.register(ShapeElement);
   ```

2. **Register it** in `elements/index.js` — one import line:

   ```javascript
   import './shape2/shape2.js';
   ```

That's it. The toolbar entry appears automatically: the toolbar is generated from the registry and grouped by each element's `category` (`text`, `shapes`, `lines`, `media`, …); a category with several entries, or an element with several `variants` (presets), becomes a dropdown, geometry/selection/drag/resize/undo come for free from the editor core, and the element persists to `.gl` with the properties you whitelisted.

To give the element editable fields in the properties panel, return controls from `properties()` that name the property they edit; no event handlers needed. For buttons that run element code, add an `actions` object:

```javascript
properties(el) {
    return `
        <input type="number" class="prop-control" value="${el.cornerRadius}" data-prop="cornerRadius">
        <button class="btn btn-secondary" data-element-action="reset" data-arg="12">Reset</button>`;
},
actions: {
    reset: (elIndex, arg) => { /* runs on click; arg === '12' */ },
},
```

### Saving it in `.gl`

The element's `gl` block says how it is written in the [`.gl` file](gluon-format.md) (`core/gl/glformat.js` is generic and reads it):

```javascript
gl: {
    props: ['x', 'y', 'width', 'height', 'bg', 'cornerRadius'], // written as key:value, in this order
    numericProps: ['x', 'y', 'width', 'height', 'cornerRadius'], // read back as numbers
    body: 'content',            // the property written as the indented body (or null)
    serializeBody(el) { ... },  // optional: a body of your own (table rows, path points)
    parseBody(text, el) { ... },// optional: its reader
    directive: (el) => '...',   // optional: a directive other than element.<type> (macro.<name>)
},
```

Only the listed `props` are written and read; the common head (`id`, `name`, `style`, `step`, `until`, `locked`, `rotate`) is handled for every type. Add an example of the new element to [docs/gluon-format.md](gluon-format.md): `tests/e2e/suites/docs-examples.mjs` checks that every example there parses and uses only keys the type reads.

### Right-click entries

An element can add entries to the right-click menu (`editor/inspector/contextMenu.js`), under *Go to Gluon file*:

```javascript
contextMenu: [
    { icon: '∑', label: 'Convert to LaTeX', when: (el) => isPicture(el), run: (el) => convert(el) },
],
```

`when` (optional) decides whether the entry is shown for that element; `run` gets the element.

### Other optional members

`category` and `variants` (toolbar entries and presets, drawn with `create: 'drag' | 'points' | 'freehand' | 'box'`), `handles` / `dragHandle` (extra handles such as a path's points), `typeLabel`, `exportStyle`, `boxResize`, `boxStyle`, `toolbar: false`, `commitEditing` (finish an edit in progress). The full list is at the top of `core/registry.js`.
