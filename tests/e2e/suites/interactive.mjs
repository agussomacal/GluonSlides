// Interactive ▾: checkbox, number box, text box, choice (one or several),
// animations; texts, true / false and lists in formulas and \var{}; Plots ▾;
// right-click "Follow a variable…" and "Make something follow this…".
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

// ---------- formulas with texts, true / false, lists ----------
const f = await app(async () => {
    const E = await import('/core/liveEngine.js');
    const ev = (code, vars) => { const c = E.compileFormula(code, 'python'); return c.error ? `ERR ${c.error}` : c.exec(Object.assign(Object.create(null), vars)); };
    const v = { show: true, method: 'Adam', opts: ['A', 'C'], n: 3 };
    return {
        bool: ev('n * 2 if show else 0', v), eq: ev("method == 'Adam'", v), ne: ev('method != "SGD"', v),
        inList: ev("'C' in opts", v), notIn: ev("'B' not in opts", v), inText: ev("'da' in method", v), boolEq: ev('show == 1', v),
        words: [E.formatValue(true), E.formatValue(false, 'on|off'), E.formatValue(true, 'shown|hidden'), E.formatValue(['A', 'C'])],
    };
});
check('formulas: true / false, texts (== != in), lists (in, not in)', f.bool === 6 && f.eq === 1 && f.ne === 1 && f.inList === 1 && f.notIn === 1 && f.inText === 1 && f.boolEq === 1, f);
check('\\var words: true, [on|off], lists', JSON.stringify(f.words) === JSON.stringify(['true', 'off', 'shown', 'A, C']), f.words);

// ---------- a slide with every input and an animation ----------
const GL = `.project {Inter} version:2 width:1920 height:1080 grid:0 nextid:90
.slide {One} id:1
.element.checkbox id:2 var:show value:yes label:"Show" x:100 y:100 width:400 height:60
.element.numberbox id:3 var:n min:1 max:10 step:1 value:3 label:"n" x:100 y:200 width:400 height:70
.element.textbox id:4 var:who value:"Ada" label:"Name" x:100 y:300 width:500 height:70
.element.choice id:5 var:opts options:"A, B, C" value:"A, C" multiple:yes label:"Pick" x:100 y:400 width:400 height:220
.element.text id:6 x:800 y:100 width:900 height:300 fontSize:36
	Show \\var{show}[on|off], n = \\var{n}, hi \\var{who}, picked \\var{opts}
.element.shape id:7 visible:"=show" x:800 y:500 width:200 height:100 bg:#93c5fd
.element.shape id:8 visible:"='B' in opts" x:1100 y:500 width:200 height:100 bg:#fca5a5
.element.animation id:9 duration:1 easing:linear step:2 x:1400 y:800 width:400 height:120
	mu: 0 -> 10
	w = 100 + 10*mu
.element.text id:10 x:800 y:700 width:500 height:80 fontSize:36
	mu = \\var{mu}[%.1f]
`;
await app(async (gl) => {
    await (await import('/ui/project.js')).openSampleProject();
    const { state, applyProjectData, parseProjectContent } = await import('/core/state.js');
    applyProjectData(parseProjectContent(gl));
    (await import('/editor/editor.js')).selectSlide(0);
}, GL);
await page.waitForTimeout(300);
const text6 = () => app(() => document.querySelector('#slide-canvas [data-element-id="6"]').textContent.replace(/\s+/g, ' ').trim());
const hidden = (id) => app((id) => document.querySelector(`#slide-canvas [data-element-id="${id}"]`).classList.contains('formula-hidden'), id);

check('starting values in text: on, 3, Ada, A, C', (await text6()) === 'Show on, n = 3, hi Ada, picked A, C', await text6());
check('…and in conditions: show (shown), B in opts (hidden)', !(await hidden(7)) && await hidden(8));
check('the animation\'s variable starts at its start (mu = 0.0)', (await app(() => document.querySelector('#slide-canvas [data-element-id="10"]').textContent.trim())) === 'mu = 0.0');
check('the animation is a dashed chip in the editor', await app(() => document.querySelector('#slide-canvas [data-element-id="9"] .gl-animation-chip')?.textContent.includes('mu: 0 → 10')));

// using the inputs on the canvas
await page.click('#slide-canvas [data-element-id="2"] input');
await page.waitForTimeout(100);
await page.fill('#slide-canvas [data-element-id="3"] input', '7');
await page.fill('#slide-canvas [data-element-id="4"] input', 'Grace');
await page.waitForTimeout(100);
await app(() => { const s = document.querySelector('#slide-canvas [data-element-id="5"] select'); [...s.options].forEach(o => { o.selected = o.value === 'B'; }); s.dispatchEvent(new Event('input', { bubbles: true })); });
await page.waitForTimeout(200);
check('the inputs on the canvas: off, 7, Grace, B', (await text6()) === 'Show off, n = 7, hi Grace, picked B', await text6());
check('…the conditions follow (show off: hidden; B picked: shown)', await hidden(7) && !(await hidden(8)));
check('…the file unchanged', (await app(async () => (await import('/core/state.js')).serializeProject())).includes('.element.textbox id:4 x:100 y:300 width:500 height:70 var:who label:Name value:Ada'));
check('the inputs written back', await app(async () => { const t = (await import('/core/state.js')).serializeProject(); return t.includes('.element.checkbox id:2') && t.includes('var:show') && t.includes('options:"A, B, C"') && t.includes('multiple:yes') && t.includes('\tmu: 0 -> 10'); }));

