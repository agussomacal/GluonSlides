// Variables, plots and sliders (core/variables.js, core/liveEngine.js,
// elements/plot, elements/slider): formulas in Python and LaTeX give the
// same numbers and can't run code; \var{…} in text and math; the .gl
// keeps .vars, plots (as typed) and sliders; a slider on the canvas moves
// the curve and the values; the exported HTML does the same by itself.
import { launchBrowser, BASE_URL } from '../helpers.mjs';

const browser = await launchBrowser();
const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
const errors = [];
page.on('pageerror', e => errors.push(e.message));
const out = [];
const check = (n, c, x = '') => out.push(`${c ? 'PASS' : 'FAIL'} ${n}${x !== '' ? ' — ' + x : ''}`);
const app = (fn, arg) => page.evaluate(fn, arg);

await page.goto(`${BASE_URL}/index.html`);
await page.waitForTimeout(300);

// ---------- the engine ----------
const engine = await app(async () => {
    const E = await import('/core/liveEngine.js');
    const at = (code, lang, vars, x) => {
        const f = E.compileFormula(code, lang);
        return f.error ? `ERR ${f.error}` : f.evaluate(vars)(x);
    };
    const v = { mu: 0.5, sigma: 1.5 };
    const gauss = (x) => Math.exp(-((x - 0.5) ** 2) / (2 * 2.25)) / Math.sqrt(2 * Math.PI * 2.25);
    return {
        py: at('s2 = sigma**2\ny = exp(-(x - mu)**2 / (2*s2)) / sqrt(2*pi*s2)', 'python', v, 1.2),
        pyNp: at('np.exp(-(x-mu)**2/(2*sigma**2)) / math.sqrt(2*np.pi*sigma**2)', 'python', v, 1.2),
        tex: at('\\frac{1}{\\sqrt{2\\pi\\sigma^2}} e^{-\\frac{(x-\\mu)^2}{2\\sigma^2}}', 'latex', v, 1.2),
        texY: at('y = \\frac{1}{\\sigma\\sqrt{2\\pi}} \\exp\\left(-\\frac{(x-\\mu)^2}{2\\sigma^2}\\right)', 'latex', v, 1.2),
        want: gauss(1.2),
        precedence: at('-x**2 + 2*3', 'python', {}, 3),
        ternary: at('x if x > 0 else 0', 'python', {}, -2),
        texImplicit: at('2x\\sin x + |x-3|', 'latex', {}, 1),
        texSub: at('a_0 + a_{1} x^2', 'latex', { a_0: 1, a_1: 2 }, 3),
        unknown: E.compileFormula('y = exp(-x) * k', 'python').names,
        evil: at('alert(1)', 'python', {}, 0),
        evil2: at('constructor.constructor("return 1")()', 'python', {}, 0),
        evil3: at('__proto__', 'python', {}, 0).toString(),
        syntax: at('y = (x + ', 'python', {}, 0),
        fmt: [E.formatValue(0.12345, '%.2f'), E.formatValue(0.05, '%.1%'), E.formatValue(-1234.5), E.formatValue(12345678, '%.2e')],
        curves: E.parseCurves('.curve color:red label:"a b"\ny = x\n.curve dash:dashed\nx**2', 'python').map(c => [c.color, c.label, c.dash || '', c.code]),
    };
});
const near = (a, b) => typeof a === 'number' && Math.abs(a - b) < 1e-9;
check('python: a Gaussian, with a helper line', near(engine.py, engine.want), `${engine.py} vs ${engine.want}`);
check('python: np. and math. prefixes', near(engine.pyNp, engine.want), String(engine.pyNp));
check('latex: the same Gaussian (\\frac, \\sqrt, e^{…}, implicit products)', near(engine.tex, engine.want), String(engine.tex));
check('latex: y = … with \\exp\\left(…\\right)', near(engine.texY, engine.want), String(engine.texY));
check('python precedence: -x**2 is -(x²)', engine.precedence === -3, String(engine.precedence));
check('python: x if c else y', engine.ternary === 0, String(engine.ternary));
check('latex: 2x\\sin x + |x−3|', near(engine.texImplicit, 2 * Math.sin(1) + 2), String(engine.texImplicit));
check('latex: subscripts are names (a_0, a_{1})', engine.texSub === 19, String(engine.texSub));
check('the names a formula needs', JSON.stringify(engine.unknown) === '["k"]', JSON.stringify(engine.unknown));
check('no code runs: alert(1) is an unknown function', String(engine.evil).includes('unknown function: alert'), String(engine.evil));
check('…nor constructor tricks', String(engine.evil2).startsWith('ERR'), String(engine.evil2));
check('…nor __proto__', /unknown name|ERR/.test(engine.evil3) || engine.evil3 === 'NaN', engine.evil3);
check('a syntax error says so', String(engine.syntax).startsWith('ERR'), String(engine.syntax));
check('number formats', JSON.stringify(engine.fmt) === JSON.stringify(['0.12', '5.0%', '−1234.5', '1.23e+7']), JSON.stringify(engine.fmt));
check('.curve lines', JSON.stringify(engine.curves) === JSON.stringify([['red', 'a b', '', 'y = x'], [undefined, undefined, 'dashed', 'x**2']]), JSON.stringify(engine.curves));

