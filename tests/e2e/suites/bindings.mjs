// Settings given by formulas of the variables (core/bindings.js, "=…"):
// read and written in the .gl; computed with the variables; typed in the
// panel with suggestions and the value shown; a plain number replaces one;
// dragging moves the formula's constant; a visibility condition; a slider
// moves them on the canvas and in the exported HTML.
import { launchBrowser, BASE_URL } from '../helpers.mjs';

const browser = await launchBrowser();
const page = await browser.newPage({ viewport: { width: 1400, height: 1000 } });
const errors = [];
page.on('pageerror', e => errors.push(e.message));
const out = [];
const check = (n, c, x = '') => out.push(`${c ? 'PASS' : 'FAIL'} ${n}${x !== '' ? ' — ' + JSON.stringify(x) : ''}`);
const app = (fn, arg) => page.evaluate(fn, arg);

const GL = `.project {Bind} version:2 width:1920 height:1080 grid:0 nextid:80
.slide {One} id:1
.element.slider id:2 x:100 y:950 width:600 height:70 var:mu min:-2 max:2 step:0.1 value:0
.element.shape id:3 rotate:"=30*mu" x:"=860 + 300*mu" y:400 width:"=200 + 50*mu" height:200 bg:#93c5fd
.element.text id:4 visible:"=mu > 0" opacity:0.5 x:100 y:100 width:600 height:80 fontSize:40
	Only while mu is positive
`;
await page.goto(`${BASE_URL}/index.html`);
await app(async (gl) => {
    await (await import('/ui/project.js')).openSampleProject();
    const { state, applyProjectData, parseProjectContent } = await import('/core/state.js');
    applyProjectData(parseProjectContent(gl));
    (await import('/editor/editor.js')).selectSlide(0);
}, GL);
await page.waitForTimeout(300);
const els = () => app(async () => JSON.parse(JSON.stringify((await import('/core/state.js')).state.slides[0].elements)));

// ---------- the file ----------
let e = await els();
check('read: formulas kept, values computed at mu = 0', e[1].formulas.x === '860 + 300*mu' && e[1].x === 860 && e[1].width === 200 && (e[1].rotate || 0) === 0 && e[2].formulas.visible === 'mu > 0' && e[2]._hidden === true && e[2].opacity === 0.5, [e[1], e[2]]);
const saved = await app(async () => (await import('/core/state.js')).serializeProject());
check('written back as typed', saved.includes('.element.shape id:3 rotate:=30*mu x:"=860 + 300*mu" y:400 width:"=200 + 50*mu"') && saved.includes('visible:"=mu > 0"') && saved.includes('opacity:0.5'), saved.split('\n').filter(l => l.startsWith('.element')).join(' | '));

// ---------- moving the constant ----------
const shifts = await app(async () => {
    const { shiftConstant } = await import('/core/bindings.js');
    return [shiftConstant('860 + 300*mu', 40), shiftConstant('300*mu + 860', -60), shiftConstant('300*mu - 40', 100), shiftConstant('300*mu', 25), shiftConstant('500', -20), shiftConstant('2*mu + 3*sigma', -5)];
});
check('the constant moves (leading, trailing, a minus, none yet)', JSON.stringify(shifts) === JSON.stringify(['900 + 300*mu', '300*mu + 800', '300*mu + 60', '300*mu + 25', '480', '2*mu + 3*sigma - 5']), shifts);

// ---------- a slider moves them on the canvas ----------
const box = () => app(() => { const n = document.querySelector('#slide-canvas [data-element-id="3"]'); return { left: n.style.left, width: n.style.width, transform: n.style.transform, hidden: document.querySelector('#slide-canvas [data-element-id="4"]').classList.contains('formula-hidden') }; });
check('at mu = 0: the text is hidden (faint and dashed in the editor)', (await box()).hidden);
await app(() => { const i = document.querySelector('#slide-canvas [data-element-id="2"] input'); i.value = '1'; i.dispatchEvent(new Event('input', { bubbles: true })); });
await page.waitForTimeout(100);
let b = await box();
check('moving the slider: the shape moves, grows and turns; the text shows', b.left === '1160px' && b.width === '250px' && b.transform === 'rotate(30deg)' && !b.hidden, b);
await app(() => { const i = document.querySelector('#slide-canvas [data-element-id="2"] input'); i.dispatchEvent(new Event('change', { bubbles: true })); });
await page.waitForTimeout(200);
check('…the file unchanged', (await app(async () => (await import('/core/state.js')).serializeProject())).includes('x:"=860 + 300*mu"'));

