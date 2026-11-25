import { launchBrowser, BASE_URL } from '../helpers.mjs';

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
    const p = await import('/ui/project.js');
    await p.createProject('G');
    const { state, allocateElementId } = await import('/core/state.js');
    const shape = (x, y) => ({ id: allocateElementId(), type: 'shape', x, y, width: 200, height: 100, bg: '#38f', borderCol: '#000', borderWidth: 2, borderStyle: 'solid' });
    state.slides[0].elements.push(
        shape(100, 100), shape(400, 300),
        { id: allocateElementId(), type: 'text', x: 100, y: 450, width: 500, height: 100, content: 'Line one\n.starts with dot\n\n# heading', fontSize: 32, fontFamily: 'sans-serif', fontColor: '#000', textAlign: 'center', verticalAlign: 'center', bg: 'transparent', borderCol: 'transparent', borderWidth: 0, borderStyle: 'solid' },
        shape(1500, 800),
    );
    (await import('/editor/editor.js')).renderEditor();
});
const S = () => page.evaluate(async () => {
    const m = await import('/core/state.js');
    return { els: JSON.parse(JSON.stringify(m.state.slides[0].elements)), editing: m.state.editingGroupId, sel: m.getSelectedElementIndices(), gl: m.serializeProject() };
});
const toClient = (x, y) => page.evaluate(([x, y]) => {
    const r = document.getElementById('slide-canvas').getBoundingClientRect();
    const s = r.width / 1920; return [r.left + x * s, r.top + y * s];
}, [x, y]);
const drag = async (a, b) => {
    const [x1, y1] = await toClient(...a); const [x2, y2] = await toClient(...b);
    await page.mouse.move(x1, y1); await page.mouse.down();
    await page.mouse.move(x2, y2, { steps: 8 }); await page.mouse.up();
    await page.waitForTimeout(120);
};

// 1. Marquee + Ctrl+G
await drag([50, 50], [700, 600]);
let st = await S();
check('marquee picked 3', JSON.stringify(st.sel) === '[0,1,2]', JSON.stringify(st.sel));
check('Group button shown for multi-select', await page.$('[data-action="group-selection"]') !== null);
await page.keyboard.press('Control+g');
await page.waitForTimeout(150);
st = await S();
const g = st.els.find(e => e.type === 'group');
check('group created', !!g && g.children.length === 3 && st.els.length === 2, `els=${st.els.length}`);
check('group bbox', g && g.x === 100 && g.y === 100 && g.width === 500 && g.height === 450, g && `${g.x},${g.y},${g.width}x${g.height}`);
check('children relative', g && g.children[1].x === 300 && g.children[1].y === 200);
check('group selected after grouping', JSON.stringify(st.sel) === '[0]', JSON.stringify(st.sel));

// 2. .gl format
check('gl has group directive', /^\.element\.group id:\d+ x:100 y:100 width:500 height:450 frameWidth:500 frameHeight:450/m.test(st.gl));
check('children indented one tab', /^\t\.element\.shape /m.test(st.gl) && /^\t\.element\.text /m.test(st.gl));
check('child body indented two tabs (dot escaped)', st.gl.includes('\t\tLine one\n\t\t\\.starts with dot\n\n\t\t# heading'));
const rt = await page.evaluate(async (gl) => {
    const f = await import('/core/gl/glformat.js');
    const p = f.parseGl(gl);
    return { again: f.serializeGl({ ...p, projectName: p.name, slides: p.slides }), text: p.slides[0].elements[0].children[2].content };
}, st.gl);
check('round-trip stable', rt.again === st.gl);
check('child text body preserved', rt.text === 'Line one\n.starts with dot\n\n# heading', JSON.stringify(rt.text));

// 3. Resize group 2x wide -> contents scale
await page.evaluate(async () => {
    const m = await import('/core/state.js');
    const grp = m.state.slides[0].elements[0];
    grp.width = 1000; m.markDirty();
    (await import('/editor/editor.js')).renderEditor();
});
const ratio = await page.evaluate(() => {
    const frame = document.querySelector('.canvas-element.element-group .group-frame');
    const child = frame.children[0].getBoundingClientRect();
    const canvas = document.getElementById('slide-canvas').getBoundingClientRect();
    return (child.width / (canvas.width / 1920)).toFixed(1);
});
check('child drawn 2x wide after group resize', ratio === '400.0', ratio);
st = await S();
check('resize only changed group line', st.els[0].children[0].width === 200 && st.els[0].frameWidth === 500);

// 4. Double-click to enter
const [gx, gy] = await toClient(300, 160);
await page.mouse.dblclick(gx, gy);
await page.waitForTimeout(150);
st = await S();
check('double-click enters group', st.editing === st.els[0].id);
check('entered shell + banner', await page.$('.group-entered') !== null && await page.$('.group-banner') !== null);
check('outside elements dimmed', await page.$('.outside-group') !== null);
const childNodes = await page.$$('.group-entered > .group-frame > [data-element-id]');
check('children interactive', childNodes.length === 3);

