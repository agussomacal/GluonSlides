import { launchBrowser, BASE_URL, OUT_DIR, FIXTURES_DIR, REPO_DIR } from '../helpers.mjs';
const browser = await launchBrowser();
const page = await browser.newPage({ viewport: { width: 1500, height: 950 } });
const errors = [];
page.on('pageerror', e => errors.push('pageerror: ' + e.message));
page.on('console', m => { if (m.type() === 'error' && !m.text().includes('404')) errors.push('console: ' + m.text()); });
page.on('dialog', d => { errors.push('dialog: ' + d.message()); d.dismiss(); });
await page.addInitScript(() => {
    window.__calls = [];
    const ok = (o = {}) => Promise.resolve({ success: true, ...o });
    window.pywebview = { api: {
        get_recent_projects: () => ok({ projects: [] }), add_recent_project: () => ok(),
        get_inspector_settings: () => ok({ settings: null }), save_inspector_settings: () => ok(),
        save_project_data: () => ok(), load_text_file: () => Promise.resolve({ success: false }), save_text_file: () => ok(),
        create_project: (n) => ok({ path: `/p/${n}/${n}.gl`, folder: `/p/${n}` }),
        select_figure_file: () => { window.__calls.push(['select']); return ok({ path: '/home/me/pic "a" & b.png' }); },
        import_figure: (folder, p) => { window.__calls.push(['import', p]); return ok({ data_uri: 'data:image/png;base64,AAAA', relative_path: 'figures/pic.png' }); },
        open_file_with_system: (p) => { window.__calls.push(['open', p]); return ok(); },
    } };
});
const out = [];
const check = (n, c, x = '') => out.push(`${c ? 'PASS' : 'FAIL'} ${n}${x !== '' ? ' — ' + x : ''}`);
await page.goto(`${BASE_URL}/index.html`);
await page.waitForTimeout(400);
await page.evaluate(async () => (await import('/ui/project.js')).createProject('P'));
const el = (i) => page.evaluate(async (i) => JSON.parse(JSON.stringify((await import('/core/state.js')).activeElements()[i])), i);
const panelHasInline = () => page.evaluate(() => /on(click|input|change)=/.test(document.getElementById('properties-body').innerHTML));

// Text element: number, color, selects
await page.click('[data-type="text"]');
await page.fill('[data-prop="fontSize"]', '55');
check('number input (fontSize) live', (await el(0)).fontSize === 55);
await page.fill('[data-prop="x"]', '321');
check('position input (x)', (await el(0)).x === 321);
await page.evaluate(() => { const c = document.querySelector('[data-prop="fontColor"]'); c.value = '#ff0000'; c.dispatchEvent(new Event('change', { bubbles: true })); });
check('color input (fontColor)', (await el(0)).fontColor === '#ff0000');
await page.selectOption('[data-prop="textAlign"]', 'left');
check('select (textAlign) on change', (await el(0)).textAlign === 'left');
await page.selectOption('[data-prop="borderStyle"]', 'dashed');
check('select (borderStyle)', (await el(0)).borderStyle === 'dashed');
check('canvas re-rendered with new font size', (await page.$eval('.canvas-element.selected', n => n.style.fontSize)) === '55px');
check('no inline handlers in text panel', !(await panelHasInline()));

// Multi-select panel: bg for all
await page.click('[data-category="shapes"] > .toolbar-btn'); await page.click('[data-category="shapes"] .toolbar-menu button:has-text("Rectangle")');
await page.evaluate(async () => { const m = await import('/core/state.js'); m.setSelectedElementIndices([0, 1]); (await import('/editor/editor.js')).renderEditor(); });
await page.evaluate(() => { const c = document.querySelector('[data-prop="bg"]'); c.value = '#00ff00'; c.dispatchEvent(new Event('change', { bubbles: true })); });
check('multi-select bg applies to all', (await el(0)).bg === '#00ff00' && (await el(1)).bg === '#00ff00');

// Figure: element actions
await page.click('[data-type="figure"]');
await page.click('[data-element-action="browse"]');
await page.waitForTimeout(200);
const fig = await el(2);
check('figure browse action', fig.filePath === 'figures/pic.png' && fig.originalPath === '/home/me/pic "a" & b.png', JSON.stringify([fig.filePath, fig.originalPath]));
check('no inline handlers in figure panel', !(await panelHasInline()));
const btns = await page.$$('[data-element-action="openPath"]');
await btns[0].click();
await page.waitForTimeout(100);
const calls = await page.evaluate(() => window.__calls);
const openCall = calls.find(c => c[0] === 'open');
check('openPath action gets the exact path (quotes/& intact)', openCall && openCall[1] === '/home/me', JSON.stringify(openCall));

// Group buttons (main.js data-action) still work alongside
await page.evaluate(async () => { const m = await import('/core/state.js'); m.setSelectedElementIndices([0, 1]); (await import('/editor/editor.js')).renderEditor(); });
await page.click('[data-action="group-selection"]');
check('group button', (await el(0)).type === 'group' || (await el(1)).type === 'group');

check('globals removed', await page.evaluate(() => !('updateProp' in window) && !('SlideStudioFigure' in window) && !('ElementRegistry' in window)));
console.log(out.join('\n'));
console.log('--- errors ---\n' + (errors.join('\n') || '(none)'));
await browser.close();
