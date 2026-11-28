// Circles by centre and radius (elements/shape kind:circle) and sliders
// that start inside their range: a circle is written cx / cy / r, drawn
// from them, grows about its centre when r is a formula of a slider (on
// the canvas and in the exported HTML), moving or resizing it moves its
// centre and radius; a slider whose start is outside its range starts at
// the nearest end.
import { launchBrowser, BASE_URL } from '../helpers.mjs';

const browser = await launchBrowser();
const page = await browser.newPage({ viewport: { width: 1400, height: 1000 } });
const errors = [];
page.on('pageerror', e => errors.push(e.message));
const out = [];
const check = (n, c, x = '') => out.push(`${c ? 'PASS' : 'FAIL'} ${n}${x !== '' ? ' — ' + JSON.stringify(x) : ''}`);
const app = (fn, arg) => page.evaluate(fn, arg);

const GL = `.project {Circles} version:2 width:1920 height:1080 grid:0 nextid:80
.slide {One} id:1
.element.slider id:2 x:100 y:950 width:600 height:70 var:s min:1 max:5 step:0.5 value:0
.element.shape id:3 kind:circle cx:960 cy:500 r:=40*s bg:#93c5fd
.element.shape id:4 kind:circle cx:300 cy:300 r:100 bg:#fca5a5
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
const saved = () => app(async () => (await import('/core/state.js')).serializeProject());

// the slider's start was 0, outside 1…5: it starts at 1
const vars = await app(async () => (await import('/core/variables.js')).startingVariables());
check('a start outside the range: the nearest end (s = 1, not 0)', vars.s === 1, vars);
let e = await els();
check('the circle by centre and radius: r = 40·s = 40, its box around (960, 500)', e[1].r === 40 && e[1].x === 920 && e[1].y === 460 && e[1].width === 80 && e[1].height === 80, e[1]);
check('a plain circle: box from cx, cy, r', e[2].x === 200 && e[2].width === 200 && e[2].lockAspect === 'yes', e[2]);
let text = await saved();
check('written as kind:circle cx cy r (no box)', text.includes('.element.shape id:3 kind:circle cx:960 cy:500 r:=40*s') && text.includes('.element.shape id:4 kind:circle cx:300 cy:300 r:100 bg:#fca5a5') && !/id:4[^\n]*width:/.test(text), text.split('\n').filter(l => l.includes('kind:circle')));

// a slider grows it about its centre, on the canvas
await app(() => { const i = document.querySelector('#slide-canvas [data-element-id="2"] input'); i.value = '3'; i.dispatchEvent(new Event('input', { bubbles: true })); });
await page.waitForTimeout(100);
const live = await app(() => { const n = document.querySelector('#slide-canvas [data-element-id="3"]'); return [n.style.left, n.style.top, n.style.width, n.style.height]; });
check('slider at 3: r = 120, still centred on (960, 500)', JSON.stringify(live) === JSON.stringify(['840px', '380px', '240px', '240px']), live);
await app(() => { const i = document.querySelector('#slide-canvas [data-element-id="2"] input'); i.dispatchEvent(new Event('change', { bubbles: true })); });
await page.waitForTimeout(200);
text = await saved();
check('…the file still says cx:960 cy:500 r:=40*s', text.includes("cx:960 cy:500 r:=40*s"));

// moving the plain circle moves its centre; resizing changes its radius
await app(async () => { const m = await import('/core/state.js'); m.setSelectedElementIndices([], null); (await import('/editor/editor.js')).renderEditor(); });
const b = await page.locator('#slide-canvas [data-element-id="4"]').boundingBox();
await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2);
await page.mouse.down();
await page.mouse.move(b.x + b.width / 2 + 50, b.y + b.height / 2, { steps: 5 });
await page.mouse.up();
await page.waitForTimeout(200);
e = await els();
check('dragged right: cx grows, cy and r stay', e[2].cx > 300 && e[2].cy === 300 && e[2].r === 100 && Math.abs(e[2].x - (e[2].cx - 100)) < 0.01, [e[2].cx, e[2].cy, e[2].r, e[2].x]);
// the panel: radius and centre fields; typing a radius grows it about its centre
await app(async () => { const m = await import('/core/state.js'); m.setSelectedElementIndices([2], 2); (await import('/editor/editor.js')).renderEditor(); });
await page.waitForTimeout(100);
const fields = await app(() => ['r', 'cx', 'cy'].map(k => document.querySelector(`#properties-body input[data-prop="${k}"]`)?.value));
check('the panel: Radius, Centre x, Centre y', fields[0] === '100' && Number(fields[1]) === e[2].cx && fields[2] === '300', fields);
const cxBefore = e[2].cx;
await page.fill('#properties-body input[data-prop="r"]', '150');
await page.waitForTimeout(200);
e = await els();
check('radius 150 typed: bigger about the same centre', e[2].r === 150 && e[2].width === 300 && e[2].cx === cxBefore && e[2].x === cxBefore - 150, e[2]);
// a formula for the radius in the panel
await page.fill('#properties-body input[data-prop="r"]', '=30*s + 10');
await page.waitForTimeout(200);
e = await els();
check('a formula for the radius, typed: =30·s + 10 → 100 at s = 3', e[2].formulas.r === '30*s + 10' && e[2].r === 100 && e[2].width === 200, e[2]);