// the animation's preview and scrubber
await app(async () => { const m = await import('/core/state.js'); m.setSelectedElementIndices([7], 7); (await import('/editor/editor.js')).renderEditor(); });
await page.waitForTimeout(150);
const rows = await app(() => [...document.querySelectorAll('.anim-row')].map(r => [...r.querySelectorAll('input, select')].map(i => i.value)));
check('the panel: one row per variable', JSON.stringify(rows) === JSON.stringify([['mu', 'range', '0', '10'], ['w', 'formula', '100 + 10*mu']]), rows);
await app(() => { const r = document.querySelector('[data-anim-scrub]'); r.value = '0.5'; r.dispatchEvent(new Event('input', { bubbles: true })); });
await page.waitForTimeout(100);
check('scrubbing to 0.5 s: mu = 5 on the canvas', (await app(() => document.querySelector('#slide-canvas [data-element-id="10"]').textContent.trim())) === 'mu = 5.0' && (await app(() => document.querySelector('[data-anim-time]').textContent)).includes('w = 150'));
await page.click('[data-anim-op="preview"]');
await page.waitForTimeout(1400);
check('▶ Preview plays it to the end (mu = 10)', (await app(() => document.querySelector('#slide-canvas [data-element-id="10"]').textContent.trim())) === 'mu = 10.0');

// ---------- the exported HTML ----------
await app(async () => (await import('/core/variables.js')).resetLiveValues());
const html = await app(async () => (await import('/export/html.js')).getExportHtmlString({ localAssets: true }));
const exp = await browser.newPage({ viewport: { width: 1400, height: 900 } });
const expErrors = [];
exp.on('pageerror', x => expErrors.push(x.message));
await exp.goto(`${BASE_URL}/index.html`);
await exp.setContent(html);
await exp.waitForTimeout(300);
const t6 = () => exp.evaluate(() => document.querySelector('.slide.active [data-glbind], .slide.active') && [...document.querySelectorAll('.slide.active .el')].map(n => n.textContent.replace(/\s+/g, ' ').trim()).find(t => t.startsWith('Show ') && t.includes('n =')));
check('export: starting values', (await t6()) === 'Show on, n = 3, hi Ada, picked A, C', await t6());
await exp.click('.slide.active [data-glinput="show"]');
await exp.click('.slide.active [data-glinput="who"]');
await exp.keyboard.press('Control+a');
await exp.keyboard.type('Rosalind');
await exp.keyboard.press('ArrowRight');
await exp.waitForTimeout(150);
check('export: typing in a text box (arrows too) stays on the slide', (await exp.evaluate(() => document.querySelector('.slide.active').id)) === 'slide-0' && (await exp.evaluate(() => window.GluonViewer.position().step)) === 1);
check('export: checkbox and text box update the text', (await t6()) === 'Show off, n = 3, hi Rosalind, picked A, C', await t6());
const offs = await exp.evaluate(() => [...document.querySelectorAll('.slide.active [data-glbind]')].map(n => getComputedStyle(n).display));
check('export: conditions follow (show off: hidden)', offs[0] === 'none', offs);
await exp.keyboard.press('Enter'); // let go of the text box
const mu = () => exp.evaluate(() => [...document.querySelectorAll('.slide.active .el')].map(n => n.textContent.trim()).find(t => t.startsWith('mu =')));
check('export: the animation waits for its step', (await mu()) === 'mu = 0.0', await mu());
await exp.evaluate(() => window.GluonViewer.next());
await exp.waitForTimeout(500);
const midway = await mu();
await exp.waitForTimeout(900);
check('export: at step 2 it plays (midway, then 10)', midway !== 'mu = 0.0' && midway !== 'mu = 10.0' && (await mu()) === 'mu = 10.0', [midway, await mu()]);
await exp.evaluate(() => window.GluonViewer.prev());
await exp.waitForTimeout(150);
check('export: back a step, the value is kept (afterwards: keep)', (await mu()) === 'mu = 10.0', await mu());
// the PDF's pages: step 1 at the start, step 2 at its end
const printed = await exp.evaluate(() => [...document.querySelectorAll('.print-page')].map(p => [...p.querySelectorAll('.el')].map(n => n.textContent.trim()).find(t => t.startsWith('mu ='))));
check('PDF: step 1 shows mu = 0, step 2 its end, mu = 10', JSON.stringify(printed) === JSON.stringify(['mu = 0.0', 'mu = 10.0']), printed);
check('export: no script errors', !expErrors.length, expErrors.join(' | '));
await exp.close();