// ---------- the panel ----------
await app(async () => { const m = await import('/core/state.js'); m.setSelectedElementIndices([1], 1); (await import('/editor/editor.js')).renderEditor(); });
await page.waitForTimeout(150);
const panel = await app(() => {
    const f = document.querySelector('#properties-body input[data-prop="x"]');
    return { value: f.value, type: f.type, badge: !!f.closest('.prop-group').querySelector('.formula-badge'), result: f.parentElement.querySelector('.formula-result').textContent, cls: f.classList.contains('has-formula') };
});
check('X in the panel: the formula, marked ƒ, and its value now', panel.value === '=860 + 300*mu' && panel.type === 'text' && panel.badge && panel.result === '= 1160 now' && panel.cls, panel);
// type a new one in Y with suggestions
await page.fill('#properties-body input[data-prop="y"]', '');
await page.type('#properties-body input[data-prop="y"]', '=400 - 100*m', { delay: 20 });
await page.waitForTimeout(150);
const menu = await app(() => [...document.querySelectorAll('.formula-menu div')].map(d => d.textContent));
check('typing a formula suggests the variables (with their value) and functions', menu.some(t => t.startsWith('mu') && t.includes('1')) && menu.some(t => t.startsWith('max(')), menu);
await page.keyboard.press('Enter');
await page.waitForTimeout(150);
e = await els();
check('Enter takes it: y = 400 − 100·mu, set (300 now)', e[1].formulas.y === '400 - 100*mu' && e[1].y === 300, e[1]);
check('…its value shown under the field', (await app(() => document.querySelector('#properties-body input[data-prop="y"]').parentElement.querySelector('.formula-result').textContent)) === '= 300 now');
// the names without typing any letter: right after "=", after an operator, or with Ctrl+Space
await page.fill('#properties-body input[data-prop="height"]', '');
await page.type('#properties-body input[data-prop="height"]', '=', { delay: 20 });
await page.waitForTimeout(120);
const afterEq = await app(() => [...document.querySelectorAll('.formula-menu div')].map(d => d.textContent));
await page.type('#properties-body input[data-prop="height"]', '200 + ', { delay: 20 });
await page.waitForTimeout(120);
const afterOp = await app(() => [...document.querySelectorAll('.formula-menu div')].map(d => d.textContent));
await page.keyboard.press('Escape');
await page.type('#properties-body input[data-prop="height"]', '3', { delay: 20 });
await page.keyboard.press('Control+Space');
await page.waitForTimeout(120);
const ctrlSpace = await app(() => [...document.querySelectorAll('.formula-menu div')].map(d => d.textContent));
await page.keyboard.press('Escape');
check('the variables listed right after "=", after an operator, and with Ctrl+Space', afterEq[0]?.startsWith('mu') && afterOp[0]?.startsWith('mu') && ctrlSpace[0]?.startsWith('mu') && afterEq.length > 10, [afterEq.slice(0, 2), afterOp.slice(0, 2), ctrlSpace.slice(0, 2)]);
await page.fill('#properties-body input[data-prop="height"]', '200');
await page.waitForTimeout(100);
await page.fill('#properties-body input[data-prop="y"]', '=400 - 100*nope');
await page.waitForTimeout(150);
check('a mistake is said under the field', (await app(() => document.querySelector('#properties-body input[data-prop="y"]').parentElement.querySelector('.formula-result').textContent)).includes('unknown name: nope'));
await page.fill('#properties-body input[data-prop="y"]', '420');
await page.waitForTimeout(150);
e = await els();
check('a plain number replaces the formula', !('y' in (e[1].formulas || {})) && e[1].y === 420, e[1]);