// switching a rectangle to a circle: a square about its centre
await app(async () => {
    const { state } = await import('/core/state.js');
    state.slides[0].elements.push({ type: 'shape', id: 9, x: 1300, y: 100, width: 300, height: 200, bg: '#bbf7d0' });
    const m = await import('/core/state.js');
    m.setSelectedElementIndices([3], 3);
    (await import('/editor/editor.js')).renderEditor();
});
await page.waitForTimeout(100);
await page.selectOption('#properties-body select[data-prop="kind"]', 'circle');
await page.waitForTimeout(200);
e = await els();
check('a rectangle made a circle: centre kept, radius from the smaller side', e[3].kind === 'circle' && e[3].cx === 1450 && e[3].cy === 200 && e[3].r === 100, e[3]);
await page.selectOption('#properties-body select[data-prop="kind"]', 'rect');
await page.waitForTimeout(200);
e = await els();
check('…and back to a rectangle: no centre and radius left', e[3].kind === 'rect' && e[3].cx === undefined && e[3].r === undefined && e[3].width === 200, e[3]);

// the Circle of the Shapes menu makes one
const made = await app(async () => {
    await (await import('/editor/editor.js')).addElement('shape', 'circle');
    const { state } = await import('/core/state.js');
    const el = state.slides[0].elements[state.slides[0].elements.length - 1];
    return { kind: el.kind, r: el.r, cx: el.cx, w: el.width };
});
check('Shapes ▾ Circle: a circle with a radius', made.kind === 'circle' && made.r > 0 && made.w === 2 * made.r, made);

// the exported HTML: starts at s = 1 (r = 40), the slider grows it about its centre
const html = await app(async () => (await import('/export/html.js')).getExportHtmlString({ localAssets: true }));
const exp = await browser.newPage({ viewport: { width: 1400, height: 900 } });
const expErrors = [];
exp.on('pageerror', x => expErrors.push(x.message));
await exp.goto(`${BASE_URL}/index.html`);
await exp.setContent(html);
await exp.waitForTimeout(300);
const ex = await exp.evaluate(() => {
    const n = document.querySelector('.slide.active [data-glbind*="40*s"]');
    const start = [n.style.left, n.style.width];
    const input = document.querySelector('.slide.active input[data-glslider="s"]');
    const startSlider = input.value;
    input.value = '5';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    return { start, startSlider, after: [n.style.left, n.style.top, n.style.width] };
});
check('export: starts at s = 1 (r = 40), the slider at 1', JSON.stringify(ex.start) === JSON.stringify(['920px', '80px']) && ex.startSlider === '1', ex);
check('export: s = 5 → r = 200, centred on (960, 500)', JSON.stringify(ex.after) === JSON.stringify(['760px', '300px', '400px']), ex.after);
check('export: no script errors', !expErrors.length, expErrors.join(' | '));
await exp.close();

// a slider's range changed in the panel: its start follows into it
await app(async () => { const m = await import('/core/state.js'); m.setSelectedElementIndices([0], 0); (await import('/editor/editor.js')).renderEditor(); });
await page.waitForTimeout(100);
await page.fill('#properties-body input[data-prop="min"]', '2');
await page.waitForTimeout(150);
e = await els();
check('a slider\'s range raised above its start: Starts at follows (2)', e[0].value === 2, e[0].value);

console.log(out.join('\n'));
console.log('--- errors ---\n' + (errors.join('\n') || '(none)'));
await browser.close();
