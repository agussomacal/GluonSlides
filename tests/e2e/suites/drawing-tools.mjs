import { launchBrowser, BASE_URL, OUT_DIR, FIXTURES_DIR, REPO_DIR } from '../helpers.mjs';
const browser = await launchBrowser();
const page = await browser.newPage({ viewport: { width: 1500, height: 950 } });
const errors = [];
page.on('pageerror', e => errors.push('pageerror: ' + e.message));
page.on('console', m => { if (m.type() === 'error' && !m.text().includes('404')) errors.push('console: ' + m.text()); });
const out = [];
const check = (n, c, x = '') => out.push(`${c ? 'PASS' : 'FAIL'} ${n}${x !== '' ? ' — ' + x : ''}`);
await page.goto(`${BASE_URL}/index.html`);
await page.waitForTimeout(400);
await page.evaluate(async () => {
    await (await import('/ui/project.js')).createProject('D');
    const m = await import('/core/state.js');
    // An existing selected element, so a leaking click would visibly deselect/redraw.
    m.state.slides[0].elements.push({ id: m.allocateElementId(), type: 'shape', x: 1500, y: 100, width: 200, height: 150, bg: '#ccc', borderCol: '#000', borderWidth: 2, borderStyle: 'solid' });
    m.setSelectedElementIndices([0], 0);
    (await import('/editor/editor.js')).renderEditor();
});
const toClient = (x, y) => page.evaluate(([x, y]) => {
    const r = document.getElementById('slide-canvas').getBoundingClientRect();
    const s = r.width / 1920; return [r.left + x * s, r.top + y * s];
}, [x, y]);
// Human-like click: hold the button for a while.
const humanClick = async (x, y) => {
    const [a, b] = await toClient(x, y);
    await page.mouse.move(a, b, { steps: 3 });
    await page.mouse.down(); await page.waitForTimeout(150); await page.mouse.up();
    await page.waitForTimeout(250);
};
const humanDouble = async (x, y) => {
    const [a, b] = await toClient(x, y);
    await page.mouse.move(a, b, { steps: 3 });
    await page.mouse.click(a, b, { clickCount: 1, delay: 60 });
    await page.mouse.click(a, b, { clickCount: 2, delay: 60 });
    await page.waitForTimeout(250);
};
const previewState = () => page.evaluate(() => {
    const svg = document.querySelector('.tool-preview');
    return svg && svg.isConnected
        ? { dots: svg.querySelectorAll('.tool-preview-points circle').length, d: svg.querySelector('.tool-preview-line').getAttribute('d') || '' }
        : null;
});
const pick = async (cat, label) => {
    await page.click(`[data-category="${cat}"] > .toolbar-btn`);
    await page.click(`[data-category="${cat}"] .toolbar-menu button:has-text("${label}")`);
};
const els = () => page.evaluate(async () => JSON.parse(JSON.stringify((await import('/core/state.js')).state.slides[0].elements)));

// Menus
const lineItems = await page.evaluate(() => { document.querySelector('[data-category="lines"] > .toolbar-btn').click(); return [...document.querySelectorAll('[data-category="lines"] .toolbar-menu button')].map(b => b.textContent.trim().replace(/^\S+\s+/, '')); });
check('Lines menu: open paths only', lineItems.join(',') === 'Line,Arrow,Double arrow,Curve,Curved arrow,Freehand', lineItems.join(','));
await page.keyboard.press('Escape');
const shapeItems = await page.evaluate(() => { document.querySelector('[data-category="shapes"] > .toolbar-btn').click(); return [...document.querySelectorAll('[data-category="shapes"] .toolbar-menu button')].map(b => b.textContent.trim().replace(/^\S+\s+/, '')); });
check('Shapes menu: box shapes + closed paths', shapeItems.join(',') === 'Rectangle,Rounded rectangle,Ellipse,Circle,Dot,Polygon,Closed curve,Freehand shape', shapeItems.join(','));
check('divider between box shapes and paths', (await page.$$('[data-category="shapes"] .toolbar-menu-divider')).length === 1);
await page.keyboard.press('Escape');

