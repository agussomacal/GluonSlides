// A plot's settings that follow the variables: a layer's numbers may be
// formulas (samples:"=10*n"; whole numbers rounded to the nearest), a
// layer may have a "Visible when" condition (the legend follows), the
// axis ranges may be formulas; the layer cards take them; "Follow a
// variable…" on a plot lists its own settings, a line, then its layers
// (each opens into its settings), and a search finds the layers' settings.
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

// ---------- the engine ----------
const engine = await app(async () => {
    const E = await import('/core/liveEngine.js');
    const base = { width: 800, height: 500, xmin: -5, xmax: 5, ymin: 0, ymax: 10, grid: 'no' };
    const hist = (bins, vars) => {
        const svg = E.plotSvg({ ...base, layers: E.parseLayers(`.hist samples:"=n" bins:${bins} from:0 to:10\ny = i + 0.5`) }, vars);
        const g = svg.match(/<g fill="[^"]*" fill-opacity[^>]*>(.*?)<\/g>/);
        return g ? (g[1].match(/<rect/g) || []).length : -1;
    };
    const curves = (vars) => (E.plotSvg({ ...base, layers: E.parseLayers(".curve visible:\"=model == 'A'\"\ny = 1\n.curve\ny = 2") }, vars).match(/<path d="M/g) || []).length;
    return {
        bins: hist('"=b"', { n: 10, b: 4.6 }),
        binsDown: hist('"=floor(b)"', { n: 10, b: 4.6 }),
        samplesErr: E.plotErrors({ ...base, layers: E.parseLayers('.hist samples:"=n*10"\ny = normal(0, 1)') }, { n: 2.5 }),
        unknown: E.plotErrors({ ...base, layers: E.parseLayers('.hist samples:"=m"\ny = normal(0, 1)') }, {}),
        shownA: curves({ model: 'A' }),
        shownB: curves({ model: 'B' }),
        badCond: E.plotErrors({ ...base, layers: E.parseLayers('.curve visible:"=zz > 0"\ny = 1') }, {}),
        shownList: E.shownLayers({ layers: E.parseLayers(".curve visible:\"=model == 'A'\"\ny = 1\n.curve hidden:yes\ny = 2\n.curve\ny = 3") }, { model: 'B' }),
        ranges: E.autoRanges({ ...base, xmin: '=a-1', xmax: '=a+1', layers: E.parseLayers('y = x') }, { a: 3 }).x,
        width: /stroke-width="6"/.test(E.plotSvg({ ...base, layers: E.parseLayers('.curve width:"=2*w"\ny = 1') }, { w: 3 })),
    };
});
check('bins:"=b" with b = 4.6: rounded to the nearest (5 bars)', engine.bins === 5, engine.bins);
check('…floor(b) for the other way (4 bars)', engine.binsDown === 4, engine.binsDown);
check('samples:"=n*10" draws (no error)', engine.samplesErr[0] === '', engine.samplesErr);
check('a formula of an unknown name: the layer says so', /samples: unknown name m/.test(engine.unknown[0]), engine.unknown);
check('visible:"=model == \'A\'": drawn for A, not for B', engine.shownA - engine.shownB === 1, [engine.shownA, engine.shownB]);
check('a bad condition: the layer says so', /visible: unknown name zz/.test(engine.badCond[0]), engine.badCond);
check('shownLayers: condition, hidden:yes, always', JSON.stringify(engine.shownList) === '[false,false,true]', engine.shownList);
check('axis ranges as formulas (xmin:"=a-1" xmax:"=a+1")', JSON.stringify(engine.ranges) === '[2,4]', engine.ranges);
check('a line width as a formula', engine.width);

// ---------- a plot on a slide: the legend follows the condition ----------
const CODE = ".hist samples:1000 bins:30 color:@muted label:\"draws\"\ny = normal(mu, 1)\n.curve color:@primary label:\"Gaussian\" visible:\"=model == 'Gaussian'\"\ny = exp(-(x-mu)**2/2)/sqrt(2*pi)";
await app(async (code) => {
    await (await import('/ui/project.js')).openSampleProject();
    const { state, setSelectedElementIndices } = await import('/core/state.js');
    state.gridSize = 0;
    state.slides = [{ id: 1, title: 'P', elements: [
        { type: 'slider', id: 2, x: 100, y: 950, width: 600, height: 70, var: 'mu', min: -3, max: 3, step: 0.1, value: 0 },
        { type: 'choice', id: 4, x: 800, y: 950, width: 500, height: 70, var: 'model', options: 'Gaussian, Laplace', value: 'Laplace' },
        { type: 'plot', id: 3, x: 100, y: 100, width: 1200, height: 800, lang: 'python', xmin: -5, xmax: 5, code },
    ] }];
    (await import('/editor/editor.js')).selectSlide(0);
    setSelectedElementIndices([2], 1);
    (await import('/editor/editor.js')).renderEditor();
}, CODE);
await page.waitForTimeout(300);
const legend = () => app(() => [...document.querySelectorAll('#slide-canvas [data-element-id="3"] [data-gl-legend-layer]')].map(r => `${r.textContent.trim()}:${r.style.display}`));
check('legend: the curve not shown (model is Laplace) has its row hidden', JSON.stringify(await legend()) === '["draws:flex","Gaussian:none"]', await legend());
await app(async () => {
    const V = await import('/core/variables.js');
    const E = await import('/core/liveEngine.js');
    V.setLiveValue('model', 'Gaussian');
    E.liveUpdate(document.getElementById('slide-canvas'), V.allVariables());
});
check('…choosing Gaussian shows it (liveUpdate)', JSON.stringify(await legend()) === '["draws:flex","Gaussian:flex"]', await legend());
await app(async () => {
    const V = await import('/core/variables.js');
    V.setLiveValue('model', 'Laplace');
    (await import('/editor/editor.js')).redrawCanvas();
});

// ---------- the layer cards take formulas ----------
const code = () => app(async () => (await import('/core/state.js')).state.slides[0].elements[2].code);
await app(() => document.querySelector('[data-layer-toggle="0"]')?.click());
await page.waitForTimeout(150);
const samplesField = page.locator('#properties-body input[data-layer-field="samples"][data-layer="0"]');
check('a card\'s Samples is a text field taking formulas', (await samplesField.getAttribute('type')) === 'text');
await samplesField.fill('=round(10*mu) + 500');
await page.waitForTimeout(60);
const result = await app(() => document.querySelector('#properties-body input[data-layer-field="samples"][data-layer="0"]')?.parentElement.querySelector('.formula-result')?.textContent);
check('…what it gives now shown under it', result === '= 500 now', result);
await samplesField.press('Escape'); // the suggestion list
await samplesField.press('Enter');
await page.waitForTimeout(200);
check('…written quoted, with its "="', (await code()).startsWith('.hist samples:"=round(10*mu) + 500" bins:30'), await code());
const binsField = page.locator('#properties-body input[data-layer-field="bins"][data-layer="0"]');
await binsField.fill('12.4');
await binsField.press('Enter');
await page.waitForTimeout(200);
check('…a plain number stays one (rounded when drawn)', (await code()).includes(' bins:12.4 '), await code());
const whole = await app(() => {
    const f = document.querySelector('#properties-body input[data-layer-field="bins"][data-layer="0"]');
    f.value = '=12.4';
    f.dispatchEvent(new Event('input', { bubbles: true }));
    return new Promise(r => setTimeout(() => r(f.parentElement.querySelector('.formula-result')?.textContent), 30));
});
check('…a whole-number field says what is used (→ 12)', whole === '= 12.4 now → 12 used', whole);
await app(() => { document.querySelector('.formula-menu')?.remove(); document.querySelector('[data-layer-toggle="1"]')?.click(); });
await page.waitForTimeout(150);
const cond = page.locator('#properties-body input[data-layer-field="visible"][data-layer="1"]');
check('the curve\'s card: Visible when, without its "="', (await cond.inputValue()) === "model == 'Gaussian'", await cond.inputValue());
await cond.fill("model != 'Gaussian'");
await cond.press('Escape');
await cond.press('Enter');
await page.waitForTimeout(200);
check('…written back with "="', (await code()).includes(".curve color:@primary label:Gaussian visible:\"=model != 'Gaussian'\""), await code());
await cond.fill('');
await cond.press('Enter');
await page.waitForTimeout(200);
check('…emptied: always shown (the setting removed)', !(await code()).includes('visible:'), await code());

// ---------- Follow a variable… on a plot ----------
await app(async () => {
    const { state } = await import('/core/state.js');
    state.slides[0].elements[2].code = '.hist samples:1000 bins:30 color:@muted\ny = normal(mu, 1)\n.vline x:mu label:"μ"';
    (await import('/editor/editor.js')).renderEditor();
    (await import('/ui/followVariable.js')).openFollow(state.slides[0].elements[2], { x: 300, y: 200 });
});
await page.waitForTimeout(100);
const rows = () => app(() => [...document.querySelectorAll('.follow-list > *')].map(r => (r.classList.contains('follow-sep') ? `— ${r.textContent} —` : r.querySelector('span')?.textContent.trim())));
const top = await rows();
check('a plot: its own settings, no "Points" without a curve', top.includes('Width') && top.includes('x axis from') && !top.some(t => /Points/.test(t)), top);
check('…a line, then its layers', top.indexOf('— layers —') > 0 && top.slice(top.indexOf('— layers —') + 1).join('|') === '▙ Histogram 1|│ Vertical line — μ', top);
await page.locator('.follow-item', { hasText: 'Histogram 1' }).click();
await page.waitForTimeout(60);
const inLayer = await rows();
check('clicking a layer: its settings', inLayer.includes('Samples') && inLayer.includes('Bins') && inLayer.includes('Visible when') && !inLayer.includes('Width'), inLayer);
check('…and a way back', await page.isVisible('.follow-back'));
await page.keyboard.press('Backspace');
await page.waitForTimeout(60);
check('Backspace (search empty): back to the plot', (await rows()).includes('— layers —'));
await page.keyboard.type('bins');
await page.waitForTimeout(60);
const found = await app(() => [...document.querySelectorAll('.follow-item')].map(r => r.textContent.replace(/\s+/g, ' ').trim()));
check('a search finds a layer\'s setting (Histogram › Bins)', found.length === 1 && /Histogram 1 › Bins/.test(found[0]), found);
await page.keyboard.press('Enter');
await page.waitForTimeout(80);
const f2 = await app(() => ({ title: document.querySelector('.follow-title')?.textContent, value: document.querySelector('.follow-formula')?.value }));
check('…Enter: its formula, starting at its value', /Histogram 1 › Bins/.test(f2.title) && f2.value === '=30', f2);
await app(() => document.querySelector('.formula-menu')?.remove());
await page.locator('.follow-formula').fill('=30 + 10*mu');
await page.waitForTimeout(80);
check('…the plot follows as you type', (await code()).startsWith('.hist samples:1000 bins:"=30 + 10*mu"'), await code());
await page.locator('.follow-formula').press('Escape');
await page.waitForTimeout(80);
if (await page.isVisible('.follow-formula')) await page.locator('.follow-formula').press('Escape'); // the first closed the suggestions
await page.waitForTimeout(80);
check('…Esc: as it was', (await code()).startsWith('.hist samples:1000 bins:30'), await code());

// an axis range follows
await app(async () => {
    const { state } = await import('/core/state.js');
    (await import('/ui/followVariable.js')).openFollow(state.slides[0].elements[2], { x: 300, y: 200 });
});
await page.keyboard.type('x axis from');
await page.keyboard.press('Enter');
await page.waitForTimeout(60);
await app(() => document.querySelector('.formula-menu')?.remove());
await page.locator('.follow-formula').fill('=mu - 3');
await page.locator('.follow-formula').press('Enter');
await page.waitForTimeout(150);
const xmin = await app(async () => (await import('/core/state.js')).state.slides[0].elements[2].xmin);
check('an axis range follows (xmin:"=mu - 3")', xmin === '=mu - 3', xmin);

check('no page errors', errors.length === 0, errors);
console.log(out.join('\n'));
await browser.close();
