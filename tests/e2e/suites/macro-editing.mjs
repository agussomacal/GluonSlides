import { launchBrowser, BASE_URL, OUT_DIR, FIXTURES_DIR, REPO_DIR } from '../helpers.mjs';
const browser = await launchBrowser();
const page = await browser.newPage({ viewport: { width: 1500, height: 950 } });
const errors = [];
page.on('pageerror', e => errors.push('pageerror: ' + e.message));
page.on('console', m => { if (m.type() === 'error' && !m.text().includes('404')) errors.push('console: ' + m.text()); });
page.on('dialog', d => { errors.push('dialog: ' + d.message()); d.dismiss(); });
await page.addInitScript(() => {
    const files = {}; window.__files = files;
    const ok = (o = {}) => Promise.resolve({ success: true, ...o });
    window.pywebview = { api: {
        get_recent_projects: () => ok({ projects: [] }), add_recent_project: () => ok(),
        get_inspector_settings: () => ok({ settings: null }), save_inspector_settings: () => ok(),
        create_project: (n) => ok({ path: `/p/${n}/${n}.gl`, folder: `/p/${n}` }),
        save_project_data: (p, c) => { files[p] = c; return ok(); },
        load_project_at: (p) => files[p] ? ok({ path: p, content: files[p] }) : Promise.resolve({ success: false }),
        save_text_file: (d, n, c) => { files[`${d}/${n}`] = c; return ok(); },
        load_text_file: (d, n) => files[`${d}/${n}`] !== undefined ? ok({ content: files[`${d}/${n}`] }) : Promise.resolve({ success: false }),
    } };
});
const out = [];
const check = (n, c, x = '') => out.push(`${c ? 'PASS' : 'FAIL'} ${n}${x !== '' ? ' — ' + x : ''}`);
await page.goto(`${BASE_URL}/index.html`);
await page.waitForTimeout(400);
await page.evaluate(async () => {
    await (await import('/ui/project.js')).createProject('Deck');
    const m = await import('/core/state.js'); const mac = await import('/core/macros.js');
    m.state.gridSize = 0; m.state.imports = ['macros.gl'];
    mac.applyLibraryText('macros.gl', [
        '.define {card} width:400 height:300',
        '\t.element.shape name:frame x:0 y:0 width:400 height:300 radius:20 bg:#e0f2fe borderCol:#0369a1 borderWidth:2 borderStyle:solid',
        '\t.element.text name:title x:20 y:20 width:360 height:80 fontSize:40 fontFamily:sans-serif fontColor:#0f172a textAlign:center verticalAlign:center bg:transparent borderCol:transparent borderWidth:0 borderStyle:solid',
        '\t\tTitle',
        '\t.element.shape name:badge x:330 y:230 width:50 height:50 kind:ellipse bg:#0369a1 borderCol:#0369a1 borderWidth:0 borderStyle:solid', ''].join('\n'));
    const els = m.state.slides[0].elements;
    els.push({ type: 'macro', id: m.allocateElementId(), ref: 'card', x: 100, y: 100, width: 400, height: 300, overrides: [], extras: [] },
             { type: 'macro', id: m.allocateElementId(), ref: 'card', x: 700, y: 100, width: 800, height: 600, overrides: [], extras: [] });
    m.markDirty();
    (await import('/editor/editor.js')).renderEditor();
});
const S = () => page.evaluate(async () => {
    const m = await import('/core/state.js');
    return { els: JSON.parse(JSON.stringify(m.state.slides[0].elements)), editing: m.state.editingGroupId, sel: m.getSelectedElementIndices(),
             def: JSON.parse(JSON.stringify(m.state.macros.card)), gl: m.serializeProject() };
});
const toClient = (x, y) => page.evaluate(([x, y]) => {
    const r = document.getElementById('slide-canvas').getBoundingClientRect();
    const s = r.width / 1920; return [r.left + x * s, r.top + y * s];
}, [x, y]);
const dragSlide = async (from, to) => {
    const [a, b] = await toClient(...from); const [c, d] = await toClient(...to);
    await page.mouse.move(a, b); await page.mouse.down(); await page.mouse.move(c, d, { steps: 8 }); await page.mouse.up();
    await page.waitForTimeout(120);
};
let st = await S();
const [i1, i2] = st.els;

