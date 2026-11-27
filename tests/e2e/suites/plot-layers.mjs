// Plot layers (core/liveEngine.js, elements/plot, core/plotData.js): every
// ＋ Layer template draws; fills, parametric curves, markers, points with
// error bars, histograms (sampled from a formula, from rows, from a file),
// bars by category, heatmaps with a colour bar, contour lines, arrows, log
// and π ticks; a data file linked and followed; the export redraws them.
import { launchBrowser, BASE_URL } from '../helpers.mjs';

const browser = await launchBrowser();
const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
const errors = [];
page.on('pageerror', e => errors.push(e.message));
const out = [];
const check = (n, c, x = '') => out.push(`${c ? 'PASS' : 'FAIL'} ${n}${x !== '' ? ' — ' + x : ''}`);
const app = (fn, arg) => page.evaluate(fn, arg);

// A fake backend for data files: run.csv can change.
await page.addInitScript(() => {
    const ok = (o = {}) => Promise.resolve({ success: true, ...o });
    window.__run = { mtime: 1, rows: [['1', '0.9', '0.1'], ['2', '0.5', '0.05'], ['3', '0.3', '0.04'], ['4', '0.2', '0.02']] };
    window.__calls = [];
    window.pywebview = { api: {
        read_plot_data: (folder, path) => {
            window.__calls.push(['read', path]);
            if (path === 'data/run.csv') return ok({ header: ['step', 'loss', 'std'], rows: window.__run.rows, total: window.__run.rows.length, mtime: window.__run.mtime });
            if (path === 'data/samples.csv') return ok({ header: ['value'], rows: Array.from({ length: 500 }, (_, i) => [String((i % 50) / 10)]), total: 500, mtime: 1 });
            return Promise.resolve({ success: false, error: `${path}: no such file` });
        },
        refresh_plot_data: (folder, items) => {
            window.__calls.push(['refresh', items.map(i => `${i.src}@${i.mtime}`).join()]);
            const updated = items.filter(i => i.src === 'data/run.csv' && i.mtime !== window.__run.mtime)
                .map(i => ({ src: i.src, success: true, header: ['step', 'loss', 'std'], rows: window.__run.rows, total: window.__run.rows.length, mtime: window.__run.mtime }));
            return ok({ updated });
        },
        select_table_file: () => ok({ path: '/home/me/exp/run.csv' }),
        link_plot_data: (folder, src) => ok({ relative_path: 'data/run.csv', original: src, header: ['step', 'loss', 'std'], rows: window.__run.rows, total: 4, mtime: window.__run.mtime }),
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
    state.slides = [{ id: 1, title: 'P', elements: [
        { type: 'slider', id: 2, x: 100, y: 950, width: 600, height: 70, var: 'mu', min: -3, max: 3, step: 0.1, value: 0 },
        { type: 'plot', id: 3, x: 100, y: 100, width: 1200, height: 800, lang: 'python', xmin: -5, xmax: 5, code: '' },
    ] }];
    state.nextId = 10;
    (await import('/editor/editor.js')).selectSlide(0);
});
await page.waitForTimeout(200);

/** Sets the plot's body and settings, redraws, returns what was drawn. */
const draw = (code, props = {}) => app(async ({ code, props }) => {
    const { state } = await import('/core/state.js');
    const p = state.slides[0].elements[1];
    Object.keys(p).filter(k => !['type', 'id', 'x', 'y', 'width', 'height', 'lang'].includes(k)).forEach(k => delete p[k]);
    Object.assign(p, { code, xmin: -5, xmax: 5 }, props);
    (await import('/editor/editor.js')).renderEditor();
    await new Promise(r => setTimeout(r, 120));
    (await import('/editor/editor.js')).renderEditor();
    const svg = document.querySelector('#slide-canvas [data-element-id="3"] svg.gl-plot-svg');
    const texts = [...svg.querySelectorAll('text')].map(t => t.textContent);
    return {
        errors: [...svg.querySelectorAll('g[fill="#dc2626"] text')].map(t => t.textContent),
        paths: [...svg.querySelectorAll('g[clip-path] path')].map(p => p.getAttribute('d')),
        rects: svg.querySelectorAll('g[clip-path] rect').length,
        circles: [...svg.querySelectorAll('g[clip-path] circle')].map(c => [Number(c.getAttribute('cx')), Number(c.getAttribute('cy'))]),
        images: [...svg.querySelectorAll('image')].map(i => (i.getAttribute('href') || '').slice(0, 22)),
        texts, html: svg.outerHTML,
    };
}, { code, props });
const setMu = (v) => app(async (v) => {
    const input = document.querySelector('#slide-canvas [data-element-id="2"] input');
    input.value = String(v);
    input.dispatchEvent(new Event('input', { bubbles: true }));
}, v);

// every template draws without an error
const templates = await app(async () => {
    const { state } = await import('/core/state.js');
    state.slides[0].elements[1].code = '';
    (await import('/editor/editor.js')).setSelectedElementIndices?.([1], 1);
    const m = await import('/core/state.js');
    m.setSelectedElementIndices([1], 1);
    (await import('/editor/editor.js')).renderEditor();
    return [...document.querySelectorAll('[data-layer-add]')].map(b => b.dataset.layerAdd);
});
check('＋ Layer: every kind offered', templates.join() === 'curve,fill,parametric,vline,hline,point,text,points,line,hist,bar,heatmap,contour,quiver', templates.join());
const bad = [];
for (const kind of templates) {
    await app(async (kind) => {
        const { state } = await import('/core/state.js');
        state.slides[0].elements[1].code = '';
        document.querySelector(`[data-layer-add="${kind}"]`).click();
    }, kind);
    await page.waitForTimeout(80);
    const res = await app(() => [...document.querySelectorAll('#slide-canvas [data-element-id="3"] svg g[fill="#dc2626"] text')].map(t => t.textContent));
    if (res.length) bad.push(`${kind}: ${res.join(' ')}`);
}
check('…and each draws without an error', !bad.length, bad.join(' | '));

// fill: the area between from and to, which follow a variable
let r = await draw('.fill from:mu-1 to:mu+1 color:#2563eb\ny = exp(-x**2/2)');
const fillBox = (d) => { const xs = [...d.matchAll(/[ML]([\d.]+) /g)].map(m => Number(m[1])); return [Math.min(...xs), Math.max(...xs)]; };
const fill0 = fillBox(r.paths[0]);
await setMu(2);
await page.waitForTimeout(80);
const fill2 = await app(() => document.querySelector('#slide-canvas [data-element-id="3"] svg g[clip-path] path').getAttribute('d'));
check('fill: a closed area from mu−1 to mu+1, moving with mu', r.paths[0].endsWith('Z') && fillBox(fill2)[0] > fill0[0] + 100, JSON.stringify([fill0, fillBox(fill2)]));
await setMu(0);

// parametric circle with equal proportions: as wide as tall
r = await draw('.parametric from:0 to:2*pi\nx = cos(t)\ny = sin(t)', { xmin: -2, xmax: 2, ymin: -2, ymax: 2, aspect: 'equal' });
const box = (d) => { const p = [...d.matchAll(/[ML]([\d.]+) ([\d.]+)/g)].map(m => [Number(m[1]), Number(m[2])]); const xs = p.map(q => q[0]); const ys = p.map(q => q[1]); return [Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys)]; };
const circle = box(r.paths[0]);
check('parametric + equal proportions: a round circle', !r.errors.length && Math.abs(circle[0] - circle[1]) < 2, JSON.stringify(circle));

// markers at variables
r = await draw('.vline x:mu label:"mean"\n.hline y:0.5\n.point x:1 y:0.25 label:"P"\n.text x:-4 y:0.9 label:"note"', { ymin: 0, ymax: 1 });
check('markers: vertical and horizontal lines, a point, texts', r.paths.length === 2 && r.circles.length === 1 && ['mean', 'P', 'note'].every(t => r.texts.includes(t)), JSON.stringify(r.texts.slice(-4)));

// points from rows, with error bars from a column
r = await draw('.points yerr:3\nx, y, e\n1, 1, 0.1\n2, 4, 0.5\n3, 9, 1', { xmin: '', xmax: '' });
check('points: rows with a header, error bars', !r.errors.length && r.circles.length === 3 && r.paths.length === 1 && r.paths[0].split('M').length - 1 === 9, JSON.stringify(r.errors));
check('…x range found from the data', r.texts.includes('1.0') || r.texts.includes('1'), r.texts.slice(0, 8).join(' '));

// histogram sampled from a formula: area 1 with density, the same draws each time, moved by mu
const hist = '.hist samples:4000 bins:40 density:yes from:-5 to:5 seed:7\ny = normal(mu, 1)';
r = await draw(hist, { ymin: 0, ymax: 0.6 });
const area = await app(async () => {
    const E = await import('/core/liveEngine.js');
    const spec = { width: 1200, height: 800, xmin: -5, xmax: 5, ymin: 0, ymax: 0.6, layers: E.parseLayers('.hist samples:4000 bins:40 density:yes from:-5 to:5 seed:7\ny = normal(mu, 1)') };
    const svg = E.plotSvg(spec, { mu: 0 });
    return { same: svg.replace(/glc\w+/g, '') === E.plotSvg(spec, { mu: 0 }).replace(/glc\w+/g, ''), svg };
});
check('histogram of a formula: 40 bars', !r.errors.length && r.rects >= 30, String(r.rects));
check('…the same draws every time (seeded)', area.same);
const h0 = r.html;
await setMu(2);
await page.waitForTimeout(80);
const h2 = await app(() => document.querySelector('#slide-canvas [data-element-id="3"] svg.gl-plot-svg').outerHTML);
check('…moving mu moves it', h0 !== h2);
await setMu(0);
const densityArea = await app(async () => {
    const E = await import('/core/liveEngine.js');
    const layers = E.parseLayers('.hist samples:4000 bins:40 density:yes from:-5 to:5\ny = normal(0, 1)');
    const spec = { width: 1000, height: 600, xmin: -5, xmax: 5, ymin: 0, ymax: 0.6, layers };
    const div = document.createElement('div');
    div.innerHTML = E.plotSvg(spec, {});
    // heights back from the rects: area = Σ h·w in data units
    const L = E.plotLayout(spec);
    let a = 0;
    div.querySelectorAll('g[clip-path] rect').forEach(rc => { a += (Number(rc.getAttribute('height')) / L.h * 0.6) * (Number(rc.getAttribute('width')) / L.w * 10); });
    return a;
});
check('…density: area 1', Math.abs(densityArea - 1) < 0.02, densityArea.toFixed(3));

// histogram of rows, and of a file's column
r = await draw('.hist bins:5\n1\n2\n2\n3\n3\n3', { xmin: '', xmax: '' });
check('histogram of rows', !r.errors.length && r.rects === 3, `${r.rects} ${r.errors}`);
r = await draw('.hist data:{data/samples.csv} column:value bins:10', { xmin: '', xmax: '' });
check('histogram of a file\'s column', !r.errors.length && r.rects === 10, `${r.rects} ${r.errors}`);
r = await draw('.hist data:{data/samples.csv} column:nope');
check('…a wrong column is named', r.errors.some(e => e.includes('no column “nope”') && e.includes('value')), r.errors.join());

// bars by category
r = await draw('.bar\nAdam, 3\nSGD, 5\nNGD, 2', { xmin: '', xmax: '' });
check('bars by category: one bar each, the names on the axis', r.rects === 3 && ['Adam', 'SGD', 'NGD'].every(t => r.texts.includes(t)), r.texts.join(' '));

// heatmap with a colour bar
r = await draw('.heatmap colormap:magma\nz = sin(x) * cos(y)', { ymin: -3, ymax: 3 });
check('heatmap: an image of the values, with a colour bar', r.images[0] === 'data:image/png;base64,' && r.html.includes('linearGradient') && r.texts.some(t => t === '0.5' || t === '0.50'), r.texts.slice(-6).join(' '));

// contour lines of x² + y² at level 1 lie on the unit circle
const contour = await app(async () => {
    const E = await import('/core/liveEngine.js');
    const spec = { width: 1000, height: 1000, xmin: -2, xmax: 2, ymin: -2, ymax: 2, fontSize: 1, layers: E.parseLayers('.contour at:1\nz = x**2 + y**2') };
    const L = E.plotLayout(spec);
    const div = document.createElement('div');
    div.innerHTML = E.plotSvg(spec, {});
    const d = div.querySelector('g[clip-path] path').getAttribute('d');
    const pts = [...d.matchAll(/[ML]([\d.]+) ([\d.]+)/g)].map(m => [(Number(m[1]) - L.left) / L.w * 4 - 2, 2 - (Number(m[2]) - L.top) / L.h * 4]);
    return { n: pts.length, worst: Math.max(...pts.map(([x, y]) => Math.abs(Math.hypot(x, y) - 1))) };
});
check('contour: the level 1 of x²+y² is the unit circle', contour.n > 50 && contour.worst < 0.02, JSON.stringify(contour));

// arrows
r = await draw('.quiver grid:10\nu = -y\nv = x', { ymin: -3, ymax: 3 });
check('arrows: a field of them', !r.errors.length && (r.paths[0].match(/M/g) || []).length > 100);
r = await draw('.quiver\nu = -y');
check('…without v: said', r.errors.some(e => e.includes('u = … and v = …')), r.errors.join());

// log and π ticks
r = await draw('.curve\ny = x**2', { xmin: 0.01, xmax: 100, xscale: 'log', yscale: 'log', ymin: 0.0001, ymax: 10000 });
check('log axes: decades', !r.errors.length && ['10⁻²', '1', '10', '100', '10⁴'].every(t => r.texts.includes(t)), r.texts.join(' '));
r = await draw('.curve\ny = sin(x)', { xmin: 0, xmax: 6.2832, xticks: 'pi' });
check('ticks at multiples of π', ['π/2', 'π', '3π/2', '2π'].every(t => r.texts.includes(t)), r.texts.join(' '));

// log scale over a range with 0 or negatives: drawn from just above 0, with a note
r = await draw('.curve\ny = x**2 + 1', { xmin: -5, xmax: 5, xscale: 'log', yscale: 'log' });
check('log over −5…5: drawn, no error, a note', !r.errors.length && r.paths[0] && r.paths[0].length > 100 && r.texts.some(t => t.includes('values above 0 only')) && !r.html.includes('NaN'), r.texts.slice(-3));
// axes: none (only the plot), zero (through the origin)
r = await draw('.curve\ny = sin(x)', { axes: 'none' });
check('axes none: no numbers, no grid, the curve', r.texts.length === 0 && !r.html.includes('stroke-opacity="0.12"') && r.paths.length === 1, r.texts);
r = await draw('.curve\ny = sin(x)', { axes: 'zero', ymin: -1.5, ymax: 1.5 });
check('axes through the origin: numbers next to them, no 0', r.texts.includes('2') && r.texts.includes('−1.0') && !r.texts.includes('0'), r.texts);

// a data file: chosen in a layer's card, read, drawn, followed when it changes
await app(async () => {
    const { state, setSelectedElementIndices } = await import('/core/state.js');
    state.slides[0].elements[1].code = '.line color:@primary markers:yes\n1, 1\n2, 4';
    setSelectedElementIndices([1], 1);
    (await import('/editor/editor.js')).renderEditor();
});
await page.waitForTimeout(150);
await page.click('[data-layer-op="pickfile"][data-layer="0"]');
await page.waitForTimeout(400);
const linked = await app(async () => (await import('/core/state.js')).state.slides[0].elements[1].code);
check('a layer\'s data file: copied, its columns set by name, the rows kept below', linked === '.line color:@primary markers:yes data:{data/run.csv} original:/home/me/exp/run.csv x:step y:loss\n1, 1\n2, 4', JSON.stringify(linked));
const columns = await app(() => [...document.querySelectorAll('[data-layer-field="y"] option')].map(o => o.value));
check('…the column menus list the file\'s header', JSON.stringify(columns) === '["","step","loss","std"]', JSON.stringify(columns));
r = await draw('.points data:{data/run.csv} x:step y:loss yerr:std', { xmin: '', xmax: '' });
check('…drawn', !r.errors.length && r.circles.length === 4, `${r.circles.length} ${r.errors}`);
await app(() => { window.__run = { mtime: 2, rows: [...window.__run.rows, ['5', '0.1', '0.01'], ['6', '0.05', '0.01']] }; window.dispatchEvent(new Event('focus')); });
await page.waitForTimeout(400);
const after = await app(() => document.querySelectorAll('#slide-canvas [data-element-id="3"] svg g[clip-path] circle').length);
check('…and redrawn when the file changes', after === 6, String(after));
r = await draw('.points data:{data/missing.csv}');
await page.waitForTimeout(150);
r = await draw('.points data:{data/missing.csv}');
check('a missing file is said', r.errors.some(e => e.includes('no such file')), r.errors.join());

// the export redraws layers with the slider (heatmap and histogram)
await draw('.heatmap\nz = sin(x - mu) * cos(y)\n.hist samples:500 bins:20 density:yes opacity:0.4\ny = normal(mu, 1)', { ymin: -3, ymax: 3 });
const html = await app(async () => (await import('/export/html.js')).getExportHtmlString({ localAssets: true }));
const exp = await browser.newPage({ viewport: { width: 1400, height: 900 } });
const expErrors = [];
exp.on('pageerror', e => expErrors.push(e.message));
await exp.goto(`${BASE_URL}/index.html`);
await exp.setContent(html);
await exp.waitForTimeout(300);
const moved = await exp.evaluate(() => {
    const img = () => document.querySelector('.slide.active svg.gl-plot-svg image').getAttribute('href');
    const before = img();
    const input = document.querySelector('.slide.active input[data-glslider="mu"]');
    input.value = '1.5';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    return before !== img();
});
check('export: the heatmap follows the slider', moved);
check('export: no script errors', !expErrors.length, expErrors.join(' | '));
await exp.close();

console.log(out.join('\n'));
console.log('--- errors ---\n' + (errors.join('\n') || '(none)'));
await browser.close();
