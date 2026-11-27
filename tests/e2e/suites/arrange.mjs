// Arranging objects: align (to the slide / to each other), distribute,
// layer order (buttons and Ctrl+[ ]), locking (no dragging, arrows or
// align; a drag on it selects with a rectangle; locked:yes in .gl) and
// smart guides while moving and resizing.
import { launchBrowser, BASE_URL } from '../helpers.mjs';

const browser = await launchBrowser();
const page = await browser.newPage({ viewport: { width: 1500, height: 950 } });
const errors = [];
page.on('pageerror', e => errors.push(e.message));
const out = [];
const check = (n, c, x = '') => out.push(`${c ? 'PASS' : 'FAIL'} ${n}${x !== '' ? ' — ' + x : ''}`);
const app = (fn, arg) => page.evaluate(fn, arg);

await page.goto(`${BASE_URL}/index.html`);
await app(async () => {
    await (await import('/ui/project.js')).openSampleProject();
    const { state } = await import('/core/state.js');
    const box = (id, x, y, width, height) => ({ type: 'shape', id, kind: 'rect', x, y, width, height, bg: '#38f', borderWidth: 0, borderStyle: 'solid' });
    state.slides = [{ id: 1, title: 'One', elements: [box(2, 100, 100, 200, 100), box(3, 500, 300, 100, 100), box(4, 1200, 150, 300, 200)] }];
    state.masters = [];
    state.gridSize = 0; // guides on their own
    state.nextId = 10;
    (await import('/editor/editor.js')).selectSlide(0);
});

const els = () => app(async () => (await import('/core/state.js')).state.slides[0].elements.map(e => ({ id: e.id, x: e.x, y: e.y, w: e.width, h: e.height, locked: e.locked })));
const byId = async (id) => (await els()).find(e => e.id === id);
const select = (indices) => app(async (ix) => {
    const m = await import('/core/state.js');
    m.setSelectedElementIndices(ix, ix[ix.length - 1]);
    (await import('/editor/editor.js')).renderEditor();
}, indices);
const setPos = (list) => app(async (l) => {
    const { state } = await import('/core/state.js');
    l.forEach(([id, x, y]) => Object.assign(state.slides[0].elements.find(e => e.id === id), { x, y }));
    (await import('/core/state.js')).markDirty();
    (await import('/editor/editor.js')).renderEditor();
}, list);
const toClient = (x, y) => app(([x, y]) => {
    const r = document.getElementById('slide-canvas').getBoundingClientRect();
    const s = r.width / 1920; return [r.left + x * s, r.top + y * s];
}, [x, y]);
const scale = await app(() => document.getElementById('slide-canvas').getBoundingClientRect().width / 1920);

// ---------- Align ----------
await select([0]);
check('one object: "Align on the slide"', (await page.textContent('.arrange-section')).includes('Align on the slide'));
await page.click('[data-action="align"][data-arg="center"]');
await page.click('[data-action="align"][data-arg="middle"]');
let a = await byId(2);
check('centred on the slide', a.x === 860 && a.y === 490, JSON.stringify(a));
await page.click('[data-action="align"][data-arg="right"]');
await page.click('[data-action="align"][data-arg="bottom"]');
a = await byId(2);
check('right / bottom of the slide', a.x === 1720 && a.y === 980, JSON.stringify(a));

await setPos([[2, 100, 100], [3, 500, 300], [4, 1200, 150]]);
await select([0, 1, 2]);
check('several: "Align to each other"', (await page.textContent('.arrange-section')).includes('Align to each other'));
await page.click('[data-action="align"][data-arg="left"]');
let all = await els();
check('align left edges', all.every(e => e.x === 100), JSON.stringify(all.map(e => e.x)));
await page.click('[data-action="align"][data-arg="top"]');
all = await els();
check('align top edges', all.every(e => e.y === 100), JSON.stringify(all.map(e => e.y)));
await page.click('[data-action="align"][data-arg="middle"]');
all = await els();
check('align middles (box 100–300)', all.every(e => e.y + e.h / 2 === 200), JSON.stringify(all.map(e => e.y + e.h / 2)));

