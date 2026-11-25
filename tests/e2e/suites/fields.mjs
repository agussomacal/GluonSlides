// Automatic fields (\slidenumber, \totalslides, \slidetitle, \sectiontitle,
// \presentationtitle, \author, \date, \tableofcontents) and sections:
// values per slide on the canvas, thumbnails and exports; continuation
// pages counted; the .section directive; the sidebar headers; the Fields ▾
// menu; Project settings → Presentation; "\" autocomplete.
import { launchBrowser, BASE_URL } from '../helpers.mjs';

const browser = await launchBrowser();
const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
const errors = [];
page.on('pageerror', e => errors.push(e.message));
const out = [];
const check = (n, c, x = '') => out.push(`${c ? 'PASS' : 'FAIL'} ${n}${x !== '' ? ' — ' + x : ''}`);
const app = (fn, arg) => page.evaluate(fn, arg);
const text = (id) => page.$eval(`#slide-canvas [data-element-id="${id}"]`, n => n.textContent.replace(/\s+/g, ' ').trim());

const GL = String.raw`.project {Field Trip} version:2 width:1920 height:1080 grid:20 darkmode:no citestyle:numeric nextid:30 author:"Ada Lovelace" date:2026-03-14
.slide {Title} id:1
.element.text id:2 x:100 y:100 width:1700 height:300
	# \presentationtitle
	\author — \date

.section {Introduction}

.slide {Motivation} id:3
.element.text id:4 x:100 y:900 width:1700 height:80
	\sectiontitle · \slidetitle · \slidenumber / \totalslides

.slide {Outline} id:5
.element.text id:6 x:100 y:100 width:1700 height:600
	\tableofcontents

.section {Results}

.slide {Accuracy} id:7
.element.text id:8 x:100 y:900 width:1700 height:80
	\sectiontitle · \slidenumber / \totalslides

.section

.slide {Backup} id:9
`;

await page.goto(`${BASE_URL}/index.html`);
await app(async (gl) => {
    await (await import('/ui/project.js')).openSampleProject(); // opens the editor
    const s = await import('/core/state.js');
    s.applyProjectData(s.parseProjectContent(gl));
    s.state.projectName = 'Field Trip';
    (await import('/editor/editor.js')).selectSlide(0);
}, GL);
await page.waitForTimeout(200);

// ---------- Values ----------
check('title page: \\presentationtitle, \\author, \\date', (await text(2)) === `Field Trip Ada Lovelace — ${await app(() => new Date('2026-03-14T12:00:00').toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' }))}`, await text(2));
await app(async () => (await import('/editor/editor.js')).selectSlide(1));
check('footer: section, slide title, number / total', (await text(4)) === 'Introduction · Motivation · 2 / 5', await text(4));
await app(async () => (await import('/editor/editor.js')).selectSlide(2));
const toc = await page.$$eval('#slide-canvas [data-element-id="6"] li', ls => ls.map(l => [l.textContent.trim(), Boolean(l.querySelector('strong'))]));
check('table of contents: sections in order, current one bold', JSON.stringify(toc) === '[["Introduction",true],["Results",false]]', JSON.stringify(toc));
const thumbs = await page.$$eval('#slides-thumb-list .thumb-container', cs => cs.map(c => c.textContent.replace(/\s+/g, ' ')));
check('thumbnails show each slide\'s own values', thumbs[3].includes('Results · 4 / 5') && thumbs[1].includes('Motivation · 2 / 5'), thumbs[3]);

// ---------- File format ----------
const saved = await app(async () => (await import('/core/state.js')).serializeProject());
check('.gl keeps the commands', saved.includes('\t\\sectiontitle · \\slidetitle · \\slidenumber / \\totalslides'));
check('.gl: author and date in the header', saved.includes('author:"Ada Lovelace" date:2026-03-14'), saved.split('\n').find(l => l.startsWith('.project')));
check('.gl: .section before each section, bare .section to end one',
    /\.section \{Introduction\}\n\n\.slide \{Motivation\}/.test(saved) && /\.section \{Results\}\n\n\.slide \{Accuracy\}/.test(saved) && /\n\.section\n\n\.slide \{Backup\}/.test(saved)
    && (saved.match(/\.section/g) || []).length === 3);