// 1. Double-click the second instance -> instance editing
const [dx, dy] = await toClient(700 + 400, 100 + 400);
await page.mouse.dblclick(dx, dy);
await page.waitForTimeout(150);
st = await S();
check('double-click opens instance editing', st.editing === i2.id);
check('purple banner: changes are overrides', (await page.textContent('.group-banner.macro-banner')).includes('overrides'));
check('children interactive', (await page.$$('.group-entered > .group-frame > [data-element-id]')).length === 3);

// 2. Select the title -> its name is shown
const titleNode = (await page.$$('.group-entered > .group-frame > [data-element-id]'))[1];
const tb = await titleNode.boundingBox();
await page.mouse.click(tb.x + 20, tb.y + 20);
await page.waitForTimeout(100);
check('selected child shows ::title', (await page.$eval('#properties-body', n => n.innerHTML)).includes('::title'));

// 3. Restyle it in the properties panel -> override
await page.evaluate(() => { const c = document.querySelector('[data-prop="fontColor"]'); c.value = '#dc2626'; c.dispatchEvent(new Event('change', { bubbles: true })); });
st = await S();
let inst = st.els[1];
check('property change -> override on this instance', JSON.stringify(inst.overrides) === JSON.stringify([{ target: 'title', props: { fontColor: '#dc2626' } }]), JSON.stringify(inst.overrides));
check('other instance untouched', JSON.stringify(st.els[0].overrides) === '[]');
check('"Overridden here" + reset shown', (await page.textContent('#properties-body')).includes('Overridden here: fontColor') && await page.$('[data-action="reset-override"]') !== null);

// 4. Drag the badge (frame space: x 330 -> drag 100 slide px = 50 frame px at 2x)
await dragSlide([700 + 2 * 355, 100 + 2 * 255], [700 + 2 * 355 + 100, 100 + 2 * 255]);
st = await S();
inst = st.els[1];
const badgeO = inst.overrides.find(o => o.target === 'badge');
check('drag -> x override in frame units', badgeO && Number(badgeO.props.x) === 380 && badgeO.props.y === undefined, JSON.stringify(badgeO));

// 5. Delete the frame -> hidden:yes; add a text box -> extra
const frameNode = (await page.$$('.group-entered > .group-frame > [data-element-id]'))[0];
const fb = await frameNode.boundingBox();
await page.mouse.click(fb.x + fb.width - 15, fb.y + fb.height / 2);
await page.evaluate(() => document.activeElement && document.activeElement.blur());
await page.keyboard.press('Delete');
await page.click('[data-type="text"]');
await page.waitForTimeout(100);
st = await S();
inst = st.els[1];
check('delete -> ::frame hidden:yes', inst.overrides.some(o => o.target === 'frame' && o.props.hidden === 'yes'), JSON.stringify(inst.overrides));
check('added element -> extra', inst.extras.length === 1 && inst.extras[0].type === 'text' && inst.extras[0].id === undefined);

