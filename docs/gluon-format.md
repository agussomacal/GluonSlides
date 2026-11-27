# The Gluon (`.gl`) format

A GluonSlides project is a plain-text `.gl` file. Everything you do in the editor is written to it, and everything in it can be written by hand or by a script and opened in the app. This page is the complete reference. The [user guide](user-guide.md) explains the features; here is how each one is written.

- [A complete example](#a-complete-example)
- [The project folder](#the-project-folder)
- [Lexical rules](#lexical-rules)
- [Directives](#directives)
  - [`.project`](#project) · [`.import`](#import) · [`.palette`](#palette) · [`.defaults.<type>`](#defaultstype) · [`.style.<type>`](#styletype)
  - [`.master`](#master) · [`.section`](#section) · [`.slide`](#slide) · [`.notes`](#notes)
  - [`.element.<type>`](#elementtype) · [`.define` and `.macro.<name>`](#define-and-macroname)
- [Parameters every element has](#parameters-every-element-has)
- [Colours](#colours)
- [Element types](#element-types): [text](#text) · [shape](#shape) · [figure](#figure) · [path](#path-lines-curves-polygons-connectors) · [columns](#columns) · [table](#table) · [group](#group) · [macro instance](#macro-instance)
- [What goes in text](#what-goes-in-text)
- [Writing `.gl` files from a script](#writing-gl-files-from-a-script)

## A complete example

```gl
# Gluon slide project — saved by GluonSlides
.import {macros.gl}
.project {My Talk} version:2 width:1920 height:1080 grid:20 darkmode:no citestyle:numeric nextid:20 author:"Ada Lovelace" date:today
.palette primary:#1d4ed8 accent:#f59e0b dark:#0f172a light:#f1f5f9
.defaults.text fontFamily:"EB Garamond" fontSize:36 fontColor:@dark
.style.text {title} fontSize:64 fontColor:@primary textAlign:left

.master {Default} id:1
.element.text id:2 x:1680 y:990 width:200 height:60 fontSize:24 textAlign:right
	\slidenumber / \totalslides

.section {Introduction}

.slide {Title} id:3 master:none
.element.text id:4 style:title x:160 y:380 width:1600 height:200
	# \presentationtitle
	\author · \date

.slide {Results} id:5
.notes
	Start with the headline number.
.element.text id:6 style:title x:100 y:60 width:1720 height:120
	Accuracy went from 71% to **93%**
.element.shape id:7 x:100 y:300 width:400 height:250 radius:24 bg:@accent/40
.element.figure id:8 step:2 x:700 y:300 width:900 height:600 filePath:figures/plot.png bg:transparent borderWidth:0
.element.path id:9 step:2 from:7@right to:8@left route:curved end:arrow x:500 y:425 width:200 height:175 strokeWidth:4
	0 0
	1 1
```

## The project folder

| Path | What it is |
|---|---|
| `Deck.gl` | the project: everything below the slides is referenced from here |
| `macros.tex` | LaTeX macros (`\newcommand`) used in math and text |
| `bibliography.bib` | BibTeX entries for `\cite` |
| `macros.gl` | reusable components (`.define` blocks), imported with `.import {macros.gl}` |
| `figures/` | pictures used by figures and Markdown images (copies of the originals) |
| `data/` | copies of linked CSV files (tables) and variable files (`.vars`) |
| `fonts/` | font files that travel with the project |

Paths in the `.gl` file (`filePath`, `.data`, `.import`, `![](…)`) are relative to the project folder.

## Lexical rules

**Lines.** Every line that starts with `.` in the first column is a directive: `.name.subtype {argument} key:value key:value …`. Lines indented under a directive are its *body*.

**Indentation.** One level is one tab. Two spaces are also accepted for one level, but other widths are not: with four spaces, two are left over, which breaks nested blocks (groups, macros). The app always writes tabs.

**The `{argument}`.** Some directives take one argument in braces: a title, a name or a file. Inside it, `\{`, `\}` and `\\` stand for `{`, `}` and `\`.

**Parameters.** `key:value`, separated by spaces. A value with spaces or `"` is quoted: `fontFamily:"EB Garamond"`, and inside quotes `\"` and `\\` are `"` and `\`. Keys are letters, digits and `_`. Order doesn't matter (the app writes a fixed order, so diffs stay small). Unknown keys on a known element type are ignored.

**Bodies.** The indented lines after an element are its body: the text of a text box, the points of a line, the children of a group, and so on. One level of indentation is removed. Blank lines inside a body are kept. A body line that starts with `.` (after the indentation) is written `\.` so it isn't read as a directive; the app adds and removes that escape.

**Comments.** A line starting with `#` is a comment when no element body is open: at the top of the file, and after `.project`, `.palette`, `.style`, `.defaults`, `.section`, `.slide` and `.master` lines, before the next element. Inside a body `#` is text (a Markdown heading).

**Ids.** Slides, masters and elements share one counter. Every id must be a positive whole number, unique in the file. Missing or repeated ids are replaced by new ones when the file is read, and `nextid` is raised above the largest id. Elements inside `.define` blocks have names instead of ids.

**Numbers.** Positions and sizes are in pixels of the slide (1920 × 1080 by default), with the origin at the top-left corner. Decimals are allowed.

**Yes / no.** Switches are written `yes` / `no`.

## Directives

### `.project`

The header. One per file.

```gl
.project {My Talk} version:2 width:1920 height:1080 grid:20 darkmode:no citestyle:numeric nextid:20

.slide {One} id:1
```

| Parameter | Values | Default | Meaning |
|---|---|---|---|
| `{…}` | text | `Untitled Project` | the project's name (`\presentationtitle`) |
| `version` | `2` | `2` | format version |
| `width`, `height` | pixels | `1920`, `1080` | slide size |
| `grid` | pixels, `0` = off | `20` | the editor's snapping grid |
| `darkmode` | `yes` / `no` | `no` | the editor's dark mode |
| `citestyle` | `numeric` / `authoryear` | `numeric` | citation style |
| `nextid` | number | largest id + 1 | the next free id |
| `author` | text | | shown by `\author` |
| `date` | `YYYY-MM-DD`, `today`, or any text | | shown by `\date` (`today`: the current day) |
| `equations` | `text` | (centred) | display equations follow the text's alignment instead of being centred |

### `.import`

```gl
.import {macros.gl}
```

Reads the `.define` blocks of another file (a *macro library*). A library holds only `.import` and `.define` lines. The app writes imports above `.project`.

### `.palette`

The project's theme colours, `name:colour`. Elements refer to them as `@name`. Without a `.palette` line the project uses the starter palette: `primary #1d4ed8`, `secondary #0f766e`, `accent #f59e0b`, `dark #0f172a`, `muted #64748b`, `light #f1f5f9`.

```gl
.project {Deck}
.palette primary:#1d4ed8 accent:#f59e0b dark:#0f172a light:#f1f5f9

.slide {One} id:1
```

### `.vars`

Variables: values that text shows with `\var{name}` and that [plots](#plot) compute with. Two forms, as many lines as needed:

```gl
.project {Deck}
.vars alpha:0.05 method:Adam
.vars {data/summary.json} sync:yes original:"/home/me/run/summary.json"

.slide {One} id:1
```

- `.vars name:value …`: values written in the project. A value that reads as a number is a number, anything else is text.
- `.vars {file}`: the values of a JSON or CSV file in the project folder (usually `data/`). `sync:yes` (the default) copies `original` again when it changes, like a linked table; `sync:no` keeps the copy as it is.

A JSON file holds an object; nested objects give dotted names (`{"fit": {"a": 2}}` gives `fit.a`), lists are skipped. A CSV file is either `name,value` rows (a first row `name,value` is a header), or a header row of names and rows of values, of which the last is used (a log your script appends to). Names use letters, digits, `_` and `.`.

When the same name comes from several places, a file wins over a value written here, and a [slider](#slider) over both.

### `.defaults.<type>`

The project's default look for an element type: `text`, `columns`, `table`, `shape`, `figure` or `path`. An element that doesn't set a value takes it from its named style, then from these defaults, then from the built-in look.

```gl
.project {Deck}
.defaults.text fontFamily:"EB Garamond" fontSize:32 fontColor:#0f172a
.defaults.shape bg:#e0f2fe borderCol:#0369a1
.defaults.path stroke:#0f172a strokeWidth:4

.slide {One} id:1
```

Only these properties are inherited:

| Type | Properties |
|---|---|
| `text` | `fontFamily fontSize fontColor textAlign verticalAlign bg borderCol borderWidth borderStyle` |
| `columns`, `table` | `fontFamily fontSize fontColor bg borderCol borderWidth borderStyle` |
| `shape`, `figure` | `bg borderCol borderWidth borderStyle` |
| `path` | `stroke strokeWidth dash fill` |

### `.style.<type>`

A named style (letters, digits, `-`, `_`; starting with a letter), used by elements with `style:name`. Same properties as `.defaults`.

```gl
.project {Deck}
.style.text {title} fontFamily:Montserrat fontSize:64 fontColor:@primary
.style.text {caption} fontSize:20 fontColor:#64748b

.slide {One} id:1
.element.text id:2 style:title x:100 y:80 width:1200 height:120
	Results
```

The order of precedence: the element's own value, then its style, then `.defaults`, then the built-in look.

### `.master`

A master slide: elements drawn under every slide that uses it. It is written like a slide, and its elements follow it.

```gl
.project {Deck}

.master {Default} id:40
.element.text id:41 x:1680 y:990 width:200 height:60 fontSize:24 textAlign:right
	\slidenumber / \totalslides

.master {Plain} id:42

.slide {Title} id:1 master:none
.slide {Results} id:2
.slide {Appendix} id:3 master:Plain
```

Slides use the first master unless they say `master:none` or `master:<name>`. The app writes masters before the slides.

### `.section`

`.section {Name}` starts a section: the slides after it belong to it, until the next `.section`. A bare `.section` ends the current one.

### `.slide`

```gl
.project {Deck}
.slide {Motivation} id:3 master:Plain
```

| Parameter | Meaning |
|---|---|
| `{…}` | the slide's title (`\slidetitle`); default `Slide N` |
| `id` | its id |
| `master` | `none`, or the name of a master; default the first master |

Elements after a `.slide` line belong to that slide, in drawing order: later lines are drawn on top.

### `.notes`

Speaker notes: an indented block right after the `.slide` line.

```gl
.project {Deck}
.slide {Results} id:3
.notes
	Start with the headline number.
	Then reveal the plot.
.element.text id:4 x:100 y:80 width:1200 height:120
	Accuracy went from 71% to **93%**
```

### `.element.<type>`

An element of a slide or master: `.element.text`, `.element.shape`, `.element.figure`, `.element.path`, `.element.columns`, `.element.table`, `.element.group`. Its parameters are described below. An element of a type the app doesn't know is kept as it is: its parameters are written back unchanged.

### `.define` and `.macro.<name>`

A reusable component (a *macro*): `.define {name} width:W height:H` holds elements laid out in a W × H frame. Its elements have a `name` (unique within it) instead of an id.

```gl
.project {Deck}
.define {card} width:600 height:400
	.element.shape name:frame x:0 y:0 width:600 height:400 radius:24 bg:#e0f2fe
	.element.text name:title x:30 y:20 width:540 height:80 fontSize:40
		Title

.slide {Results} id:3
.macro.card id:20 x:100 y:100 width:600 height:400
.macro.card id:21 x:800 y:100 width:900 height:600
	::title
		Results
	::frame bg:#fee2e2
	.element.text x:10 y:10 width:200 height:40 fontSize:18
		Only on this instance
```

Definitions can be in the project file or in an imported library. Each instance, `.macro.<name>`, is drawn scaled to its own size, like a group. See [macro instance](#macro-instance) for overrides.

## Parameters every element has

These come first on an element's line, before the type's own parameters. Only `x`, `y`, `width` and `height` are always written.

| Parameter | Values | Meaning |
|---|---|---|
| `id` | number | unique id (none inside `.define`) |
| `name` | letters, digits, `-`, `_` | a name: used by macro overrides and by connectors (`{name}`) |
| `style` | a style's name | the named style it uses |
| `step` | 2, 3, … | builds: appears at this step of the slide (step 1, from the start, isn't written) |
| `until` | ≥ `step` | disappears after this step: shown at steps `step`…`until` |
| `locked` | `yes` | can't be moved or resized in the editor (no effect on the slides) |
| `rotate` | degrees | turned clockwise about its centre (the editor turns a path's points instead of setting this) |
| `x`, `y` | pixels | top-left corner (of the unturned box) |
| `width`, `height` | pixels | size |
| `bg` | colour | background |
| `borderCol` | colour | border colour |
| `borderWidth` | pixels | border width |
| `borderStyle` | `solid` / `dashed` / `dotted` / `none` | border style |

`bg` and the border parameters are not used by `path`, `group` and macro instances, which don't write them.

`step` and `until` count only for a slide's own elements: elements inside a group or a macro appear with it.

## Colours

A colour value is one of:

- `#rrggbb` (or `#rgb`);
- `@name`, a theme colour from `.palette`, which changes when the palette does;
- `transparent` or `none`;

optionally followed by `/NN`, the opacity in percent: `bg:@accent/40`, `fill:#000000/25`.

Text commands accept more: see [What goes in text](#what-goes-in-text).

## Element types

Values left out are inherited (see `.defaults`) or take the built-in value in the tables.

### text

A text box: Markdown, math, fields and text commands. The body is the text.

```gl
.project {Deck}
.slide {One} id:1
.element.text id:1 x:200 y:200 width:800 height:160 fontSize:42 fontFamily:sans-serif fontColor:#0f172a textAlign:center verticalAlign:center bg:transparent borderCol:transparent borderWidth:0 borderStyle:solid
	Welcome to **GluonSlides** with math: $x^2 + y^2 = r^2$
```

| Parameter | Values | Built-in | Meaning |
|---|---|---|---|
| `fontSize` | pixels | `32` (at 1920 wide) | font size |
| `fontFamily` | a font name (quoted if it has spaces), `sans-serif`, `serif`, `monospace` | `sans-serif` | font |
| `fontColor` | colour | `#0f172a` (`#f8fafc` in dark mode) | text colour |
| `textAlign` | `left` / `center` / `right` | `center` | horizontal alignment |
| `verticalAlign` | `top` / `center` / `bottom` | `center` | vertical alignment |
| `bg`, `borderCol`, `borderWidth`, `borderStyle` | | `transparent`, `transparent`, `0`, `solid` | box |

### shape

Rectangles, rounded rectangles, ellipses, circles and dots. No body.

```gl
.project {Deck}
.slide {One} id:1
.element.shape id:2 x:100 y:300 width:400 height:300 radius:24 bg:#e0f2fe borderCol:#0369a1 borderWidth:2
.element.shape id:3 x:600 y:300 width:300 height:300 kind:ellipse lockAspect:yes bg:@accent
```

| Parameter | Values | Built-in | Meaning |
|---|---|---|---|
| `kind` | `rect` / `ellipse` | `rect` | the shape |
| `radius` | pixels | `0` | corner radius (rectangles) |
| `lockAspect` | `yes` | | keeps its proportions when resized (circles, dots) |
| `bg` | colour | `#cbd5e1` | fill |
| `borderCol`, `borderWidth`, `borderStyle` | | `#475569`, `2`, `solid` | outline |

### figure

A picture: PNG, JPEG, GIF, WebP, SVG, or a PDF / EPS page. Stored by path only; the image itself is never written into the `.gl` file. No body.

```gl
.project {Deck}
.slide {One} id:1
.element.figure id:3 x:400 y:150 width:600 height:450 filePath:figures/plot.png originalPath:/home/me/analysis/plot.png sync:yes bg:transparent borderCol:transparent borderWidth:0
```

| Parameter | Values | Meaning |
|---|---|---|
| `filePath` | path | the project's copy (in `figures/`), relative to the project folder |
| `originalPath` | path | where it was imported from |
| `sync` | `yes` | the copy is refreshed when the original changes (a plot your script rewrites) |
| `bg`, `borderCol`, `borderWidth`, `borderStyle` | | box; the built-in look is a light placeholder with a dashed border, so write `bg:transparent borderWidth:0` for a plain picture |

The picture is fitted inside the box, keeping its proportions.

### path (lines, curves, polygons, connectors)

Lines, arrows, curves, polylines, freehand strokes, and closed shapes (polygons, blobs). The body has the points, one per line: `x y` (or `x,y`) as fractions (0 to 1) of the element's box. Resizing the box reshapes the path.

```gl
.project {Deck}
.slide {One} id:1
.element.path id:9 x:200 y:200 width:500 height:300 curve:smooth end:arrow stroke:#0f172a strokeWidth:4
	0 0.8
	0.3 0.1
	1 0.2
.element.path id:10 x:900 y:200 width:300 height:300 closed:yes fill:#93c5fd stroke:#1d4ed8 strokeWidth:3
	0.5 0
	1 1
	0 1
```

| Parameter | Values | Built-in | Meaning |
|---|---|---|---|
| `stroke` | colour | `#0f172a` | line colour |
| `strokeWidth` | pixels | `4` | line width |
| `dash` | `solid` / `dashed` / `dotted` | `solid` | line style |
| `curve` | `straight` / `smooth` / `bezier` | `straight` | `smooth`: a spline through every point; `bezier`: the points are a cubic Bézier: start, then control, control, end for each segment |
| `closed` | `yes` | | closes the path (polygon, closed curve) |
| `fill` | colour | none | fill of a closed path |
| `start`, `end` | `none` / `arrow` / `dot` | `none` | what each end has |
| `from`, `to` | `<id>@<side>` or `{<name>}@<side>` | | attached ends (connectors, below) |
| `route` | `straight` / `curved` / `elbow` | `straight` | how a connector goes between its ends |

**Connectors.** A path with `from` and/or `to` is attached to elements of the same slide (or the same group, master or macro definition), including elements inside groups. The end names the element by id (`12`) or, when it has a unique `name`, by `{name}` (`{Model}`). The side is `top`, `right`, `bottom`, `left`, `center`, or `auto`, the side facing the other end (also used when `@side` is left out). The points are recomputed from the elements whenever the slide is drawn, so in a hand-written file they can be anything (`0 0` and `1 1`). If an end's element is gone, the line stays where it was last drawn.

```gl
.project {Deck}
.slide {One} id:1
.element.shape id:12 x:100 y:400 width:300 height:200
.element.shape id:13 name:Model x:1200 y:200 width:300 height:200
.element.path id:14 from:12@right to:{Model}@left route:elbow end:arrow x:0 y:0 width:10 height:10
	0 0
	1 1
```

A curved route stores its points as `curve:bezier`.

### columns

Text in 2–4 columns. The body has one `.column` line per column, each followed by the column's text (Markdown, math and images, like a text box).

```gl
.project {Deck}
.slide {One} id:1
.element.columns id:12 x:100 y:200 width:1700 height:600 gap:40 divider:line
	.column width:60
	Left column, **Markdown** and $math$
	.column width:40 valign:center align:center
	Right column
```

| Parameter | Values | Built-in | Meaning |
|---|---|---|---|
| `gap` | pixels | `48` | space between columns |
| `divider` | `line` / `none` | `none` | a line between columns |
| `fontSize`, `fontFamily`, `fontColor` | | the project's text font | text |
| `bg`, `borderCol`, `borderWidth`, `borderStyle` | | transparent, none | box |

Each `.column` line takes:

| Parameter | Values | Default | Meaning |
|---|---|---|---|
| `width` | number | equal shares | relative width (60 and 40 split the space left by the gaps 60 % / 40 %) |
| `align` | `left` / `center` / `right` | `left` | horizontal alignment |
| `valign` | `top` / `center` / `bottom` | `top` | vertical alignment |

Text before the first `.column` line goes into the first column. A column's text line that itself starts with `.column` is written `\\.column`.

### table

The body has optional settings lines (`.data`, `.widths`, `.row`, `.col`, `.cell`), then the rows as Markdown-style lines `| a | b | c |`.

```gl
.project {Deck}
.slide {One} id:1
.element.table id:30 x:100 y:300 width:1200 height:400 header:yes borders:horizontal stripes:yes
	.data {data/results.csv} sync:yes original:"/home/me/run/results.csv"
	.widths 40,30,30
	.row 1 bold:yes bg:#eeeeee
	.col 3 align:right format:%.2e
	.cell 2,3 color:#cc0000
	| Method | Iterations | Error |
	| NGD | 120 | 0.00123 |
```

| Parameter | Values | Built-in | Meaning |
|---|---|---|---|
| `header` | `yes` / `no` | `yes` | the first row is a header |
| `borders` | `horizontal` / `all` / `none` | `horizontal` | rules: horizontal (as in papers), all cell borders, or none |
| `stripes` | `yes` / `no` | `no` | striped rows |
| `headerBg` | colour | transparent | header background |
| `ruleColor` | colour | the text colour | colour of the rules |
| `fontSize`, `fontFamily`, `fontColor` | | `28`, `sans-serif`, dark | text |
| `bg`, `borderCol`, `borderWidth`, `borderStyle` | | transparent, none | box |

Body lines:

| Line | Meaning |
|---|---|
| `.data {file} sync:yes original:"path" rows:N` | a linked CSV: `file` is the project's copy in `data/`, `original` the file it follows, `sync:no` stops following, `rows` how many rows of a big file are shown (default 20, header included) |
| `.widths 40,30,30` | relative column widths |
| `.row N …`, `.col N …`, `.cell R,C …` | the style of row N, column N, or the cell in row R, column C (counting from 1) |
| `\| a \| b \|` | a row of cells |

Style parameters: `bold:yes`, `italic:yes`, `color:<colour>`, `bg:<colour>`, `align:left|center|right`, and, for columns, `format`: `%.2f` (fixed), `%.3e` (scientific), `%.4g` (significant digits), `%d` (whole number), `%.1%` (percent). Formats apply only to cells that are numbers.

Cells hold Markdown and math. In a cell, `|` is written `\|` and a line break `<br>`. The cells are always written, also for a linked table, so the file is complete on its own.

### group

Elements grouped together. The body has the children, one level deeper, in the group's own frame: `frameWidth` × `frameHeight` drawn at `width` × `height`. Resizing the group scales everything in it; only the group's line changes.

```gl
.project {Deck}
.slide {One} id:1
.element.group id:10 x:200 y:100 width:800 height:400 frameWidth:400 frameHeight:200
	.element.text id:11 x:0 y:0 width:400 height:100 fontSize:32
		Text of the child (one more tab)
	.element.shape id:12 x:0 y:120 width:400 height:80
```

| Parameter | Meaning |
|---|---|
| `frameWidth`, `frameHeight` | the size of the frame the children are laid out in (here they are drawn at 2×) |

Children are `.element.*` or `.macro.*` lines; other directives aren't allowed inside a group.

### plot

A plot: **layers** drawn on shared axes, computed from formulas and data with the project's [variables](#vars). Moving a [slider](#slider) redraws it, on the canvas, while presenting and in an exported HTML. The body is kept exactly as written: a line per layer, `.kind key:value …`, followed by that layer's formula or rows.

```gl
.project {Deck}
.slide {Gauss} id:1
.element.slider id:41 x:100 y:900 width:600 height:70 var:mu min:-3 max:3 step:0.1 value:0 label:"$\mu$"
.element.slider id:42 x:800 y:900 width:600 height:70 var:sigma min:0.5 max:3 step:0.1 value:1 label:"$\sigma$"
.element.plot id:40 x:100 y:100 width:1200 height:700 lang:python xmin:-6 xmax:6 ymin:0 ymax:0.85 xlabel:"$x$"
	.hist samples:3000 bins:40 density:yes color:@muted label:"samples"
	y = normal(mu, sigma)
	.curve color:@primary width:4 label:"$\mathcal{N}(\mu,\sigma^2)$"
	s2 = sigma**2
	y = exp(-(x - mu)**2 / (2*s2)) / sqrt(2*pi*s2)
	.fill from:mu-sigma to:mu+sigma color:@primary opacity:0.2
	y = exp(-(x - mu)**2 / (2*sigma**2)) / sqrt(2*pi*sigma**2)
	.vline x:mu label:"μ"
	.curve color:@muted dash:dashed label:"standard" lang:latex
	\frac{1}{\sqrt{2\pi}} e^{-x^2/2}
```

| Parameter | Values | Built-in | Meaning |
|---|---|---|---|
| `lang` | `python` / `latex` / `matplotlib` | `python` | how the formulas are written (a layer can say its own); `matplotlib`: the body is a script (below) |
| `xmin`, `xmax`, `ymin`, `ymax` | numbers | from the layers | the ranges; one left out is found from the layers at the starting values, then kept while sliders move |
| `xscale`, `yscale` | `log` | linear | logarithmic axes (ticks at powers of 10) |
| `xticks`, `yticks` | `pi` | numbers | ticks at multiples of π (π/2, π, 3π/2…) |
| `aspect` | `equal` | | the same unit on x and y (a circle is round); the ranges grow to fit the box |
| `xlabel`, `ylabel` | text (Markdown and math) | | axis labels |
| `grid` | `yes` / `no` | `yes` | grid lines |
| `legend` | `yes` / `no` | `yes` | the legend of the layers that have a `label` |
| `samples` | number | `400` | points computed per curve (a layer can say its own) |
| `fontSize`, `fontFamily`, `fontColor` | | `28`, `sans-serif`, dark | tick labels, axis labels and legend; `fontColor` also draws the axes |

**Layers.** Every layer takes `color` (a colour, `@theme` too; else one of a set), `label` (Markdown and math, for the legend; on markers, plain text next to them), `lang`, and `hidden:yes` (kept but not drawn, also when presenting and exporting). Lines take `width` and `dash` (`dashed` / `dotted`); areas take `opacity`. Parameters marked *formula* may be a number or a formula of the variables (`x:mu`, `from:mu-sigma`).

| Layer | Its lines | Parameters |
|---|---|---|
| `.curve` | `y = …` in `x` (helper lines first) | `samples` |
| `.fill` | `y = …` the top, and optionally `y0 = …` the bottom (else 0) | `from`, `to` (*formula*; else the x range), `opacity` (0.3) |
| `.parametric` | `x = …` and `y = …` in `t` | `from`, `to` (*formula*; 0 and 2π), `samples` |
| `.vline`, `.hline` | none | `x` / `y` (*formula*), `label`; dashed unless `dash:solid` |
| `.point` | none | `x`, `y` (*formula*), `size` (7), `label` |
| `.text` | none | `x`, `y` (*formula*), `label` (the text), `align` (`left` / `center` / `right`), `size` |
| `.points` | rows `x, y` (or `x, y, err`), or `data:{file}` | `x`, `y`, `yerr`: columns by name or number (from 1); `size` (5). With one column, x is 1, 2, 3… |
| `.line` | as `.points` | `markers:yes` adds the points |
| `.hist` | one number per row, `data:{file}` with `column`, or a formula of samples | `bins` (30), `density:yes` (area 1; else counts), `from`, `to` (*formula*; else the x range), `samples` (draws of the formula; 1000), `seed` (1), `opacity` |
| `.bar` | rows `name, value` (names make a category axis) or `number, value` | `x`, `y` (columns), `barwidth` (0.8), `offset` (to put several sets side by side) |
| `.heatmap` | `z = …` in `x` and `y` | `colormap` (`viridis`, `magma`, `coolwarm`, `blues`, `gray`), `zmin`, `zmax` (else found once), `resolution` (120 cells across), `colorbar` (`yes` / `no`), `opacity` |
| `.contour` | `z = …` in `x` and `y` | `levels` (how many, 10) or `at:"0.5, 1, 2"` (which values, *formulas*), `colormap` (else `color`), `resolution` (100) |
| `.quiver` | `u = …` and `v = …` in `x` and `y` | `grid` (16 arrows across), `scale` (else the longest arrow fits a cell) |

Text before any layer line is a first `.curve` (comments there belong to the first layer). Rows are separated by commas, semicolons or tabs (or spaces); a first row of names only is a header, and `#` starts a comment.

**Data files**: `data:{data/run.csv}` reads a CSV of the project folder (the panel's *＋ Data file…* copies one into `data/` and writes `original:"…"`, so the copy follows the file your script rewrites, like a linked table). Columns are chosen by their header's name (`x:step y:loss`, quoted if they have spaces) or by number. A file with very many rows is drawn from 20 000 of them, evenly spread (5 000 in an exported HTML), the last one always kept.

**Histograms of a formula**: with `samples:N`, the formula is drawn N times: random functions give the samples (`y = normal(mu, sigma)`). The draws are seeded (`seed`), so moving a slider moves the same draws instead of making new noise; `i` is the draw's number (0 to N−1).

**`lang:python`**: Python's syntax: `+ - * / // % **`, comparisons, `and` `or` `not`, `a if c else b`, `#` comments, a line ending in an operator or inside brackets continuing on the next. Functions: `exp log log10 log2 sqrt abs sin cos tan asin acos atan atan2 sinh cosh tanh floor ceil round min max pow sign erf erfc gamma factorial clip where heaviside sinc hypot`, constants `pi e tau inf nan`. Random draws: `normal(mu, sigma)` (also `gauss`, `randn()`), `uniform(a, b)`, `rand()`, `exponential(scale)`, `lognormal`, `poisson(lam)`, `binomial(n, p)`, `randint(a, b)`. `math.`, `np.`, `numpy.`, `np.random.` and `random.` in front of a name are ignored, so formulas copied from a script work as they are.

**`lang:latex`**: the formula as you would typeset it: `\frac{a}{b}`, `\sqrt{…}` and `\sqrt[n]{…}`, `x^{2}`, `e^{…}` (the exponential), `\exp`, `\ln` and `\log` (natural), `\sin` and the other functions (with or without brackets: `\sin x`), `|x|`, `\left( … \right)`, `\cdot`, `\times`, products without a sign (`2\pi\sigma^2`), Greek letters (`\mu` is the variable `mu`), subscripts as part of a name (`x_0`, `\sigma_{1}`), `\pi`, `\infty`. Lines (or `\\`) can be `y = …` or `\sigma_2 = …` helpers; `f(x) = …` is the curve.

Formulas are read by the app's own small parser: they can compute numbers and nothing else, so a shared file or an exported presentation can't run code. A mistake (an unknown name, a missing column, a bracket) is written on the plot in red, with the layer and line.

#### Plots written with matplotlib

With `lang:matplotlib` the body is a script in matplotlib and numpy, as you would write it in Python, using the project's variables by name. GluonSlides reads it itself (it is not run as Python), turns each call into the layers above, and reads it again whenever a slider moves, also in the exported HTML.

```gl
.project {Deck}
.slide {Gauss} id:1
.element.slider id:41 x:100 y:960 width:600 height:70 var:mu min:-3 max:3 step:0.1 value:0 label:"$\mu$"
.element.plot id:40 x:100 y:60 width:1400 height:880 lang:matplotlib
	import numpy as np
	import matplotlib.pyplot as plt

	x = np.linspace(-5, 5, 400)
	fig, ax = plt.subplots()
	ax.hist(np.random.normal(mu, 1, 2000), bins=40, density=True, alpha=0.4, label='samples')
	ax.plot(x, np.exp(-(x - mu)**2 / 2) / np.sqrt(2*np.pi), 'C0', lw=2, label=r'$\mathcal{N}(\mu, 1)$')
	ax.axvline(mu, ls='--', color='k')
	for k in range(3):
	    ax.plot(x, 0.1 * np.sin(x + k), label=f'k = {k}')
	ax.set_xlabel('$x$')
	ax.set_title(f'$\\mu = {mu:.1f}$')
	ax.legend()
```

What it reads:

- **Python**: assignments (also `a, b = …` and `+=`), `for` and `if` / `elif` / `else` blocks, list comprehensions, f-strings, texts, lists and tuples, keyword arguments, `import numpy as np` / `import matplotlib.pyplot as plt` (other modules are refused). No `def`, `while` or dictionaries.
- **numpy**: arrays with element-wise arithmetic and comparisons (masks: `x[x > 0]`), slicing (`X[::5, ::5]`), `linspace`, `arange`, `meshgrid`, `zeros` / `ones` / `full`, the math functions (`exp`, `sin`, `sqrt`, `log`…), `sum`, `mean`, `std`, `min`, `max`, `cumsum`, `diff`, `clip`, `where`, `interp`, `trapz`, `polyval`…, and `np.random`: `normal`, `uniform`, `rand`, `randn`, `exponential`, `poisson`, `binomial`, `randint`, `seed`. The draws are seeded: the same every time, so a slider moves them smoothly.
- **matplotlib** (`plt.…` or the axes of `fig, ax = plt.subplots()`): `plot` (with format strings like `'r--'` and `'o'`), `scatter`, `errorbar`, `fill_between` (also `where=`), `hist`, `bar`, `axvline`, `axhline`, `text`, `imshow`, `pcolormesh`, `contourf`, `contour`, `quiver`, `colorbar`; `xlim`, `ylim`, `xlabel`, `ylabel`, `title`, `xscale` / `yscale` (and `loglog`, `semilogy`), `legend`, `grid`, `axis('off')`, `axis('equal')`, `set_aspect`, and the `set_…` names of the axes. Colours: `'C0'`…`'C9'` (matplotlib's cycle, also used when none is given), `'r'`, `'k'`…, `'tab:blue'`, CSS names, `'#hex'`, `(r, g, b)`; `alpha`, `lw`, `ls`, `marker`, `ms`, `label`, `cmap` (viridis, magma, coolwarm, Blues, gray… shown with the nearest of the app's maps).
- As in matplotlib, there is a legend only when the script calls `legend()`, and no grid unless it calls `grid()`. One plot per element: `plt.subplots(2, 1)` is refused (put two plots on the slide).

Anything else (`twinx`, annotations with arrows, styles…) is written on the plot with its line, as are mistakes. In the panel, *Written as: a matplotlib script* shows the script in an editor (colours, suggestions after `np.`, `np.random.` and `plt.`, the line of a mistake marked) instead of the layer cards.

### slider

A slider that sets a variable. Plots that use it are redrawn and values in text that show it (`\var{mu}`, also inside `$…$`) change as it moves, while presenting, in the presenter view (the audience's screen follows) and in an exported HTML. In the PDF export everything is at the starting values.

```gl
.project {Deck}
.slide {One} id:1
.element.slider id:41 x:100 y:900 width:600 height:70 var:mu min:-3 max:3 step:0.1 value:0 label:"$\mu$" format:%.1f
```

| Parameter | Values | Built-in | Meaning |
|---|---|---|---|
| `var` | a name | | the variable it sets |
| `min`, `max`, `step` | numbers | `0`, `1`, `0.01` | the range and its steps |
| `value` | number | `min` | where it starts (moving it doesn't change the file) |
| `label` | text (Markdown and math) | | shown before it |
| `format` | `%.2f`, `%.3e`, `%d`, `%.1%`… | a short number | how the value after it is shown |
| `showValue` | `yes` / `no` | `yes` | show the value after it |
| `accent` | colour | blue | the slider's colour |
| `fontSize`, `fontFamily`, `fontColor` | | | its label and value |

### macro instance

`.macro.<name>` places an instance of the definition `<name>` (see [`.define`](#define-and-macroname)), scaled to `width` × `height`. Its body has, in this order:

1. **Overrides**, one per element of the definition, addressed by name: `::name key:value …`, optionally followed by an indented body that replaces that element's text (or points). `::name hidden:yes` hides it on this instance.
2. **Extra elements** that only this instance has: ordinary `.element.*` lines (in the definition's frame).

```gl
.project {Deck}
.define {card} width:600 height:400
	.element.shape name:frame x:0 y:0 width:600 height:400 bg:#e0f2fe
	.element.text name:title x:30 y:20 width:540 height:80 fontSize:40
		Title
	.element.text name:badge x:450 y:20 width:120 height:50 fontSize:20
		New

.slide {Results} id:3
.macro.card id:21 x:800 y:100 width:900 height:600
	::title
		Results
	::frame bg:#fee2e2
	::badge hidden:yes
```

An override of a name the definition no longer has is shown as a warning in the editor, and a missing definition as a placeholder; neither is an error.

## What goes in text

The body of a text box, a column or a table cell:

- **Markdown**: `**bold**`, `*italic*`, lists, headings (`#`), links, `![](figures/plot.png)` images.
- **Math** with KaTeX: `$…$` inline, `$$…$$` displayed (centred unless the project says `equations:text`). Macros from `macros.tex` work.
- **Text commands**: `\textcolor{colour}{…}`, `\highlight{colour}{…}`, `\colorbox{colour}{…}`, `\textbf{…}`, `\textit{…}`, `\emph{…}`, `\underline{…}`, `\texttt{…}`. Colours here may also be CSS / xcolor names (`red`, `ForestGreen`), theme colours (`@accent`) and xcolor mixes (`red!60`, `red!50!blue`). Macros from `macros.tex` whose definition uses these commands work in text too.
- **Fields**, replaced on each slide: `\slidenumber`, `\totalslides`, `\slidetitle`, `\sectiontitle`, `\presentationtitle`, `\author`, `\date`, `\tableofcontents`.
- **Variables**: `\var{name}`, or `\var{name}[%.2f]` with a format (`%.2f`, `%.3e`, `%.4g`, `%d`, `%.1%`), shows a [variable](#vars)'s value, in text and inside math; one moved by a slider changes in place while presenting. An unknown name shows as `[? name]`.
- **Citations**: `\cite{key}`, `\citep`, `\citet`, `\parencite`, `\textcite`, `\fullcite`, `\cite[p.~5]{key}`, and `\printbibliography` (optionally `[9-]`, `[1-8]`, `[5]`), from `bibliography.bib`.
- HTML, such as `<span style="color:red">…</span>`.

The file keeps all of these as you wrote them: they are only resolved when drawing and exporting.

## Writing `.gl` files from a script

A script can produce a whole talk (one slide per experiment, a table per results file) and the app opens it like any other project. Some tips:

- **The minimum** is a `.project` line and one `.slide`. Every element needs `x`, `y`, `width` and `height`; everything else can be left out, and then follows the project's `.defaults` (or the built-in look). Writing less makes the file easier to restyle later.
- **Ids**: give each slide and element a unique positive number and set `nextid` above the largest. If you leave ids out (or repeat one), the app numbers them when it opens the file; it writes them on the next save. Connectors need ids or unique `name`s to point at.
- **Figures**: put the pictures in the project's `figures/` folder and use `filePath:figures/name.png`. Add `originalPath:/path/to/plot.png sync:yes` to have the copy follow the original, and `bg:transparent borderWidth:0` for a plain picture.
- **Tables from results**: write the rows as `| … |` lines, or link a CSV with `.data {data/results.csv} sync:yes original:"/path/results.csv"` (copy the file into `data/` too).
- **Text**: indent each line of a body with one tab. Escape a line that starts with `.` as `\.`.
- **Builds**: `step:2` on an element shows it on the first click.
- **Look**: put fonts, sizes and colours in `.defaults` and `.style` lines and theme colours in `.palette`, rather than on each element.
- The app rewrites the file in its own order the first time it saves (fixed parameter order, tabs, ids). Comments are not kept.
