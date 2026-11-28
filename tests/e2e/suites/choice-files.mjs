// A choice's options from a file (a CSV's header or a column's values, a
// JSON's keys), a plot's column picked by a variable (y:"=run"), and
// names picked by others in formulas and text (results[opt].acc).
import { launchBrowser, BASE_URL } from '../helpers.mjs';

const browser = await launchBrowser();
const page = await browser.newPage({ viewport: { width: 1400, height: 1000 } });
const errors = [];
page.on('pageerror', e => errors.push(e.message));
const out = [];
const check = (n, c, x = '') => out.push(`${c ? 'PASS' : 'FAIL'} ${n}${x !== '' ? ' — ' + JSON.stringify(x) : ''}`);
const app = (fn, arg) => page.evaluate(fn, arg);

// a fake backend: runs.csv (a column per run), results.json (keys per optimiser)
await page.addInitScript(() => {
    const ok = (o = {}) => Promise.resolve({ success: true, ...o });
    const RUNS = { header: ['step', 'loss_adam', 'loss_sgd', 'optimizer'], rows: [['1', '0.9', '5', 'adam'], ['2', '0.5', '4', 'sgd'], ['3', '0.3', '3', 'adam']], total: 3, mtime: 1 };
    const RESULTS = { json: { adam: { acc: 0.91 }, sgd: { acc: 0.85 }, meta: { runs: ['r1', 'r2'] } }, mtime: 1 };
    window.pywebview = { api: {
        read_plot_data: (folder, path) => {
            if (path === 'data/runs.csv') return ok(RUNS);
            if (path === 'data/results.json') return ok(RESULTS);
            if (path === 'data/long.csv') return ok({ header: ['run', 'step', 'loss'], rows: [['adam', '1', '0.9'], ['adam', '2', '0.5'], ['sgd', '1', '1.2'], ['sgd', '2', '0.8'], ['ngd', '1', '2'], ['ngd', '2', '1.5']], total: 6, mtime: 1 });
            // names only (no data): one per line, or one row
            if (path === 'data/names.csv') return ok({ header: null, rows: [['Input'], ['Output']], total: 2, mtime: 1 });
            if (path === 'data/namesrow.csv') return ok({ header: null, rows: [['Input', 'Output']], total: 1, mtime: 1 });
            return Promise.resolve({ success: false, error: `${path}: no such file` });
        },
        refresh_plot_data: () => ok({ updated: [] }),
        select_vars_file: () => ok({ path: '/home/me/exp/results.json' }),
        link_plot_data: (folder, src, linked) => { window.__linked = linked; return ok({ relative_path: 'data/results.json', original: src, ...RESULTS }); },
        get_recent_projects: () => ok({ projects: [] }),
        get_inspector_settings: () => ok({ settings: null }),
        save_inspector_settings: () => ok(),
        list_project_fonts: () => ok({ fonts: [] }),
        list_system_fonts: () => ok({ families: [] }),
        save_project_data: () => ok(),
        save_text_file: () => ok(),
        load_text_file: () => Promise.resolve({ success: false }),
    } };
});
await page.goto(`${BASE_URL}/index.html`);
await app(async () => {
    await (await import('/ui/project.js')).openSampleProject();
    const { state } = await import('/core/state.js');
    state.projectFolder = '/home/me/talk';
    state.gridSize = 0;
    state.vars = { 'results.adam.acc': 0.91, 'results.sgd.acc': 0.85 };
    state.slides = [{ id: 1, title: 'P', elements: [
        { type: 'choice', id: 2, x: 100, y: 950, width: 500, height: 70, var: 'run', source: 'data/runs.csv', use: 'header', options: '', value: 'loss_adam', original: '/home/me/exp/runs.csv' },
        { type: 'choice', id: 4, x: 700, y: 950, width: 500, height: 70, var: 'opt', source: 'data/results.json', options: 'adam, sgd', value: 'adam' },
        { type: 'plot', id: 3, x: 100, y: 100, width: 1200, height: 700, lang: 'python', code: '.line data:{data/runs.csv} x:step y:"=run"' },
        { type: 'text', id: 5, x: 100, y: 820, width: 1200, height: 100, content: 'Accuracy: \\var{results[opt].acc}[%.2f]' },
    ] }];
    state.nextId = 10;
    (await import('/editor/editor.js')).selectSlide(0);
});
await page.waitForTimeout(400);

