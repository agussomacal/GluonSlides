import { launchBrowser, BASE_URL, OUT_DIR, FIXTURES_DIR, REPO_DIR } from '../helpers.mjs';
const browser = await launchBrowser();
const page = await browser.newPage({ viewport: { width: 1500, height: 950 } });
const errors = [];
page.on('pageerror', e => errors.push('pageerror: ' + e.message));
page.on('console', m => { if (m.type() === 'error' && !m.text().includes('404')) errors.push('console: ' + m.text()); });
page.on('dialog', d => { errors.push('dialog: ' + d.message()); d.dismiss(); });
await page.addInitScript(() => {
    const files = {};
    window.__files = files;
    const ok = (o = {}) => Promise.resolve({ success: true, ...o });
    window.pywebview = { api: {
        get_recent_projects: () => ok({ projects: [] }), add_recent_project: () => ok(),
        get_inspector_settings: () => ok({ settings: null }), save_inspector_settings: () => ok(),
        create_project: (n) => ok({ path: `/p/${n}/${n}.gl`, folder: `/p/${n}` }),
        save_project_data: (p, c) => { files[p] = c; return ok(); },
        load_project_at: (p) => files[p] ? ok({ path: p, content: files[p] }) : Promise.resolve({ success: false, error: 'nf' }),
        save_text_file: (d, n, c) => { files[`${d}/${n}`] = c; return ok(); },
        load_text_file: (d, n) => files[`${d}/${n}`] !== undefined ? ok({ content: files[`${d}/${n}`] }) : Promise.resolve({ success: false, error: 'File not found' }),
    } };
});
const out = [];
const check = (n, c, x = '') => out.push(`${c ? 'PASS' : 'FAIL'} ${n}${x !== '' ? ' — ' + x : ''}`);
await page.goto(`${BASE_URL}/index.html`);
await page.waitForTimeout(400);
const S = () => page.evaluate(async () => {
    const m = await import('/core/state.js');
    return { els: JSON.parse(JSON.stringify(m.state.slides[0].elements)), macros: JSON.parse(JSON.stringify(m.state.macros)), imports: [...m.state.imports], sel: m.getSelectedElementIndices(), gl: m.serializeProject() };
});
const save = () => page.evaluate(async () => {
    const m = await import('/core/state.js'); m.markDirty(); await m.flushPendingSave();
});
const files = () => page.evaluate(() => ({ ...window.__files }));

await page.evaluate(async () => {
    await (await import('/ui/project.js')).createProject('Deck');
    const m = await import('/core/state.js');
    m.state.gridSize = 0;
    const els = m.state.slides[0].elements;
    els.push(
        { id: m.allocateElementId(), type: 'shape', x: 100, y: 100, width: 400, height: 300, kind: 'rect', radius: 20, bg: '#e0f2fe', borderCol: '#0369a1', borderWidth: 2, borderStyle: 'solid' },
        { id: m.allocateElementId(), type: 'text', x: 120, y: 120, width: 360, height: 80, content: 'Title', fontSize: 40, fontFamily: 'sans-serif', fontColor: '#0f172a', textAlign: 'center', verticalAlign: 'center', bg: 'transparent', borderCol: 'transparent', borderWidth: 0, borderStyle: 'solid' },
    );
    m.setSelectedElementIndices([0, 1]);
    (await import('/editor/editor.js')).renderEditor();
});

// 1. Make macro from the selection (name field + Enter)
check('Make macro field shown', await page.$('#make-macro-name') !== null);
await page.fill('#make-macro-name', 'bad name');
await page.press('#make-macro-name', 'Enter');
await page.waitForTimeout(150);
check('invalid name rejected', (await page.textContent('#make-macro-error')).includes('letters'));
await page.fill('#make-macro-name', 'card');
await page.press('#make-macro-name', 'Enter');
await page.waitForTimeout(300);
let st = await S();
const card = st.macros.card;
check('macro defined in macros.gl', card && card.source === 'macros.gl' && card.width === 400 && card.height === 300 && card.children.length === 2);
check('definition children named, no ids', card && card.children.map(c => c.name).join(',') === 'shape1,text1' && card.children.every(c => c.id === undefined));
check('project imports macros.gl', JSON.stringify(st.imports) === '["macros.gl"]');
check('selection replaced by one instance', st.els.length === 1 && st.els[0].type === 'macro' && st.els[0].ref === 'card' && st.els[0].x === 100);
check('instance renders the macro', (await page.$$('#slide-canvas .canvas-element.element-macro .group-child')).length === 2);
check('properties: Macro: card + Detach', (await page.inputValue('#properties-body input[disabled]')) === 'Macro: card' && await page.$('[data-action="detach-macro"]') !== null);