// ---------- a project with variables, a plot and a slider ----------
const GL = `.project {Live} version:2 width:1920 height:1080 grid:0 nextid:50
.vars alpha:0.05 n:12

.slide {Gauss} id:1
.element.text id:2 x:100 y:60 width:1700 height:120 fontSize:40
	Error \\var{alpha}[%.1%], $\\mu = \\var{mu}[%.2f]$, n = \\var{n}, missing \\var{nope}, code \`\\var{n}\`
.element.slider id:3 x:100 y:900 width:700 height:80 var:mu min:-3 max:3 step:0.1 value:0 label:"$\\mu$"
.element.plot id:4 x:100 y:200 width:1200 height:650 lang:python xmin:-5 xmax:5 xlabel:"$x$"
	.curve color:@primary width:4 label:"$\\mathcal{N}(\\mu, 1)$"
	y = exp(-(x - mu)**2 / 2) / sqrt(2*pi)
	.curve color:#dc2626 dash:dashed lang:latex
	\\frac{1}{\\sqrt{2\\pi}} e^{-x^2/2}
`;
await app(async (gl) => {
    await (await import('/ui/project.js')).openSampleProject();
    const { state, applyProjectData, parseProjectContent } = await import('/core/state.js');
    applyProjectData(parseProjectContent(gl));
    (await import('/editor/editor.js')).selectSlide(0);
}, GL);
await page.waitForTimeout(300);

const text = await app(() => {
    const t = document.querySelector('#slide-canvas [data-element-id="2"]');
    return { html: t.innerHTML, text: t.textContent, mathVar: !!t.querySelector('.katex [data-glvar="mu"]') };
});
check('\\var in text, with a format', text.text.includes('Error 5.0%') && text.text.includes('n = 12'), text.text.slice(0, 120));
check('\\var in math: a KaTeX marker', text.mathVar, text.html.slice(0, 200));
check('an unknown variable is flagged', text.text.includes('[? nope]'));
check('`\\var{n}` in inline code stays as written', text.text.includes('code \\var{n}'), text.text.slice(-40));

const plot = await app(() => {
    const p = document.querySelector('#slide-canvas [data-element-id="4"]');
    const paths = [...p.querySelectorAll('svg.gl-plot-svg g[clip-path] path')].map(x => x.getAttribute('d'));
    return { paths, legend: p.querySelector('.gl-plot-legend .katex-html')?.textContent || '', label: !!p.querySelector('.gl-plot-label .katex'), err: p.querySelector('svg text[fill="#dc2626"], g[fill="#dc2626"] text')?.textContent || '' };
});
check('the plot draws both curves', plot.paths.length === 2 && plot.paths.every(d => d.length > 200), JSON.stringify(plot.paths.map(d => d.length)));
check('…the same curve in python and latex at mu = 0', plot.paths[0] === plot.paths[1]);
check('…legend and axis label with math', !plot.legend.includes('mathcal') && plot.legend.includes('μ') && plot.label, plot.legend);
check('…no error', !plot.err, plot.err);

