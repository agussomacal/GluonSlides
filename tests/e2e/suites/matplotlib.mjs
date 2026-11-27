// Plots written with matplotlib and numpy (core/mplEngine.js, lang:matplotlib):
// the calls become layers, numpy arrays compute element-wise, the draws are
// the same each time, unsupported things and unsafe names are said with their
// line; the plot draws on the canvas (title, legend), follows a slider, has a
// script editor in its panel, keeps its text in the .gl, and works in the
// exported HTML.
import { launchBrowser, BASE_URL } from '../helpers.mjs';

const browser = await launchBrowser();
const page = await browser.newPage({ viewport: { width: 1400, height: 1000 } });
const errors = [];
page.on('pageerror', e => errors.push(e.message));
const out = [];
const check = (n, c, x = '') => out.push(`${c ? 'PASS' : 'FAIL'} ${n}${x !== '' ? ' — ' + JSON.stringify(x) : ''}`);
const app = (fn, arg) => page.evaluate(fn, arg);

await page.goto(`${BASE_URL}/index.html`);
await page.waitForTimeout(300);

// ---------- the reader ----------
const SCRIPT = `import numpy as np
import matplotlib.pyplot as plt

x = np.linspace(-5, 5, num=400)
fig, ax = plt.subplots()
ax.hist(np.random.normal(mu, 1, 2000), bins=40, density=True, alpha=0.4, label='samples')
ax.plot(x, np.exp(-(x - mu)**2 / 2) / np.sqrt(2*np.pi), 'C0', lw=2, label=r'$\\mathcal{N}(\\mu, 1)$')
ax.axvline(mu, ls='--', color='k')
for k in range(2):
    ax.plot(x, 0.1 * np.sin(x + k), label=f'k = {k}')
ax.fill_between(x, 0, np.exp(-x**2), where=np.abs(x) < 1, alpha=0.2)
ax.set_xlabel('$x$'); ax.set_xlim(-5, 5)
ax.legend()
plt.title(f"mu = {mu:.2f}")`;
const reader = await app(async (script) => {
    const M = await import('/core/mplEngine.js');
    const run = (code, vars = {}) => { try { const r = M.runMatplotlib(code, vars); return { kinds: r.layers.map(l => l.kind), settings: r.settings, layers: r.layers }; } catch (e) { return { error: `line ${e.line}: ${e.message}` }; } };
    const a = run(script, { mu: 0.5 });
    const b = run(script, { mu: 0.5 });
    const c = run(script, { mu: 1.5 });
    const meanOf = (r) => { const v = r.layers[0].table.rows.map(q => q[0]); return v.reduce((s, q) => s + q, 0) / v.length; };
    return {
        kinds: a.kinds, settings: a.settings,
        curveAt: a.layers[1].table.rows[200], same: JSON.stringify(a.layers[0].table.rows) === JSON.stringify(b.layers[0].table.rows),
        shift: meanOf(c) - meanOf(a), colours: [a.layers[1].color, a.layers[3].color, a.layers[2].color],
        filled: a.layers[5].table.rows.length,
        grid: run('X, Y = np.meshgrid(np.linspace(-2, 2, 50), np.linspace(-1, 1, 30))\nZ = np.exp(-(X**2 + Y**2))\nplt.pcolormesh(X, Y, Z, cmap="magma")\nplt.colorbar()\nplt.contour(X, Y, Z, levels=[0.5])\nplt.quiver(X[::5, ::5], Y[::5, ::5], -Y[::5, ::5], X[::5, ::5])'),
        misc: run('d = [1, 2, 3]\nsq = [v**2 for v in d if v > 1]\nplt.bar(["A", "B"], sq, color="tab:orange")\nplt.scatter(np.arange(5), np.arange(5)**2, s=36, c="r")\nplt.errorbar([1, 2], [3, 4], yerr=[0.1, 0.2], fmt="o")\nplt.yscale("log"); plt.axis("off"); plt.grid(True)'),
        errors: [
            run('plt.plot(x)'), run('y = np.foo(3)'), run('plt.twinx()'), run('for i in range(3):\nplt.plot([1, 2])'),
            run('__import__("os")'), run('a = ().__class__'), run('np.constructor("return 1")()'), run('import os'),
            run('np.linspace(0, 1, nums=3)'), run('while True:\n    pass'),
        ].map(r => r.error),
    };
}, SCRIPT);
check('calls become layers, in order', JSON.stringify(reader.kinds) === '["hist","line","vline","line","line","fill"]', reader.kinds);
check('settings: label, x range, legend, title with an f-string', reader.settings.xlabel === '$x$' && reader.settings.xmin === -5 && reader.settings.legend === 'yes' && reader.settings.title === 'mu = 0.50' && reader.settings.grid === 'no', reader.settings);
check('numpy element-wise: the Gaussian at x = 0.0125', Math.abs(reader.curveAt[1] - Math.exp(-((0.012531 - 0.5) ** 2) / 2) / Math.sqrt(2 * Math.PI)) < 1e-4, reader.curveAt);
check('the same draws every time; mu shifts them by exactly mu', reader.same && Math.abs(reader.shift - 1) < 1e-9, reader.shift);
check('colours: C0, the cycle, k', reader.colours[0] === '#1f77b4' && reader.colours[1] === '#ff7f0e' && reader.colours[2] === '#000000', reader.colours);
check('fill_between where=: only |x| < 1', reader.filled === 80, reader.filled);
check('2D: pcolormesh (+ colorbar), contour at a level, quiver of slices', JSON.stringify(reader.grid.kinds) === '["heatmap","contour","quiver"]' && reader.grid.layers[0].colorbar === 'yes' && reader.grid.layers[0].colormap === 'magma' && reader.grid.layers[1].at === '0.5' && reader.grid.layers[2].arrowsData.length === 60, reader.grid.error || reader.grid.kinds);
check('lists, comprehensions, bar, scatter, errorbar, log, axis off, grid', JSON.stringify(reader.misc.kinds) === '["bar","points","points"]' && reader.misc.settings.yscale === 'log' && reader.misc.settings.axes === 'none' && reader.misc.settings.grid === 'yes', reader.misc.error || reader.misc);
const [e1, e2, e3, e4, e5, e6, e7, e8, e9, e10] = reader.errors;
check('unknown names, functions and calls are said with their line', e1 === 'line 1: unknown name: x' && e2 === 'line 1: np has no .foo' && e3.includes('twinx (not supported yet)'), [e1, e2, e3]);
check('a missing indentation is said', e4 === 'line 2: expected an indented block after “:”', e4);
check('no way out: __import__, __class__, constructor, import os', e5.includes('unknown name: __import__') && e6.includes('.__class__ isn\'t available') && e7.includes('no .constructor') && e8.includes('only numpy, math and matplotlib.pyplot'), [e5, e6, e7, e8]);
check('a wrong keyword argument, and while (not supported)', e9.includes('nums= isn\'t supported') && e10.includes('while isn\'t supported'), [e9, e10]);