// 2. Saving writes both files
await save();
let f = await files();
check('Deck.gl imports + uses the macro', /^\.import \{macros\.gl\}\n\.project /m.test(f['/p/Deck/Deck.gl']) && /^\.macro\.card id:\d+ x:100 y:100 width:400 height:300$/m.test(f['/p/Deck/Deck.gl']), (f['/p/Deck/Deck.gl'] || '').split('\n').filter(l => /^\.(import|macro)/.test(l)).join(' | '));
check('macros.gl has the definition', /^\.define \{card\} width:400 height:300\n\t\.element\.shape name:shape1 x:0 y:0 /m.test(f['/p/Deck/macros.gl'] || ''), (f['/p/Deck/macros.gl'] || '(missing)').split('\n').slice(0, 4).join(' | '));

// 3. Insert from the Macros menu
await page.click('[data-category="macros"] > .toolbar-btn');
const items = await page.$$eval('[data-category="macros"] .toolbar-menu button', ns => ns.map(n => n.textContent.trim()));
check('Macros menu lists card', items.length === 1 && items[0].includes('card'), items.join(','));
await page.click('[data-category="macros"] .toolbar-menu button');
st = await S();
check('second instance inserted', st.els.length === 2 && st.els[1].ref === 'card' && st.els[1].width === 400);
await page.evaluate(async () => {
    const m = await import('/core/state.js'); const e = m.state.slides[0].elements[1];
    e.x = 700; e.y = 100; e.width = 800; e.height = 600; m.markDirty(); (await import('/editor/editor.js')).renderEditor();
});
const sizes = await page.$$eval('#slide-canvas .element-macro .shape-fill', ns => ns.map(n => Math.round(n.getBoundingClientRect().width)));
check('resized instance scales contents', sizes.length === 2 && sizes[1] === sizes[0] * 2, JSON.stringify(sizes));

// 4. Overrides in the inspector (project tab)
await page.click('#slide-canvas .element-macro >> nth=1', { button: 'right' });
await page.click('#gl-context-menu button');
await page.waitForTimeout(300);
check('tabs: Project | macros.gl', (await page.$$eval('.gl-inspector-tabs button', b => b.map(x => x.textContent.trim()))).join('|') === 'Project|macros.gl');
const inst2 = st.els[1].id;
await page.evaluate((id) => {
    const cm = document.querySelector('.CodeMirror').CodeMirror;
    const text = cm.getValue().replace(new RegExp(`(\\.macro\\.card id:${id} [^\\n]*)`), '$1\n\t::text1 fontColor:#dc2626\n\t\tResults\n\t::shape1 bg:#fee2e2\n\t::ghost bg:#000000');
    cm.focus(); cm.setValue(text);
}, inst2);
await page.keyboard.press('Control+Enter');
await page.waitForTimeout(400);
st = await S();
check('overrides parsed', JSON.stringify(st.els[1].overrides) === JSON.stringify([
    { target: 'text1', props: { fontColor: '#dc2626' }, body: 'Results' },
    { target: 'shape1', props: { bg: '#fee2e2' } },
    { target: 'ghost', props: { bg: '#000000' } },
]), JSON.stringify(st.els[1].overrides));
const texts = await page.$$eval('#slide-canvas .element-macro .element-text', ns => ns.map(n => n.textContent.trim()));
check('override text only on that instance', JSON.stringify(texts) === '["Title","Results"]', JSON.stringify(texts));
const fills = await page.$$eval('#slide-canvas .element-macro .shape-fill', ns => ns.map(n => n.style.backgroundColor));
check('override bg only on that instance', fills[0] !== fills[1] && fills[1] === 'rgb(254, 226, 226)', JSON.stringify(fills));
check('stale override flagged', await page.$('#slide-canvas .element-macro .macro-warning') !== null);
check('override syntax highlighted', await page.$('.CodeMirror .cm-gl-directive-element') !== null);

