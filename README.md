# GluonSlides

A local-first, freeform presentation builder with a twist: **your slides live in a Quarkdown-inspired text format** that you can read, edit, and version-control — while a full drag-and-drop editor keeps everything in sync.

GluonSlides runs entirely on your machine (Python + pywebview, no cloud, no accounts) and treats the `.gl` project file as the single source of truth: every drag, resize, and property change in the GUI is serialized back into clean, human-readable text.

## Highlights

- 🖱️ **Visual slide editor** — drag, resize, multi-select, group-move, arrow-key nudging, snap-to-grid, slide reordering, cut/copy/paste, and full undo/redo.
- 📐 **Freeform layout** — absolutely positioned elements on a canvas (1920×1080 by default, other presets available), with a configurable alignment grid.
- 📝 **Markdown + LaTeX in every text box** — write `**bold**`, lists, and inline or display math (`$E = mc^2$`, `$$\int f(x)\,dx$$`) rendered with marked.js and KaTeX.
- ⚙️ **LaTeX macros** — define `\newcommand` macros once in a per-project `macros.tex` file (editable from a built-in dialog) and use them in any text element.
- 📤 **Export to HTML and PDF** — one click produces an interactive HTML viewer (keyboard navigation) or a pixel-perfect, vector PDF via headless Chromium. Math renders perfectly in both.
- 🔤 **Gluon format (`.gl`)** — a Quarkdown-like syntax stores your slides as plain text, with a built-in source editor (syntax highlighting) right inside the app.
- 🧩 **Plugin-style elements** — new element types are a single self-registering file. No core changes required.

## The Gluon (`.gl`) format

Instead of an opaque JSON blob, a GluonSlides project is a text file heavily inspired by [Quarkdown](https://quarkdown.com/)'s function-call syntax:

```
# Gluon slide project — saved by GluonSlides
.project {My Deck} version:2 width:1920 height:1080 grid:20 darkmode:no nextid:3

.slide {Introduction} id:1
.element.text id:1 x:200 y:200 width:800 height:160 fontSize:42 fontFamily:sans-serif fontColor:#0f172a textAlign:center verticalAlign:center bg:transparent borderCol:transparent borderWidth:0 borderStyle:solid
Welcome to **GluonSlides** with math: $x^2 + y^2 = r^2$

.element.shape id:2 x:100 y:900 width:300 height:40 bg:#3366ff borderCol:#1e40af borderWidth:2 borderStyle:solid

.slide {Results} id:2
.element.figure id:3 x:400 y:150 width:600 height:450 filePath:figures/plot.png originalPath:/home/me/plot.png bg:transparent borderCol:transparent borderWidth:0 borderStyle:dashed
data:image/png;base64,iVBORw0KGgo...
```

The rules are simple:

- `.project` is the header: name, canvas size, grid, theme, and the next available element ID.
- Each `.slide {Title}` starts a slide.
- Each `.element.<type> id:n k:v k:v ...` places an element; the parameters are exactly the properties you see in the editor's right-hand panel.
- Lines following a `.element.text` directive are its body — Markdown and LaTeX verbatim. A figure's data URI is stored the same way, as its body.

Because the format is deterministic (fixed property order, stable IDs, no timestamps), the file plays nicely with `git diff`, and every position change in the GUI translates into a tiny, reviewable edit. You can also hand-edit the file and reopen it — the parser reports friendly, actionable errors.

## Integrated source editor

The editor includes a built-in **source view with syntax highlighting** for `.gl` files, so you can flip between the canvas and the code that generates it. Adjust coordinates by typing instead of dragging, batch-rename colors, or paste in a slide written by a colleague — the canvas re-renders from the text instantly.

## Adding a new element type

Elements are plugins registered in a central registry (`core/registry.js`). To add one — say, a table element:

1. **Create `elements/table/table.js`** and export an object implementing the element contract:

   ```javascript
   import { state } from '../../core/state.js';
   import { ElementRegistry } from '../../core/registry.js';

   const TableElement = {
       type: 'table',                  // unique key
       label: 'Add Table',             // toolbar label
       icon: '📊',                     // toolbar icon
       className: 'element-shape',     // base CSS class for the wrapper

       defaults(ctx) {                 // default properties for new elements
           return {
               type: 'table',
               x: 0, y: 0,
               width: 400, height: 300,
               rows: 3, cols: 3,
               bg: 'transparent', borderCol: 'transparent',
               borderWidth: 0, borderStyle: 'solid',
           };
       },

       renderDom(domEl, el, ctx) {     // paint onto canvas ('canvas') or thumbnail ('thumb')
           domEl.innerHTML = `<table>...</table>`;
       },

       exportInner(el) {               // inner HTML used by HTML/PDF export
           return `<table>...</table>`;
       },

       properties(el, elIndex) {       // extra controls for the right-hand panel
           return `
               <div class="prop-group">
                   <label>Rows</label>
                   <input type="number" class="prop-control"
                          value="${el.rows}" oninput="updateProp('rows', this.value)">
               </div>`;
       },
   };

   ElementRegistry.register(TableElement);
   ```

2. **Register it** in `elements/index.js` — one import line:

   ```javascript
   import './table/table.js';
   ```

3. **Declare its `.gl` schema** in the `SCHEMAS` table in `core/gl/glformat.js` so the new type survives save/load:

   ```javascript
   table: {
       props: ['x', 'y', 'width', 'height', 'rows', 'cols',
               'bg', 'borderCol', 'borderWidth', 'borderStyle'],
       body: null, // or 'content' if the element has editable text
   },
   ```

That's it. The toolbar button appears automatically (the toolbar is generated from the registry), geometry/selection/drag/resize/undo come for free from the editor core, and the element persists to `.gl` with the properties you whitelisted.

## Architecture in one minute

```
core/
  state.js        app state, undo/redo, autosave, .gl <-> state boundary
  registry.js     element plugin registry + contract validation
  render.js       shared styling, Markdown/KaTeX rendering, grid
  geometry.js     drag/resize/snap math
  clipboard.js    keyboard shortcuts (cut/copy/paste/delete/undo)
  gl/
    glformat.js   the .gl format: spec, serializer, parser
editor/
  editor.js       canvas, thumbnails, properties panel, slide ops
elements/
  index.js        registry hookup — one import per element type
  text/ shape/ figure/
export/
  html.js         interactive HTML viewer + print source
  pdf.js          headless-Chromium vector PDF
app.py            pywebview backend: dialogs, file IO, figure import, PDF
```

The in-memory model is plain JS objects; `.gl` is a projection applied only at the file boundary (`serializeProject` / `deserializeProject`), which keeps rendering, selection, and history logic completely format-agnostic. Text elements never import the editor — they communicate through DOM events, so there are no circular dependencies.

## Getting started

Requirements: Python 3 with GTK bindings (Linux: `sudo apt install python3-gi python3-gi-cairo gir1.2-gtk-3.0`) and the packages in `pyproject.toml` / `dependencies.yaml`.

```bash
python3 app.py
```

Create a project (pick a folder — you get `MyDeck.gl` plus a `macros.tex` for your LaTeX macros), add elements from the toolbar, and export with the HTML/PDF buttons. Autosave runs continuously; your project file always reflects the current canvas.

## License

See [LICENSE](LICENSE).