const again = await app(async (txt) => {
    const s = await import('/core/state.js');
    const p = s.parseProjectContent(txt);
    return p.slides.map(x => x.section || '-').join(',');
}, saved);
check('.gl: sections read back', again === '-,Introduction,Introduction,Results,-', again);

// ---------- Sidebar ----------
const headers = await page.$$eval('#slides-thumb-list .thumb-section', hs => hs.map(h => `${h.querySelector('.thumb-section-name').textContent}:${h.querySelector('.thumb-section-count').textContent}`));
check('sidebar: a header per section with its slide count', JSON.stringify(headers) === '["Introduction:2","Results:1"]', JSON.stringify(headers));
await page.click('#slides-thumb-list .thumb-section[data-section="Introduction"]');
await page.waitForTimeout(100);
await app(async () => (await import('/editor/editor.js')).selectSlide(3));
const visible = await page.$$eval('#slides-thumb-list .thumb-container', cs => cs.map(c => getComputedStyle(c).display !== 'none'));
check('sidebar: clicking a header folds its slides', JSON.stringify(visible) === '[true,false,false,true,true]', JSON.stringify(visible));
await page.click('#slides-thumb-list .thumb-section[data-section="Introduction"]');

// ---------- Section field (nothing selected) ----------
await app(async () => (await import('/editor/editor.js')).selectSlide(2));
check('Section field shows the slide\'s section', await page.inputValue('#slide-section') === 'Introduction');
await page.fill('#slide-section', 'Plan');
await page.waitForTimeout(600);
let sections = await app(async () => (await import('/core/state.js')).state.slides.map(s => s.section || '-').join(','));
check('a new name here starts a section from this slide on', sections === '-,Introduction,Plan,Results,-', sections);
await app(async () => (await import('/editor/editor.js')).selectSlide(1));
await page.fill('#slide-section', 'Intro');
await page.waitForTimeout(600);
sections = await app(async () => (await import('/core/state.js')).state.slides.map(s => s.section || '-').join(','));
check('renaming on the first slide renames the run (not the next section)', sections === '-,Intro,Plan,Results,-', sections);
check('footer follows the renamed section', (await text(4)).startsWith('Intro · Motivation'), await text(4));
await app(async () => (await import('/editor/editor.js')).selectSlide(3));
await app(async () => (await import('/editor/editor.js')).addSlide());
sections = await app(async () => (await import('/core/state.js')).state.slides.map(s => s.section || '-').join(','));
check('a new slide continues the last section', sections.endsWith(',-'), sections);
await app(async () => {
    const { state } = await import('/core/state.js');
    state.slides.pop();
    (await import('/editor/editor.js')).selectSlide(3);
});

// ---------- Numbering counts continuation pages of long reference lists ----------
await app(async () => {
    const { state } = await import('/core/state.js');
    const { setBibSource } = await import('/core/citations.js');
    let bib = '';
    const keys = [];
    for (let i = 1; i <= 15; i++) { bib += `@article{k${i}, author={A${i}, B}, title={Title ${i} of some length}, journal={J}, year=2001}\n`; keys.push(`k${i}`); }
    state.slides[1].elements.push({ type: 'text', id: 20, x: 100, y: 100, width: 1700, height: 100, content: `\\cite{${keys.join(',')}}` });
    state.slides.splice(3, 0, { id: 21, title: 'References', section: 'Plan', elements: [
        { type: 'text', id: 22, x: 100, y: 100, width: 1700, height: 400, fontSize: 32, textAlign: 'left', verticalAlign: 'top', content: '\\printbibliography' },
        { type: 'text', id: 23, x: 100, y: 900, width: 1700, height: 80, content: '\\slidenumber / \\totalslides' },
    ] });
    setBibSource(bib);
    (await import('/editor/editor.js')).selectSlide(4);
});
await page.waitForTimeout(150);
check('a continuation page counts: slide after the references is 6 / 7', (await text(8)).endsWith('6 / 7'), await text(8));
const html = await app(async () => (await import('/export/html.js')).getExportHtmlString());
const ev = await browser.newPage();
await ev.setContent(html);
const numbers = await ev.$$eval('.slide-wrapper > .slide', ss => ss.map(s => (s.textContent.match(/(\d+) \/ (\d+)/) || [])[0] || '-'));
check('export: every page its own number, continuation included', JSON.stringify(numbers) === '["-","2 / 7","-","4 / 7","5 / 7","6 / 7","-"]', JSON.stringify(numbers));
await ev.close();