await page.screenshot({ path: 'tests/e2e/output/plots-editor.png' });
// the slider on the canvas
const slid = await app(() => {
    const input = document.querySelector('#slide-canvas [data-element-id="3"] input[type=range]');
    const before = document.querySelector('#slide-canvas [data-element-id="4"] svg.gl-plot-svg g[clip-path] path').getAttribute('d');
    input.value = '1.5';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    const after = document.querySelector('#slide-canvas [data-element-id="4"] svg.gl-plot-svg g[clip-path] path').getAttribute('d');
    const shown = document.querySelector('#slide-canvas [data-element-id="2"] [data-glvar="mu"]').textContent;
    const value = document.querySelector('#slide-canvas [data-element-id="3"] .gl-slider-value').textContent;
    return { moved: before !== after, shown, value };
});
check('moving the slider redraws the curve', slid.moved);
check('…and updates the values in text (also in math)', slid.shown === '1.50' && slid.value === '1.5', JSON.stringify(slid));
// a real drag on the slider's knob: the value changes, the slider stays put
const knob = await page.locator('#slide-canvas [data-element-id="3"] input[type=range]').boundingBox();
await page.mouse.move(knob.x + knob.width * 0.5, knob.y + knob.height / 2);
await page.mouse.down();
await page.mouse.move(knob.x + knob.width * 0.9, knob.y + knob.height / 2, { steps: 8 });
await page.mouse.up();
await page.waitForTimeout(150);
const dragged = await app(async () => {
    const { state } = await import('/core/state.js');
    const el = state.slides[0].elements.find(e => e.id === 3);
    return { x: el.x, y: el.y, shown: document.querySelector('#slide-canvas [data-element-id="3"] .gl-slider-value').textContent };
});
check('dragging the knob moves the value, not the slider', dragged.x === 100 && dragged.y === 900 && Number(dragged.shown.replace('−', '-')) > 1.5, JSON.stringify(dragged));
const saved = await app(async () => (await import('/core/state.js')).serializeProject());
check('…without changing the file', saved.includes('value:0') && !saved.includes('value:1.5'));

// .gl round trip
check('.vars written back', saved.includes('.vars alpha:0.05 n:12'), saved.split('\n').filter(l => l.startsWith('.vars')).join(' | '));
check('the plot body as typed (.curve lines, LaTeX untouched)', saved.includes('\t.curve color:@primary width:4 label:"$\\mathcal{N}(\\mu, 1)$"') && saved.includes('\t\\frac{1}{\\sqrt{2\\pi}} e^{-x^2/2}'), saved.split('\n').filter(l => l.startsWith('\t')).slice(0, 6).join(' | '));
const again = await app(async (s) => {
    const { parseProjectContent } = await import('/core/state.js');
    const p = parseProjectContent(s);
    const plot = p.slides[0].elements.find(e => e.type === 'plot');
    const slider = p.slides[0].elements.find(e => e.type === 'slider');
    return { code: plot.code, vars: p.vars, slider: [slider.var, slider.min, slider.max, slider.step, slider.value, slider.label] };
}, saved);
check('…read back the same', again.code.startsWith('.curve color:@primary') && again.vars.alpha === 0.05 && JSON.stringify(again.slider) === JSON.stringify(['mu', -3, 3, 0.1, 0, '$\\mu$']), JSON.stringify(again));

// errors are shown on the plot
await app(async () => {
    const { state } = await import('/core/state.js');
    state.slides[0].elements[2].code = 'y = exp(-x**2) * k';
    (await import('/editor/editor.js')).renderEditor();
});
const err = await app(() => [...document.querySelectorAll('#slide-canvas [data-element-id="4"] svg text')].map(t => t.textContent).join(' | '));
check('a missing variable is said on the plot', err.includes('unknown name: k'), err);
await app(async () => {
    const { state } = await import('/core/state.js');
    state.slides[0].elements[2].code = '.curve color:@primary\ny = exp(-(x - mu)**2 / 2) / sqrt(2*pi)';
    (await import('/editor/editor.js')).renderEditor();
});

// ---------- the toolbar ----------
const menu = await app(() => [...document.querySelectorAll('.toolbar-dropdown[data-category="interactive"] .toolbar-menu button')].map(b => b.textContent.trim()));
check('Interactive ▾: Plot and Slider', JSON.stringify(menu.map(t => t.replace(/^\S+\s*/, ''))) === '["Plot","Slider"]', JSON.stringify(menu));

