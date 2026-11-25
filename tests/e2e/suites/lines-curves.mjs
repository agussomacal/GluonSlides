import { launchBrowser, BASE_URL, OUT_DIR, FIXTURES_DIR, REPO_DIR } from '../helpers.mjs';
const browser = await launchBrowser();
const page = await browser.newPage({ viewport: { width: 1500, height: 950 } });
const errors = [];
page.on('pageerror', e => errors.push('pageerror: ' + e.message));
page.on('console', m => { if (m.type() === 'error' && !m.text().includes('404')) errors.push('console: ' + m.text()); });
page.on('dialog', d => { errors.push('dialog: ' + d.message()); d.dismiss(); });
const out = [];
const check = (n, c, x = '') => out.push(`${c ? 'PASS' : 'FAIL'} ${n}${x !== '' ? ' — ' + x : ''}`);
await page.goto(`${BASE_URL}/index.html`);
await page.waitForTimeout(400);
await page.evaluate(async () => {
    await (await import('/ui/project.js')).createProject('L');
    const m = await import('/core/state.js'); m.state.gridSize = 0;
    (await import('/editor/editor.js')).renderEditor();
});
const S = () => page.evaluate(async () => {
    const m = await import('/core/state.js');
    return { els: JSON.parse(JSON.stringify(m.activeElements())), sel: m.getSelectedElementIndices(), gl: m.serializeProject() };
});
const toClient = (x, y) => page.evaluate(([x, y]) => {
    const r = document.getElementById('slide-canvas').getBoundingClientRect();
    const s = r.width / 1920; return [r.left + x * s, r.top + y * s];
}, [x, y]);
const pick = async (label) => {
    await page.click('[data-category="lines"] > .toolbar-btn');
    await page.click(`[data-category="lines"] .toolbar-menu button:text-is("${label}")`).catch(async () =>
        page.click(`[data-category="lines"] .toolbar-menu button:has-text("${label}")`));
};
const dragSlide = async (from, to, { steps = 8, shift = false } = {}) => {
    const [a, b] = await toClient(...from); const [c, d] = await toClient(...to);
    if (shift) await page.keyboard.down('Shift');
    await page.mouse.move(a, b); await page.mouse.down(); await page.mouse.move(c, d, { steps }); await page.mouse.up();
    if (shift) await page.keyboard.up('Shift');
    await page.waitForTimeout(100);
};
const clickSlide = async (x, y) => { const [a, b] = await toClient(x, y); await page.mouse.click(a, b); await page.waitForTimeout(60); };
const near = (a, b, tol = 1) => Math.abs(a - b) <= tol;

// Toolbar
await page.click('[data-category="lines"] > .toolbar-btn');
const items = await page.$$eval('[data-category="lines"] .toolbar-menu button', ns => ns.map(n => n.textContent.trim().replace(/^\S+\s+/, '')));
check('Lines & curves menu', items.length === 6, items.join(' | '));
await page.click('[data-category="lines"] > .toolbar-btn');

// 1. Line by dragging
await pick('Line');
check('tool hint shown', await page.isVisible('#tool-hint'));
await dragSlide([200, 200], [600, 400]);
let st = await S();
let L = st.els[0];
check('line created by drag', L && L.type === 'path' && near(L.x, 200) && near(L.y, 200) && near(L.width, 400) && near(L.height, 200), L && `${L.x},${L.y} ${L.width}x${L.height}`);
check('line points', JSON.stringify(L.points) === '[[0,0],[1,1]]', JSON.stringify(L.points));
check('tool ends after drawing', !(await page.isVisible('#tool-hint')) && JSON.stringify(st.sel) === '[0]');
check('2 endpoint handles, no corners', (await page.$$('.el-handle-point')).length === 2 && (await page.$$('.el-handle-corner')).length === 0);

// 2. Arrow with Shift -> horizontal
await pick('Arrow');
await dragSlide([200, 600], [600, 640], { shift: true });
st = await S();
const A = st.els[1];
check('Shift snaps to 45° (horizontal)', A.end === 'arrow' && near(A.height, 1) && near(A.width, 400, 2), `${A.width}x${A.height}`);
check('arrow marker rendered', await page.$('#slide-canvas .canvas-element marker') !== null);

// 3. Click without drag -> default length
await pick('Line');
await clickSlide(1200, 900);
st = await S();
check('click draws default-length line', near(st.els[2].width, 300, 1), st.els[2].width);