// Curve with slow, human clicks: preview visible after every click.
await pick('lines', 'Curve');
const seen = [];
for (const [i, p] of [[200, 600], [450, 350], [700, 650], [950, 300], [1200, 600]].entries()) {
    await humanClick(...p);
    const pv = await previewState();
    seen.push(pv ? pv.dots : 'gone');
    // move the mouse: the rubber segment should follow
    const [mx, my] = await toClient(p[0] + 100, p[1] + 50);
    await page.mouse.move(mx, my, { steps: 2 });
}
check('preview stays visible and shows every point', JSON.stringify(seen) === '[1,2,3,4,5]', JSON.stringify(seen));
const pv = await previewState();
check('rubber segment follows the mouse', pv && (pv.d.match(/C/g) || []).length === 5, pv && pv.d.slice(0, 40));
check('no element created yet, selection untouched', (await els()).length === 1);
await humanDouble(1300, 650);
const after = await els();
const curve = after[1];
check('double-click finishes with all points (+1 at dblclick)', curve && curve.points.length === 6, curve && curve.points.length);
check('preview removed', (await previewState()) === null);
check('new curve selected', await page.evaluate(async () => JSON.stringify((await import('/core/state.js')).getSelectedElementIndices()) === '[1]'));

// Closed curve (Shapes menu): closing edge shown, click first point closes.
await pick('shapes', 'Closed curve');
for (const p of [[300, 150], [600, 120], [650, 400]]) await humanClick(...p);
const closeEdge = await page.evaluate(() => document.querySelector('.tool-preview .tool-preview-close').getAttribute('d'));
check('closing edge previewed', !!closeEdge, closeEdge);
const [fx, fy] = await toClient(302, 152);
await page.mouse.move(fx, fy, { steps: 3 });
check('first point highlighted when closable', await page.$('.tool-preview circle.closing') !== null);
await humanClick(302, 152);
const blob = (await els())[2];
check('clicking the first point closes it', blob && blob.closed === 'yes' && blob.points.length === 3 && blob.fill !== 'none');

// Polygon finished with double-click
await pick('shapes', 'Polygon');
for (const p of [[900, 700], [1100, 700]]) await humanClick(...p);
await humanDouble(1000, 900);
const poly = (await els())[3];
check('polygon by double-click', poly && poly.closed === 'yes' && poly.points.length === 3, poly && poly.points.length);

// Freehand shape: closed, smooth, filled
await pick('shapes', 'Freehand shape');
const c0 = await toClient(1400, 400);
await page.mouse.move(...c0); await page.mouse.down();
for (let i = 1; i <= 50; i++) { const t = i / 50 * Math.PI * 1.8; const c = await toClient(1550 + 150 * Math.cos(Math.PI + t), 400 + 150 * Math.sin(Math.PI + t)); await page.mouse.move(...c); }
const midPv = await previewState();
await page.mouse.up(); await page.waitForTimeout(200);
const fh = (await els())[4];
check('freehand preview while drawing', midPv && midPv.d.length > 50);
check('freehand shape closed + filled', fh && fh.closed === 'yes' && fh.curve === 'smooth' && fh.fill !== 'none' && fh.points.length >= 4, fh && fh.points.length);

// Line drag with slow movement keeps preview
await pick('lines', 'Arrow');
const [la, lb] = await toClient(200, 900); const [lc, ld] = await toClient(700, 950);
await page.mouse.move(la, lb); await page.mouse.down();
await page.mouse.move(lc, ld, { steps: 10 }); await page.waitForTimeout(200);
const linePv = await previewState();
await page.mouse.up(); await page.waitForTimeout(250);
check('drag preview shows both ends', linePv && linePv.dots === 2);
check('arrow created', (await els())[5]?.end === 'arrow');
check('selection kept on new arrow (no stray click)', await page.evaluate(async () => JSON.stringify((await import('/core/state.js')).getSelectedElementIndices()) === '[5]'));

await page.screenshot({ path: `${OUT_DIR}/drawing-tools.png` });
console.log(out.join('\n'));
console.log('--- errors ---\n' + (errors.join('\n') || '(none)'));
await browser.close();
