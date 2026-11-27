// Rotation: rotate:N on elements (panel, the round handle, Shift 15°), drawn
// turned on the canvas and in exports; a turned box resizes along its own
// sides; align uses the box it covers; connectors attach to its turned
// sides; a line turns its points instead.
import { launchBrowser, BASE_URL } from '../helpers.mjs';

const browser = await launchBrowser();
const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
const errors = [];
page.on('pageerror', e => errors.push(e.message));
const out = [];
const check = (n, c, x = '') => out.push(`${c ? 'PASS' : 'FAIL'} ${n}${x !== '' ? ' — ' + x : ''}`);
const app = (fn, arg) => page.evaluate(fn, arg);

const GL = `.project {Turn} version:2 width:1920 height:1080 grid:0 nextid:40
.slide {S} id:1
.element.shape id:2 x:600 y:400 width:400 height:200 bg:#93c5fd
.element.shape id:3 x:1400 y:700 width:200 height:100 bg:#fca5a5
.element.path id:4 from:2@right to:3@left x:0 y:0 width:10 height:10 strokeWidth:4
\t0 0
\t1 1
.element.path id:5 x:200 y:900 width:400 height:1 strokeWidth:4
\t0 0.5
\t1 0.5
`;
await page.goto(`${BASE_URL}/index.html`);
await app(async (gl) => {
    await (await import('/ui/project.js')).openSampleProject();
    const { state, parseProjectContent } = await import('/core/state.js');
    state.slides = parseProjectContent(gl).slides; state.masters = []; state.nextId = 40; state.gridSize = 0;
    (await import('/editor/editor.js')).selectSlide(0);
}, GL);
await page.waitForTimeout(200);
const S = () => app(async () => JSON.parse(JSON.stringify((await import('/core/state.js')).state.slides[0].elements)));
const select = (i) => app(async (i) => { const m = await import('/core/state.js'); m.setSelectedElementIndices([i], i); (await import('/editor/editor.js')).renderEditor(); }, i);
const toClient = (x, y) => app(([x, y]) => { const r = document.getElementById('slide-canvas').getBoundingClientRect(); const s = r.width / 1920; return [r.left + x * s, r.top + y * s]; }, [x, y]);

// panel
await select(0);
await page.fill('[data-prop="rotate"]', '90');
await page.dispatchEvent('[data-prop="rotate"]', 'change');
await page.waitForTimeout(150);
let els = await S();
check('the panel turns it', els[0].rotate === 90 && (await app(() => document.querySelector('#slide-canvas [data-element-id="2"]').style.transform)) === 'rotate(90deg)');
const gl = await app(async () => (await import('/core/state.js')).serializeProject());
const back = await app(async (t) => (await import('/core/state.js')).parseProjectContent(t).slides[0].elements[0].rotate, gl);
const html = await app(async () => (await import('/export/html.js')).getExportHtmlString());
check('.gl rotate:90, read back; exports turned', /\.element\.shape id:2 [^\n]*rotate:90/.test(gl) && back === 90 && html.includes('transform:rotate(90deg)'));

// connector: the right side of a box turned 90° is at the bottom of what you see
const conn = els[2];
const p0 = [conn.x + conn.points[0][0] * conn.width, conn.y + conn.points[0][1] * conn.height];
check('connectors attach to the turned side', Math.abs(p0[0] - 800) < 2 && Math.abs(p0[1] - 700) < 2, JSON.stringify(p0));

// align uses the box it covers (turned 90°: 200 wide, 400 tall, centred at 800,500)
await app(async () => {
    const { alignElements } = await import('/core/arrange.js');
    const { state } = await import('/core/state.js');
    alignElements(state.slides[0].elements, [0], 'left', { width: 1920, height: 1080 });
    alignElements(state.slides[0].elements, [0], 'top', { width: 1920, height: 1080 });
    (await import('/editor/editor.js')).renderEditor();
});
els = await S();
check('aligned by what it covers: its turned box touches the corner', els[0].x === -100 && els[0].y === 100, `${els[0].x},${els[0].y}`);

// the round handle: drag it a quarter turn back
await app(async () => { const { state } = await import('/core/state.js'); Object.assign(state.slides[0].elements[0], { x: 600, y: 400, rotate: 0 }); delete state.slides[0].elements[0].rotate; });
await select(0);
const kb = await (await page.$('#slide-canvas .rotate-handle')).boundingBox();
const [cx, cy] = await toClient(800, 500);
await page.mouse.move(kb.x + kb.width / 2, kb.y + kb.height / 2); await page.mouse.down();
await page.mouse.move(cx + 200, cy + 1, { steps: 8 }); await page.mouse.up();
await page.waitForTimeout(150);
els = await S();
check('dragging the handle turns it (square angles stick)', els[0].rotate === 90, els[0].rotate);

// resizing a turned box: its own width grows, the opposite side stays
await page.waitForTimeout(100);
const before = await S();
const [ex, ey] = await toClient(800, 700 - 3); // turned 90°: its right side is at the bottom
const [tx, ty] = await toClient(800, 800);
await page.mouse.move(ex, ey);
const cursor = await app(() => document.querySelector('#slide-canvas [data-element-id="2"]').style.cursor);
await page.mouse.down(); await page.mouse.move(tx, ty, { steps: 6 }); await page.mouse.up();
await page.waitForTimeout(150);
els = await S();
const e2 = els[0];
const topEdge = e2.y + e2.height / 2 - e2.width / 2; // the far side (its left) on screen
check('resizing a turned box: its own width grows along the turn', e2.width > before[0].width + 60 && Math.abs(topEdge - 300) < 4 && Math.abs(e2.height - 200) < 1, `${e2.x},${e2.y} ${e2.width}x${e2.height} cursor:${cursor}`);
check('…the resize cursor follows its turned side', cursor === 'ew-resize', cursor);

// a line turns its points
await select(3);
const kb2 = await (await page.$('#slide-canvas .rotate-handle')).boundingBox();
const [lx, ly] = await toClient(400, 900);
await page.mouse.move(kb2.x + kb2.width / 2, kb2.y + kb2.height / 2); await page.mouse.down();
await page.mouse.move(lx + 300, ly + 1, { steps: 8 }); await page.mouse.up();
await page.waitForTimeout(150);
els = await S();
const line = els[3];
check('rotating a line turns its points (no rotate value)', line.rotate === undefined && line.width < 5 && line.height > 380, `${line.width}x${line.height}`);

console.log(out.join('\n'));
console.log('--- errors ---\n' + (errors.join('\n') || '(none)'));
await browser.close();
