# GluonSlides user guide

What the editor can do and how. The [Gluon format reference](gluon-format.md) has the file format; [developer notes](developer.md) explain the code.

- [Editing](#editing)
  - [Basics](#basics)
  - [Arranging: align, guides, layers, lock](#arranging-align-guides-layers-lock)
  - [Groups](#groups)
  - [Project defaults](#project-defaults)
  - [Styles and theme colors](#styles-and-theme-colors)
  - [Integrated source editor](#integrated-source-editor)
- [Text](#text)
  - [Fonts](#fonts)
  - [Coloured and formatted text](#coloured-and-formatted-text)
  - [Fields and sections](#fields-and-sections)
  - [Bibliography (`.bib`)](#bibliography-bib)
- [Figures and data](#figures-and-data)
  - [Figures: pasting and linked files](#figures-pasting-and-linked-files)
  - [Columns](#columns)
  - [Tables](#tables)
  - [Variables: values from your results](#variables-values-from-your-results)
  - [Interactive plots and sliders](#interactive-plots-and-sliders)
- [Drawing](#drawing)
  - [Shapes](#shapes)
  - [Lines & curves](#lines--curves)
  - [Connectors and rotation](#connectors-and-rotation)
- [Structure: masters and macros](#structure-masters-and-macros)
  - [Master slides](#master-slides)
  - [Macros (reusable components)](#macros-reusable-components)
- [Presenting and exporting](#presenting-and-exporting)
  - [Presenting, builds and speaker notes](#presenting-builds-and-speaker-notes)
  - [Exporting](#exporting)
- [Importing a talk](#importing-a-talk)
  - [Importing a talk (Beamer, Slidev, PowerPoint, PDF)](#importing-a-talk-beamer-slidev-powerpoint-pdf)
- [Projects and tabs](#projects-and-tabs)
  - [Several projects: tabs](#several-projects-tabs)
- [Help and shortcuts](#help-and-shortcuts)
  - [Help menu and keyboard shortcuts](#help-menu-and-keyboard-shortcuts)

## Editing

### Basics

Select an object with a click; **Ctrl+click** (or dragging a rectangle on an empty part of the slide) selects several. Drag to move, drag the handles to resize (**Shift** keeps the proportions), the round handle above to turn. **Double-click** a text to edit it (the double-clicked word is selected), a group or a macro instance to edit inside it; **Esc** or a click outside finishes. The **properties panel** on the right shows what is selected; with nothing selected it shows the slide (title, section, master, speaker notes). **Right-click** a slide or an object for *Go to Gluon file*, and a picture for *Convert to LaTeX*.

Everything can be undone (**Ctrl+Z** / **Ctrl+Shift+Z**), objects and slides can be cut, copied and pasted (also between projects, see [tabs](#several-projects-tabs)), and the project is saved by itself as you work.

### Arranging: align, guides, layers, lock

The **Arrange** part of the properties panel works on the selected objects:

- **Align**: one object is aligned on the slide (or in the group being edited); several are aligned to each other (left, centre, right, top, middle, bottom edges of the box around them).
- **Distribute evenly** (three or more): equal gaps from left to right or top to bottom; the two outer objects stay put.
- **Layer**: *To front*, *Forward*, *Backward*, *To back*, also **Ctrl+]** / **Ctrl+[** (one step) and **Ctrl+Shift+]** / **Ctrl+Shift+[** (all the way). The order is the order of the lines in the `.gl` file: later lines are drawn on top.
- **🔒 Locked** (**Ctrl+Shift+L**): the object can't be moved or resized by dragging, arrow keys, align or distribute. Dragging on it draws a selection rectangle instead, so a full-slide background never gets in the way; a click still selects it. In the file: `locked:yes`.

**Smart guides**: while moving or resizing, the edges and centre of what you drag snap to the edges and centres of the other objects (the master's too) and of the slide, and a pink line shows what it lines up with. A guide wins over the grid on its axis; hold **Alt** to place freely, without guides or grid.

### Groups

Select several elements (drag a box on empty canvas space, or Ctrl+click) and press **Ctrl+G**. A group keeps its children in its own coordinate frame, so resizing the group scales everything inside it (positions, sizes, fonts, borders) while only the group's line changes in the file:

```
.element.group id:10 x:200 y:100 width:800 height:400 frameWidth:400 frameHeight:200
	.element.text id:11 x:0 y:0 width:400 height:100 fontSize:32 ...
		Text body of the child (one more tab)
	.element.shape id:12 x:0 y:120 width:400 height:80 ...
```

Here the children live in a 400×200 frame drawn at 800×400, i.e. at 2× scale. Double-click a group to edit its children (Esc or a click outside to finish); **Ctrl+Shift+G** ungroups and bakes the scale into the children.

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

### Integrated source editor

The editor includes a built-in **source view with syntax highlighting** for `.gl` files (**Ctrl+E**, *Help → The .gl file of this project*, or right-click a slide or an object → *Go to Gluon file*, which opens it at that line), so you can flip between the canvas and the code that generates it. Adjust coordinates by typing instead of dragging, batch-rename colors, or paste in a slide written by a colleague — the canvas re-renders from the text instantly. Tabs switch between the project file and imported macro libraries.

**Autocomplete** suggests what can come next, from the live element types and macro library: directives after `.`, an element's parameters, enum values (and colors already used in the file) after `key:`, and a macro's element names after `::` inside a `.macro.<name>` block. **Enter** or **Tab** accepts a suggestion; Ctrl+Space shows them on demand.

The [Gluon format reference](gluon-format.md) describes everything the file can hold.

## Text

### Fonts

The font list of a text box (searchable, each name shown in its own font) has:

- **Default:** sans-serif, serif, monospace (the reader's defaults).
- **Built-in:** open fonts shipped with the app (downloaded once into `libs/fonts`): Inter, Roboto, Lato, Open Sans, Source Sans 3, Montserrat, Merriweather, Source Serif 4, EB Garamond, Playfair Display, Computer Modern (the LaTeX look), Fira Code, JetBrains Mono.
- **Project fonts:** `.ttf`, `.otf`, `.woff` or `.woff2` files in the project's `fonts/` folder (**＋ Add font files…** copies them there), so they travel with the project.
- **This computer:** fonts installed on your system.

Exports embed every font the presentation uses (not the generic defaults), so the HTML and PDF look the same on any computer. The licence of a chosen font is shown under the font list (with a warning when it is not an open licence); fonts whose licence forbids embedding are never embedded, and exports tell you which fonts were left out or are not openly licensed. In `.gl`, names with spaces are quoted: `fontFamily:"EB Garamond"`.

### Coloured and formatted text

Text (text boxes, columns, table cells) takes Markdown, math, and the LaTeX commands you already use in math:

```
The \textcolor{red}{important} step, in a \textcolor{@accent}{theme colour}, \textcolor{red!60}{lighter}.
\highlight{yellow}{Marked words}, \textbf{bold}, \emph{italic}, \underline{underlined}, \texttt{code}.
```

Colours are CSS / xcolor names (`red`, `ForestGreen`), `#hex`, theme colours (`@accent`, which follow the palette) and xcolor mixes (`red!60` is 60% red and 40% white, `red!50!blue`). Commands nest and their text can hold Markdown and math. **Your macros work in text too** when they use these commands: with `\newcommand{\important}[1]{\textcolor{red}{\textbf{#1}}}` in `macros.tex`, write `\important{this}` and restyle every use in one place (macros for math only, like `\R`, stay in `$…$`). While editing, **select some words** (or double-click one) and a small bar offers bold and italic, written in Markdown (`**…**`, `*…*`), underline, the theme colours and highlights, written as the commands above, and ✕ to remove them; it types the marks for you, and Ctrl+Z undoes them. Typing `\` suggests the commands. (HTML such as `<span style="color:red">` still works; imports now write `\textcolor`.)

**Display equations** (`$$…$$`) are centred in their box, as in LaTeX, whatever the text's alignment. To have them follow the text instead (left in a left-aligned box, like LaTeX's `fleqn`), choose it in Project settings → Presentation (`equations:text` in the `.project` line).

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

## Figures and data

### Figures: pasting and linked files

While an image or a table is being imported (a large PDF figure takes a moment), a box on the slide shows where it will appear.

**Ctrl+V** with an image in the clipboard (a screenshot, an image copied from a browser or another program) saves it into the project's `figures/` folder as `pasted-<date-time>.png` and adds it to the slide, centred and in proportion. Image *files* copied in a file manager are imported like dropped files (below). **Text** copied from elsewhere (a paper, a web page, an email) becomes a new text box, sized to fit, when you are not editing one. Objects copied inside the app still paste as objects: copying them replaces what the system clipboard held.

**Dropping image files** (PNG, JPG, SVG, PDF…) from a file manager onto the window adds each one as a figure where it was dropped; dropped on an existing figure, it replaces that figure's image. Other files are refused; the window never opens a dropped file in place of the editor. Images dragged straight from a web page can't be dropped: copy the image and paste it with Ctrl+V.

A figure imported from a file elsewhere (**📁 Browse**, dropping or pasting a file) is copied into `figures/` and stays **linked** to the original: when the original changes, for example a plot your analysis script just regenerated, the copy is updated and the slide redrawn within a few seconds, without touching anything. The figure's panel has *Update when the original file changes* (on for new imports) and **↻ Reload from the original**. In the file this is `sync:yes` on the figure, next to its `filePath` (the project's copy) and `originalPath`.

### Columns

**Text ▾** in the toolbar (its ▾; the button itself adds a text box) has columns: text in 2–4 columns: one box, each column edited like a text box (Markdown, math, lists, citations, and images with `![](figures/plot.png)`). Double-click a column to edit it (**Tab** / **Shift+Tab**: next / previous column; **Esc** or a click outside: done); drag the handles on the dividers to change the widths, or pick a preset (50/50, 60/40, 30/70...) in the panel, with the gap, a divider line, and each column's horizontal and vertical alignment. Without a font of their own, columns use the project's text font.

```
.element.columns id:12 x:100 y:200 width:1700 height:600 gap:40 divider:line
	.column width:60
	Left column, **Markdown** and $math$
	.column width:40 valign:center align:center
	Right column
```

Widths are relative (here 60% / 40% of the space left by the gap). Markdown images work in ordinary text boxes too; they are loaded from the project folder like figures and embedded in exports.

### Tables

**Text ▾** in the toolbar has three ways to add a table: **Table (draw it)**, drag a box on the slide and get the grid that fits it (a click gives the usual 3×3); **Table from a CSV file…**, linked to the file (below); and **Table from pasted cells…**, a box to paste cells copied from a spreadsheet, a CSV or a Markdown table into. Cells hold Markdown and math. Double-click a cell to edit it (**Tab** / **Shift+Tab**: next / previous cell, and Tab in the last cell adds a row; **Enter**: the cell below; **Esc** or a click outside: done). A click picks the cell the panel works on: add or delete rows and columns there, and style the cell, its row or its column (bold, italics, colour, background, alignment, and a number format for a column such as `%.2f`, `%.3e`, `%.1%`). The table has a header row, borders (horizontal rules as in papers, all, or none), striped rows, a header background and line colour; drag the handles on its top edge to change column widths. **Pasting cells** copied from a spreadsheet makes a table, and so does **dropping a CSV file** on the window: it is linked like below (dropped on a table, that table follows the file).

**Import CSV...** copies a file's cells into the table. **Link CSV...** makes the table follow the file: it is copied into the project's `data/` folder and, like a linked figure, the copy is updated when the original changes (a results file your script rewrites), with ↻ Reload and **Unlink** (keep the cells, stop following). A linked table's cells are edited in the file; its styling is kept when the data changes. A big file (results with thousands of rows) shows its first 20 rows, header included; *Rows from the file* in the panel shows more or fewer (`rows:N` on the `.data` line).

```
.element.table id:30 x:100 y:300 width:1200 height:400 header:yes borders:horizontal stripes:yes
	.data {data/results.csv} sync:yes original:"/home/me/run/results.csv"
	.widths 40,30,30
	.row 1 bold:yes bg:#eeeeee
	.col 3 align:right format:%.2e
	.cell 2,3 color:#cc0000
	| Method | Iterations | Error |
	| NGD | 120 | 0.00123 |
```

Rows and columns count from 1. The cells are always written, also for a linked table, so the project is complete on its own (a `|` in a cell is `\|`, a line break `<br>`).

### Variables: values from your results

Numbers in your text can come from your results instead of being typed: write `\var{err}` in any text box, column or table cell (also inside math: `$\sigma = \var{sigma}$`), or `\var{err}[%.2e]` with a format (`%.2f`, `%.3e`, `%.4g`, `%d`, `%.1%`). Typing `\var{` lists the variables with their values.

**Project settings → Variables** is where they come from:

- **From files**: *＋ Link a JSON or CSV file…* copies a file your script writes into the project's `data/` folder and follows it, like a linked table: rerun the analysis and the numbers on the slides update. A JSON object gives its keys (nested ones as `fit.a`); a CSV gives `name,value` rows, or a header of names and the last row of values (a log your script appends to). ↻ reads it again; ✕ stops using it.
- **Written here**: values you just want in one place (a sample size, a date), with *＋ Add a value*.
- **All variables** lists every name, its value and where it comes from. A file wins over a written value, a slider over both.

An unknown name shows as a red `[? name]`. In the file: `.vars alpha:0.05` and `.vars {data/summary.json} sync:yes` (see the [format reference](gluon-format.md#vars)).

### Interactive plots and sliders

**Interactive ▾** in the toolbar adds a **plot** and a **slider**. A slider sets a variable (*Variable* in its panel, `mu` say); plots that use it are redrawn as it moves, and text showing it with `\var{mu}` changes too. It works on the canvas (drag the knob: the slider itself stays put), while presenting, in the presenter view (the audience's screen follows), and in the exported HTML, which needs nothing installed. The PDF export shows the starting values.

A plot is made of **layers** on the same axes: a histogram of samples, the density curve over it, a shaded region, a line at the mean… In its panel each layer is a **card** showing its kind, colour and name, with buttons to hide it (👁: kept in the file, not drawn, also when presenting), draw it earlier or later (↑ ↓: later layers are on top), duplicate it (⧉) or delete it (✕). Click a card to open its settings: colour, width and line style, ranges that can be numbers or variables (`mu - sigma`), bins, sample count and seed, colour map, the data file (*Choose…* copies a CSV into `data/` and follows it; its columns are then offered in menus)… and its **formula**, in a small editor that colours functions, variables and the layer's own coordinate (`x`, `t`…), suggests names as you type (Ctrl+Space too), and marks in red the line of a mistake (an unknown name is underlined). **＋ Layer** adds a new one, already open:

- **Curves and areas**: a curve `y = …`; an *area* under it (or between `y` and `y0`) from one value to another, both possibly variables (a probability region that follows the sliders); a *parametric* curve `x = …`, `y = …` in `t` (circles, orbits).
- **Markers**: vertical and horizontal lines, points and texts at values or variables (`x:mu`).
- **Data**: *points* (with error bars), a *line*, *bars* by category (`Adam, 0.91`) and *histograms*, from rows typed in the box or from a CSV file. A histogram can also **sample a formula**: `samples:2000` draws `y = normal(mu, sigma)` that many times, and since the draws are seeded the bars slide smoothly with the slider instead of flickering.
- **2D**: a *heatmap* of `z = …` in `x` and `y` with a colour bar (colour maps viridis, magma, coolwarm, blues, gray), *contour* lines (how many, or at which values), and *arrows* of a field `u = …`, `v = …`.

The cards write the plot's text, which stays readable in the source view (Ctrl+E): a line per layer with its settings, then its formula or rows. Changing a setting rewrites only that layer's line; formulas, comments and blank lines stay as typed. You can also edit the text there: typing `.` in a plot's body suggests the layers, a space after a layer the settings it takes (with what they do), a setting's `:` its values (colour maps, theme colours, the data file's columns, variables), and a formula the functions and variables.

```
.hist samples:3000 bins:40 density:yes color:@muted label:"samples"
y = normal(mu, sigma)
.curve color:@primary width:4 label:"$\mathcal{N}(\mu,\sigma^2)$"
y = exp(-(x - mu)**2 / (2*sigma**2)) / sqrt(2*pi*sigma**2)
.vline x:mu label:"μ"
```

**Formulas** chooses how formulas are written: *Python* (`x**2`, `exp(…)`, `np.sin(…)`, `np.random.normal(…)`: copied from a script, they work as they are) or *LaTeX* (`\frac{1}{\sqrt{2\pi\sigma^2}} e^{-\frac{(x-\mu)^2}{2\sigma^2}}`: the same text you show on the slide); a layer can also say `lang:` itself. The panel also has the x and y ranges (empty: found from the layers, then kept while sliders move), log axes, ticks at multiples of π, equal proportions (a circle stays round), axis labels (Markdown and math), text size and colour, grid and legend. A mistake (an unknown name, a missing column, a bracket) is written on the plot in red, with its layer and line.

Formulas are read by GluonSlides' own small calculator, never run as code, so a presentation someone sends you can only draw. These plots are for figures that move or follow your results; for a publication figure, your own plotting script and a [linked figure](#figures-pasting-and-linked-files) remain the right tool. See the [format reference](gluon-format.md#plot) for every layer, parameter, function and command.

## Drawing

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

### Connectors and rotation

**Lines attached to shapes.** Drag an end of a line or arrow over a shape: dots show its sides and centre, and dropped on one the end is attached; the line then follows the shape when it moves, resizes or turns. A line drawn from one shape to another attaches to both; dragged off, an end comes loose. The panel shows what each end is attached to, the **route** (straight, curved, elbow) and *detach*. In the file:

```
.element.path id:30 from:12@right to:{Model}@left route:elbow end:arrow ...
```

An end names the shape by id or, when it has a unique name, by `{name}`; sides are `top`, `right`, `bottom`, `left`, `center` or `auto` (the side facing the other end). Pasting shapes together with their connector keeps them connected; a connector pasted alone stays on its shapes on the same slide. PowerPoint connectors come in attached.

**Rotation.** The round handle above a selected object turns it (**Shift**: 15° steps; square angles stick), or type the angle in the panel (`rotate:30` in the file). Turned objects resize along their own sides; aligning and the guides use the box they cover; connectors attach to their turned sides. Lines turn their points. PowerPoint rotations are kept.

## Structure: masters and macros

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

## Presenting and exporting

### Presenting, builds and speaker notes

**◧** and **◨** at the ends of the toolbar hide the slides pane and the properties pane (**Ctrl+Alt+1**, **Ctrl+Alt+2**), to give the slide the whole window, for instance next to another window. **Drag a pane's inner edge** to make it wider or narrower (dragged nearly shut it hides; a double-click gives the usual width back). Both are remembered.

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

**Builds:** select an object and set **Appears at step** in the properties panel: at step 2 it appears on the first click, at step 3 on the second, and so on (like Beamer's `\pause`). **Disappears after step** makes it go again after that step (shown at steps 2–3, say: Beamer's `\only<2-3>`, Slidev's `v-switch`), for content that replaces other content in the same place. A purple badge on the canvas shows the steps ("2", "2–3", "1 only"), and **Steps** in the toolbar shows the slide as it looks at one step, to see and edit what is on screen then (*all* shows everything; it only changes the view). Going back to a previous slide shows it complete. The PDF export works like the slide show: each step becomes a page of its own (a slide with three steps gives three pages), so the PDF can be presented the same way.

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
.element.figure id:6 step:2 until:3 x:100 y:250 width:900 height:600 filePath:figures/plot-old.png
```

`.notes` (indented text after the `.slide` line) holds the notes; `step:N` on an element is the step at which it appears (step 1, the default, is not written).

### Exporting

**Export** (toolbar): **HTML** makes one file that plays the presentation in any browser (keyboard navigation, presenter view, the fonts embedded); **PDF** a vector PDF made with Chrome, Chromium or Edge if one is installed (otherwise from pictures of the slides), one page per build step.

## Importing a talk

### Importing a talk (Beamer, Slidev, PowerPoint, PDF)

**⬇ Import Talk...** on the start screen turns an existing talk into a new project (in a folder you choose, with the figures copied into `figures/`). Drop it on the dialog or choose it: the `.zip` (as Overleaf downloads it), the project folder, or **all its files at once**. A talk split over several `.tex` or `.md` files is fine: the main one is found and the others are read from where they are.

**With the compiled PDF.** If the PDF of the talk comes along (in the zip or the folder, next to the main file, or chosen with it), it is used as the ground truth for the layout: slides are paired with its pages (Beamer numbers pages by frame; each element is looked for on the overlay page of the last step it is shown at), text, columns and tables are moved onto the PDF's text and take its font sizes, figures go where its pictures are, and boxes, formulas and rules move with what they belong to. Only positions and sizes change, never the content; a PDF that isn't this talk is ignored. **Figures missing from the source** (a zip without its `figures/`, an image that moved) are taken from the PDF: the picture or drawing the PDF shows where the figure goes is saved as `figures/<its name>.png` at twice the slide's resolution. Without a PDF a missing figure stays a placeholder of the right name and place, to drop the file into. It needs the PDF component (below). The dialog's *Use the compiled PDF* turns it off.


- **Beamer**: the `.tex`, or the `.zip` of the LaTeX project as Overleaf downloads it (the main file is found). Frames become slides with their titles, `\section`s become sections (with section slides if the talk has `\AtBeginSection`), the title page is rebuilt, and the footer's page number and the frame-title bar go on a master slide. Text keeps bold, italics and colours; math stays LaTeX (`align*` becomes `aligned`), and the document's macros (`\newcommand`, `\DeclareMathOperator`) go into `macros.tex` with colour names resolved; `itemize`/`enumerate`, `\includegraphics`, `tcolorbox` and Beamer blocks are converted; `columns` (also nested) become a columns element (separate boxes when a column reveals content step by step) and `tabular` a table element (header and rules from its `\hline`s / `\midrule`s, all borders with `|` in the column spec); `\cite` and the `.bib` are kept. Overlays (`\pause`, `\item<2->`, `\only`, `\onslide`, `\includegraphics<2>`) become build steps; content Beamer shows only for some steps (`\only<1-2>`, `\includegraphics<1>`, rows of an equation) disappears after its last step (`until`), so a later version takes its place. LaTeX's own layout isn't available, so positions are estimated and a frame that is too full is shown smaller: a good draft to tidy, not a pixel copy. TikZ drawings are not converted (a placeholder shows where they were).
- **Slidev**: the `slides.md` (or the `.zip` of the project). Slidev is Markdown with KaTeX like GluonSlides' text, so text and math are kept as they are; coloured `<span>`s and MDC `[text]{style="color:…"}` become `\textcolor`. Slides follow `---` and frontmatter, with `src:` pages included and `hide: true` skipped; `# Title` becomes the slide title; `<div class="grid grid-cols-N">` and `layout: two-cols` (`::right::`) become a columns element (or boxes per column when clicks are inside); Markdown tables become tables; `<div class="absolute left-…px bottom-…px">` boxes and `<Arrow>`s are placed exactly (Slidev's 980 × 552 canvas); `<img>` and `background:` become figures; `v-click`, `<v-click>` and `<v-clicks>` become build steps; `v-switch`, `v-click-hide` and `v-click="[a, b]"` become content shown only for some steps, in one place (also when moved into place with `v-motion`); the last HTML comment of a slide becomes its notes; the KaTeX macros of `setup/katex.ts` go into `macros.tex`. Other Vue components are listed as not converted.
- **PowerPoint** `.pptx`: text boxes and placeholders (paragraphs, bullet and numbering levels, bold, italics, underline, colours including theme colours, sizes, fonts, alignment, links), pictures (saved into `figures/`, cropped as shown), rectangles, rounded rectangles and ovals (fill, outline) with their text, lines and connectors (arrowheads), tables (as table elements, with PowerPoint's header row and banded rows), groups, solid backgrounds, speaker notes, PowerPoint's sections, and click animations (entrances as build steps, exits as the step it disappears after). The shapes of each slide layout used (a logo, a footer line) become a master slide. Freeforms (drawn shapes) and curved or elbow connectors become exact SVG pictures, text keeps its mixed sizes, text PowerPoint shrinks to fit is shrunk as shown, and the slide number field becomes `\slidenumber`. Charts, SmartArt and Windows metafile pictures can't be converted: with the deck's **PDF** (exported from PowerPoint or Google Slides, next to the `.pptx` or chosen with it) they are taken from it as pictures at their place; without it a dashed box says what was there.
- **PDF**: three ways, chosen in the dialog. *Editable* (default): text blocks become text boxes (bold, italics, colours, sizes, fonts), rectangles, rounded boxes and ellipses become shapes, lines and polygons become lines and paths, embedded pictures become figures; equations (a PDF doesn't keep their LaTeX) and dense vector drawings such as plots become pictures of that region. *Picture with editable text*: each page as a picture with its text removed, and the text as editable boxes on top. *Pages as pictures*: exact, not editable. In all three, content repeated on most pages (a logo, the footer, the frame-title bar) becomes a master slide, with page numbers as `\slidenumber / \totalslides`, and consecutive pages of one frame (Beamer overlays, `\pause`) become one slide with build steps (content gone on a later page disappears after its last one). PDF import uses PyMuPDF (AGPL-3.0): the app downloads it (about 25 MB, from PyPI, its SHA-256 checked) the first time, after asking, with a progress bar (if your system's certificates are not found by the app's own Python, the usual system certificate files are tried); from source, `uv sync --extra pdf`.

A progress bar shows how far the import is (frames converted, the compiled PDF being read). **Equations in pictures** (PowerPoint, PDF): with *Turn pictures of equations into LaTeX* in the dialog, each picture that looks like a formula is read by a LaTeX-OCR model (pix2tex's, MIT, as converted to ONNX by RapidLaTeXOCR, Apache-2.0) running on your computer; when the model is sure, the picture becomes an editable `$\displaystyle …$` text box named “Recognised equation” (check them: most are exact, some have a slip such as α for x; colours inside the equation are not read). Single letters are left as pictures. **For one picture**, right-click it and choose **∑ Convert to LaTeX** (also a button in the figure's panel): the picture is read whatever the model's confidence, and replaced by the text box, with a note to check it when the model was unsure; Ctrl+Z brings the picture back. The component (ONNX Runtime and the model, about 220 MB) is downloaded once, after asking, each file checked against its SHA-256.

The import lists anything worth checking (a figure not found, a very full slide, content that Beamer hides again later, slides not found in the compiled PDF).

## Projects and tabs

### Several projects: tabs

Opening, creating or importing a project while one is open puts it in a **tab** of its own (the strip at the top; **+** opens the start screen for another one, **×** or **Ctrl+W** closes, **Ctrl+Tab** goes to the next). Opening a project that is open already shows its tab. Leaving a tab saves its project; each keeps its own undo history. Objects and slides **copied in one tab paste into another** with what they use: figures and images in text are copied into the project's `figures/` (still following their original), linked tables into `data/`, and macro definitions, named styles and theme colours the project lacks are added.

## Help and shortcuts

### Help menu and keyboard shortcuts

The **?** button at the right end of the toolbar opens **Help**:

- **Quick tour**: spotlights the parts of the window one after the other (the toolbar, the slides, the canvas, the properties, the source). It starts by itself the first time the editor opens.
- **Tutorial presentation**: a short presentation that teaches by doing: each slide explains something and has objects to try it on. It opens in a new tab and is not saved (it's a scratch project; nothing to clean up). The start screen has a **🎓 Tutorial** button for it too.
- **Keyboard shortcuts** (**Ctrl+/** or **F1**): every shortcut, and the keys of every command can be changed there: click a shortcut, press the new keys; ↺ goes back to the default. Your choices are kept between runs. A combination already used by another command is pointed out.
- **The .gl file of this project** (**Ctrl+E**): the source view.
- **Gluon format reference**: opens [the reference of the `.gl` format](gluon-format.md) on GitHub.

On macOS, Ctrl in the shortcuts below means Cmd.

| Command | Default keys |
|---|---|
| Undo | Ctrl+Z |
| Redo | Ctrl+Shift+Z, Ctrl+Y |
| Cut / Copy / Paste | Ctrl+X / Ctrl+C / Ctrl+V |
| Delete | Delete, Backspace |
| Group / Ungroup | Ctrl+G / Ctrl+Shift+G |
| Lock / unlock | Ctrl+Shift+L |
| Forward / Backward | Ctrl+] / Ctrl+[ |
| To front / To back | Ctrl+Shift+] / Ctrl+Shift+[ |
| Hide / show the slides pane | Ctrl+Alt+1 |
| Hide / show the properties pane | Ctrl+Alt+2 |
| Show / hide the .gl file (source) | Ctrl+E |
| Next / previous tab | Ctrl+Tab / Ctrl+Shift+Tab |
| Close tab | Ctrl+W |
| Present from the first slide | F5 |
| Present from the current slide | Shift+F5 |
| Keyboard shortcuts | Ctrl+/, F1 |

These keys are fixed (listed in the dialog too):

| Keys | |
|---|---|
| Arrows | move the selection (Alt: by one pixel, without snapping); with nothing selected, change slide |
| Shift+↑ / Shift+↓ | select more slides |
| Esc | finish editing; leave a group, a macro or a master; close a menu |
| Enter, Tab, Shift+Tab | in a table or columns being edited: next cell or column |
| Shift while resizing or drawing | keep proportions, 45° angles, 15° turns |
| Alt while dragging | place freely, without guides or grid |
| Ctrl+click | add to the selection |
| Double-click | edit a text, a cell or a column; enter a group or a macro instance |
| While presenting | see [Presenting](#presenting-builds-and-speaker-notes) |