// 5. Drag a child: screen move of 100 slide px along x = 50 frame px (sx=2)
const c0 = st.els[0].children[0];
const [cx, cy] = await toClient(100 + 2 * (c0.x + 100), 100 + c0.y + 50);
await page.mouse.move(cx, cy); await page.mouse.down();
const [cx2, cy2] = await toClient(100 + 2 * (c0.x + 100) + 100, 100 + c0.y + 50 + 40);
await page.mouse.move(cx2, cy2, { steps: 6 }); await page.mouse.up();
await page.waitForTimeout(150);
st = await S();
const moved = st.els[0].children[0];
check('child dragged in frame units (x+50, y+40 before snap)', Math.abs(moved.x - (c0.x + 50)) <= 20 && Math.abs(moved.y - (c0.y + 40)) <= 20, `${c0.x},${c0.y} -> ${moved.x},${moved.y}`);
check('still inside group after drag', st.editing === st.els[0].id);

// 6. Marquee inside group selects children
await drag([110, 105], [1090, 330]);
st = await S();
check('marquee inside group selects children', st.editing !== null && st.sel.length >= 2, JSON.stringify(st.sel));

// 7. Esc leaves group and selects it
await page.evaluate(() => document.activeElement && document.activeElement.blur());
await page.keyboard.press('Escape');
await page.waitForTimeout(100);
st = await S();
check('Esc leaves group', st.editing === null && JSON.stringify(st.sel) === '[0]', `editing=${st.editing} sel=${JSON.stringify(st.sel)}`);

// 8. Ungroup bakes scale
const before = st.els[0];
await page.keyboard.press('Control+Shift+g');
await page.waitForTimeout(100);
st = await S();
const sx = before.width / before.frameWidth, sy = before.height / before.frameHeight;
const b1 = before.children[1];
const a1 = st.els[1];
check('ungroup restores elements', st.els.length === 4 && !st.els.some(e => e.type === 'group'), `els=${st.els.length}`);
check('ungroup bakes positions/sizes', a1.x === before.x + b1.x * sx && a1.width === b1.width * sx && a1.y === before.y + b1.y * sy, `${a1.x},${a1.y},${a1.width}`);
const txt = st.els.find(e => e.type === 'text');
check('ungroup scales font by sqrt(sx*sy)', Math.abs(txt.fontSize - 32 * Math.sqrt(sx * sy)) < 0.01, txt.fontSize);

// 9. Undo regroups
await page.keyboard.press('Control+z');
await page.waitForTimeout(100);
st = await S();
check('undo brings group back', st.els.some(e => e.type === 'group'));

// 10. Inspector: caret on child line enters the group
await page.click('.canvas-element.element-group', { button: 'right' });
await page.click('#gl-context-menu button');
await page.waitForTimeout(300);
const childId = st.els.find(e => e.type === 'group').children[2].id;
await page.evaluate((id) => {
    const cm = document.querySelector('.CodeMirror').CodeMirror;
    const line = cm.getValue().split('\n').findIndex(l => l.startsWith(`\t.element.text id:${id} `));
    cm.focus(); cm.setCursor({ line, ch: 3 });
}, childId);
await page.waitForTimeout(150);
st = await S();
check('caret on child line enters its group', st.editing === st.els.find(e => e.type === 'group').id && st.sel.length === 1, `editing=${st.editing}`);
await page.click('[data-action="close"]');

// 11. Export markup
const exp = await page.evaluate(async () => {
    const { exportElementMarkup } = await import('/core/render.js');
    const { state } = await import('/core/state.js');
    return exportElementMarkup(state.slides[0].elements.find(e => e.type === 'group'));
});
check('export uses scaled frame', /transform:scale\(2, 1\)/.test(exp) && (exp.match(/class="el/g) || []).length === 4);

// 12. Paste a group: all descendants get fresh ids
await page.evaluate(async () => {
    const m = await import('/core/state.js');
    m.setEditingGroup(null);
    m.setSelectedElementIndices([0], 0);
    (await import('/editor/editor.js')).renderEditor();
});
await page.evaluate(() => document.activeElement && document.activeElement.blur());
await page.keyboard.press('Control+c');
await page.keyboard.press('Control+v');
await page.waitForTimeout(100);
const ids = await page.evaluate(async () => {
    const m = await import('/core/state.js'); const ids = [];
    m.forEachElementDeep(m.state.slides[0].elements, e => ids.push(e.id)); return ids;
});
check('pasted group has unique ids', new Set(ids).size === ids.length, JSON.stringify(ids));

console.log(out.join('\n'));
console.log('--- errors ---\n' + (errors.join('\n') || '(none)'));
await browser.close();
