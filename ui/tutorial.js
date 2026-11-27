// ============================================================
// ui/tutorial.js — The tutorial presentation (Help → Tutorial
// presentation, or 🎓 on the start screen): a project of a few slides
// that teaches by doing — each slide says what to try on itself. It is
// written in the .gl format, so it is also an example of it (Ctrl+E
// shows it). It opens in a tab of its own and is not saved anywhere.
// ============================================================

export const TUTORIAL_GL = String.raw`# GluonSlides tutorial
.project {GluonSlides tutorial} version:2 width:1920 height:1080 grid:20 nextid:200
.style.text {title} fontSize:64 fontColor:@primary textAlign:left verticalAlign:center
.style.text {hint} fontSize:30 fontColor:@muted textAlign:left verticalAlign:top

.master {Tutorial} id:1
.element.shape id:2 x:0 y:1040 width:1920 height:40 bg:@light
.element.text id:3 x:1500 y:1040 width:380 height:40 fontSize:22 fontColor:@muted textAlign:right verticalAlign:center
	\slidenumber / \totalslides
.element.text id:4 x:40 y:1040 width:1000 height:40 fontSize:22 fontColor:@muted textAlign:left verticalAlign:center
	\presentationtitle · \slidetitle

.slide {Welcome} id:10 master:none
.element.text id:11 x:160 y:300 width:1600 height:160 fontSize:96 fontColor:@primary textAlign:center verticalAlign:center
	Welcome to **GluonSlides**
.element.text id:12 x:260 y:500 width:1400 height:260 fontSize:36 fontColor:@dark textAlign:center verticalAlign:top
	Each slide of this tutorial says what to try, on the slide itself.
	Change anything: this presentation is not saved.

	Next slide: **↓**, or click it in the list on the left.

.slide {Text} id:20
.element.text id:21 style:title x:100 y:60 width:1700 height:120
	Text: Markdown, math and LaTeX
.element.text id:22 x:100 y:220 width:1100 height:560 fontSize:36 textAlign:left verticalAlign:top bg:@light
	**Double-click this text** to write in it. Click outside (or Esc) when done.

	- Markdown: **bold**, *italic*, lists
	- Math: $e^{i\pi} + 1 = 0$ and $$\int_0^1 x^2\,dx = \tfrac13$$
	- LaTeX commands: \textcolor{@accent}{coloured}, \highlight{yellow}{marked}, \underline{underlined}
.element.text id:23 style:hint x:1260 y:220 width:560 height:600
	While writing, **double-click a word** (or select some): a small bar offers bold, italic, colours and highlights.

	Typing \ suggests commands; your own macros go in *Edit LaTeX Macros…* (bottom left).

.slide {Objects} id:30
.element.text id:31 style:title x:100 y:60 width:1700 height:120
	Shapes, lines and connectors
.element.group id:37 x:200 y:380 width:360 height:200 frameWidth:360 frameHeight:200
	.element.shape id:32 name:Data x:0 y:0 width:360 height:200 bg:#dbeafe borderCol:@primary borderWidth:3 radius:20
	.element.text id:33 x:0 y:0 width:360 height:200 fontSize:40 textAlign:center verticalAlign:center
		Data
.element.group id:38 x:1000 y:300 width:380 height:240 frameWidth:380 frameHeight:240
	.element.shape id:34 name:Model kind:ellipse x:0 y:0 width:380 height:240 bg:#fef3c7 borderCol:@accent borderWidth:3
	.element.text id:39 x:0 y:0 width:380 height:240 fontSize:40 textAlign:center verticalAlign:center
		Model
.element.path id:35 from:{Data}@right to:{Model}@left route:curved end:arrow stroke:@dark strokeWidth:5 x:560 y:420 width:440 height:60
	0 1
	1 0
.element.text id:36 style:hint x:200 y:680 width:1500 height:300
	**Drag the shapes**: the arrow follows them. The round handle above a selected object turns it.
	Draw lines and arrows from **Lines & curves**: start or end one on a shape and it attaches.
	Select several (drag a box around them), then **Ctrl+G** groups them; the panel on the right aligns them.

.slide {Builds} id:40
.notes
	Speaker notes go here: with nothing selected, the panel on the right shows them.
	The presenter view (🗒 in the toolbar) shows them with the next slide and a timer.
.element.text id:41 style:title x:100 y:60 width:1700 height:120
	Builds: one thing at a time
.element.text id:42 x:100 y:240 width:1100 height:90 fontSize:40 textAlign:left
	First this,
.element.text id:43 step:2 x:100 y:340 width:1100 height:90 fontSize:40 textAlign:left
	then this, on the first click,
.element.text id:44 step:3 x:100 y:440 width:1100 height:90 fontSize:40 textAlign:left fontColor:@primary
	and this on the second.
.element.text id:45 step:2 until:2 x:1300 y:300 width:500 height:200 fontSize:36 textAlign:center verticalAlign:center bg:#fee2e2
	Only at step 2
.element.text id:46 style:hint x:100 y:640 width:1700 height:360
	Select a text: **Appears at step** in the panel sets its click; **Disappears after step** removes it again (the red box).
	**Steps** in the toolbar shows the slide at one step. Press **▶ Present** (top right) and click through; Esc comes back.

.slide {Columns and tables} id:50
.element.text id:51 style:title x:100 y:60 width:1700 height:120
	Columns and tables
.element.columns id:52 x:100 y:220 width:1720 height:300 fontSize:32 gap:60 divider:line
	.column width:50
	Text in **columns**: double-click one to edit it, **Tab** goes to the next. Drag the divider to change the widths.
	.column width:50
	They come from the **▾** next to **Text** in the toolbar, with tables (drawn, from a CSV file, or pasted from a spreadsheet).
.element.table id:53 x:100 y:580 width:1100 height:300 fontSize:30 header:yes borders:horizontal stripes:yes
	| Method | Steps | Error |
	| Gradient | 120 | 0.012 |
	| Natural gradient | 35 | 0.004 |
.element.text id:54 style:hint x:1260 y:580 width:560 height:400
	Click a cell, then style its row or column in the panel. Double-click to edit. A CSV dropped on the window becomes a table that follows the file.

.slide {Pictures} id:60
.element.text id:61 style:title x:100 y:60 width:1700 height:120
	Pictures
.element.figure id:62 x:100 y:220 width:900 height:600 borderCol:@muted borderWidth:2 borderStyle:dashed
.element.text id:63 style:hint x:1080 y:220 width:740 height:700
	**Drop an image** (or a PDF figure) from your files onto the dashed box, or click it to choose one.

	A screenshot? **Ctrl+V** pastes it as a picture.

	Pictures are copied into the project's figures/ folder and follow the original file: rerun the script that made a plot and the slide updates.

	A picture of an equation: right-click → *Convert to LaTeX*.

.slide {Every slide} id:70
.element.text id:71 style:title x:100 y:60 width:1700 height:120
	Master slides and fields
.element.text id:72 x:100 y:240 width:1700 height:560 fontSize:34 textAlign:left verticalAlign:top
	The bar at the bottom, with the slide number, is on a **master slide**: every slide shows it. With nothing selected, the panel on the right has **Master slide → ✎ Edit**.

	The number is a **field**: a command replaced by its value, here \slidenumber of \totalslides. Others give the slide's title, its section, the presentation's title, the author, the date, a table of contents. **Fields** in the toolbar adds them where they usually go; typing \ in a text lists them.

	The slides here are grouped in a **section**: see the slide's panel.

.section {The file underneath}

.slide {The .gl file} id:80
.element.text id:81 style:title x:100 y:60 width:1700 height:120
	Everything is text: the .gl file
.element.text id:82 x:100 y:240 width:1700 height:440 fontSize:34 textAlign:left verticalAlign:top
	A project is one readable text file, saved as you work. Press **Ctrl+E** (or right-click an object → *Go to Gluon file*) to see it next to the slide: change a number there and the slide follows; move the object and the text follows.

	It works well with git, can be written by a script, and is described in Help → *Gluon format reference*.
.element.text id:83 x:100 y:720 width:1700 height:200 fontSize:28 fontFamily:monospace textAlign:left verticalAlign:top bg:@light
	.element.text id:22 x:100 y:220 width:1100 height:560 fontSize:36
	&nbsp;&nbsp;&nbsp;&nbsp;\*\*Double-click this text\*\* to write in it.

.slide {Next steps} id:90
.element.text id:91 style:title x:100 y:60 width:1700 height:120
	What next
.element.text id:92 x:100 y:240 width:1700 height:700 fontSize:34 textAlign:left verticalAlign:top
	- **Start a project**: Back to Home (bottom left) → *Create New Project*.
	- **Bring a talk you have**: *Import Talk* takes Beamer, Slidev, PowerPoint and PDF, best with the compiled PDF next to it.
	- **Share it**: HTML and PDF export, bottom left.
	- **Make it yours**: *Project settings* for fonts, theme colours and styles.
	- **Help (?)**, top right: the quick tour again, and the keyboard shortcuts (Ctrl+/), which you can change.
`;