// ---------- Distribute ----------
await setPos([[2, 100, 100], [3, 300, 300], [4, 1200, 150]]);
await select([0, 1, 2]);
await page.click('[data-action="distribute"][data-arg="x"]');
all = await els();
check('distribute horizontally: equal gaps, ends stay', all[0].x === 100 && all[1].x === 700 && all[2].x === 1200, JSON.stringify(all.map(e => e.x)));
await select([0, 1]);
check('distribute only offered for 3+', !(await page.$('[data-action="distribute"]')));

// ---------- Undo ----------
await page.mouse.click(700, 920);
await page.keyboard.press('Control+z');
await page.waitForTimeout(100);
all = await els();
check('undo reverts a distribute', all[1].x === 300, JSON.stringify(all.map(e => e.x)));

// ---------- Layers ----------
await select([0]);
check('already at the back: To back / Backward disabled', await page.$eval('[data-action="reorder"][data-arg="back"]', b => b.disabled)
    && await page.$eval('[data-action="reorder"][data-arg="backward"]', b => b.disabled)
    && !(await page.$eval('[data-action="reorder"][data-arg="front"]', b => b.disabled)));
await page.click('[data-action="reorder"][data-arg="front"]');
let order = (await els()).map(e => e.id);
let selNow = await app(async () => (await import('/core/state.js')).getSelectedElementIndices());
check('To front: drawn last, still selected', JSON.stringify(order) === '[3,4,2]' && JSON.stringify(selNow) === '[2]', JSON.stringify({ order, selNow }));
check('…and on top on the canvas', await app(() => [...document.querySelectorAll('#slide-canvas > [data-element-id]')].map(n => n.dataset.elementId).join(',')) === '3,4,2');
await page.mouse.click(700, 920); // focus away from the panel
await select([2]);
await page.keyboard.press('Control+BracketLeft');
order = (await els()).map(e => e.id);
check('Ctrl+[ sends backward one step', JSON.stringify(order) === '[3,2,4]', JSON.stringify(order));
await page.keyboard.press('Control+Shift+BracketLeft');
order = (await els()).map(e => e.id);
check('Ctrl+Shift+[ sends to back', JSON.stringify(order) === '[2,3,4]', JSON.stringify(order));
await page.keyboard.press('Control+BracketRight');
order = (await els()).map(e => e.id);
check('Ctrl+] brings forward', JSON.stringify(order) === '[3,2,4]', JSON.stringify(order));
await select([0, 2]); // ids 3 and 4, around 2
await page.click('[data-action="reorder"][data-arg="back"]');
order = (await els()).map(e => e.id);
check('several to back keep their order', JSON.stringify(order) === '[3,4,2]', JSON.stringify(order));
await app(async () => {
    const { state } = await import('/core/state.js');
    state.slides[0].elements.sort((p, q) => p.id - q.id);
    (await import('/editor/editor.js')).renderEditor();
});

// ---------- Lock ----------
await setPos([[2, 100, 100], [3, 500, 300], [4, 1200, 150]]);
await select([0]);
await page.check('[data-arrange-lock]');
a = await byId(2);
check('lock checkbox sets locked:yes', a.locked === 'yes');
check('locked: 🔒 dashed outline when selected', await app(() => document.querySelector('#slide-canvas [data-element-id="2"]').classList.contains('locked')));
let [px, py] = await toClient(200, 150);
await page.mouse.move(px, py); await page.mouse.down(); await page.mouse.move(px + 60, py + 40, { steps: 5 }); await page.mouse.up();
await page.waitForTimeout(100);
a = await byId(2);
check('a locked object is not dragged', a.x === 100 && a.y === 100, JSON.stringify(a));
// Dragging from it draws a selection rectangle (that doesn't select it)
[px, py] = await toClient(150, 120);
const [qx, qy] = await toClient(620, 420);
await page.mouse.move(px, py); await page.mouse.down(); await page.mouse.move(qx, qy, { steps: 6 }); await page.mouse.up();
await page.waitForTimeout(100);
selNow = await app(async () => (await import('/core/state.js')).getSelectedElementIndices());
check('a drag starting on it selects with a rectangle, without it', JSON.stringify(selNow) === '[1]', JSON.stringify(selNow));
[px, py] = await toClient(200, 150);
await page.mouse.click(px, py);
selNow = await app(async () => (await import('/core/state.js')).getSelectedElementIndices());
check('a click selects it', JSON.stringify(selNow) === '[0]', JSON.stringify(selNow));
await page.keyboard.press('ArrowRight');
a = await byId(2);
check('arrow keys don\'t move it', a.x === 100);
await select([0, 1]);
await page.click('[data-action="align"][data-arg="left"]');
all = await els();
check('align: the locked one is the anchor and stays', all[0].x === 100 && all[1].x === 100, JSON.stringify(all.map(e => e.x)));
const saved = await app(async () => (await import('/core/state.js')).serializeProject());
check('.gl: locked:yes', /\.element\.shape id:2 locked:yes /.test(saved), saved.split('\n').find(l => l.includes('id:2')));
const back = await app(async (t) => (await import('/core/state.js')).parseProjectContent(t).slides[0].elements[0].locked, saved);
check('.gl: read back', back === 'yes');
await page.mouse.click(700, 920);
await select([0]);
await page.keyboard.press('Control+Shift+L');
a = await byId(2);
check('Ctrl+Shift+L unlocks', a.locked === undefined, JSON.stringify(a));

