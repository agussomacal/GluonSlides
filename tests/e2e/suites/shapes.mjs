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
await page.evaluate(async () => (await import('/ui/project.js')).createProject('S'));
await page.evaluate(async () => { const m = await import('/core/state.js'); m.state.gridSize = 0; (await import('/editor/editor.js')).renderEditor(); });

// Toolbar layout
const toolbar = await page.$$eval('[data-role="add-element"]', ns => ns.map(n => n.dataset.type || `[${n.dataset.category}]`));
check('toolbar: [text], [fields], [shapes], [lines], Figure, [interactive]', JSON.stringify(toolbar) === '["[text]","[fields]","[shapes]","[lines]","figure","[interactive]"]', JSON.stringify(toolbar));
await page.click('[data-category="text"] .toolbar-split-caret');
const textItems = await page.$$eval('[data-category="text"] .toolbar-menu [data-index]', ns => ns.map(n => n.textContent.trim().replace(/^\S+\s+/, '')));
check('Text ▾: text box, columns, tables', JSON.stringify(textItems) === JSON.stringify(['Text Box', 'Two columns', 'Two columns, wide left (60/40)', 'Three columns', 'Table (draw it)', 'Table from a CSV file…', 'Table from pasted cells…']), JSON.stringify(textItems));
await page.click('[data-category="text"] .toolbar-split-caret');
await page.click('[data-category="shapes"] > .toolbar-btn');
const items = await page.$$eval('[data-category="shapes"] .toolbar-menu button', ns => ns.map(n => n.textContent.trim()));
check('shapes menu entries', items.length === 8, items.join(' | '));
check('menu opens', await page.isVisible('[data-category="shapes"] .toolbar-menu'));
await page.mouse.click(1400, 900);
check('click outside closes menu', !(await page.isVisible('[data-category="shapes"] .toolbar-menu')));

const add = async (label) => {
    await page.click('[data-category="shapes"] > .toolbar-btn');
    await page.click(`[data-category="shapes"] .toolbar-menu button:has-text("${label}")`);
    await page.waitForTimeout(50);
};
for (const l of ['Rectangle', 'Rounded rectangle', 'Ellipse', 'Circle', 'Dot']) await add(l);
const S = () => page.evaluate(async () => {
    const m = await import('/core/state.js');
    return { els: JSON.parse(JSON.stringify(m.state.slides[0].elements)), gl: m.serializeProject() };
});
let st = await S();
const [rect, rounded, ellipse, circle, dot] = st.els;
check('5 shapes added, last selected', st.els.length === 5);
check('dot preset', dot.kind === 'ellipse' && dot.lockAspect === 'yes' && dot.width === 24 && dot.borderWidth === 0);
const radii = await page.$$eval('#slide-canvas > .canvas-element > .shape-fill', ns => ns.map(n => n.style.borderRadius));
check('border-radius per kind', JSON.stringify(radii) === JSON.stringify(['', '32px', '50%', '50%', '50%']), JSON.stringify(radii));
const lines = st.gl.split('\n').filter(l => l.startsWith('.element.shape'));
check('plain rect writes no new props', !/kind:|radius:|lockAspect:/.test(lines[0]), lines[0]);
check('rounded writes radius', /radius:32/.test(lines[1]));
check('circle writes kind+lockAspect', /kind:ellipse lockAspect:yes/.test(lines[3]), lines[3]);
check('thumbnail rounded too', (await page.$$eval('.thumb-element .shape-fill', ns => ns.map(n => n.style.borderRadius))).includes('50%'));

// Canvas helpers
const toClient = (x, y) => page.evaluate(([x, y]) => {
    const r = document.getElementById('slide-canvas').getBoundingClientRect();
    const s = r.width / 1920; return [r.left + x * s, r.top + y * s];
}, [x, y]);
const dragSlide = async (from, to, mods = []) => {
    const [a, b] = await toClient(...from); const [c, d] = await toClient(...to);
    for (const k of mods) await page.keyboard.down(k);
    await page.mouse.move(a, b); await page.mouse.down(); await page.mouse.move(c, d, { steps: 8 }); await page.mouse.up();
    for (const k of mods) await page.keyboard.up(k);
    await page.waitForTimeout(100);
};
// Move shapes apart so they don't overlap
await page.evaluate(async () => {
    const m = await import('/core/state.js'); const e = m.state.slides[0].elements;
    [[100, 100], [600, 100], [1100, 100], [100, 600], [800, 700]].forEach(([x, y], i) => { e[i].x = x; e[i].y = y; });
    (await import('/editor/editor.js')).renderEditor();
});
st = await S();

