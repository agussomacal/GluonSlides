// A CSV or JSON dropped on a slide (ui/dataDrop.js): a panel asks for a
// table, a plot (wide or long format, with a choice to pick while
// presenting) or a choice (a JSON: a choice or variables); nothing is
// copied until it is chosen; Enter makes the same kind as last time;
// dropped on a plot: a layer of it.
import { launchBrowser, BASE_URL } from '../helpers.mjs';

const browser = await launchBrowser();
const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
const errors = [];
page.on('pageerror', e => errors.push(e.message));
const out = [];
const check = (n, c, x = '') => out.push(`${c ? 'PASS' : 'FAIL'} ${n}${x !== '' ? ' — ' + JSON.stringify(x) : ''}`);
const app = (fn, arg) => page.evaluate(fn, arg);

await page.addInitScript(() => {
    const ok = (o = {}) => Promise.resolve({ success: true, ...o });
    const FILES = {
        'wide.csv': { header: ['step', 'loss_adam', 'loss_sgd'], rows: [['1', '0.9', '1.2'], ['2', '0.5', '0.8'], ['3', '0.3', '0.6']], total: 3, mtime: 1 },
        'long.csv': { header: ['run', 'step', 'loss'], rows: [['adam', '1', '0.9'], ['adam', '2', '0.5'], ['sgd', '1', '1.2'], ['sgd', '2', '0.8']], total: 4, mtime: 1 },
        'names.csv': { header: null, rows: [['Input'], ['Output']], total: 2, mtime: 1 },
        'results.json': { json: { adam: { acc: 0.91 }, sgd: { acc: 0.85 } }, mtime: 1 },
    };
    const of = (path) => FILES[path.split('/').pop()];
    window.__links = [];
    window.__unused = [{ path: 'data/long.csv', size: 120 }, { path: 'data/data_test_1.csv', size: 39 }, { path: 'figures/old.png', size: 2048 }];
    window.pywebview = { api: {
        read_plot_data: (folder, path) => (of(path) ? ok(of(path)) : Promise.resolve({ success: false, error: `${path}: no such file` })),
        link_plot_data: (folder, src) => { window.__links.push(src); return ok({ relative_path: `data/${src.split('/').pop()}`, original: src, ...of(src) }); },
        refresh_plot_data: () => ok({ updated: [] }),
        link_table_file: (folder, src) => { window.__links.push(src); const f = of(src); return ok({ rows: [f.header, ...f.rows], total: f.total, mtime: 1, relative_path: `data/${src.split('/').pop()}`, original: src }); },
        read_table_file: () => ok({ rows: [['k']], mtime: 1 }),
        refresh_tables: () => ok({ updated: [] }),
        link_vars_file: (folder, src) => { window.__links.push(src); return ok({ relative_path: `data/${src.split('/').pop()}`, original: src, values: { 'adam.acc': 0.91, 'sgd.acc': 0.85 }, mtime: 1 }); },
        refresh_vars: () => ok({ updated: [] }),
        read_vars_file: () => ok({ values: {}, mtime: 1 }),
        take_dropped_paths: () => ok({ paths: [] }),
        unused_project_files: (folder, text) => { window.__text = text; return ok({ files: window.__unused.filter(f => !text.includes(f.path)) }); },
        delete_project_files: (folder, paths) => { window.__deleted = paths; window.__unused = window.__unused.filter(f => !paths.includes(f.path)); return ok({ deleted: paths, errors: [] }); },
        get_recent_projects: () => ok({ projects: [] }),
        get_inspector_settings: () => ok({ settings: null }),
        save_inspector_settings: () => ok(),
        list_project_fonts: () => ok({ fonts: [] }),
        list_system_fonts: () => ok({ families: [] }),
        save_project_data: () => ok(),
        save_text_file: () => ok(),
        load_text_file: () => Promise.resolve({ success: false }),
    } };
    try { localStorage.removeItem('gluon-data-drop'); } catch (e) { /* none */ }
});
await page.goto(`${BASE_URL}/index.html`);
await app(async () => {
    await (await import('/ui/project.js')).openSampleProject();
    const { state } = await import('/core/state.js');
    state.projectFolder = '/home/me/talk';
    state.gridSize = 0;
    state.slides = [{ id: 1, title: 'One', elements: [] }];
    state.masters = [];
    state.nextId = 10;
    (await import('/editor/editor.js')).selectSlide(0);
});
await page.waitForTimeout(200);
const toClient = (x, y) => app(([x, y]) => {
    const r = document.getElementById('slide-canvas').getBoundingClientRect();
    const s = r.width / 1920; return [r.left + x * s, r.top + y * s];
}, [x, y]);
const elements = () => app(async () => (await import('/core/state.js')).state.slides[0].elements);
// the same file dropped again within 3 s is taken for the same drop (it can come twice): wait
const lastDrop = new Map();
const drop = async (path, x = 960, y = 540) => {
    const wait = 3100 - (Date.now() - (lastDrop.get(path) || 0));
    if (wait > 0) await page.waitForTimeout(wait);
    lastDrop.set(path, Date.now());
    const [cx, cy] = await toClient(x, y);
    await app(([p, x, y]) => window.gluonNativeDrop([p], x, y), [path, cx, cy]);
    await page.waitForTimeout(250);
};
const clear = () => app(async () => { const { state } = await import('/core/state.js'); state.slides[0].elements = []; (await import('/editor/editor.js')).renderEditor(); });
const panelText = () => app(() => document.querySelector('.data-drop')?.textContent.replace(/\s+/g, ' ').trim() || '');