// ---------- names picked by others ----------
const formulas = await app(async () => {
    const E = await import('/core/liveEngine.js');
    const v = { 'results.adam.acc': 0.91, 'results.sgd.acc': 0.85, opt: 'sgd', opts: ['a', 'b'] };
    const run = (f) => { const c = E.compileFormula(f); try { return c.error || c.exec(v); } catch (e) { return `ERR ${e.message}`; } };
    return { pick: run('results[opt].acc'), quoted: run("results['adam'].acc * 100"), first: run('opts[0]'), last: run('opts[-1]'), missing: run('results[opt]'), names: E.compileFormula('results[opt].acc').names };
});
check('results[opt].acc: results.sgd.acc', formulas.pick === 0.85, formulas.pick);
check("results['adam'].acc * 100", formulas.quoted === 91, formulas.quoted);
check('opts[0], opts[-1]: elements of a list', formulas.first === 'a' && formulas.last === 'b', [formulas.first, formulas.last]);
check('a name that is not there says which', formulas.missing === 'ERR unknown name: results.sgd', formulas.missing);
check('only the names in the brackets are needed beforehand', JSON.stringify(formulas.names) === '["opt"]', formulas.names);

const textNow = () => app(() => document.querySelector('#slide-canvas [data-element-id="5"]')?.textContent.trim());
check('text: \\var{results[opt].acc}[%.2f] shows the chosen one', (await textNow()) === 'Accuracy: 0.91', await textNow());

// ---------- options from a file ----------
const opts = (id) => app((id) => [...document.querySelectorAll(`#slide-canvas [data-element-id="${id}"] option`)].map(o => o.value), id);
check('a CSV\'s column names as options', JSON.stringify(await opts(2)) === '["step","loss_adam","loss_sgd","optimizer"]', await opts(2));
check('a JSON\'s keys as options', JSON.stringify(await opts(4)) === '["adam","sgd","meta"]', await opts(4));
const uses = await app(async () => {
    const V = await import('/core/variables.js');
    const o = (el) => { const r = V.fileOptions(el); return r.error || r.options.join(','); };
    // read the names-only files first
    V.fileOptions({ source: 'data/names.csv' }); V.fileOptions({ source: 'data/namesrow.csv' });
    await new Promise(r => setTimeout(r, 150));
    return {
        column: o({ source: 'data/runs.csv', use: 'column:optimizer' }),
        byNumber: o({ source: 'data/runs.csv', use: 'column:1' }),
        nested: o({ source: 'data/results.json', use: 'keys:meta.runs' }),
        noColumn: o({ source: 'data/runs.csv', use: 'column:nope' }),
        noPath: o({ source: 'data/results.json', use: 'keys:nope' }),
        missing: V.choiceOptions({ source: 'data/none.csv', options: 'kept, these' }).join(','),
        namesLines: o({ source: 'data/names.csv' }),
        namesRow: o({ source: 'data/namesrow.csv' }),
    };
});
check('use:column:optimizer: its values, each once', uses.column === 'adam,sgd', uses.column);
check('use:column:1: by number', uses.byNumber === '1,2,3', uses.byNumber);
check('use:keys:meta.runs: a list inside', uses.nested === 'r1,r2', uses.nested);
check('a column or a key not there: said', /no column “nope”/.test(uses.noColumn) && /no “nope”/.test(uses.noPath), [uses.noColumn, uses.noPath]);
check('a file of names only (one per line, or one row): those names', uses.namesLines === 'Input,Output' && uses.namesRow === 'Input,Output', [uses.namesLines, uses.namesRow]);
check('a file that can\'t be read: the written options are kept', uses.missing === 'kept,these', uses.missing);
const kept = await app(async () => (await import('/core/state.js')).state.slides[0].elements[0].options);
check('the options a file gave are kept written too', kept === 'step, loss_adam, loss_sgd, optimizer', kept);

// ---------- a plot's column picked by the choice ----------
const path = () => app(() => document.querySelector('#slide-canvas [data-element-id="3"] svg path[stroke-linejoin]')?.getAttribute('d'));
const warn = () => app(() => document.querySelector('#slide-canvas [data-element-id="3"] .gl-plot-notes, #slide-canvas [data-element-id="3"] .gl-plot-error')?.textContent || '');
const adam = await path();
check('y:"=run" draws the chosen column (loss_adam)', Boolean(adam) && !(await warn()), [adam, await warn()]);
const ticks = () => app(() => [...document.querySelectorAll('#slide-canvas [data-element-id="3"] svg text')].map(t => t.textContent).join(' '));
const ticksAdam = await ticks();
await page.selectOption('#slide-canvas [data-element-id="2"] select', 'loss_sgd');
await page.waitForTimeout(150);
const sgd = await path();
check('…choosing loss_sgd redraws it from that column', sgd && sgd !== adam, sgd);
check('…and the axes fit the new column', (await ticks()) !== ticksAdam, await ticks());