// ---------- on the canvas ----------
await app(async (code) => {
    await (await import('/ui/project.js')).openSampleProject();
    const { state, setSelectedElementIndices } = await import('/core/state.js');
    state.gridSize = 0;
    state.slides = [{ id: 1, title: 'P', elements: [
        { type: 'slider', id: 2, x: 100, y: 950, width: 600, height: 70, var: 'mu', min: -3, max: 3, step: 0.1, value: 0.5 },
        { type: 'plot', id: 3, x: 100, y: 60, width: 1200, height: 860, lang: 'matplotlib', code },
    ] }];
    (await import('/editor/editor.js')).selectSlide(0);
    setSelectedElementIndices([1], 1);
    (await import('/editor/editor.js')).renderEditor();
}, SCRIPT);
await page.waitForTimeout(400);
const canvas = await app(() => {
    const p = document.querySelector('#slide-canvas [data-element-id="3"]');
    const svg = p.querySelector('svg.gl-plot-svg');
    return {
        rects: svg.querySelectorAll('g[clip-path] rect').length, paths: svg.querySelectorAll('g[clip-path] path').length,
        errors: [...svg.querySelectorAll('g[fill="#dc2626"] text')].map(t => t.textContent),
        title: p.querySelector('.gl-plot-title')?.textContent, legend: p.querySelector('.gl-plot-legend')?.textContent || '',
        xlabel: !!p.querySelector('.gl-plot-label .katex'),
    };
});
check('drawn: histogram bars, lines, area; no error', canvas.rects >= 20 && canvas.paths >= 5 && !canvas.errors.length, canvas);
check('…title, legend (legend() called) and the x label', canvas.title.trim() === 'mu = 0.50' && canvas.legend.includes('samples') && canvas.legend.includes('k = 1') && canvas.xlabel, canvas);
await page.screenshot({ path: 'tests/e2e/output/matplotlib-editor.png' });
const before = await app(() => document.querySelector('#slide-canvas [data-element-id="3"] svg g[clip-path]').innerHTML);
await app(() => { const i = document.querySelector('#slide-canvas [data-element-id="2"] input'); i.value = '-1'; i.dispatchEvent(new Event('input', { bubbles: true })); });
await page.waitForTimeout(150);
check('a slider re-reads the script', before !== await app(() => document.querySelector('#slide-canvas [data-element-id="3"] svg g[clip-path]').innerHTML));

