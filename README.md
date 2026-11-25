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
```

Figures are stored by path only (imported images are copied into the project's `figures/` folder); image data is loaded at runtime and never written into the `.gl` file.

The rules are simple:

- `.project` is the header: name, canvas size, grid, theme, citation style, and the next available ID (slides and elements share one ID counter).
- Each `.slide {Title}` starts a slide.
- Each `.element.<type> id:n k:v k:v ...` places an element; the parameters are exactly the properties you see in the editor's right-hand panel.
- Lines following a `.element.text` directive are its body — Markdown and LaTeX verbatim.

Because the format is deterministic (fixed property order, stable IDs, no timestamps), the file plays nicely with `git diff`, and every position change in the GUI translates into a tiny, reviewable edit. You can also hand-edit the file and reopen it — the parser reports friendly, actionable errors.

### Shapes

The **Shapes ▾** menu adds a rectangle, rounded rectangle, ellipse, circle or dot (and the drawn closed shapes described below). The first five are all `.element.shape`, with optional parameters that are only written when set: `kind:ellipse`, `radius:24` (corner radius), and `lockAspect:yes` (keep proportions; circles and dots use it). Holding **Shift** while resizing keeps any element's proportions.

### Lines & curves

The **Lines & curves ▾** menu draws open paths: lines, arrows, curves, curved arrows and freehand strokes. Their closed versions (polygon, closed curve, freehand shape) are in **Shapes ▾**; they are the same element with `closed:yes` and a fill. Pick one, then draw on the slide: drag for lines and arrows (Shift: 45° angles); click to place each point of a curve or polygon and double-click (or Enter) to finish, or click the first point to close; hold the mouse button and draw for freehand. A dashed preview shows every placed point while you draw. Esc cancels.

They are all `.element.path`. The points are the body, one per line, as fractions (0–1) of the element's box, so resizing the box reshapes the path:

```
.element.path id:9 x:200 y:200 width:500 height:300 curve:smooth end:arrow stroke:#0f172a strokeWidth:4
	0 0.8
	0.3 0.1
	1 0.2
```

Optional parameters: `curve:smooth` (a spline through every point; default straight), `closed:yes` with `fill:#hex`, `dash:dashed|dotted`, `start`/`end:arrow|dot`. A selected path shows its points: drag them to reshape, double-click the line to add a point, double-click a point to remove it; corner handles scale the whole path (Shift keeps proportions). Freehand strokes are simplified to a few points and drawn as smooth curves, so they can be edited the same way.

### Groups

Select several elements (drag a box on empty canvas space, or Ctrl+click) and press **Ctrl+G**. A group keeps its children in its own coordinate frame, so resizing the group scales everything inside it (positions, sizes, fonts, borders) while only the group's line changes in the file:

```
.element.group id:10 x:200 y:100 width:800 height:400 frameWidth:400 frameHeight:200
	.element.text id:11 x:0 y:0 width:400 height:100 fontSize:32 ...
		Text body of the child (one more tab)
	.element.shape id:12 x:0 y:120 width:400 height:80 ...
```

Here the children live in a 400×200 frame drawn at 800×400, i.e. at 2× scale. Double-click a group to edit its children (Esc or a click outside to finish); **Ctrl+Shift+G** ungroups and bakes the scale into the children.

### Macros (reusable components)

Select some objects (or a group), type a name under **Make Macro** in the properties panel and press Enter. The objects are saved as a definition in `macros.gl` and replaced by an *instance*; insert more instances from the **Macros ▾** menu (each shown with a small preview). Every instance follows its definition.

Editing on the canvas:

- **Double-click an instance** (or *Edit this instance*) to move, restyle, add or delete its elements. Changes are saved as overrides of that instance only: a moved element becomes `::name x:…`, a deleted one `::name hidden:yes`, a new one an extra element. The selected element shows its `::name` and what is overridden, with *Reset to macro*.
- **Edit definition (all instances)** opens the macro itself: every instance follows. Element names (used by overrides) can be renamed there.
- **Go to definition** opens the `.define` block in the inspector; the instance's properties also list its element names.