// the text follows the other choice
await page.selectOption('#slide-canvas [data-element-id="4"] select', 'sgd');
await page.waitForTimeout(150);
check('choosing sgd: the text shows results.sgd.acc', (await textNow()) === 'Accuracy: 0.85', await textNow());

// ---------- the cards: the column a variable names ----------
await app(async () => {
    const { setSelectedElementIndices } = await import('/core/state.js');
    setSelectedElementIndices([2], 2);
    (await import('/editor/editor.js')).renderEditor();
    // one layer: its card is open already
    if (!document.querySelector('#properties-body select[data-layer-field="y"]')) document.querySelector('[data-layer-toggle="0"]')?.click();
});
await page.waitForTimeout(200);
const yOptions = await app(() => [...document.querySelectorAll('#properties-body select[data-layer-field="y"] option')].map(o => `${o.value}${o.selected ? '*' : ''}`));
check('the y column\'s list: the columns, then the variables naming one', yOptions.includes('loss_sgd') && yOptions.includes('=run*') && yOptions.includes('=opt'), yOptions);

// ---------- the choice's panel ----------
await app(async () => {
    const { state, setSelectedElementIndices } = await import('/core/state.js');
    const el = state.slides[0].elements[1];
    delete el.source; el.options = 'a, b';
    setSelectedElementIndices([1], 1);
    (await import('/editor/editor.js')).renderEditor();
});
await page.waitForTimeout(150);
await page.locator('#properties-body [data-choice-op="pick"]').click();
await page.waitForTimeout(300);
const panel = await app(async () => {
    const el = (await import('/core/state.js')).state.slides[0].elements[1];
    return {
        source: el.source, original: el.original,
        take: [...document.querySelectorAll('#properties-body select[data-prop="use"] option')].map(o => o.textContent),
        info: document.querySelector('#properties-body .prop-hint')?.textContent,
    };
});
const sentLinks = await app(() => window.__linked);
check('…what the project links is sent along (a file linked again reuses its copy)', Array.isArray(sentLinks) && sentLinks.some(l => l.copy === 'data/runs.csv' && l.original === '/home/me/exp/runs.csv'), sentLinks);
check('📄 Options from a file…: copied into data/, followed', panel.source === 'data/results.json' && panel.original === '/home/me/exp/results.json', panel);
check('…Take: its keys, or the keys / items of what is inside', JSON.stringify(panel.take) === '["its keys","the keys of adam","the keys of sgd","the keys of meta","the items of meta.runs"]', panel.take);
await page.selectOption('#properties-body select[data-prop="use"]', 'keys:meta.runs');
await page.waitForTimeout(200);
check('…taking meta.runs: its items are the options', JSON.stringify(await opts(4)) === '["r1","r2"]', await opts(4));
await page.locator('#properties-body [data-choice-op="clear"]').click();
await page.waitForTimeout(200);
const cleared = await app(async () => { const el = (await import('/core/state.js')).state.slides[0].elements[1]; return { source: el.source, options: el.options }; });
check('✕: back to written options (the ones it had)', cleared.source === undefined && cleared.options === 'r1, r2', cleared);

// ---------- the file ----------
const gl = await app(async () => (await import('/core/state.js')).serializeProject());
check('written in the .gl: source and use', /\.element\.choice id:2 [^\n]*source:data\/runs\.csv[^\n]*use:header/.test(gl), gl.split('\n').filter(l => l.includes('choice')));

