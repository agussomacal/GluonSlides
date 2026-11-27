// Lines attached to shapes (core/connectors.js): ends by id or name follow
// their shapes; routes straight / curved / elbow; the .gl; drawing a line
// between shapes attaches it, dragging an end off detaches it, onto a shape
// attaches it; pasting shapes with their connector keeps them connected.
import { launchBrowser, BASE_URL } from '../helpers.mjs';

const browser = await launchBrowser();
const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
const errors = [];
page.on('pageerror', e => errors.push(e.message));
const out = [];
const check = (n, c, x = '') => out.push(`${c ? 'PASS' : 'FAIL'} ${n}${x !== '' ? ' — ' + x : ''}`);
const app = (fn, arg) => page.evaluate(fn, arg);

const GL = `.project {Links} version:2 width:1920 height:1080 grid:0 nextid:40
.slide {S} id:1
.element.shape id:2 x:100 y:400 width:300 height:200 bg:#93c5fd
.element.shape id:3 name:B x:1200 y:200 width:300 height:200 bg:#fca5a5
.element.path id:4 from:2@right to:{B}@left route:elbow end:arrow x:0 y:0 width:10 height:10 strokeWidth:4
\t0 0
\t1 1
`;

await page.goto(`${BASE_URL}/index.html`);
await app(async (gl) => {
    await (await import('/ui/project.js')).openSampleProject();
    const { state, parseProjectContent } = await import('/core/state.js');
    const p = parseProjectContent(gl);
    state.slides = p.slides; state.masters = []; state.nextId = 40; state.gridSize = 0;
    (await import('/editor/editor.js')).selectSlide(0);
}, GL);
await page.waitForTimeout(200);
const S = () => app(async () => JSON.parse(JSON.stringify((await import('/core/state.js')).state.slides[0].elements)));
const ends = (c) => { const p = c.points.map(([fx, fy]) => [c.x + fx * c.width, c.y + fy * c.height]); return [p[0], p[p.length - 1], p.length]; };
const near = (p, q, tol = 1.5) => Math.abs(p[0] - q[0]) <= tol && Math.abs(p[1] - q[1]) <= tol;

let els = await S();
let [a, b, n] = ends(els[2]);
check('ends on the right of #2 and the left of B (by name)', near(a, [400, 500]) && near(b, [1200, 300]), JSON.stringify([a, b]));
check('elbow: horizontal, vertical, horizontal', n === 4 && Math.abs(els[2].points[1][0] - els[2].points[2][0]) < 1e-3, JSON.stringify(els[2].points));

await app(async () => { const { state } = await import('/core/state.js'); state.slides[0].elements[1].y = 700; (await import('/editor/editor.js')).renderEditor(); });
els = await S();
[a, b] = ends(els[2]);
check('moving a shape: the line follows', near(b, [1200, 800]), JSON.stringify(b));

await app(async () => { const { state } = await import('/core/state.js'); state.slides[0].elements[2].route = 'curved'; (await import('/editor/editor.js')).renderEditor(); });
els = await S();
check('curved: a cubic Bézier leaving each side square', els[2].curve === 'bezier' && els[2].points.length === 4
    && (await app(() => document.querySelector('#slide-canvas [data-element-id="4"] svg > path')?.getAttribute('d') || '')).includes('C'),
    JSON.stringify([els[2].curve, await app(() => document.querySelector('#slide-canvas [data-element-id="4"] svg > path')?.getAttribute('d'))]));
const gl = await app(async () => (await import('/core/state.js')).serializeProject());
check('.gl keeps the ends and the route', /\.element\.path id:4 [^\n]*from:2@right to:\{B\}@left route:curved/.test(gl) || /from:2@right/.test(gl) && /to:"?\{B\}@left"?/.test(gl) && /route:curved/.test(gl), gl.split('\n').find(l => l.includes('.element.path id:4')));

