import { launchBrowser, BASE_URL, OUT_DIR, FIXTURES_DIR, REPO_DIR } from '../helpers.mjs';
const browser = await launchBrowser();
const page = await browser.newPage({ viewport: { width: 1500, height: 950 } });
const errors = [];
page.on('pageerror', e => errors.push(e.message));
await page.addInitScript(() => {
    window.__saves = [];
    const ok = (o = {}) => Promise.resolve({ success: true, ...o });
    window.pywebview = { api: {
        get_recent_projects: () => ok({ projects: [] }), add_recent_project: () => ok(),
        get_inspector_settings: () => ok({ settings: null }), save_inspector_settings: () => ok(),
        save_project_data: () => { window.__saves.push(Date.now()); return ok(); },
        load_text_file: () => Promise.resolve({ success: false }), save_text_file: () => ok(),
        create_project: (n) => ok({ path: `/p/${n}.gl`, folder: '/p' }),
    } };
});
await page.goto(`${BASE_URL}/index.html`);
await page.waitForTimeout(400);
await page.evaluate(async () => {
    await (await import('/ui/project.js')).createProject('M');
    const { state, allocateElementId } = await import('/core/state.js');
    const mk = (x, y) => ({ id: allocateElementId(), type: 'shape', x, y, width: 200, height: 100, bg: '#38f', borderCol: '#000', borderWidth: 0, borderStyle: 'solid' });
    state.slides[0].elements.push(mk(100, 100), mk(400, 120), mk(1400, 700));
    (await import('/editor/editor.js')).renderEditor();
});
const toClient = (x, y) => page.evaluate(([x, y]) => {
    const r = document.getElementById('slide-canvas').getBoundingClientRect();
    const s = r.width / 1920; return [r.left + x * s, r.top + y * s];
}, [x, y]);
const sel = () => page.evaluate(async () => (await import('/core/state.js')).getSelectedElementIndices());
const drag = async (a, b, mods = []) => {
    const [x1, y1] = await toClient(...a); const [x2, y2] = await toClient(...b);
    for (const m of mods) await page.keyboard.down(m);
    await page.mouse.move(x1, y1); await page.mouse.down();
    await page.mouse.move((x1 + x2) / 2, (y1 + y2) / 2, { steps: 4 });
    await page.mouse.move(x2, y2, { steps: 4 }); await page.mouse.up();
    for (const m of mods) await page.keyboard.up(m);
    await page.waitForTimeout(100);
};
const out = [];
const check = (n, c, x = '') => out.push(`${c ? 'PASS' : 'FAIL'} ${n}${x !== '' ? ' — ' + x : ''}`);
const selIs = async (name, expected) => { const got = JSON.stringify(await sel()); check(name, got === expected, got); };
await drag([50, 50], [450, 150]);
await selIs('drag selects every element the box touches', '[0,1]');
await drag([1300, 650], [1450, 750], ['Control']);
await selIs('Ctrl+drag adds to the selection', '[0,1,2]');
await drag([1000, 900], [1100, 1000]);
await selIs('dragging over empty space clears it', '[]');
const ws = await page.evaluate(() => { const r = document.getElementById('slide-canvas').getBoundingClientRect(); return [r.left + 20, r.top - 20]; });
const [tx, ty] = await toClient(150, 150);
await page.mouse.move(...ws); await page.mouse.down(); await page.mouse.move(tx, ty, { steps: 6 }); await page.mouse.up();
await page.waitForTimeout(100);
await selIs('a drag may start outside the slide', '[0]');
const [ex, ey] = await toClient(150, 150);
await page.mouse.move(ex, ey); await page.mouse.down(); await page.mouse.move(ex + 40, ey + 20, { steps: 4 }); await page.mouse.up();
const moved = await page.evaluate(async () => (await import('/core/state.js')).state.slides[0].elements[0].x);
check('dragging an element still moves it', moved !== 100, moved);
const [cx, cy] = await toClient(900, 500);
await page.mouse.click(cx, cy);
await selIs('a plain click clears the selection', '[]');
const before = await page.evaluate(() => window.__saves.length);
await page.evaluate(async () => { const { state, markDirty } = await import('/core/state.js'); state.slides[0].title = 'x'; markDirty(); });
await page.waitForTimeout(1200);
check('autosave runs within ~1s of a change', (await page.evaluate(() => window.__saves.length)) > before);
check('no selection box left behind', (await page.$$eval('.marquee-rect', n => n.length)) === 0);
console.log(out.join('\n')); console.log('--- errors ---\n' + (errors.join('\n') || '(none)'));
await browser.close();