// 4. Drag endpoint handle (line 0 end at 600,400 -> 700,250)
await clickSlide(400, 300);           // select line 0 by its stroke
st = await S();
check('click on stroke selects line', JSON.stringify(st.sel) === '[0]', JSON.stringify(st.sel));
const h = await page.$('.el-handle[data-handle="p1"]');
const hb = await h.boundingBox();
const [tx, ty] = await toClient(700, 250);
await page.mouse.move(hb.x + hb.width / 2, hb.y + hb.height / 2); await page.mouse.down();
await page.mouse.move(tx, ty, { steps: 6 }); await page.mouse.up(); await page.waitForTimeout(100);
st = await S();
L = st.els[0];
check('endpoint drag renormalizes box', near(L.x, 200) && near(L.y, 200) && near(L.width, 500, 2) && near(L.height, 50, 2), `${L.x},${L.y} ${L.width}x${L.height}`);

// 5. Empty part of the line's box does not grab the line
await clickSlide(1500, 300);  // deselect
await dragSlide([250, 240], [260, 245], { steps: 2 }); // inside box, away from stroke
st = await S();
check('empty box area is click-through', st.els[0].x === L.x && st.els[0].y === L.y);

// 6. Curve by points + double-click
await pick('Curve');
await clickSlide(900, 200); await clickSlide(1100, 100); await clickSlide(1300, 300);
const [fx, fy] = await toClient(1500, 150);
await page.mouse.dblclick(fx, fy); await page.waitForTimeout(120);
st = await S();
const C = st.els[3];
check('curve from clicked points', C && C.curve === 'smooth' && C.points.length === 4, C && JSON.stringify(C.points));
check('curve has corner + point handles', (await page.$$('.el-handle-corner')).length === 4 && (await page.$$('.el-handle-point')).length === 4);

// 7. Corner handle scales the curve
const box0 = { x: C.x, y: C.y, w: C.width, h: C.height };
const se = await (await page.$('.el-handle[data-handle="se"]')).boundingBox();
const [sx2, sy2] = await toClient(C.x + C.width * 1.5, C.y + C.height * 1.5);
await page.mouse.move(se.x + se.width / 2, se.y + se.height / 2); await page.mouse.down();
await page.mouse.move(sx2, sy2, { steps: 6 }); await page.mouse.up(); await page.waitForTimeout(100);
st = await S();
const C2 = st.els[3];
check('corner drag scales, points keep fractions', near(C2.x, box0.x) && near(C2.width, box0.w * 1.5, 2) && JSON.stringify(C2.points) === JSON.stringify(C.points), `${C2.width}x${C2.height}`);

// 8. Double-click a point handle removes it; double-click stroke adds one
const p2 = await (await page.$('.el-handle[data-handle="p2"]')).boundingBox();
await page.mouse.dblclick(p2.x + p2.width / 2, p2.y + p2.height / 2); await page.waitForTimeout(120);
st = await S();
check('double-click point removes it', st.els[3].points.length === 3, st.els[3].points.length);
const mid = await page.evaluate(() => {
    const path = document.querySelector('#slide-canvas .canvas-element.selected .path-hit');
    const len = path.getTotalLength(); const pt = path.getPointAtLength(len * 0.3);
    const m = path.getScreenCTM(); return [pt.x * m.a + m.e, pt.y * m.d + m.f];
});
await page.mouse.dblclick(mid[0], mid[1]); await page.waitForTimeout(150);
st = await S();
check('double-click stroke adds a point', st.els[3].points.length === 4, st.els[3].points.length);

// 9. Polygon closes when clicking the first point
await page.click('[data-category="shapes"] > .toolbar-btn');
await page.click('[data-category="shapes"] .toolbar-menu button:has-text("Polygon")');
await clickSlide(300, 800); await clickSlide(500, 750); await clickSlide(450, 950); await clickSlide(301, 801);
st = await S();
const P = st.els[4];
check('polygon closes on first point', P && P.closed === 'yes' && P.points.length === 3 && P.fill && P.fill !== 'none', P && JSON.stringify([P.points.length, P.closed]));

// 10. Freehand
await pick('Freehand');
const pts = [];
for (let i = 0; i <= 60; i++) { const t = i / 60; pts.push([800 + 400 * t, 650 + 120 * Math.sin(t * Math.PI * 2)]); }
const c0 = await toClient(...pts[0]);
await page.mouse.move(...c0); await page.mouse.down();
for (const p of pts.slice(1)) { const c = await toClient(...p); await page.mouse.move(...c); }
await page.mouse.up(); await page.waitForTimeout(120);
st = await S();
const F = st.els[5];
check('freehand simplified to few points', F && F.points.length >= 4 && F.points.length < 20, F && F.points.length);
check('freehand is smooth', F && F.curve === 'smooth');