// ---------- long format: a line per value of a column ----------
await app(async () => {
    const { state } = await import('/core/state.js');
    state.slides.push({ id: 20, title: 'Long', elements: [
        { type: 'choice', id: 21, x: 100, y: 950, width: 500, height: 200, var: 'pick', source: 'data/long.csv', use: 'column:run', value: 'adam, sgd', multiple: 'yes' },
        { type: 'plot', id: 22, x: 100, y: 100, width: 1200, height: 700, lang: 'python', code: '.line data:{data/long.csv} group:run show:"=pick" label:"loss"' },
    ] });
    (await import('/editor/editor.js')).selectSlide(1);
});
await page.waitForTimeout(400);
const longLegend = () => app(() => [...document.querySelectorAll('#slide-canvas [data-element-id="22"] [data-gl-legend-layer]')].map(r => `${r.textContent.trim()}:${r.style.display}`));
const longLines = () => app(() => [...document.querySelectorAll('#slide-canvas [data-element-id="22"] svg path[stroke-linejoin]')].map(p => p.getAttribute('stroke')));
check('group:run: a legend row per run, the ones not picked hidden', JSON.stringify(await longLegend()) === '["loss adam:flex","loss sgd:flex","loss ngd:none"]', await longLegend());
check('…a line per run picked, each its colour', JSON.stringify(await longLines()) === '["#2563eb","#dc2626"]', await longLines());
const pickOpts = await opts(21);
check('…the choice: the run column\'s values', JSON.stringify(pickOpts) === '["adam","sgd","ngd"]', pickOpts);
await page.selectOption('#slide-canvas [data-element-id="21"] select', ['ngd']);
await page.waitForTimeout(150);
check('…picking ngd: only its line and its legend row', JSON.stringify(await longLines()) === '["#16a34a"]' && JSON.stringify(await longLegend()) === '["loss adam:none","loss sgd:none","loss ngd:flex"]', [await longLines(), await longLegend()]);
await app(async () => {
    const { setSelectedElementIndices } = await import('/core/state.js');
    setSelectedElementIndices([1], 1);
    (await import('/editor/editor.js')).renderEditor();
});
await page.waitForTimeout(200);
const groupField = await app(() => ({
    group: document.querySelector('#properties-body select[data-layer-field="group"]')?.value,
    show: document.querySelector('#properties-body input[data-layer-field="show"]')?.value,
    warn: document.querySelector('#properties-body .plot-layer-warn') ? 'warn' : '',
}));
check('the card: One per value of run, Only show =pick, no error', groupField.group === 'run' && groupField.show === '=pick' && !groupField.warn, groupField);
await app(async () => { (await import('/core/variables.js')).resetLiveValues(); (await import('/editor/editor.js')).selectSlide(0); });
await page.waitForTimeout(200);

// ---------- the exported HTML ----------
await app(async () => {
    const { state } = await import('/core/state.js');
    state.slides[0].elements[1].source = 'data/results.json'; // keys again: adam, sgd, meta
    delete state.slides[0].elements[1].use;
    (await import('/core/variables.js')).resetLiveValues();
    (await import('/editor/editor.js')).redrawCanvas();
});
await page.waitForTimeout(150);
const html = await app(async () => (await import('/export/html.js')).getExportHtmlString({ localAssets: true }));
const exp = await browser.newPage({ viewport: { width: 1400, height: 900 } });
const expErrors = [];
exp.on('pageerror', x => expErrors.push(x.message));
await exp.goto(`${BASE_URL}/index.html`);
await exp.setContent(html);
await exp.waitForTimeout(300);
const expText = () => exp.evaluate(() => [...document.querySelectorAll('.slide.active .el')].map(n => n.textContent.trim()).find(t => t.startsWith('Accuracy')));
const expOpts = await exp.evaluate(() => [...document.querySelectorAll('.slide.active [data-glinput="run"] option')].map(o => o.value));
check('export: the options from the file', JSON.stringify(expOpts) === '["step","loss_adam","loss_sgd","optimizer"]', expOpts);
check('export: the text at the start (adam)', (await expText()) === 'Accuracy: 0.91', await expText());
await exp.selectOption('.slide.active [data-glinput="opt"]', 'sgd');
await exp.waitForTimeout(150);
check('export: choosing sgd changes the text', (await expText()) === 'Accuracy: 0.85', await expText());
const expPath = () => exp.evaluate(() => document.querySelector('.slide.active svg path[stroke-linejoin]')?.getAttribute('d'));
const before = await expPath();
await exp.selectOption('.slide.active [data-glinput="run"]', 'loss_sgd');
await exp.waitForTimeout(150);
check('export: choosing a column redraws the plot from it', Boolean(before) && (await expPath()) !== before, [before, await expPath()]);
await exp.evaluate(() => window.GluonViewer.next());
await exp.waitForTimeout(200);
const expLines = () => exp.evaluate(() => [...document.querySelectorAll('.slide.active svg path[stroke-linejoin]')].map(p => p.getAttribute('stroke')));
check('export: long format, the runs picked at the start', JSON.stringify(await expLines()) === '["#2563eb","#dc2626"]', await expLines());
await exp.selectOption('.slide.active [data-glinput="pick"]', ['sgd', 'ngd']);
await exp.waitForTimeout(150);
check('export: picking others redraws their lines', JSON.stringify(await expLines()) === '["#dc2626","#16a34a"]', await expLines());
check('export: no page errors', expErrors.length === 0, expErrors);
await exp.close();

check('no page errors', errors.length === 0, errors);
console.log(out.join('\n'));
await browser.close();