// ---------- Plots ▾ ----------
const made = await app(async () => {
    await (await import('/editor/editor.js')).addElement('plot', 'hist');
    const { state } = await import('/core/state.js');
    const p = state.slides[0].elements[state.slides[0].elements.length - 1];
    return { type: p.type, code: p.code };
});
check('Plots ▾ Histogram: a plot holding a histogram', made.type === 'plot' && made.code.startsWith('.hist'), made);
await app(async () => { const { state } = await import('/core/state.js'); state.slides[0].elements.pop(); });

// ---------- right-click: Follow a variable… ----------
await app(async () => {
    const { state } = await import('/core/state.js');
    state.slides[0].elements.push({ type: 'shape', id: 50, kind: 'circle', cx: 1500, cy: 300, r: 80, bg: '#bbf7d0' });
    (await import('/editor/editor.js')).renderEditor();
});
await page.waitForTimeout(200);
await page.click('#slide-canvas [data-element-id="50"]', { button: 'right' });
await page.waitForTimeout(100);
const items = await app(() => [...document.querySelectorAll('#gl-context-menu.open button')].map(b => b.textContent.trim()));
check('right-click an object: Follow a variable…', items.some(t => t.includes('Follow a variable')), items);
await page.locator('#gl-context-menu.open button', { hasText: 'Follow a variable' }).click();
await page.waitForTimeout(100);
const list = await app(() => [...document.querySelectorAll('.follow-item')].map(i => [...i.children].map(c => c.textContent.trim()).join(' ')).slice(0, 3));
check('…its settings, a circle\'s radius and centre first, with their values', list[0] === 'Radius 80' && list[1].startsWith('Centre x'), list);
await page.keyboard.type('rad');
await page.keyboard.press('Enter');
await page.waitForTimeout(150);
const step2 = await app(() => ({ value: document.querySelector('.follow-formula')?.value, menu: [...document.querySelectorAll('.formula-menu div')].map(d => d.textContent).slice(0, 4) }));
check('…Radius: the formula starts at its value (=80), every variable listed', step2.value === '=80' && step2.menu.some(t => t.startsWith('n')) && step2.menu.some(t => t.startsWith('mu')), step2);
await page.keyboard.press('Escape'); // closes the list
await page.keyboard.type(' + 10*n');
await page.waitForTimeout(150);
const preview = await app(async () => (await import('/core/state.js')).state.slides[0].elements.find(e => e.id === 50).r);
check('…typing moves it live (80 + 10·n, n = 3: 110)', preview === 110, preview);
await page.keyboard.press('Enter');
await page.waitForTimeout(150);
const kept = await app(async () => (await import('/core/state.js')).state.slides[0].elements.find(e => e.id === 50).formulas);
check('…Enter keeps it', kept && kept.r === '80 + 10*n' && !(await page.isVisible('.follow-box')), kept);
// Esc leaves it as it was
await app(async () => { const { state } = await import('/core/state.js'); (await import('/ui/followVariable.js')).openFollow(state.slides[0].elements.find(e => e.id === 50)); });
await page.waitForTimeout(100);
await page.keyboard.type('Centre y');
await page.keyboard.press('Enter');
await page.waitForTimeout(100);
await page.keyboard.press('Escape');
await page.keyboard.type(' + 100');
await page.waitForTimeout(100);
await page.keyboard.press('Escape');
await page.waitForTimeout(150);
const after = await app(async () => { const e = (await import('/core/state.js')).state.slides[0].elements.find(x => x.id === 50); return { cy: e.cy, f: e.formulas }; });
check('Esc: as it was (cy 300, no formula for it)', after.cy === 300 && !('cy' in after.f), after);

// right-click an input: Make something follow this…
await page.click('#slide-canvas [data-element-id="3"]', { button: 'right', position: { x: 5, y: 5 } });
await page.waitForTimeout(100);
await page.locator('#gl-context-menu.open button', { hasText: 'Make something follow this' }).click();
await page.waitForTimeout(100);
check('…a banner: click the object', (await app(() => document.querySelector('.follow-banner')?.textContent || '')).includes('follow n'));
await page.click('#slide-canvas [data-element-id="7"]', { force: true });
await page.waitForTimeout(150);
const picked = await app(() => ({ title: document.querySelector('.follow-title')?.textContent || '' }));
await page.keyboard.type('Width');
await page.keyboard.press('Enter');
await page.waitForTimeout(150);
const startF = await app(() => document.querySelector('.follow-formula')?.value);
check('…then the setting, the formula started with that variable (=200 + n)', picked.title.includes('Follow n') && startF === '=200 + n', [picked, startF]);
await page.keyboard.press('Escape');
await page.keyboard.press('Escape');

console.log(out.join('\n'));
console.log('--- errors ---\n' + (errors.join('\n') || '(none)'));
await browser.close();