// drawing a line from shape to shape attaches it
const toClient = (x, y) => app(([x, y]) => { const r = document.getElementById('slide-canvas').getBoundingClientRect(); const s = r.width / 1920; return [r.left + x * s, r.top + y * s]; }, [x, y]);
await page.click('[data-category="lines"] > .toolbar-btn');
await page.click('[data-category="lines"] .toolbar-menu button:has-text("Arrow")');
let [x0, y0] = await toClient(250, 480);
let [x1, y1] = await toClient(1350, 780);
await page.mouse.move(x0, y0); await page.mouse.down(); await page.mouse.move(x1, y1, { steps: 6 }); await page.mouse.up();
await page.waitForTimeout(200);
els = await S();
const drawn = els[els.length - 1];
check('a line drawn from one shape to another attaches to both', drawn.type === 'path' && /^2@/.test(drawn.from || '') && /^(3|\{B\})@/.test(drawn.to || ''), JSON.stringify([drawn.from, drawn.to]));

// dragging its end away detaches it; onto a shape's anchor attaches it
await app(async () => { const m = await import('/core/state.js'); const els = m.state.slides[0].elements; m.setSelectedElementIndices([els.length - 1], els.length - 1); (await import('/editor/editor.js')).renderEditor(); });
await page.waitForTimeout(100);
let h = await page.$('.el-handle[data-handle="p1"]');
let hb = await h.boundingBox();
[x1, y1] = await toClient(900, 950);
await page.mouse.move(hb.x + hb.width / 2, hb.y + hb.height / 2); await page.mouse.down(); await page.mouse.move(x1, y1, { steps: 6 }); await page.mouse.up();
await page.waitForTimeout(150);
els = await S();
check('an end dragged off its shape comes loose', !els[els.length - 1].to && /^2@/.test(els[els.length - 1].from || ''), JSON.stringify(els[els.length - 1].to));
h = await page.$('.el-handle[data-handle="p1"]');
hb = await h.boundingBox();
[x1, y1] = await toClient(1350, 705); // near B's top anchor
await page.mouse.move(hb.x + hb.width / 2, hb.y + hb.height / 2); await page.mouse.down(); await page.mouse.move(x1, y1, { steps: 6 });
const dots = await app(() => document.querySelectorAll('#slide-canvas .anchor-dot').length);
await page.mouse.up();
await page.waitForTimeout(150);
els = await S();
check('dragged onto a shape: its anchors show, and the end attaches to the nearest', dots === 5 && /@top$/.test(els[els.length - 1].to || ''), `${dots} ${els[els.length - 1].to}`);

// copy / paste
await app(async () => { const m = await import('/core/state.js'); m.setSelectedElementIndices([0, 1, 2], 2); (await import('/editor/editor.js')).renderEditor(); });
await page.mouse.click(5, 450);
await app(async () => { const m = await import('/core/state.js'); m.setSelectedElementIndices([0, 1, 2], 2); });
await page.keyboard.press('Control+c');
await page.keyboard.press('Control+v');
await page.waitForTimeout(300);
els = await S();
const [pa, pb, pc] = els.slice(-3);
check('pasting the shapes with their connector: it joins the copies', pc.type === 'path' && pc.from === `${pa.id}@right` && pc.to === `${pb.id}@left`, JSON.stringify([pa.id, pb.id, pc.from, pc.to]));
await app(async () => { const m = await import('/core/state.js'); m.setSelectedElementIndices([2], 2); });
await page.keyboard.press('Control+c');
await page.keyboard.press('Control+v');
await page.waitForTimeout(300);
els = await S();
const lone = els[els.length - 1];
check('pasting only the connector on the same slide: still on the originals', lone.from === '2@right' && /\{B\}@left|3@left/.test(lone.to), JSON.stringify([lone.from, lone.to]));

// export draws it where the shapes are
const html = await app(async () => (await import('/export/html.js')).getExportHtmlString());
check('export: connectors drawn', (html.match(/class="path-svg"/g) || []).length >= 3);

console.log(out.join('\n'));
console.log('--- errors ---\n' + (errors.join('\n') || '(none)'));
await browser.close();