// a new plot: Python first; choosing LaTeX in its panel swaps the example
await app(async () => (await import('/editor/editor.js')).addElement('plot'));
await page.waitForTimeout(200);
const fresh = () => app(async () => { const { state } = await import('/core/state.js'); const p = state.slides[0].elements.filter(e => e.type === 'plot').pop(); return { lang: p.lang, code: p.code }; });
const first = await fresh();
await page.selectOption('#properties-body select[data-prop="lang"]', 'latex');
await page.waitForTimeout(200);
const swapped = await fresh();
check('a new plot is Python; LaTeX in the panel swaps the example', first.lang === 'python' && first.code.includes('exp(') && swapped.lang === 'latex' && swapped.code.includes('\\frac'), JSON.stringify([first, swapped]));

// ---------- the exported HTML works by itself ----------
const html = await app(async () => (await import('/export/html.js')).getExportHtmlString({ localAssets: true }));
check('export: the engine and the starting values inlined', html.includes('function plotSvg') && html.includes('"alpha":0.05') && !/^export /m.test(html.split('<script>').pop()));
const exp = await browser.newPage({ viewport: { width: 1400, height: 900 } });
const expErrors = [];
exp.on('pageerror', e => expErrors.push(e.message));
await exp.goto(`${BASE_URL}/index.html`);
await exp.setContent(html);
await exp.waitForTimeout(300);
const live = await exp.evaluate(() => {
    const slide = document.querySelector('.slide.active');
    const input = slide.querySelector('input[data-glslider="mu"]');
    const path = () => slide.querySelector('svg.gl-plot-svg g[clip-path] path').getAttribute('d');
    const before = path();
    input.value = '-2';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    return { moved: path() !== before, shown: slide.querySelector('.katex [data-glvar="mu"]')?.textContent, value: slide.querySelector('.gl-slider-value').textContent };
});
await exp.screenshot({ path: 'tests/e2e/output/plots-export.png' });
check('export: the slider moves the curve', live.moved, JSON.stringify(live));
check('export: values in math follow', live.shown === '−2.00', JSON.stringify(live));
// a click on the slider doesn't change slide
const box = await exp.locator('.slide.active input[data-glslider="mu"]').boundingBox();
await exp.mouse.click(box.x + box.width * 0.8, box.y + box.height / 2);
await exp.waitForTimeout(200);
const still = await exp.evaluate(() => document.querySelector('.slide.active').id);
check('export: clicking the slider stays on the slide', still === 'slide-0', still);
// the presenter view's values reach the audience window
const followed = await exp.evaluate(async () => {
    const path = () => document.querySelector('.slide.active svg.gl-plot-svg g[clip-path] path').getAttribute('d');
    const before = path();
    window.postMessage({ type: 'gluon-control', action: 'vars', vars: { mu: 2.5 } }, '*');
    await new Promise(r => setTimeout(r, 100));
    return { moved: path() !== before, slider: document.querySelector('.slide.active input[data-glslider="mu"]').value };
});
check('audience window: follows the presenter\'s slider', followed.moved && followed.slider === '2.5', JSON.stringify(followed));
check('export: no script errors', !expErrors.length, expErrors.join(' | '));
await exp.close();

// the presenter view: its copy of the slide has a working slider, and says so to the audience
const presenterHtml = await app(async () => (await import('/export/html.js')).getExportHtmlString({ localAssets: true, mode: 'presenter' }));
const pres = await browser.newPage({ viewport: { width: 1400, height: 900 } });
await pres.goto(`${BASE_URL}/index.html`);
await pres.setContent(presenterHtml);
await pres.waitForTimeout(400);
const sent = await pres.evaluate(async () => {
    let out = null;
    window.addEventListener('gluon-vars-out', (e) => { out = e.detail; });
    const input = document.querySelector('.gp-current .gp-copy input[data-glslider="mu"]');
    if (!input) return { error: 'no slider in the presenter copy' };
    const path = () => document.querySelector('.gp-current .gp-copy svg.gl-plot-svg g[clip-path] path').getAttribute('d');
    const before = path();
    input.value = '-1';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    return { out, moved: path() !== before };
});
check('presenter view: its slider works and is sent to the audience', sent.out && sent.out.mu === -1 && sent.moved, JSON.stringify(sent));
await pres.close();

console.log(out.join('\n'));
console.log('--- errors ---\n' + (errors.join('\n') || '(none)'));
await browser.close();