// ---------- a wide CSV ----------
await drop('/home/me/exp/wide.csv');
check('a dropped CSV: a panel with what it holds', /wide\.csv · 3 rows · 3 columns/.test(await panelText()), await panelText());
const modes = await app(() => [...document.querySelectorAll('.dd-mode')].map(b => `${b.textContent.trim()}${b.classList.contains('on') ? '*' : ''}`));
check('…Table, Plot or Choice (a table first time)', JSON.stringify(modes) === '["▦ Table*","📈 Plot","📋 Choice"]', modes);
check('…nothing copied yet', (await app(() => window.__links.length)) === 0);
await page.click('[data-dd-mode="plot"]');
// dropped near a corner: the panel is still in the middle, whole; a frame on the slide shows where it goes
await page.click('[data-dd-cancel]');
await drop('/home/me/exp/wide.csv', 1800, 1000);
await page.click('[data-dd-mode="plot"]');
const where = await app(() => {
    const r = document.querySelector('.data-drop').getBoundingClientRect();
    const m = document.querySelector('#slide-canvas .dd-marker');
    return { cx: Math.round(r.left + r.width / 2), cy: Math.round(r.top + r.height / 2), w: innerWidth, h: innerHeight, inside: r.top >= 0 && r.bottom <= innerHeight && r.left >= 0 && r.right <= innerWidth,
        add: (() => { const b = document.querySelector('[data-dd-add]').getBoundingClientRect(); return b.bottom <= innerHeight && b.top >= 0; })(),
        marker: m && { x: parseFloat(m.style.left), y: parseFloat(m.style.top), w: parseFloat(m.style.width), h: parseFloat(m.style.height) } };
});
check('the panel: in the middle of the window, whole, Add visible', Math.abs(where.cx - where.w / 2) <= 2 && Math.abs(where.cy - where.h / 2) <= 2 && where.inside && where.add, where);
check('…a frame where the plot will go (kept on the slide, by the drop point)', where.marker && Math.round(where.marker.x + where.marker.w) === 1920 && Math.round(where.marker.y + where.marker.h) === 1080 && where.marker.w === 1100, where.marker);
const title = await page.locator('.dd-title').boundingBox();
await page.mouse.move(title.x + 20, title.y + 10);
await page.mouse.down();
await page.mouse.move(title.x - 180, title.y - 100, { steps: 4 });
await page.mouse.up();
const movedBy = await page.locator('.dd-title').boundingBox();
check('…dragging its title moves it', Math.round(title.x - movedBy.x) === 200 && Math.round(title.y - movedBy.y) === 110, [title, movedBy]);
const wide = await app(() => ({
    format: document.querySelector('input[data-dd="format"]:checked')?.value,
    x: document.querySelector('select[data-dd="x"]')?.value,
    ys: [...document.querySelectorAll('input[data-dd-y]')].map(i => `${i.parentElement.textContent.trim()}${i.checked ? '*' : ''}`),
    longOff: document.querySelector('input[data-dd="format"][value="long"]')?.disabled,
}));
check('a plot of it: wide guessed (all numbers), x = step, the others ticked', wide.format === 'wide' && wide.x === '0' && JSON.stringify(wide.ys) === '["loss_adam*","loss_sgd*"]' && wide.longOff, wide);
await page.click('[data-dd-add]');
await page.waitForTimeout(250);
let els = await elements();
let plot = els.find(e => e.type === 'plot');
check('…Add: a line per column, named, from its copy in data/', plot && plot.code === '.line data:{data/wide.csv} original:/home/me/exp/wide.csv x:step y:loss_adam label:loss_adam\n.line data:{data/wide.csv} original:/home/me/exp/wide.csv x:step y:loss_sgd label:loss_sgd', plot && plot.code);
check('…ranges found from the data, x labelled', plot && plot.xmin === '' && plot.ymax === '' && plot.xlabel === 'step', plot && [plot.xmin, plot.xlabel]);
check('…the panel closes', !(await page.isVisible('.data-drop')));
const drawn = await app(() => document.querySelectorAll('#slide-canvas .element-plot svg path[stroke-linejoin]').length);
check('…and it draws', drawn === 2, drawn);
await clear();