// 11. Esc cancels a tool
await pick('Curve');
await clickSlide(100, 100);
await page.keyboard.press('Escape');
st = await S();
check('Esc cancels tool without creating', st.els.length === 6 && !(await page.isVisible('#tool-hint')));
check('no preview left', (await page.$$('.tool-preview')).length === 0);

// 12. Properties
await page.evaluate(async () => { const m = await import('/core/state.js'); m.setSelectedElementIndices([0], 0); (await import('/editor/editor.js')).renderEditor(); });
check('no background/border section for paths', !(await page.$('[data-prop="bg"]')));
await page.fill('[data-prop="strokeWidth"]', '9');
await page.selectOption('[data-prop="dash"]', 'dashed');
await page.selectOption('[data-prop="end"]', 'dot');
st = await S();
check('stroke props', st.els[0].strokeWidth === 9 && st.els[0].dash === 'dashed' && st.els[0].end === 'dot');
check('dash rendered', (await page.$eval('#slide-canvas .canvas-element.selected svg path', p => p.getAttribute('stroke-dasharray'))) === '27 18');
await page.evaluate(async () => { const m = await import('/core/state.js'); m.setSelectedElementIndices([4], 4); (await import('/editor/editor.js')).renderEditor(); });
await page.click('.color-field[data-prop="fill"]');
await page.click('.color-popover [data-none]');
st = await S();
const unfilled = await page.$eval('#slide-canvas .canvas-element.selected svg path', p => p.getAttribute('fill'));
check('No fill via the color picker', st.els[4].fill === 'transparent' && unfilled === 'none', `${st.els[4].fill} -> ${unfilled}`);

// 13. Format + round-trip + export
check('.gl body points', /^\.element\.path id:\d+ x:200 y:200 width:500 height:50 strokeWidth:9 dash:dashed end:dot\n\t0 0\n\t1 1$/m.test(st.gl), st.gl.split('\n').find(l => l.startsWith('.element.path')));
const rt = await page.evaluate(async (gl) => { const f = await import('/core/gl/glformat.js'); const p = f.parseGl(gl); return f.serializeGl({ ...p, projectName: p.name }) === gl; }, st.gl);
check('round-trip stable', rt);
const exp = await page.evaluate(async () => { const { exportElementMarkup } = await import('/core/render.js'); const m = await import('/core/state.js'); return m.state.slides[0].elements.map(exportElementMarkup).join(''); });
check('export has svg + markers', exp.includes('<svg') && exp.includes('<marker') && !exp.includes('path-hit'));

// 14. Grouping a path scales its stroke with the group
await page.evaluate(async () => {
    const m = await import('/core/state.js'); m.setSelectedElementIndices([0, 1]);
    const ed = await import('/editor/editor.js'); ed.groupSelected();
    const g = m.state.slides[0].elements.find(e => e.type === 'group'); g.width *= 2; g.height *= 2; ed.renderEditor();
});
const strokePx = await page.evaluate(async () => {
    // User units of the line's SVG equal box px, so stroke on screen =
    // strokeWidth × (screen width of the svg / box width), in slide px.
    const m = await import('/core/state.js');
    const g = m.state.slides[0].elements.find(e => e.type === 'group');
    const line = g.children.find(c => c.strokeWidth === 9);
    const svg = document.querySelectorAll('#slide-canvas .element-group .group-frame > .group-child')[g.children.indexOf(line)].querySelector('svg');
    const canvasScale = document.getElementById('slide-canvas').getBoundingClientRect().width / 1920;
    return line.strokeWidth * (svg.getBoundingClientRect().width / line.width) / canvasScale;
});
check('stroke scales with group (9px -> 18px)', near(strokePx, 18, 0.5), strokePx.toFixed(2));

// 15. Inspector shows paths
await page.click('.canvas-element.element-group', { button: 'right' });
await page.click('#gl-context-menu button');
await page.waitForTimeout(300);
check('inspector highlights path syntax', await page.$('.cm-gl-directive-element') !== null);

await page.screenshot({ path: `${OUT_DIR}/lines-curves.png` });
console.log(out.join('\n'));
console.log('--- errors ---\n' + (errors.join('\n') || '(none)'));
await browser.close();