// ---------- dragging moves the constant ----------
await app(async () => { const m = await import('/core/state.js'); m.setSelectedElementIndices([], null); (await import('/editor/editor.js')).renderEditor(); });
await page.waitForTimeout(100);
const shape = await page.locator('#slide-canvas [data-element-id="3"]').boundingBox();
await page.mouse.move(shape.x + shape.width / 2, shape.y + shape.height / 2);
await page.mouse.down();
await page.mouse.move(shape.x + shape.width / 2 - 60, shape.y + shape.height / 2, { steps: 6 });
await page.mouse.up();
await page.waitForTimeout(200);
e = await els();
const moved = await app(async (x) => (await import('/core/bindings.js')).evaluateFormula(x).value, e[1].formulas.x);
check('dragging left: the formula\'s constant goes down by as much, mu kept', /^\d+(\.\d+)? \+ 300\*mu$/.test(e[1].formulas.x) && Number(e[1].formulas.x.split(' ')[0]) < 860 && Math.abs(moved - e[1].x) < 0.01, [e[1].formulas.x, e[1].x]);

// ---------- the visibility field ----------
await app(async () => { const m = await import('/core/state.js'); m.setSelectedElementIndices([2], 2); (await import('/editor/editor.js')).renderEditor(); });
await page.waitForTimeout(100);
check('Visible when: the condition, and what it gives now', await app(() => { const f = document.querySelector('#properties-body input[data-prop="visible"]'); return f.value === 'mu > 0' && f.parentElement.querySelector('.formula-result').textContent === 'shown now'; }));

// ---------- the source view ----------
const source = await app(async () => {
    (await import('/editor/inspector/index.js')).toggleGlInspector();
    await new Promise(r => setTimeout(r, 200));
    const cm = document.querySelector('.gl-code-editor .CodeMirror').CodeMirror;
    const line = cm.getValue().split('\n').findIndex(l => l.startsWith('.element.shape id:3'));
    const vars = cm.getLineTokens(line).filter(t => (t.type || '').includes('gl-var')).map(t => t.string);
    const { glHints } = await import('/editor/inspector/completions.js');
    const doc = ['.project {P}', '.slide {S} id:1', '.element.shape id:9 x:"=100 + m', '.element.shape id:9 x:"=100 + '];
    const r = glHints({ getCursor: () => ({ line: 2, ch: doc[2].length }), getLine: (i) => doc[i], lineCount: () => 4 });
    const r2 = glHints({ getCursor: () => ({ line: 3, ch: doc[3].length }), getLine: (i) => doc[i], lineCount: () => 4 });
    (await import('/editor/inspector/index.js')).closeGlInspector();
    return { vars, hints: r ? r.list.map(x => x.text) : [], afterOp: r2 ? r2.list.map(x => x.text) : [] };
});
check('source view: the variables of a setting\'s formula coloured', source.vars.filter(v => v === 'mu').length >= 2, source.vars);
check('…and suggested while typing one', source.hints.includes('mu') && source.hints.includes('max('), source.hints);
check('…and listed after an operator, before any letter', source.afterOp[0] === 'mu', source.afterOp.slice(0, 3));

// ---------- the exported HTML ----------
const html = await app(async () => (await import('/export/html.js')).getExportHtmlString({ localAssets: true }));
check('export: the starting values (mu = 0), the formulas carried', html.includes('data-glbind') && /left:\d+(\.\d+)?px; top:400px;width:200px/.test(html.replace(/\s/g, ' ').replace(/; /g, ';')) || html.includes('width:200px'), '');
const exp = await browser.newPage({ viewport: { width: 1400, height: 900 } });
const expErrors = [];
exp.on('pageerror', x => expErrors.push(x.message));
await exp.goto(`${BASE_URL}/index.html`);
await exp.setContent(html);
await exp.waitForTimeout(300);
const live = await exp.evaluate(() => {
    const shapeNode = document.querySelector('.slide.active [data-glbind*="300*mu"]');
    const textNode = document.querySelector('.slide.active [data-glbind*="mu > 0"]');
    const before = { hidden: getComputedStyle(textNode).display === 'none', width: shapeNode.style.width };
    const input = document.querySelector('.slide.active input[data-glslider="mu"]');
    input.value = '2';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    return { before, width: shapeNode.style.width, transform: shapeNode.style.transform, shown: getComputedStyle(textNode).display === 'flex' };
});
check('export: hidden at the start, then the slider moves, grows, turns and shows', live.before.hidden && live.before.width === '200px' && live.width === '300px' && live.transform === 'rotate(60deg)' && live.shown, live);
check('export: no script errors', !expErrors.length, expErrors.join(' | '));
await exp.close();
const after = await els();
check('after exporting, the editor keeps its values (mu = 1)', after[1].width === 250, after[1].width);

