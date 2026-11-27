// Columns element: adding it, the .gl format (.column lines, escaping),
// editing one column on the canvas (double-click, Tab, Esc, click
// outside), dragging a divider, presets and column count, Markdown images
// from the project, export, and the project's text font.
import { launchBrowser, BASE_URL } from '../helpers.mjs';

const browser = await launchBrowser();
const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
const errors = [];
page.on('pageerror', e => errors.push(e.message));
const out = [];
const check = (n, c, x = '') => out.push(`${c ? 'PASS' : 'FAIL'} ${n}${x !== '' ? ' — ' + x : ''}`);
const app = (fn, arg) => page.evaluate(fn, arg);

await page.addInitScript(() => {
    const red = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAIAAAABCAYAAAD0In+KAAAAEUlEQVR42mP8z8DwnwEJMAIAKjYD/0QNRfwAAAAASUVORK5CYII=';
    window.__loads = [];
    const ok = (o = {}) => Promise.resolve({ success: true, ...o });
    window.pywebview = { api: {
        load_figure_data_uri: (folder, path) => { window.__loads.push(path); return ok({ data_uri: red }); },
        get_recent_projects: () => ok({ projects: [] }), get_inspector_settings: () => ok({ settings: null }),
        save_inspector_settings: () => ok(), list_project_fonts: () => ok({ fonts: [] }), list_system_fonts: () => ok({ families: [] }),
        save_project_data: () => ok(), save_text_file: () => ok(), load_text_file: () => Promise.resolve({ success: false }),
    } };
});
await page.goto(`${BASE_URL}/index.html`);
await app(async () => {
    await (await import('/ui/project.js')).openSampleProject();
    const { state } = await import('/core/state.js');
    state.projectFolder = '/home/me/talk';
    state.slides = [{ id: 1, title: 'One', elements: [] }];
    state.masters = [];
    state.gridSize = 0;
    state.nextId = 10;
    (await import('/editor/editor.js')).selectSlide(0);
});
const el = () => app(async () => JSON.parse(JSON.stringify((await import('/core/state.js')).state.slides[0].elements[0])));
const colTexts = () => app(() => [...document.querySelectorAll('#slide-canvas .gl-column-text')].map(n => n.textContent.trim()));

// ---------- Adding ----------
await page.click('[data-category="text"] .toolbar-split-caret');
await page.click('[data-category="text"] .toolbar-menu [data-variant="wide-left"]');
let e = await el();
check('added from the Columns menu: 60/40', e.type === 'columns' && e.columns.map(c => c.width).join(',') === '60,40', JSON.stringify(e.columns));
check('drawn as two columns', JSON.stringify(await colTexts()) === '["Left column","Right column"]');
const widths = await app(() => [...document.querySelectorAll('#slide-canvas .gl-column')].map(n => n.getBoundingClientRect().width));
check('…60% / 40% of the space', Math.abs(widths[0] / widths[1] - 1.5) < 0.05, JSON.stringify(widths));

// ---------- Editing a column ----------
const colBox = async (i) => app((i) => { const r = document.querySelectorAll('#slide-canvas .gl-column')[i].getBoundingClientRect(); return [r.x + r.width / 2, r.y + r.height / 2]; }, i);
let [cx, cy] = await colBox(1);
await page.mouse.dblclick(cx, cy);
check('double-click edits that column only', await app(() => document.querySelectorAll('#slide-canvas .gl-column-editing').length === 1
    && document.querySelector('#slide-canvas .gl-column-editing').dataset.column === '1'));
await page.keyboard.press('Control+a');
await page.keyboard.type('Right **bold** and $x^2$');
await page.keyboard.press('Tab');
check('Tab goes to the next column (wraps to the first)', await app(() => document.querySelector('#slide-canvas .gl-column-editing')?.dataset.column) === '0');
await page.keyboard.press('Control+a');
await page.keyboard.type('Left text');
await page.keyboard.press('Escape');
await page.waitForTimeout(300);
e = await el();
check('Esc saves; both columns kept their text', e.columns[0].content === 'Left text' && e.columns[1].content === 'Right **bold** and $x^2$', JSON.stringify(e.columns.map(c => c.content)));
check('rendered as Markdown with math', await app(() => Boolean(document.querySelector('#slide-canvas .gl-column strong')) && Boolean(document.querySelector('#slide-canvas .gl-column .katex'))));
[cx, cy] = await colBox(0);
await page.mouse.dblclick(cx, cy);
await page.keyboard.press('End');
await page.keyboard.type(' more');
await page.mouse.click(700, 860);
await page.waitForTimeout(300);
e = await el();
check('a click outside saves the column', e.columns[0].content === 'Left text more', e.columns[0].content);