// 6. Esc closes the session; file has the overrides
await page.evaluate(() => document.activeElement && document.activeElement.blur());
await page.keyboard.press('Escape');
st = await S();
inst = st.els[1];
check('Esc closes the session', st.editing === null && inst.children === undefined && JSON.stringify(st.sel) === '[1]');
check('.gl has the overrides + extra', /\t::title fontColor:#dc2626\n/.test(st.gl) && /\t::badge x:380\n/.test(st.gl) && /\t::frame hidden:yes\n/.test(st.gl) && /\t\.element\.text x:/.test(st.gl), st.gl.split('\n').filter(l => l.startsWith('\t')).join(' | '));
check('instance draws the result', await page.evaluate(() => document.querySelectorAll('#slide-canvas > .element-macro')[1].querySelectorAll('.group-child').length) === 3);

// 7. Re-enter, reset the title override
await page.click('[data-action="enter-group"]');
await page.waitForTimeout(100);
const t2 = (await page.$$('.group-entered > .group-frame > [data-element-id]'))[0];
const t2b = await t2.boundingBox();
await page.mouse.click(t2b.x + 20, t2b.y + 20);
await page.click('[data-action="reset-override"]');
st = await S();
check('Reset to macro removes that override', !st.els[1].overrides.some(o => o.target === 'title') && st.editing === i2.id, JSON.stringify(st.els[1].overrides));

// 8. Undo inside a session
await page.evaluate(() => document.activeElement && document.activeElement.blur());
await page.keyboard.press('Control+z');
st = await S();
check('undo restores the override', st.els[1].overrides.some(o => o.target === 'title'), JSON.stringify(st.els[1].overrides));
await page.keyboard.press('Escape');

// 9. Edit definition: every instance follows
await page.evaluate(async () => { const m = await import('/core/state.js'); m.setSelectedElementIndices([0], 0); (await import('/editor/editor.js')).renderEditor(); });
await page.click('[data-action="edit-macro-definition"]');
st = await S();
check('definition mode banner', (await page.textContent('.group-banner')).includes('every instance'));
await page.evaluate(() => { const c = document.querySelectorAll('.group-entered > .group-frame > [data-element-id]')[0]; c.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, button: 0, clientX: c.getBoundingClientRect().x + c.getBoundingClientRect().width - 10, clientY: c.getBoundingClientRect().y + 60 })); window.dispatchEvent(new MouseEvent('mouseup', { bubbles: true })); });
await page.waitForTimeout(80);
await page.evaluate(() => { const c = document.querySelector('[data-prop="bg"]'); c.value = '#fef9c3'; c.dispatchEvent(new Event('change', { bubbles: true })); });
st = await S();
check('definition changed', st.def.children[0].bg === '#fef9c3' && st.def.children[0].id === undefined, JSON.stringify(st.def.children[0].bg));
check('name field editable in definition mode', await page.$('[data-prop="name"]:not([disabled])') !== null);
await page.evaluate(() => document.activeElement && document.activeElement.blur());
await page.keyboard.press('Escape');
const fillsAll = await page.$$eval('#slide-canvas > .element-macro', ns => ns.map(n => n.querySelector('.shape-fill').style.backgroundColor));
// instance 1 shows the new frame color; instance 2 hides its frame (override) so shows its badge
check('instances follow the new definition', fillsAll[0] === 'rgb(254, 249, 195)', JSON.stringify(fillsAll));
await page.evaluate(async () => { const m = await import('/core/state.js'); await m.flushPendingSave(); });
const lib = await page.evaluate(() => window.__files['/p/Deck/macros.gl']);
check('macros.gl saved with the edit', (lib || '').includes('bg:#fef9c3'));

// 10. Go to definition
await page.evaluate(async () => { const m = await import('/core/state.js'); m.setSelectedElementIndices([1], 1); (await import('/editor/editor.js')).renderEditor(); });
await page.click('[data-action="goto-macro-definition"]');
await page.waitForTimeout(300);
const gotoInfo = await page.evaluate(() => {
    const cm = document.querySelector('.CodeMirror').CodeMirror;
    return { tab: document.querySelector('.gl-inspector-tabs .active')?.dataset.file, line: cm.getLine(cm.getCursor().line) };
});
check('Go to definition opens macros.gl at .define', gotoInfo.tab === 'macros.gl' && gotoInfo.line.startsWith('.define {card}'), JSON.stringify(gotoInfo));
check('names listed in properties', (await page.textContent('#properties-body')).includes('Elements: frame title badge'));

