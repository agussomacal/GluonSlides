# GluonSlides

[![Tests](https://github.com/agussomacal/GluonSlides/actions/workflows/tests.yml/badge.svg)](https://github.com/agussomacal/GluonSlides/actions/workflows/tests.yml)

A local-first, freeform presentation builder with a twist: **your slides live in a Quarkdown-inspired text format** that you can read, edit, and version-control — while a full drag-and-drop editor keeps everything in sync.

GluonSlides runs entirely on your machine (Python + pywebview, no cloud, no accounts) and treats the `.gl` project file as the single source of truth: every drag, resize, and property change in the GUI is serialized back into clean, human-readable text.

## Highlights

- 🖱️ **Visual slide editor** — drag, resize, multi-select, group-move, arrow-key nudging, snap-to-grid and smart guides, align/distribute, layers and locking, slide reordering, cut/copy/paste, and full undo/redo.
- 📐 **Freeform layout** — absolutely positioned elements on a canvas (1920×1080 by default, other presets available), with a configurable alignment grid.
- 📝 **Markdown + LaTeX in every text box** — write `**bold**`, lists, and inline or display math (`$E = mc^2$`, `$$\int f(x)\,dx$$`) rendered with marked.js and KaTeX.
- ⚙️ **LaTeX macros** — define `\newcommand` macros once in a per-project `macros.tex` file (editable from a built-in dialog) and use them in any text element.
- 📚 **Bibliography (`.bib`)** — keep BibTeX entries in a per-project `bibliography.bib`, cite them with `\cite{key}` in any text box, and print the reference list with `\printbibliography`, in numeric or author–year style.
- ▶️ **Present from the app** — full-screen slide show with builds (objects that appear one click at a time), a presenter view (notes, next slide, timer) with the audience on a second screen, black screen and go-to-slide.
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

### Project defaults

**⚙ Project settings** (sidebar) sets the project's defaults for text (font, size, color, alignment), shapes (fill, border) and lines (stroke, width, style). They work like CSS: an element's own value wins, otherwise the project default applies, otherwise the built-in one. New elements store no style values, so they follow the defaults, and changing a default updates every element that inherits it. In the properties panel inherited fields are tagged *default*; overridden ones get a ↺ to return to the default. In `.gl`:

```
.project {Deck} ...
.defaults.text fontFamily:"EB Garamond" fontSize:32 fontColor:#0f172a
.defaults.shape bg:#e0f2fe borderCol:#0369a1
.defaults.path stroke:#0f172a strokeWidth:4
```

Older projects store every value in each element; *Use project defaults for existing elements* (in the dialog) makes elements whose values are just the standard ones follow the defaults, keeping values you changed on purpose. Elements inside macros inherit the defaults too.

### Styles and theme colors

**Named styles** (Project settings → *Styles*) are reusable looks such as *title* or *caption*, for text, shapes and lines. Pick one in the properties panel (**Style**); **＋** next to it turns the selected element's look into a new style. Changing a style updates every element using it. The cascade is: element's own value → its style → project default → built-in. Field tags in the panel show where an inherited value comes from (the style's name, or *default*).

**Theme colors** (Project settings → *Colors*) are the project's palette. Every color field offers them first, then *None* and *＋ Custom…*. Elements refer to them by name, so changing a theme color updates all its uses; renaming one updates the references, and removing one keeps the look (its uses get the color itself). **Opacity** is a separate slider in each color field, so no extra semi-transparent colors are needed.

```
.palette primary:#1d4ed8 accent:#f59e0b dark:#0f172a light:#f1f5f9
.style.text {title} fontFamily:Montserrat fontSize:64 fontColor:@primary
.element.text id:3 style:title x:100 y:80 width:1200 height:120
	Results
.element.shape id:4 x:100 y:300 width:400 height:300 bg:@accent/40
```

`@accent` is a theme color, `/40` means 40% opacity.

### Fonts

The font list of a text box (searchable, each name shown in its own font) has:

- **Default:** sans-serif, serif, monospace (the reader's defaults).
- **Built-in:** open fonts shipped with the app (downloaded once into `libs/fonts`): Inter, Roboto, Lato, Open Sans, Source Sans 3, Montserrat, Merriweather, Source Serif 4, EB Garamond, Playfair Display, Computer Modern (the LaTeX look), Fira Code, JetBrains Mono.
- **Project fonts:** `.ttf`, `.otf`, `.woff` or `.woff2` files in the project's `fonts/` folder (**＋ Add font files…** copies them there), so they travel with the project.
- **This computer:** fonts installed on your system.

Exports embed every font the presentation uses (not the generic defaults), so the HTML and PDF look the same on any computer. The licence of a chosen font is shown under the font list (with a warning when it is not an open licence); fonts whose licence forbids embedding are never embedded, and exports tell you which fonts were left out or are not openly licensed. In `.gl`, names with spaces are quoted: `fontFamily:"EB Garamond"`.

### Figures: pasting and linked files

**Ctrl+V** with an image in the clipboard (a screenshot, an image copied from a browser or another program) saves it into the project's `figures/` folder as `pasted-<date-time>.png` and adds it to the slide, centred and in proportion. Image *files* copied in a file manager are imported like dropped files (below). **Text** copied from elsewhere (a paper, a web page, an email) becomes a new text box, sized to fit, when you are not editing one. Objects copied inside the app still paste as objects: copying them replaces what the system clipboard held.

**Dropping image files** (PNG, JPG, SVG, PDF…) from a file manager onto the window adds each one as a figure where it was dropped; dropped on an existing figure, it replaces that figure's image. Other files are refused; the window never opens a dropped file in place of the editor. Images dragged straight from a web page can't be dropped: copy the image and paste it with Ctrl+V.

A figure imported from a file elsewhere (**📁 Browse**, dropping or pasting a file) is copied into `figures/` and stays **linked** to the original: when the original changes, for example a plot your analysis script just regenerated, the copy is updated and the slide redrawn within a few seconds, without touching anything. The figure's panel has *Update when the original file changes* (on for new imports) and **↻ Reload from the original**. In the file this is `sync:yes` on the figure, next to its `filePath` (the project's copy) and `originalPath`.

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

### Arranging: align, guides, layers, lock

The **Arrange** part of the properties panel works on the selected objects:

- **Align**: one object is aligned on the slide (or in the group being edited); several are aligned to each other (left, centre, right, top, middle, bottom edges of the box around them).
- **Distribute evenly** (three or more): equal gaps from left to right or top to bottom; the two outer objects stay put.
- **Layer**: *To front*, *Forward*, *Backward*, *To back*, also **Ctrl+]** / **Ctrl+[** (one step) and **Ctrl+Shift+]** / **Ctrl+Shift+[** (all the way). The order is the order of the lines in the `.gl` file: later lines are drawn on top.
- **🔒 Locked** (**Ctrl+Shift+L**): the object can't be moved or resized by dragging, arrow keys, align or distribute. Dragging on it draws a selection rectangle instead, so a full-slide background never gets in the way; a click still selects it. In the file: `locked:yes`.

**Smart guides**: while moving or resizing, the edges and centre of what you drag snap to the edges and centres of the other objects (the master's too) and of the slide, and a pink line shows what it lines up with. A guide wins over the grid on its axis; hold **Alt** to place freely, without guides or grid.

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

### Bibliography (`.bib`)

**📚 Bibliography (.bib)** in the sidebar opens the project's BibTeX entries, which are saved as `bibliography.bib` in the project folder (you can also edit that file directly, or drop in one exported from Zotero, JabRef, etc.). In any text element:

| Command | Numeric | Author–year |
|---|---|---|
| `\cite{key}`, `\citep{key}`, `\parencite{key}` | [1] | (Smith, 2020) |
| `\citet{key}`, `\textcite{key}` | Smith [1] | Smith (2020) |
| `\cite{a,b}` | [1, 2] | (Smith, 2020; Doe & Lee, 2019) |
| `\cite[p.~5]{key}` | [1, p. 5] | (Smith, 2020, p. 5) |
| `\fullcite{key}` | the full reference | |
| `\printbibliography` | the list of every cited work, in order of first citation | |
| `\printbibliography[9-]`, `[1-8]`, `[5]` | part of the list (numbers in citation order) | |

**Long reference lists:** when the list does not fit in its text box, the box shows what fits (with a "continues on +N slides" badge) and the rest continues on copies of that slide (same title, logo and layout) when presenting and in the HTML and PDF exports. Nothing extra is saved in the `.gl` file, and the split follows the bibliography as it changes. To choose the split yourself, put `\printbibliography[1-8]` on one slide and `\printbibliography[9-]` on another.

The selector next to the button switches the style between numeric and author–year; it is stored in the project header as `citestyle:numeric` or `citestyle:authoryear`. References are formatted from the BibTeX fields (authors as "Gödel, K.", year, title, journal or book, volume(number), pages), with LaTeX accents and symbols decoded (`G{\"o}del` → Gödel, `--` → –). Citations are resolved only when drawing and exporting: the `.gl` file keeps the commands as you typed them.

**Autocomplete:** typing `\cite{` (or any of the commands above, or a comma inside one) lists the bibliography entries, both in a text box on the canvas and in the `.gl` inspector. Typing filters by key, author or title; Enter or Tab inserts the key and the closing brace.

**Missing keys:** a key that is not in the bibliography shows as a red `[? key]`, the Bibliography button shows a ⚠ count, the dialog lists the keys, and exports warn about them.

```
.element.text id:5 x:100 y:200 width:1200 height:100
	Earlier results \cite{einstein1905} were confirmed later \cite{knuth1984,lamport1994}.
.element.text id:6 x:100 y:800 width:1200 height:200 fontSize:20
	\printbibliography
```

### Fields and sections

Text can contain **fields**, commands replaced by their value on each slide (on the canvas, in thumbnails, when presenting and in exports; the `.gl` file keeps the command):

| Field | Shows |
|---|---|
| `\slidenumber` / `\totalslides` | 7 / 24 (as presented: continuation pages of long reference lists count, build steps don't) |
| `\slidetitle` | the slide's name |
| `\sectiontitle` | the slide's section |
| `\presentationtitle`, `\author`, `\date` | the project name, and the author and date from **Project settings → Presentation** (`date:today` always shows the current day) |
| `\tableofcontents` | the sections, the current one in bold |

They mix with normal text and Markdown (`**\slidenumber**`, `Page \slidenumber of \totalslides`) and take the text box's font and style. **Fields ▾** in the toolbar adds a text box with a field already placed where it usually goes (slide number bottom right, a footer, a title page, a table of contents...), and typing `\` in a text box or in the inspector suggests them.

**Sections** group slides. With nothing selected, the properties panel shows the slide's **Section**: a name typed there applies from this slide on (to the following slides that were in the same section), so it both starts a new section and renames one. The sidebar shows a header per section; click it to fold the section's slides. In the file a section starts with `.section {Name}` (a bare `.section` ends it):

```
.project {Thesis defence} ... author:"Ada Lovelace" date:2026-06-30

.section {Introduction}

.slide {Motivation} id:3
.element.text id:4 x:40 y:1010 width:1840 height:50 fontSize:20
	\presentationtitle · \sectiontitle · \slidenumber / \totalslides
```

### Master slides

A **master slide** holds what every slide shows: a background, a logo, a footer with `\slidenumber`... With no object selected, the slide panel has **Master slide**: *Create a master slide* the first time, then a choice of master (or *None*, e.g. for the title slide), **✎ Edit** and **＋** (a new master). Editing a master happens on the canvas, like a slide (a teal frame and a banner show it; **Esc** or *Done* returns). On slides, master elements are drawn underneath and cannot be selected; fields show each slide's own values.

```
.master {Default} id:40
.element.text id:41 x:1680 y:990 width:200 height:60 fontSize:24 textAlign:right
	\slidenumber / \totalslides

.slide {Title} id:1 master:none
.slide {Results} id:2
.slide {Appendix} id:3 master:Plain
```

Slides use the first master unless they say `master:none` or `master:Name`.

### Presenting, builds and speaker notes

**▶ Present** (top right of the toolbar, or **Shift+F5**) starts the slide show from the current slide; **F5** starts from the first one. It shows exactly what the HTML export shows, full screen. **Esc** returns to the editor on the slide where you stopped.

| Keys | |
|---|---|
| → ↓ Space PageDown Enter, click | next step or slide |
| ← ↑ PageUp Backspace, right-click | back |
| Home / End | first / last slide |
| a number, then Enter | go to that slide |
| B or . / W or , | black / white screen (any key returns) |
| S | presenter view |
| F | full screen (in the exported HTML) |
| T / R, + / − | presenter view: pause / reset the timer, notes size |

**Builds:** select an object and set **Appears at step** in the properties panel: at step 2 it appears on the first click, at step 3 on the second, and so on (like Beamer's `\pause`). A purple badge on the canvas shows the step. Going back to a previous slide shows it complete. The PDF export works like the slide show: each step becomes a page of its own (a slide with three steps gives three pages), so the PDF can be presented the same way.

**Speaker notes:** with nothing selected, the properties panel shows the current slide's notes.

**Presenter view** (**🗒 Presenter view** in the toolbar, or **S** while presenting): this window shows the current slide, the next step, your notes, a timer (**T** pauses, **R** resets) and the clock, and a second window shows the slides to the audience. With two screens connected, **Present** starts in the presenter view by itself and puts the audience window full screen on the other screen. With one screen the audience window opens normally: drag it to the projector and press **F**. (On Wayland apps can't place their windows, so you may have to drag it there as well.) Without an audience window the presenter view works as a rehearsal mode. Navigating in either window moves both; **Black** blanks only the audience's screen.

The exported HTML has the presenter view too: open it in a browser and press **S** (allow the pop-up). The exported file contains the speaker notes, so remove them before sharing it if they are private.

```
.slide {Results} id:3
.notes
	Start with the headline number.
	Then reveal the plot.
.element.text id:4 x:100 y:80 width:1200 height:120
	Accuracy went from 71% to **93%**
.element.figure id:5 step:2 x:100 y:250 width:900 height:600 filePath:figures/plot.png
```

`.notes` (indented text after the `.slide` line) holds the notes; `step:N` on an element is the step at which it appears (step 1, the default, is not written).

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
  geometry.js     drag/resize/snap math, smart guides
  arrange.js      align, distribute, layer order, lock
  clipboard.js    keyboard shortcuts (cut/copy/paste/delete/undo)
  gl/
    glformat.js   the .gl format: spec, serializer, parser
editor/
  editor.js       canvas, thumbnails, properties panel, slide ops
  fileDrop.js     image files dropped on the window
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
  desktop.py        system clipboard (Ctrl+V) and dropped file paths
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

## Tests

```bash
npm install            # once: the browser driver for the end-to-end tests
npm test               # end-to-end tests: the editor driven in a headless Chrome
npm run test:backend   # Python backend tests
```

Every push and pull request runs both on GitHub (the *Tests* workflow, badge at the top). See [tests/README.md](tests/README.md) for what each kind of test covers and how to add one.

## License

See [LICENSE](LICENSE).