```
# macros.gl
.define {card} width:600 height:400
	.element.shape name:frame x:0 y:0 width:600 height:400 radius:24 bg:#e0f2fe
	.element.text name:title x:30 y:20 width:540 height:80 fontSize:40
		Title
```

```
# Deck.gl
.import {macros.gl}
.project {Deck} ...

.slide {Results} id:3
.macro.card id:20 x:100 y:100 width:600 height:400
.macro.card id:21 x:800 y:100 width:900 height:600
	::title
		Results
	::frame bg:#fee2e2
	::badge hidden:yes
	.element.text x:10 y:10 width:200 height:40 fontSize:18
		Only on this instance
```

- `.define {name} width:W height:H` holds elements laid out in a W×H frame; an instance is drawn scaled to its own size, like a group. Definitions can live in the project file itself or in any imported file (`.import {file.gl}`); `macros.gl` is just where **Make Macro** puts them.
- Elements inside a definition have a `name` instead of an id. In an instance, `::name key:value` overrides properties of that element, an indented body replaces its text, and `hidden:yes` hides it. Overrides come first, then any extra elements that only this instance has.
- Overrides whose element no longer exists in the definition are flagged (⚠) instead of silently dropped; a missing macro shows a placeholder.
- **Detach** turns an instance into an ordinary group with the overrides applied; **Reset all overrides** returns it to the definition.

## Integrated source editor

The editor includes a built-in **source view with syntax highlighting** for `.gl` files, so you can flip between the canvas and the code that generates it. Adjust coordinates by typing instead of dragging, batch-rename colors, or paste in a slide written by a colleague — the canvas re-renders from the text instantly. Tabs switch between the project file and imported macro libraries.

**Autocomplete** suggests what can come next, from the live element types and macro library: directives after `.`, an element's parameters, enum values (and colors already used in the file) after `key:`, and a macro's element names after `::` inside a `.macro.<name>` block. **Enter** or **Tab** accepts a suggestion; Ctrl+Space shows them on demand.

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
  inspector/      .gl source inspector (bottom drawer)
    index.js        drawer + two-way sync with the canvas
    codeEditor.js   CodeMirror 5 wrapper + .gl syntax mode
    tokenizer.js    pure .gl tokenizer used by the syntax mode
    glNavigation.js line <-> slide/element mapping
    settings.js     inspector settings + popover
    contextMenu.js  right-click "Go to Gluon file"
ui/
  project.js      create/open/sample project, recents, project settings
  modals.js       new-project, macros and bibliography dialogs
main.js           entry point: wires index.html controls (data-action)
elements/
  index.js        registry hookup — one import per element type
  text/ shape/ figure/
export/
  html.js         interactive HTML viewer + print source
  pdf.js          headless-Chromium vector PDF
app.py            launcher (snap env fix, lib download, window)
backend/
  api.py          Api class exposed to JS as pywebview.api
  dialogs.py project_io.py figures.py pdf_export.py
  user_settings.py  recents + inspector settings (~/.config/gluonslides)
  vendor_libs.py    downloads JS/CSS libs listed in dependencies.yaml
  snap_env.py       undoes env leaked by snap-packaged terminals
```

The in-memory model is plain JS objects; `.gl` is a projection applied only at the file boundary (`serializeProject` / `deserializeProject`), which keeps rendering, selection, and history logic completely format-agnostic. Text elements never import the editor — they communicate through DOM events, so there are no circular dependencies.

## Getting started

Requirements: Python 3 with GTK bindings (Linux: `sudo apt install python3-gi python3-gi-cairo gir1.2-gtk-3.0`) and the packages in `pyproject.toml` / `dependencies.yaml`.

```bash
uv run app.py      # or: python3 app.py
```

On first start, missing JS/CSS libraries from `dependencies.yaml` are downloaded into `libs/`. Recent projects and inspector settings are stored per user (`~/.config/gluonslides` on Linux).

Create a project (pick a folder — you get `MyDeck.gl` plus a `macros.tex` for your LaTeX macros), add elements from the toolbar, and export with the HTML/PDF buttons. Autosave runs continuously; your project file always reflects the current canvas.

## License

See [LICENSE](LICENSE).