// ---------- the panel ----------
const panel = await app(() => ({
    langs: [...document.querySelectorAll('#properties-body select[data-prop="lang"] option')].map(o => o.value),
    editor: !!document.querySelector('[data-plot-script] .CodeMirror'), cards: document.querySelectorAll('[data-layer-card]').length,
    kw: [...document.querySelectorAll('[data-plot-script] .cm-gl-fkw')].map(t => t.textContent).slice(0, 3),
}));
check('the panel: Written as … matplotlib; a script editor, not cards', panel.langs.includes('matplotlib') && panel.editor && panel.cards === 0, panel);
check('…coloured (keywords)', panel.kw.includes('import'), panel.kw);
await page.click('[data-plot-script] .CodeMirror');
await page.keyboard.press('Control+End');
await page.keyboard.press('Enter');
await page.keyboard.type('plt.twinx()', { delay: 10 });
await page.waitForTimeout(500);
const err = await app(() => ({ msg: document.querySelector('[data-script-error]').textContent, marked: document.querySelectorAll('[data-plot-script] .plot-formula-error').length }));
check('typing: written back, an unsupported call said and its line marked', err.msg.includes('twinx') && err.marked === 1 && (await app(async () => (await import('/core/state.js')).state.slides[0].elements[1].code)).includes('plt.twinx('), err);
for (let k = 0; k < 11; k++) await page.keyboard.press('Backspace');
await page.keyboard.type('np.lin', { delay: 30 });
await page.waitForTimeout(300);
const hints = await app(() => [...document.querySelectorAll('.CodeMirror-hints li')].map(li => li.textContent));
check('suggestions after np.', hints.some(h => h.includes('linspace')), hints);
await page.keyboard.press('Escape');

// ---------- the .gl keeps the script as written ----------
const round = await app(async () => {
    const { serializeProject, parseProjectContent } = await import('/core/state.js');
    const text = serializeProject();
    const back = parseProjectContent(text).slides[0].elements.find(e => e.type === 'plot');
    const { state } = await import('/core/state.js');
    return { same: back.code === state.slides[0].elements[1].code, lang: back.lang, loop: text.includes('\tfor k in range(2):\n\t    ax.plot(') };
});
check('.gl: lang:matplotlib, the script as typed (indented loop)', round.same && round.lang === 'matplotlib' && round.loop, round);

// switching an example plot to matplotlib gives the matplotlib example
await app(async () => {
    const { state, setSelectedElementIndices } = await import('/core/state.js');
    state.slides[0].elements[1].code = state.slides[0].elements[1].code.replace(/\nnp\.lin$/, '');
    (await import('/editor/editor.js')).addElement('plot');
});
await page.waitForTimeout(200);
await page.selectOption('#properties-body select[data-prop="lang"]', 'matplotlib');
await page.waitForTimeout(300);
const ex = await app(async () => { const { state } = await import('/core/state.js'); const p = state.slides[0].elements.filter(e => e.type === 'plot').pop(); return { lang: p.lang, code: p.code }; });
check('a new plot switched to matplotlib: the matplotlib example', ex.lang === 'matplotlib' && ex.code.includes('np.linspace'), ex);

// ---------- the exported HTML ----------
const html = await app(async () => (await import('/export/html.js')).getExportHtmlString({ localAssets: true }));
check('export: the reader inlined (once)', html.includes('function runMatplotlib') && (html.match(/function runMatplotlib/g) || []).length === 1);
const exp = await browser.newPage({ viewport: { width: 1400, height: 900 } });
const expErrors = [];
exp.on('pageerror', e => expErrors.push(e.message));
await exp.goto(`${BASE_URL}/index.html`);
await exp.setContent(html);
await exp.waitForTimeout(300);
const moved = await exp.evaluate(() => {
    const g = () => document.querySelector('.slide.active [data-gl-plot] svg g[clip-path]').innerHTML;
    const before = g();
    const input = document.querySelector('.slide.active input[data-glslider="mu"]');
    input.value = '2';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    return { moved: before !== g(), errors: [...document.querySelector('.slide.active [data-gl-plot] svg').querySelectorAll('g[fill="#dc2626"] text')].map(t => t.textContent) };
});
check('export: the matplotlib plot follows the slider', moved.moved && !moved.errors.length, moved);
check('export: no script errors', !expErrors.length, expErrors.join(' | '));
await exp.close();

console.log(out.join('\n'));
console.log('--- errors ---\n' + (errors.join('\n') || '(none)'));
await browser.close();