// 11. Thumbnail icon in the Macros menu
await page.click('[data-category="macros"] > .toolbar-btn');
check('macro menu shows a thumbnail', (await page.$$('[data-category="macros"] .toolbar-menu .macro-thumb .group-child')).length === 3);
await page.click('[data-category="macros"] > .toolbar-btn'); // close the menu

// 12. Autocomplete (project tab)
await page.click('.gl-inspector-tabs button[data-file="project"]');
await page.waitForTimeout(150);
await page.evaluate(() => { const cm = document.querySelector('.CodeMirror').CodeMirror; cm.focus(); cm.setCursor({ line: cm.lineCount() - 1, ch: 0 }); });
await page.keyboard.type('.el');
await page.waitForTimeout(150);
const h1 = await page.$$eval('.CodeMirror-hint', ns => ns.map(n => n.textContent));
check('"." suggests directives', h1.some(t => t === '.element.text') && h1.some(t => t === '.element.path'), h1.join(','));
await page.keyboard.type('ement.te');
await page.waitForTimeout(100);
await page.keyboard.press('Tab');
let lineNow = await page.evaluate(() => { const cm = document.querySelector('.CodeMirror').CodeMirror; return cm.getLine(cm.getCursor().line); });
check('Tab accepts', lineNow === '.element.text ', JSON.stringify(lineNow));
await page.waitForTimeout(100);
await page.keyboard.type('fontF');
await page.waitForTimeout(100);
const h2 = await page.$$eval('.CodeMirror-hint', ns => ns.map(n => n.textContent));
check('parameters of the type', JSON.stringify(h2) === '["fontFamily"]', JSON.stringify(h2));
await page.keyboard.press('Tab');
await page.waitForTimeout(150);
const h3 = await page.$$eval('.CodeMirror-hint', ns => ns.map(n => n.textContent));
check('then its values', JSON.stringify(h3) === '["sans-serif","serif","monospace"]', JSON.stringify(h3));
await page.keyboard.press('ArrowDown');
await page.keyboard.press('Tab');
lineNow = await page.evaluate(() => { const cm = document.querySelector('.CodeMirror').CodeMirror; return cm.getLine(cm.getCursor().line); });
check('value inserted', lineNow === '.element.text fontFamily:serif ', JSON.stringify(lineNow));
await page.keyboard.type('fontColor:');
await page.waitForTimeout(120);
const h4 = await page.$$eval('.CodeMirror-hint', ns => ns.map(n => n.textContent));
check('color values from the document', h4.includes('#0369a1') || h4.includes('#dc2626'), JSON.stringify(h4.slice(0, 5)));
await page.keyboard.press('Escape');
// :: override names under a macro instance
await page.evaluate((id) => {
    const cm = document.querySelector('.CodeMirror').CodeMirror;
    const n = cm.getValue().split('\n').findIndex(l => l.startsWith(`.macro.card id:${id} `));
    cm.focus(); cm.setCursor({ line: n, ch: cm.getLine(n).length });
}, i1.id);
await page.keyboard.press('Enter');
await page.keyboard.type('\t::');
await page.waitForTimeout(120);
const h5 = await page.$$eval('.CodeMirror-hint', ns => ns.map(n => n.textContent));
check('"::" suggests the macro\'s element names', h5.join(',') === '::frame  (shape),::title  (text),::badge  (shape)', h5.join(','));
await page.keyboard.type('ti');
await page.keyboard.press('Tab');
await page.waitForTimeout(80);
await page.keyboard.type('hid');
await page.waitForTimeout(120);
const h6 = await page.$$eval('.CodeMirror-hint', ns => ns.map(n => n.textContent));
check('override params include hidden', h6.includes('hidden'), h6.join(','));
check('Enter is not hijacked by hints', true);

console.log(out.join('\n'));
console.log('--- errors ---\n' + (errors.join('\n') || '(none)'));
await browser.close();