// ---------- an arrow attached to a shape that follows a slider, in the export ----------
await app(async () => {
    const { state } = await import('/core/state.js');
    const { updateAllConnectors } = await import('/core/connectors.js');
    (await import('/core/variables.js')).resetLiveValues();
    state.slides = [{ id: 1, title: 'C', elements: [
        { type: 'slider', id: 60, x: 100, y: 950, width: 600, height: 70, var: 'k', min: 0, max: 4, step: 1, value: 0 },
        { type: 'shape', id: 61, x: 100, y: 100, width: 200, height: 100, formulas: { x: '100 + 200*k' } },
        { type: 'shape', id: 62, x: 1400, y: 600, width: 200, height: 100 },
        { type: 'path', id: 63, x: 0, y: 0, width: 10, height: 10, points: [[0, 0], [1, 1]], from: '61@auto', to: '62@left', route: 'elbow', end: 'arrow', stroke: '#000', strokeWidth: 4 },
        { type: 'path', id: 64, x: 0, y: 0, width: 10, height: 10, points: [[0, 0], [1, 1]], from: '62@top', to: '62@top', stroke: '#000', strokeWidth: 4 },
    ] }];
    (await import('/core/bindings.js')).applyFormulas();
    updateAllConnectors();
    (await import('/editor/editor.js')).selectSlide(0);
});
await page.waitForTimeout(200);
const cHtml = await app(async () => (await import('/export/html.js')).getExportHtmlString({ localAssets: true }));
check('export: an arrow attached to a moving shape carries its ends; one between still shapes doesn\'t', (cHtml.match(/data-glconnect=/g) || []).length === 1, (cHtml.match(/data-glconnect=/g) || []).length);
const cexp = await browser.newPage({ viewport: { width: 1400, height: 900 } });
const cErrors = [];
cexp.on('pageerror', x => cErrors.push(x.message));
await cexp.goto(`${BASE_URL}/index.html`);
await cexp.setContent(cHtml);
await cexp.waitForTimeout(300);
const arrow = await cexp.evaluate(() => {
    const node = document.querySelector('.slide.active [data-glconnect]');
    const read = () => ({ left: parseFloat(node.style.left), top: parseFloat(node.style.top), width: parseFloat(node.style.width), d: node.querySelector('svg > path').getAttribute('d'), marker: node.querySelector('defs path')?.getAttribute('d') });
    const before = read();
    const input = document.querySelector('.slide.active input[data-glslider="k"]');
    input.value = '3';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    const shape = document.querySelector('.slide.active [data-glid="61"]');
    return { before, after: read(), shapeLeft: shape.style.left };
});
// the shape now at x = 700: the arrow leaves the side facing the other (its bottom, x = 800) and ends at the other's left (x = 1400)
check('export: moving the slider moves the shape and its arrow follows (from its bottom to the other\'s left)', arrow.shapeLeft === '700px' && Math.round(arrow.after.left) === 800 && Math.round(arrow.after.left + arrow.after.width) === 1400 && arrow.after.d !== arrow.before.d, arrow);
check('…its arrowhead kept', arrow.after.marker === arrow.before.marker && Boolean(arrow.before.marker), arrow);
check('export: no script errors (connectors)', !cErrors.length, cErrors.join(' | '));
await cexp.close();

console.log(out.join('\n'));
console.log('--- errors ---\n' + (errors.join('\n') || '(none)'));
await browser.close();