// ---------- a long CSV, with a choice ----------
await drop('/home/me/exp/long.csv');
const longCfg = await app(() => ({
    mode: document.querySelector('.dd-mode.on')?.dataset.ddMode,
    format: document.querySelector('input[data-dd="format"]:checked')?.value,
    group: document.querySelector('select[data-dd="group"]')?.selectedOptions[0]?.textContent,
    x: document.querySelector('select[data-dd="x"]')?.selectedOptions[0]?.textContent,
    y: document.querySelector('select[data-dd="y"]')?.selectedOptions[0]?.textContent,
}));
check('the last kind comes back (a plot); long guessed: a line per run, x step, y loss', longCfg.mode === 'plot' && longCfg.format === 'long' && longCfg.group === 'run' && longCfg.x === 'step' && longCfg.y === 'loss', longCfg);
await page.check('input[data-dd="interactive"]');
await page.check('input[data-dd="several"]');
await page.click('[data-dd-add]');
await page.waitForTimeout(300);
els = await elements();
plot = els.find(e => e.type === 'plot');
let choice = els.find(e => e.type === 'choice');
check('…the plot: group:run show:"=pick"', plot && plot.code === '.line data:{data/long.csv} original:/home/me/exp/long.csv x:step y:loss group:run show:"=pick"', plot && plot.code);
check('…a choice under it: the runs, several at once, all picked', choice && choice.var === 'pick' && choice.source === 'data/long.csv' && choice.use === 'column:run' && choice.multiple === 'yes' && choice.value === 'adam, sgd' && choice.y > plot.y + plot.height, choice);
const lines = await app(() => document.querySelectorAll('#slide-canvas .element-plot svg path[stroke-linejoin]').length);
check('…two runs drawn', lines === 2, lines);
await clear();

// ---------- Enter: the same again ----------
await drop('/home/me/exp/wide.csv');
await page.keyboard.press('Enter');
await page.waitForTimeout(300);
els = await elements();
plot = els.find(e => e.type === 'plot');
choice = els.find(e => e.type === 'choice');
check('Enter: a plot again, with its choice (several columns: each line shown while picked)', plot && plot.code.includes("visible:\"='loss_adam' in pick\"") && plot.code.includes("visible:\"='loss_sgd' in pick\"") && choice && choice.use === 'header' && choice.skip === 'step', [plot && plot.code, choice]);
const choiceOpts = await app(() => [...document.querySelectorAll('#slide-canvas .element-choice option')].map(o => o.value));
check('…its options: the columns drawn (step skipped)', JSON.stringify(choiceOpts) === '["loss_adam","loss_sgd"]', choiceOpts);
await clear();

// one column at a time
await drop('/home/me/exp/wide.csv');
await page.uncheck('input[data-dd="several"]');
await page.click('[data-dd-add]');
await page.waitForTimeout(300);
els = await elements();
plot = els.find(e => e.type === 'plot');
check('one column at a time: a line of y:"=pick"', plot && plot.code === '.line data:{data/wide.csv} original:/home/me/exp/wide.csv x:step y:"=pick"', plot && plot.code);
await clear();

// ---------- histograms, bars ----------
await drop('/home/me/exp/wide.csv');
await page.uncheck('input[data-dd="interactive"]');
await page.click('[data-dd-kind="hist"]');
await page.click('[data-dd-add]');
await page.waitForTimeout(250);
plot = (await elements()).find(e => e.type === 'plot');
check('a histogram per ticked column', plot && plot.code.split('\n').length === 2 && /^\.hist data:\{data\/wide\.csv\} original:\S+ column:loss_adam label:loss_adam/.test(plot.code), plot && plot.code);
await clear();

// ---------- Esc ----------
const linksBefore = await app(() => window.__links.length);
await drop('/home/me/exp/wide.csv');
await page.keyboard.press('Escape');
await page.waitForTimeout(150);
check('Esc: nothing made, nothing copied', (await elements()).length === 0 && (await app(() => window.__links.length)) === linksBefore && !(await page.isVisible('.data-drop')));

// ---------- a file of names ----------
await drop('/home/me/exp/names.csv');
const nameModes = await app(() => [...document.querySelectorAll('.dd-mode')].map(b => b.dataset.ddMode));
check('a file of names only: a choice (or a table)', JSON.stringify(nameModes) === '["choice","table"]' && /2 names/.test(await panelText()), [nameModes, await panelText()]);
await page.click('[data-dd-mode="choice"]');
await page.click('[data-dd-add]');
await page.waitForTimeout(300);
choice = (await elements()).find(e => e.type === 'choice');
const nameOpts = await app(() => [...document.querySelectorAll('#slide-canvas .element-choice option')].map(o => o.value));
check('…a choice of those names', choice && choice.source === 'data/names.csv' && JSON.stringify(nameOpts) === '["Input","Output"]', [choice, nameOpts]);
await clear();