// 5. Edit the definition in the macros.gl tab: every instance follows
await page.evaluate(() => document.activeElement && document.activeElement.blur());
await page.waitForTimeout(100);
await page.click('.gl-inspector-tabs button[data-file="macros.gl"]');
await page.waitForTimeout(200);
const libText = await page.evaluate(() => document.querySelector('.CodeMirror').CodeMirror.getValue());
check('macros.gl tab shows the library', libText.includes('.define {card}'));
await page.evaluate(() => {
    const cm = document.querySelector('.CodeMirror').CodeMirror;
    cm.focus(); cm.setValue(cm.getValue().replace('borderCol:#0369a1 borderWidth:2', 'borderCol:#0369a1 borderWidth:12'));
});
await page.keyboard.press('Control+Enter');
await page.waitForTimeout(300);
const borders = await page.$$eval('#slide-canvas .element-macro .shape-fill', ns => ns.map(n => n.style.borderWidth));
check('definition edit updates all instances', JSON.stringify(borders) === '["12px","12px"]', JSON.stringify(borders));
await save();
f = await files();
check('library change saved to macros.gl', (f['/p/Deck/macros.gl'] || '').includes('borderWidth:12'));
await page.click('[data-action="close"]');

// 6. hidden + extras
await page.evaluate(async () => {
    const m = await import('/core/state.js'); const e = m.state.slides[0].elements[0];
    e.overrides = [{ target: 'shape1', props: { hidden: 'yes' } }];
    e.extras = [{ type: 'shape', x: 0, y: 0, width: 50, height: 50, bg: '#000', borderCol: '#000', borderWidth: 0, borderStyle: 'solid' }];
    m.markDirty(); (await import('/editor/editor.js')).renderEditor();
});
const kids = await page.$$eval('#slide-canvas .element-macro >> nth=0', ns => ns[0].querySelectorAll('.group-child').length);
check('hidden:yes removes, extras add', kids === 2, kids);
st = await S();
check('extras serialized after overrides', /\t::shape1 hidden:yes\n\t\.element\.shape x:0 y:0 width:50 height:50/.test(st.gl), st.gl.split('\n').filter(l => l.startsWith('\t')).slice(0, 3).join(' | '));

// 7. Reopen from disk: macros come back from macros.gl
await save();
await page.evaluate(async () => (await import('/ui/project.js')).openProjectByPath('/p/Deck/Deck.gl'));
await page.waitForTimeout(300);
const st2 = await S();
check('reopen loads macros.gl', st2.macros.card && st2.macros.card.source === 'macros.gl');
check('reopen keeps overrides/extras', JSON.stringify(st2.els.map(e => e.overrides)) === JSON.stringify(st.els.map(e => e.overrides)) && st2.els[0].extras.length === 1);
check('project text round-trips', st2.gl === st.gl);
f = await files();

// 8. Missing library -> placeholder, not a crash
await page.evaluate(() => { delete window.__files['/p/Deck/macros.gl']; });
await page.evaluate(async () => (await import('/ui/project.js')).openProjectByPath('/p/Deck/Deck.gl'));
await page.waitForTimeout(300);
check('missing macro shows placeholder', (await page.$$('#slide-canvas .macro-placeholder')).length === 2);
await page.evaluate((txt) => { window.__files['/p/Deck/macros.gl'] = txt; }, f['/p/Deck/macros.gl']);
await page.evaluate(async () => (await import('/ui/project.js')).openProjectByPath('/p/Deck/Deck.gl'));
await page.waitForTimeout(300);

// 9. Detach -> group with the resolved contents
await page.evaluate(async () => { const m = await import('/core/state.js'); m.setSelectedElementIndices([1], 1); (await import('/editor/editor.js')).renderEditor(); });
if (!(await page.$('[data-action="detach-macro"]'))) {
    console.log(out.join('\n'));
    console.log('DEBUG', JSON.stringify(await page.evaluate(async () => { const m = await import('/core/state.js'); return { els: m.state.slides.map(s => s.elements.map(e => e.type + ':' + (e.ref || ''))), sel: m.getSelectedElementIndices(), macros: Object.keys(m.state.macros), panel: document.getElementById('properties-body').textContent.slice(0, 200) }; })));
    console.log(errors.join('\n')); process.exit(1);
}
await page.click('[data-action="detach-macro"]');
st = await S();
const g = st.els[1];
check('detach makes a group', g.type === 'group' && g.frameWidth === 400 && g.width === 800 && g.children.length === 2 && g.children.every(c => Number.isInteger(c.id)));
check('detach keeps overrides baked in', g.children.find(c => c.type === 'text').content === 'Results');