// ---------- Smart guides ----------
await setPos([[2, 100, 100], [3, 500, 300], [4, 1200, 150]]);
await select([]);
// Drag B (500,300 100×100) so its left edge lands 3 slide units right of A's left edge (100).
[px, py] = await toClient(550, 350);
const dx = (103 - 500) * scale;
await page.mouse.move(px, py); await page.mouse.down();
await page.mouse.move(px + dx / 2, py + 2, { steps: 4 });
await page.mouse.move(px + dx, py + 2, { steps: 4 });
const guideWhileDragging = await app(() => [...document.querySelectorAll('#slide-canvas > .smart-guide-v')].map(g => parseFloat(g.style.left)));
await page.mouse.up();
await page.waitForTimeout(100);
let b = await byId(3);
check('moving: left edge snaps to another object\'s left edge', b.x === 100, JSON.stringify(b));
check('a guide line is shown while dragging, and removed after', guideWhileDragging.includes(100) && !(await page.$('.smart-guide')), JSON.stringify(guideWhileDragging));
// Centre on the slide's centre
[px, py] = await toClient(150, 350);
await page.mouse.move(px, py); await page.mouse.down();
await page.mouse.move(px + (907 - 100) * scale, py + (487 - 300) * scale, { steps: 8 });
await page.mouse.up();
await page.waitForTimeout(100);
b = await byId(3);
check('snaps to the slide centre on both axes', b.x === 910 && b.y === 490, JSON.stringify(b));
// Alt: no snapping
await setPos([[3, 500, 300]]);
[px, py] = await toClient(550, 350);
await page.keyboard.down('Alt');
await page.mouse.move(px, py); await page.mouse.down();
await page.mouse.move(px + dx, py + 2 * scale, { steps: 6 });
await page.mouse.up();
await page.keyboard.up('Alt');
await page.waitForTimeout(100);
b = await byId(3);
check('Alt: no snapping', Math.abs(b.x - 103) <= 3 && b.x !== 100, JSON.stringify(b));
// Resize: the right edge snaps to another object's left edge
await setPos([[3, 500, 300]]);
await select([]);
[px, py] = await toClient(299, 150); // A's right edge
await page.mouse.move(px, py); await page.mouse.down();
await page.mouse.move(px + (1197 - 300) * scale, py, { steps: 8 });
await page.mouse.up();
await page.waitForTimeout(100);
a = await byId(2);
check('resizing: the edge snaps to a guide', a.x === 100 && a.x + a.w === 1200, JSON.stringify(a));
// Several objects move together and snap as one box
await setPos([[2, 100, 100], [3, 500, 300]]);
await app(async () => { const { state } = await import('/core/state.js'); state.slides[0].elements[0].width = 200; });
await select([0, 1]);
[px, py] = await toClient(200, 150);
await page.mouse.move(px, py); await page.mouse.down();
await page.mouse.move(px + (1497 - 600) * scale, py + 1, { steps: 8 }); // box right 600 → 1497, near C's right (1500)
await page.mouse.up();
await page.waitForTimeout(100);
all = await els();
check('a multiple selection snaps as one box', all[1].x + all[1].w === 1500 && all[0].x === 1000, JSON.stringify(all.map(e => [e.x, e.y])));

console.log(out.join('\n'));
console.log('--- errors ---\n' + (errors.join('\n') || '(none)'));
await browser.close();