// ---------- a JSON ----------
await drop('/home/me/exp/results.json');
const jsonModes = await app(() => [...document.querySelectorAll('.dd-mode')].map(b => b.dataset.ddMode));
check('a JSON: a choice of its keys, or variables', JSON.stringify(jsonModes) === '["choice","vars"]', jsonModes);
await page.click('[data-dd-mode="vars"]');
await page.click('[data-dd-add]');
await page.waitForTimeout(250);
const vf = await app(async () => (await import('/core/state.js')).state.varFiles);
check('…variables: Project settings → Variables follows it', vf.some(f => f.file === 'data/results.json' && f.original === '/home/me/exp/results.json'), vf);

// ---------- on a plot: a layer of it ----------
await app(async () => {
    const { state } = await import('/core/state.js');
    state.slides[0].elements = [{ type: 'plot', id: 50, x: 400, y: 200, width: 1000, height: 600, lang: 'python', code: 'y = x' }];
    (await import('/editor/editor.js')).renderEditor();
});
await drop('/home/me/exp/long.csv', 900, 500);
plot = (await elements()).find(e => e.type === 'plot');
check('a CSV dropped on a plot: a layer of it added (long: a line per run)', plot && plot.code === 'y = x\n.line data:{data/long.csv} original:/home/me/exp/long.csv x:step y:loss group:run' && !(await page.isVisible('.data-drop')), plot && plot.code);

// ---------- long format with a colour key ----------
await clear();
await drop('/home/me/exp/long.csv');
await page.click('[data-dd-mode="plot"]');
await page.click('[data-dd-kind="line"]');
if (await page.isChecked('input[data-dd="interactive"]')) await page.uncheck('input[data-dd="interactive"]');
await page.check('input[data-dd="colorkey"]');
await page.click('[data-dd-add]');
await page.waitForTimeout(400);
els = await elements();
plot = els.find(e => e.type === 'plot');
const ck = els.find(e => e.type === 'colorkey');
check('long format + a colour key: colors:runcol, show:"=runcol.shown", its own legend off', plot && plot.code === '.line data:{data/long.csv} original:/home/me/exp/long.csv x:step y:loss group:run colors:runcol show:"=runcol.shown"' && plot.legend === 'no', plot && plot.code);
check('…the colour key: the runs of the file, a clickable legend right of the plot', ck && ck.var === 'runcol' && ck.source === 'data/long.csv' && ck.use === 'column:run' && ck.clickable === 'yes' && ck.x >= plot.x + plot.width, ck);
const keyLegend = await app(() => [...document.querySelectorAll('#slide-canvas .element-colorkey [data-glkey]')].map(k => k.dataset.glkey));
check('…its legend: adam, sgd', JSON.stringify(keyLegend) === '["adam","sgd"]', keyLegend);

// ---------- Project settings → Files ----------
await app(async () => (await import('/ui/projectSettings.js')).openProjectSettings('files'));
await page.waitForTimeout(200);
const unused = await app(() => [...document.querySelectorAll('[data-unused-file]')].map(i => `${i.dataset.unusedFile}${i.checked ? '*' : ''}`));
check('Files: what nothing names (data/long.csv is used by the plot)', JSON.stringify(unused) === '["data/data_test_1.csv*","figures/old.png*"]', unused);
await page.uncheck('[data-unused-file="figures/old.png"]');
await page.click('[data-settings-action="files-delete"]');
await page.waitForTimeout(100);
const asking = await app(() => document.querySelector('[data-settings-action="files-delete"]')?.textContent.trim());
check('…Delete asks once more, nothing deleted yet', asking === 'Click again: move 1 file to the trash' && (await app(() => window.__deleted)) === undefined, asking);
await page.click('[data-settings-action="files-delete"]');
await page.waitForTimeout(250);
const afterDelete = await app(() => ({ deleted: window.__deleted, left: [...document.querySelectorAll('[data-unused-file]')].map(i => i.dataset.unusedFile) }));
check('…then only the ticked file is deleted, the list looked at again', JSON.stringify(afterDelete) === '{"deleted":["data/data_test_1.csv"],"left":["figures/old.png"]}', afterDelete);
await app(async () => document.querySelector('[data-settings-action="close"]')?.click());

check('no page errors', errors.length === 0, errors);
console.log(out.join('\n'));
await browser.close();