// 10. Undo restores the instance
await page.evaluate(() => document.activeElement && document.activeElement.blur());
await page.keyboard.press('Control+z');
st = await S();
check('undo restores instance', st.els[1].type === 'macro');

// 11. Group -> macro uses the group's frame; project-local define (hybrid)
await page.evaluate(async () => {
    const m = await import('/core/state.js'); const ed = await import('/editor/editor.js');
    const els = m.state.slides[0].elements;
    els.push({ id: m.allocateElementId(), type: 'shape', x: 100, y: 600, width: 100, height: 100, bg: '#f00', borderCol: '#000', borderWidth: 0, borderStyle: 'solid' },
             { id: m.allocateElementId(), type: 'shape', x: 300, y: 600, width: 100, height: 100, bg: '#0f0', borderCol: '#000', borderWidth: 0, borderStyle: 'solid' });
    m.setSelectedElementIndices([2, 3]); ed.groupSelected();
    const grp = els.find(e => e.type === 'group'); grp.width = 600; grp.height = 200; m.setSelectedElementIndices([els.indexOf(grp)]);
    ed.renderEditor();
});
await page.fill('#make-macro-name', 'pair');
await page.click('[data-action="make-macro"]');
await page.waitForTimeout(300);
st = await S();
check('group -> macro keeps frame + size', st.macros.pair && st.macros.pair.width === 300 && st.macros.pair.height === 100 && st.els.find(e => e.ref === 'pair').width === 600);
const local = await page.evaluate(async () => {
    const m = await import('/core/state.js');
    const f = await import('/core/gl/glformat.js');
    const text = m.serializeProject().replace(/(\.project [^\n]*\n)/, '$1\n.define {badge} width:100 height:100\n\t.element.shape name:dot x:0 y:0 width:100 height:100 kind:ellipse bg:#facc15\n');
    const p = m.parseProjectContent(text);
    m.applyProjectData(p, { resetSelection: false });
    return { src: m.state.macros.badge && m.state.macros.badge.source, keepsLib: !!m.state.macros.card, again: m.serializeProject().includes('.define {badge}') };
});
check('project-local .define (hybrid)', local.src === 'project' && local.keepsLib && local.again, JSON.stringify(local));

// 12. Loop detection + export
const loop = await page.evaluate(async () => {
    const mac = await import('/core/macros.js');
    mac.applyLibraryText('macros.gl', '.define {a} width:10 height:10\n\t.macro.b x:0 y:0 width:10 height:10\n.define {b} width:10 height:10\n\t.macro.a x:0 y:0 width:10 height:10\n');
    const { exportElementMarkup } = await import('/core/render.js');
    let markup = '';
    try { markup = exportElementMarkup({ type: 'macro', ref: 'a', x: 0, y: 0, width: 10, height: 10, overrides: [], extras: [] }); } catch (e) { return 'threw: ' + e.message; }
    return markup.length < 2000 ? 'ok' : 'runaway';
});
check('macro loop does not hang', loop === 'ok', loop);
const exp = await page.evaluate(async () => {
    const m = await import('/core/state.js'); const { exportElementMarkup } = await import('/core/render.js');
    const mac = await import('/core/macros.js');
    m.state.macros.card = { name: 'card', width: 400, height: 300, source: 'macros.gl', children: [{ type: 'shape', name: 's', x: 0, y: 0, width: 400, height: 300, bg: '#abc', borderCol: '#000', borderWidth: 1, borderStyle: 'solid' }] };
    return exportElementMarkup({ type: 'macro', ref: 'card', x: 0, y: 0, width: 800, height: 300, overrides: [], extras: [] });
});
check('export scales the definition', exp.includes('transform:scale(2, 1)') && exp.includes('#abc'));

console.log(out.join('\n'));
console.log('--- errors ---\n' + (errors.join('\n') || '(none)'));
await browser.close();