// ---------- Fields ▾ menu ----------
check('Text Box stays a one-click button', await page.isVisible('.editor-toolbar > [data-type="text"]'));
await page.click('[data-category="fields"] > .toolbar-btn');
const entries = await page.$$eval('[data-category="fields"] .toolbar-menu [data-variant]', ns => ns.map(n => n.dataset.variant));
check('Fields ▾ lists the fields', entries.join(',') === 'slidenumber,footer,slidetitle,sectiontitle,titlepage,toc', entries.join(','));
await page.click('[data-category="fields"] .toolbar-menu [data-variant="slidenumber"]');
await page.waitForTimeout(150);
const added = await app(async () => {
    const { state } = await import('/core/state.js');
    const els = state.slides[state.currentSlideIndex].elements;
    return els[els.length - 1];
});
check('Slide number: a text box at the bottom right with \\slidenumber', added.content === '\\slidenumber' && added.x > 1500 && added.y > 900, JSON.stringify(added));
check('…showing the number', (await text(added.id)) === '6', await text(added.id));

// ---------- Project settings → Presentation ----------
await page.click('[data-action="open-project-settings"]');
await page.click('[data-tab="presentation"]');
await page.fill('#project-author', 'Grace Hopper');
await page.click('[data-settings-action="date-today"]');
await page.click('[data-settings-action="close"]');
await app(async () => (await import('/editor/editor.js')).selectSlide(0));
const today = await app(() => new Date().toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' }));
check('author and date from Project settings', (await text(2)) === `Field Trip Grace Hopper — ${today}`, await text(2));
check('date:today saved as "today"', (await app(async () => (await import('/core/state.js')).serializeProject())).includes('author:"Grace Hopper" date:today'));

// ---------- "\" autocomplete on the canvas ----------
await page.dblclick('#slide-canvas [data-element-id="2"]');
await page.keyboard.press('Control+End');
await page.keyboard.type(' \\sl');
await page.waitForTimeout(100);
let menu = await page.$$eval('.cite-menu-key', ns => ns.map(n => n.textContent));
check('canvas: "\\sl" suggests \\slidenumber and \\slidetitle', JSON.stringify(menu) === '["\\\\slidenumber","\\\\slidetitle"]', JSON.stringify(menu));
await page.keyboard.press('ArrowDown');
await page.keyboard.press('Enter');
let content = await app(async () => (await import('/core/state.js')).state.slides[0].elements[0].content);
check('canvas: Enter inserts the command', content.endsWith(' \\slidetitle'), JSON.stringify(content));
await page.keyboard.type(' \\cit');
await page.waitForTimeout(100);
await page.keyboard.press('Enter'); // \cite{ → the key list opens
await page.waitForTimeout(100);
menu = await page.$$eval('.cite-menu-key', ns => ns.map(n => n.textContent));
check('canvas: choosing \\cite opens the key list', menu.includes('k1'), JSON.stringify(menu));
await page.keyboard.press('Escape');
await page.keyboard.type(' $\\alpha$');
await page.waitForTimeout(100);
check('canvas: LaTeX commands that are not fields close the list', !(await page.$('.cite-menu')));
await page.keyboard.press('Escape');

// ---------- "\" autocomplete in the inspector ----------
await app(async () => (await import('/editor/inspector/index.js')).openGlInspector());
await page.waitForTimeout(300);
await app(() => {
    const cm = document.querySelector('.CodeMirror').CodeMirror;
    const line = cm.getValue().split('\n').findIndex(l => l.startsWith('\t\\tableofcontents'));
    cm.focus();
    cm.setCursor({ line, ch: cm.getLine(line).length });
});
await page.keyboard.type(' \\tot');
await page.waitForTimeout(200);
const hints = await page.$$eval('.CodeMirror-hint', ns => ns.map(n => n.textContent));
check('inspector: "\\tot" suggests \\totalslides', hints.length === 1 && hints[0].startsWith('\\totalslides'), hints.join(' | '));
await page.keyboard.press('Enter');
const line = await app(() => { const cm = document.querySelector('.CodeMirror').CodeMirror; return cm.getLine(cm.getCursor().line); });
check('inspector: Enter inserts it', line.endsWith('\\tableofcontents \\totalslides'), line);

console.log(out.join('\n'));
console.log('--- errors ---\n' + (errors.join('\n') || '(none)'));
await browser.close();
