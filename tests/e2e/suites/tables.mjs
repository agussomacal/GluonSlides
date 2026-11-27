// Table element: adding it, editing cells (double-click, Tab, Enter,
// Esc; Tab past the end adds a row), picking a cell, adding / deleting
// rows and columns, styles (row / column / cell), number formats,
// borders and stripes, column widths, the .gl format, CSV import, a
// linked CSV that changes, unlinking, pasting spreadsheet cells, export.
import { launchBrowser, BASE_URL } from '../helpers.mjs';

const browser = await launchBrowser();
const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
const errors = [];
page.on('pageerror', e => errors.push(e.message));
const out = [];
const check = (n, c, x = '') => out.push(`${c ? 'PASS' : 'FAIL'} ${n}${x !== '' ? ' — ' + x : ''}`);
const app = (fn, arg) => page.evaluate(fn, arg);

await page.addInitScript(() => {
    window.__csv = [['Method', 'Error'], ['NGD', '0.00123'], ['GD', '0.0456']];
    window.__mtime = 1;
    window.__clip = {};
    const ok = (o = {}) => Promise.resolve({ success: true, ...o });
    window.pywebview = { api: {
        select_table_file: () => ok({ path: '/home/me/run/results.csv' }),
        read_table_file: () => ok({ rows: window.__csv, mtime: window.__mtime }),
        link_table_file: () => ok({ rows: window.__csv, mtime: window.__mtime, relative_path: 'data/results.csv', original: '/home/me/run/results.csv' }),
        refresh_tables: (folder, items) => ok({ updated: items.filter(i => i.mtime !== window.__mtime).map(i => ({ src: i.src, rows: window.__csv, mtime: window.__mtime })) }),
        read_clipboard: () => ok(window.__clip),
        set_clipboard_text: () => ok(),
        get_recent_projects: () => ok({ projects: [] }), get_inspector_settings: () => ok({ settings: null }),
        save_inspector_settings: () => ok(), list_project_fonts: () => ok({ fonts: [] }), list_system_fonts: () => ok({ families: [] }),
        save_project_data: () => ok(), save_text_file: () => ok(), load_text_file: () => Promise.resolve({ success: false }),
        load_figure_data_uri: () => ok({ data_uri: '' }),
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
const el = () => app(async () => JSON.parse(JSON.stringify((await import('/core/state.js')).state.slides[0].elements[0], (k, v) => (k.startsWith('_') ? undefined : v))));
const cellBox = (r, c) => app(([r, c]) => { const n = document.querySelector(`#slide-canvas [data-r="${r}"][data-c="${c}"]`); const b = n.getBoundingClientRect(); return [b.x + b.width / 2, b.y + b.height / 2]; }, [r, c]);
const cellText = (r, c) => app(([r, c]) => document.querySelector(`#slide-canvas [data-r="${r}"][data-c="${c}"]`)?.textContent.trim(), [r, c]);

// ---------- Adding and editing ----------
await page.click('[data-role="add-element"][data-type="table"]');
let e = await el();
check('added: 3×3 with a header row', e.type === 'table' && e.rows.length === 3 && e.rows[0].length === 3 && e.header === 'yes');
check('drawn as a table, header cells as th', await app(() => document.querySelectorAll('#slide-canvas table.gl-table th').length === 3 && document.querySelectorAll('#slide-canvas table.gl-table td').length === 6));
let [x, y] = await cellBox(2, 1);
await page.mouse.dblclick(x, y);
await page.keyboard.type('NGD');
await page.keyboard.press('Tab');
await page.keyboard.type('$1.2 \\times 10^{-3}$');
await page.keyboard.press('Enter');
await page.keyboard.type('below');
await page.keyboard.press('Escape');
await page.waitForTimeout(250);
e = await el();
check('Tab: next cell; Enter: the cell below; Esc saves', e.rows[1][0] === 'NGD' && e.rows[1][1] === '$1.2 \\times 10^{-3}$' && e.rows[2][1] === 'below', JSON.stringify(e.rows));
check('cells show Markdown and math', await app(() => Boolean(document.querySelector('#slide-canvas [data-r="2"][data-c="2"] .katex'))));
[x, y] = await cellBox(3, 3);
await page.mouse.dblclick(x, y);
await page.keyboard.type('last');
await page.keyboard.press('Tab');
await page.keyboard.type('new row');
await page.mouse.click(700, 860);
await page.waitForTimeout(250);
e = await el();
check('Tab past the last cell adds a row; a click outside saves', e.rows.length === 4 && e.rows[2][2] === 'last' && e.rows[3][0] === 'new row', JSON.stringify(e.rows));

// ---------- Picking a cell, rows and columns ----------
await app(async () => { const m = await import('/core/state.js'); m.setSelectedElementIndices([0], 0); (await import('/editor/editor.js')).renderEditor(); });
[x, y] = await cellBox(2, 2);
await page.mouse.click(x, y);
await page.waitForTimeout(150);
check('a click picks the cell the panel works on', (await page.textContent('#properties-body')).includes('at cell 2,2'));
await page.click('[data-element-action="addCol"][data-arg="right"]');
e = await el();
check('+ Col → inserts after column 2', e.rows[0].length === 4 && e.rows[1][2] === '' && e.rows[1][1].includes('1.2'));
await page.click('[data-element-action="deleteRow"]');
e = await el();
check('− Row deletes row 2', e.rows.length === 3 && e.rows[1][0] === '', JSON.stringify(e.rows.map(r => r[0])));
await page.click('[data-element-action="deleteCol"]');
e = await el();
check('− Column deletes the new column', e.rows[0].length === 3);

// ---------- Styles ----------
await app(async () => {
    const { state } = await import('/core/state.js');
    state.slides[0].elements[0].rows = [['Method', 'Error', 'Time'], ['NGD', '0.00123', '1.5'], ['GD', '0.0456', '2.25']];
    document.dispatchEvent(new CustomEvent('slide-content-changed'));
});
await page.waitForTimeout(150);
[x, y] = await cellBox(2, 2);
await page.mouse.click(x, y);
await page.waitForTimeout(150);
await page.selectOption('[data-table-scope]', 'col');
await page.click('[data-element-action="align"][data-arg="right"]');
await page.fill('[data-table-format]', '%.2e');
await page.press('[data-table-format]', 'Tab');
await page.waitForTimeout(150);
check('column 2: numbers formatted %.2e and right-aligned', await cellText(2, 2) === '1.23e-3' && await cellText(3, 2) === '4.56e-2'
    && await app(() => document.querySelector('#slide-canvas [data-r="3"][data-c="2"]').style.textAlign) === 'right', await cellText(2, 2));
await page.selectOption('[data-table-scope]', 'row');
await page.click('[data-element-action="toggle"][data-arg="bold"]');
check('row 2 bold', await app(() => document.querySelector('#slide-canvas [data-r="2"][data-c="1"]').style.fontWeight) === '700');
await page.selectOption('[data-table-scope]', 'cell');
await app(() => {
    const f = document.querySelector('[data-table-style="color"]');
    f.value = '#cc0000';
    f.setAttribute('value', '#cc0000');
    f.dispatchEvent(new Event('change', { bubbles: true }));
});
await page.waitForTimeout(150);
check('cell 2,2 red', await app(() => document.querySelector('#slide-canvas [data-r="2"][data-c="2"]').style.color) === 'rgb(204, 0, 0)');
await page.selectOption('[data-prop="borders"]', 'all');
await page.check('[data-prop="stripes"]');
check('borders: all; striped rows', await app(() => document.querySelector('#slide-canvas table').className) === 'gl-table borders-all stripes');

// ---------- Column widths ----------
const handle = await page.$('#slide-canvas .el-handle-divider');
if (handle) {
    const hb = await handle.boundingBox();
    await page.mouse.move(hb.x + hb.width / 2, hb.y + hb.height / 2);
    await page.mouse.down();
    await page.mouse.move(hb.x + 80, hb.y + hb.height / 2, { steps: 5 });
    await page.mouse.up();
    e = await el();
    check('dragging a column border sets widths', Array.isArray(e.widths) && e.widths[0] > 34 && Math.abs(e.widths.reduce((a, b) => a + b, 0) - 100) < 0.5, JSON.stringify(e.widths));
} else check('dragging a column border sets widths', false, 'no handle');

// ---------- .gl ----------
await app(async () => {
    const { state } = await import('/core/state.js');
    state.slides[0].elements[0].rows[2][0] = 'a | b\nsecond line';
});
const gl = await app(async () => (await import('/core/state.js')).serializeProject());
const block = gl.slice(gl.indexOf('.element.table'));
check('.gl: settings, styles and rows', /\.element\.table [^\n]*header:yes[^\n]*borders:all[^\n]*stripes:yes/.test(block)
    && /\n\t\.widths [\d.]+,[\d.]+,[\d.]+/.test(block) && block.includes('\t.col 2 align:right format:%.2e') && block.includes('\t.row 2 bold:yes')
    && block.includes('\t.cell 2,2 color:#cc0000') && block.includes('\t| Method | Error | Time |') && block.includes('| a \\| b<br>second line |'), block.slice(0, 400));
const back = await app(async (t) => (await import('/core/state.js')).parseProjectContent(t).slides[0].elements[0], gl);
const now = await el();
check('.gl: read back the same', JSON.stringify(back.rows) === JSON.stringify(now.rows) && JSON.stringify(back.styles) === JSON.stringify(now.styles)
    && JSON.stringify(back.widths) === JSON.stringify(now.widths), JSON.stringify(back.styles));

// ---------- CSV ----------
await page.click('[data-element-action="importCsv"]');
await page.waitForTimeout(250);
e = await el();
check('Import CSV copies the cells', JSON.stringify(e.rows) === JSON.stringify([['Method', 'Error'], ['NGD', '0.00123'], ['GD', '0.0456']]) && !e.data);
await page.click('[data-element-action="linkCsv"]');
await page.waitForTimeout(250);
e = await el();
check('Link CSV: data/results.csv from the original', e.data && e.data.src === 'data/results.csv' && e.data.original === '/home/me/run/results.csv' && e.data.sync === 'yes');
check('…the panel says it is linked', (await page.textContent('#properties-body')).includes('Linked to data/results.csv'));
[x, y] = await cellBox(2, 1);
await page.mouse.dblclick(x, y);
check('a linked table\'s cells are not edited on the canvas', !(await page.$('#slide-canvas .gl-cell-editing')));
await app(() => { window.__csv = [['Method', 'Error'], ['NGD', '0.00099'], ['GD', '0.0400'], ['NHB', '0.00050']]; window.__mtime = 2; });
await app(async () => (await import('/elements/table/table.js')).syncLinkedTables());
await page.waitForTimeout(200);
e = await el();
check('when the CSV changes, the table follows', e.rows.length === 4 && e.rows[3][0] === 'NHB', JSON.stringify(e.rows));
const gl2 = await app(async () => (await import('/core/state.js')).serializeProject());
check('.gl: the link, and the cells too', gl2.includes('\t.data {data/results.csv} sync:yes original:/home/me/run/results.csv') && gl2.includes('| NHB | 0.00050 |'));
await page.click('[data-element-action="unlink"]');
e = await el();
check('Unlink keeps the cells', !e.data && e.rows.length === 4);

// ---------- Pasting spreadsheet cells; export ----------
await app(() => { window.__clip = { text: 'Name\tScore\nAna\t9\nBo\t7\n' }; });
await page.mouse.click(700, 860);
await page.keyboard.press('Control+v');
await page.waitForTimeout(300);
const pasted = await app(async () => (await import('/core/state.js')).state.slides[0].elements.at(-1));
check('pasting cells from a spreadsheet makes a table', pasted.type === 'table' && JSON.stringify(pasted.rows) === JSON.stringify([['Name', 'Score'], ['Ana', '9'], ['Bo', '7']]));
const html = await app(async () => (await import('/export/html.js')).getExportHtmlString());
check('export: the tables and their styles', (html.match(/class="gl-table/g) || []).length >= 2 && html.includes('class="gl-table borders-all stripes') && html.includes('.gl-table.borders-horizontal'));

console.log(out.join('\n'));
console.log('--- errors ---\n' + (errors.join('\n') || '(none)'));
await browser.close();
