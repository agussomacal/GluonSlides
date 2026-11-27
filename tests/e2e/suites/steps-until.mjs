// Elements that appear and disappear again (core/steps.js): until:M in the
// .gl, the panel's "Disappears after step", the step badge, the toolbar's
// step preview, and the slide show / print pages hiding them after M.
import { launchBrowser, BASE_URL } from '../helpers.mjs';

const browser = await launchBrowser();
const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
const errors = [];
page.on('pageerror', e => errors.push(e.message));
const out = [];
const check = (n, c, x = '') => out.push(`${c ? 'PASS' : 'FAIL'} ${n}${x !== '' ? ' — ' + x : ''}`);
const app = (fn, arg) => page.evaluate(fn, arg);

const GL = `.project {Switch} version:2 width:1920 height:1080 nextid:20
.slide {Options} id:1
.element.text id:2 x:100 y:100 width:800 height:100
	Always here
.element.text id:3 x:100 y:300 width:800 height:100 step:1 until:1
	First option
.element.text id:4 x:100 y:300 width:800 height:100 step:2 until:2
	Second option
.element.text id:5 x:100 y:300 width:800 height:100 step:3
	Third, stays
`;

await page.goto(`${BASE_URL}/index.html`);
await app(async (gl) => {
    await (await import('/ui/project.js')).openSampleProject();
    const { state, parseProjectContent } = await import('/core/state.js');
    state.slides = parseProjectContent(gl).slides;
    state.masters = [];
    (await import('/editor/editor.js')).selectSlide(0);
}, GL);
await page.waitForTimeout(300);

// ---------- format ----------
const els = await app(async () => (await import('/core/state.js')).state.slides[0].elements.map(e => [e.step || 1, e.until ?? null]));
check('.gl: until read (and step:1 not stored)', JSON.stringify(els) === '[[1,null],[1,1],[2,2],[3,null]]', JSON.stringify(els));
const gl = await app(async () => (await import('/core/state.js')).serializeProject());
check('.gl: until written after step', /id:3 until:1 /.test(gl) && /id:4 step:2 until:2 /.test(gl) && !/id:5 [^\n]*until/.test(gl), gl.split('\n').filter(l => l.includes('.element')).join(' | '));
const count = await app(async () => {
    const { slideStepCount } = await import('/core/steps.js');
    return [slideStepCount((await import('/core/state.js')).state.slides[0]), slideStepCount({ elements: [{ until: 2 }] })];
});
check('steps of a slide: an element gone after step M makes a step M+1', count[0] === 3 && count[1] === 3, JSON.stringify(count));

// ---------- editor: badge, panel, step preview ----------
const badges = await app(() => [...document.querySelectorAll('#slide-canvas .canvas-element')].map(n => n.dataset.stepLabel || ''));
check('badges: "1 only", "2 only", "3"', JSON.stringify(badges) === JSON.stringify(['', '1 only', '2 only', '3']), JSON.stringify(badges));
await app(async () => { const m = await import('/core/state.js'); m.setSelectedElementIndices([3], 3); (await import('/editor/editor.js')).renderEditor(); });
await page.fill('[data-prop="until"]', '4');
await page.dispatchEvent('[data-prop="until"]', 'change');
await page.waitForTimeout(100);
let u = await app(async () => (await import('/core/state.js')).state.slides[0].elements[3].until);
check('panel: Disappears after step sets until', u === 4, u);
await page.fill('[data-prop="until"]', '');
await page.dispatchEvent('[data-prop="until"]', 'change');
await page.waitForTimeout(100);
u = await app(async () => (await import('/core/state.js')).state.slides[0].elements[3].until);
check('…empty: never (removed)', u === undefined, u);

check('the Steps selector shows on a slide that builds up', await page.isVisible('#step-preview'));
await page.selectOption('#step-preview', '2');
await page.waitForTimeout(150);
const shown = () => app(() => [...document.querySelectorAll('#slide-canvas .canvas-element')].filter(n => getComputedStyle(n).visibility !== 'hidden').map(n => n.textContent.trim()));
check('step 2: what the audience sees then', JSON.stringify(await shown()) === JSON.stringify(['Always here', 'Second option']), JSON.stringify(await shown()));
await page.selectOption('#step-preview', 'all');
await page.waitForTimeout(150);
check('all: everything again', (await shown()).length === 4);

// ---------- slide show and print pages ----------
const html = await app(async () => (await import('/export/html.js')).getExportHtmlString());
const viewer = await browser.newPage({ viewport: { width: 1000, height: 700 } });
viewer.on('pageerror', e => errors.push('export: ' + e.message));
await viewer.setContent(html);
await viewer.waitForFunction(() => window.GluonViewer);
const visible = () => viewer.evaluate(() => [...document.querySelectorAll('.slide.active .el')].filter(n => !n.classList.contains('step-hidden')).map(n => n.textContent.trim()).join(' / '));
const seen = [await visible()];
for (let i = 0; i < 2; i++) { await viewer.keyboard.press('ArrowRight'); seen.push(await visible()); }
check('presenting: each option replaces the previous one', JSON.stringify(seen) === JSON.stringify(['Always here / First option', 'Always here / Second option', 'Always here / Third, stays']), JSON.stringify(seen));
await viewer.emulateMedia({ media: 'print' });
const printed = await viewer.$$eval('.slide', ns => ns.filter(n => n.getClientRects().length > 0).map(n => [...n.querySelectorAll('.el')].map(x => x.textContent.trim()).join('+')));
check('printing: one page per step, each with what was shown then', JSON.stringify(printed) === JSON.stringify(['Always here+First option', 'Always here+Second option', 'Always here+Third, stays']), JSON.stringify(printed));

console.log(out.join('\n'));
console.log('--- errors ---\n' + (errors.join('\n') || '(none)'));
await browser.close();