// Circle: drag right edge -> stays square
const c0 = st.els[3];
await dragSlide([c0.x + c0.width - 3, c0.y + c0.height / 2], [c0.x + c0.width + 97, c0.y + c0.height / 2]);
st = await S();
const c1 = st.els[3];
check('locked circle stays square on edge drag', Math.abs(c1.width - c1.height) < 0.01 && c1.width > c0.width, `${c1.width}x${c1.height}`);
// Top-left corner: bottom-right stays fixed
const br0 = [c1.x + c1.width, c1.y + c1.height];
await dragSlide([c1.x + 3, c1.y + 3], [c1.x - 50, c1.y - 50]);
st = await S();
const c2 = st.els[3];
check('circle resizes from its bounding-box corner', c2.width > c1.width, `${c1.width} -> ${c2.width}`);
check('top-left resize keeps bottom-right corner', Math.abs(c2.x + c2.width - br0[0]) < 0.5 && Math.abs(c2.y + c2.height - br0[1]) < 0.5 && Math.abs(c2.width - c2.height) < 0.01, `${c2.x},${c2.y} ${c2.width}x${c2.height}`);

// Shift-resize rectangle keeps ratio (400x300)
const r0 = st.els[0];
await dragSlide([r0.x + r0.width - 3, r0.y + r0.height - 3], [r0.x + r0.width + 197, r0.y + r0.height + 20], ['Shift']);
st = await S();
const r1 = st.els[0];
check('Shift keeps rectangle ratio', Math.abs(r1.width / r1.height - 4 / 3) < 0.01 && r1.width > r0.width, `${r1.width}x${r1.height}`);
// Without Shift, free resize (bottom edge, which nothing overlaps)
await dragSlide([r1.x + 550, r1.y + r1.height - 3], [r1.x + 550, r1.y + r1.height + 47]);
st = await S();
check('without Shift, free resize', Math.abs(st.els[0].width - r1.width) < 0.01 && st.els[0].height > r1.height, JSON.stringify([r1.width, r1.height, '->', st.els[0].width, st.els[0].height]));

// Dot: dragging the middle moves it, doesn't resize
const d0 = st.els[4];
await dragSlide([d0.x + 12, d0.y + 12], [d0.x + 112, d0.y + 62]);
st = await S();
const d1 = st.els[4];
check('dot drags (moves) from its middle', d1.width === 24 && Math.abs(d1.x - (d0.x + 100)) < 1 && Math.abs(d1.y - (d0.y + 50)) < 1, `${d1.x},${d1.y} ${d1.width}`);

// Properties panel: kind select, radius disabled, checkbox, locked width
await page.evaluate(async () => { const m = await import('/core/state.js'); m.setSelectedElementIndices([1], 1); (await import('/editor/editor.js')).renderEditor(); });
await page.fill('[data-prop="radius"]', '60');
st = await S();
check('radius input', st.els[1].radius === 60 && (await page.$eval('#slide-canvas > .canvas-element.selected > .shape-fill', n => n.style.borderRadius)) === '60px');
await page.selectOption('[data-prop="kind"]', 'ellipse');
st = await S();
check('kind select -> ellipse', st.els[1].kind === 'ellipse');
check('radius disabled for ellipse', await page.isDisabled('[data-prop="radius"]'));
await page.check('[data-prop="lockAspect"]');
st = await S();
check('checkbox -> lockAspect yes', st.els[1].lockAspect === 'yes');
const before = st.els[1];
await page.fill('[data-prop="width"]', String(before.width * 2));
st = await S();
check('typed width scales height when locked', Math.abs(st.els[1].height - before.height * 2) < 0.02, `${st.els[1].width}x${st.els[1].height}`);
await page.uncheck('[data-prop="lockAspect"]');
st = await S();
check('uncheck -> no', st.els[1].lockAspect === 'no');

// Export
const exp = await page.evaluate(async () => {
    const { exportElementMarkup } = await import('/core/render.js');
    const m = await import('/core/state.js');
    return m.state.slides[0].elements.map(exportElementMarkup);
});
check('export border-radius', exp[3].includes('border-radius:50%') && !exp[0].includes('border-radius'));

// Round-trip
const rt = await page.evaluate(async (gl) => { const f = await import('/core/gl/glformat.js'); const p = f.parseGl(gl); return f.serializeGl({ ...p, projectName: p.name }) === gl; }, st.gl);
check('round-trip stable', rt);

// Shapes inside a group still work (scale via group)
await page.evaluate(async () => { const m = await import('/core/state.js'); m.setSelectedElementIndices([3, 4]); (await import('/editor/editor.js')).groupSelected(); });
st = await S();
check('circle+dot groupable', st.els.some(e => e.type === 'group' && e.children.length === 2));

await page.screenshot({ path: `${OUT_DIR}/shapes.png` });
console.log(out.join('\n'));
console.log('--- errors ---\n' + (errors.join('\n') || '(none)'));
await browser.close();