// ---------- Divider handle ----------
await app(async () => {
    const m = await import('/core/state.js');
    m.setSelectedElementIndices([0], 0);
    (await import('/editor/editor.js')).renderEditor();
});
const handle = await page.$('#slide-canvas .el-handle-divider');
check('a handle on the divider when selected', Boolean(handle));
if (handle) {
    const hb = await handle.boundingBox();
    await page.mouse.move(hb.x + hb.width / 2, hb.y + hb.height / 2);
    await page.mouse.down();
    await page.mouse.move(hb.x - 120, hb.y + hb.height / 2, { steps: 6 });
    await page.mouse.up();
    await page.waitForTimeout(200);
    e = await el();
    check('dragging it changes the widths (still 100 in total)', e.columns[0].width < 60 && Math.abs(e.columns[0].width + e.columns[1].width - 100) < 0.5, JSON.stringify(e.columns.map(c => c.width)));
}

// ---------- Panel: presets, count, alignment ----------
await page.click('[data-element-action="preset"][data-arg="30,70"]');
e = await el();
check('width preset 30/70', e.columns.map(c => c.width).join(',') === '30,70');
await page.click('[data-element-action="setCount"][data-arg="3"]');
e = await el();
check('three columns: even widths, text kept', e.columns.length === 3 && e.columns[0].content === 'Left text more' && e.columns.every(c => c.width === 33), JSON.stringify(e.columns));
await page.click('[data-element-action="colAlign"][data-arg="2:valign:center"]');
await page.click('[data-element-action="setCount"][data-arg="2"]');
e = await el();
check('back to two: the third column\'s text is kept in the second', e.columns.length === 2 && e.columns[1].content.startsWith('Right **bold**'));

// ---------- .gl format ----------
await app(async () => {
    const { state } = await import('/core/state.js');
    const c = state.slides[0].elements[0];
    c.columns = [{ width: 60, content: 'Left\n\n.column is text here\n.dot line' }, { width: 40, valign: 'center', align: 'right', content: 'Right' }];
    c.divider = 'line';
});
const gl = await app(async () => (await import('/core/state.js')).serializeProject());
const block = gl.slice(gl.indexOf('.element.columns'));
check('.gl: .column lines with their settings', /\n\t\.column width:60\n\tLeft\n\n\t\\\\\.column is text here\n\t\\\.dot line\n\t\.column width:40 valign:center align:right\n\tRight/.test(block), block.slice(0, 200));
const back = await app(async (t) => (await import('/core/state.js')).parseProjectContent(t).slides[0].elements[0], gl);
check('.gl: read back exactly', JSON.stringify(back.columns) === JSON.stringify([{ width: 60, content: 'Left\n\n.column is text here\n.dot line' }, { width: 40, content: 'Right', valign: 'center', align: 'right' }]) && back.divider === 'line', JSON.stringify(back.columns));

// ---------- Markdown images, export, project font ----------
await app(async () => {
    const { state } = await import('/core/state.js');
    state.slides[0].elements[0].columns[0].content = 'Plot:\n\n![a plot](figures/plot.png)';
    document.dispatchEvent(new CustomEvent('slide-content-changed'));
});
await page.waitForTimeout(400);
check('a Markdown image is loaded from the project folder', (await app(() => window.__loads)).includes('figures/plot.png')
    && await app(() => (document.querySelector('#slide-canvas .gl-column img')?.getAttribute('src') || '').startsWith('data:image/png')));
const html = await app(async () => (await import('/export/html.js')).getExportHtmlString());
check('export: the columns and the image (embedded)', html.includes('gl-columns') && /<img[^>]+src="data:image\/png/.test(html) && html.includes('.gl-columns {'));
await app(async () => {
    const { state } = await import('/core/state.js');
    state.defaults = { text: { fontFamily: 'Merriweather' } };
    document.dispatchEvent(new CustomEvent('slide-content-changed'));
});
await page.waitForTimeout(200);
check('uses the project\'s text font when it has none of its own', (await app(() => document.querySelector('#slide-canvas .element-columns').style.fontFamily)).includes('Merriweather'));

console.log(out.join('\n'));
console.log('--- errors ---\n' + (errors.join('\n') || '(none)'));
await browser.close();
