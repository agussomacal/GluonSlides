import { launchBrowser, BASE_URL, OUT_DIR, FIXTURES_DIR, REPO_DIR } from '../helpers.mjs';
const OUT = OUT_DIR;
const browser = await launchBrowser();
const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
const errors = [];
page.on('pageerror', e => errors.push('pageerror: ' + e.message));
page.on('console', m => { if (m.type() === 'error' && !m.text().includes('404')) errors.push('console: ' + m.text()); });
await page.addInitScript(() => {
    window.__calls = [];
    const ok = (o = {}) => Promise.resolve({ success: true, ...o });
    let projectFonts = [];
    window.pywebview = { api: {
        get_recent_projects: () => ok({ projects: [] }), add_recent_project: () => ok(),
        get_inspector_settings: () => ok({ settings: null }), save_inspector_settings: () => ok(),
        create_project: (n) => ok({ path: `/p/${n}/${n}.gl`, folder: `/p/${n}` }),
        save_project_data: () => ok(), save_text_file: () => ok(), load_text_file: () => Promise.resolve({ success: false }),
        list_project_fonts: () => ok({ fonts: projectFonts }),
        import_font_files: () => {
            window.__calls.push('import');
            projectFonts = [{ family: 'My Brand', weight: 400, style: 'normal', file: 'MyBrand.woff2', data_uri: 'libs/fonts/lato-latin-400-normal.woff2' }];
            return ok({ fonts: projectFonts });
        },
        list_system_fonts: () => ok({ families: ['DejaVu Sans', 'Liberation Serif', 'Noto Sans'] }),
        system_font_faces: (family) => { window.__calls.push('faces:' + family); return ok({ fonts: [{ family, weight: 400, style: 'normal', data_uri: 'data:font/ttf;base64,AAAA' }] }); },
    } };
});
const out = [];
const check = (n, c, x = '') => out.push(`${c ? 'PASS' : 'FAIL'} ${n}${x !== '' ? ' — ' + x : ''}`);
await page.goto(`${BASE_URL}/index.html`);
await page.waitForTimeout(500);
await page.evaluate(async () => {
    await (await import('/ui/project.js')).createProject('F');
    const m = await import('/core/state.js');
    m.state.slides[0].elements.push({ id: m.allocateElementId(), type: 'text', x: 200, y: 200, width: 900, height: 200, content: 'Hello **world** $x^2$', fontSize: 48, fontFamily: 'sans-serif', fontColor: '#000', textAlign: 'center', verticalAlign: 'center', bg: 'transparent', borderCol: 'transparent', borderWidth: 0, borderStyle: 'solid' });
    m.setSelectedElementIndices([0], 0);
    (await import('/editor/editor.js')).renderEditor();
});
const el0 = () => page.evaluate(async () => JSON.parse(JSON.stringify((await import('/core/state.js')).state.slides[0].elements[0])));

// 1. Font list: sections, previews, search
await page.click('[data-prop="fontFamily"]');
await page.waitForTimeout(100);
const groups = await page.$$eval('.select-menu-group', ns => ns.map(n => n.textContent));
check('sections: Default, Built-in, This computer', groups.join(',') === 'Default,Built-in,This computer', groups.join(','));
const garamondPreview = await page.$eval('.select-menu-item[data-value="EB Garamond"]', n => n.style.fontFamily);
check('each name previewed in its font', garamondPreview.includes('EB Garamond'), garamondPreview);
check('search box shown for the long list', await page.$('.select-menu-search') !== null);
await page.screenshot({ path: `${OUT}/fontmenu.png`, clip: { x: 1000, y: 0, width: 400, height: 900 } });
await page.keyboard.type('gara');
const visible = await page.$$eval('.select-menu-item', ns => ns.filter(n => !n.hidden).map(n => n.textContent));
check('search filters', JSON.stringify(visible) === '["EB Garamond"]', JSON.stringify(visible));
await page.keyboard.press('Enter');
await page.waitForTimeout(300);
check('Enter picks the match', (await el0()).fontFamily === 'EB Garamond');
const applied = await page.evaluate(async () => {
    await document.fonts.ready;
    const p = document.querySelector('#slide-canvas .element-text p');
    return { css: getComputedStyle(p).fontFamily, loaded: document.fonts.check('48px "EB Garamond"') };
});
check('canvas text uses EB Garamond', applied.css.includes('EB Garamond') && applied.loaded, JSON.stringify(applied));

// 2. .gl keeps the quoted name
const gl = await page.evaluate(async () => (await import('/core/state.js')).serializeProject());
check('.gl stores fontFamily:"EB Garamond"', gl.includes('fontFamily:"EB Garamond"'));

// 3. Export embeds only the used fonts
let html = await page.evaluate(async () => (await import('/export/html.js')).getExportHtmlString());
check('export embeds EB Garamond (data URIs)', /@font-face \{ font-family: "EB Garamond"; src: url\("data:font\/woff2;base64,/.test(html));
check('export does not embed unused fonts', !html.includes('font-family: "Inter"') && !html.includes('font-family: "Roboto"'));
check('exported text uses the stack', html.includes("font-family:'EB Garamond', serif"));

// 4. Font from this computer: embedded via the Python side on export
await page.click('[data-prop="fontFamily"]');
await page.keyboard.type('dejavu');
await page.keyboard.press('Enter');
await page.waitForTimeout(150);
check('system font chosen', (await el0()).fontFamily === 'DejaVu Sans');
html = await page.evaluate(async () => (await import('/export/html.js')).getExportHtmlString());
check('system font embedded in export', html.includes('font-family: "DejaVu Sans"; src: url("data:font/ttf;base64,AAAA")') && (await page.evaluate(() => window.__calls)).includes('faces:DejaVu Sans'));

// 5. Add font files -> Project fonts section
await page.click('[data-element-action="addFonts"]');
await page.waitForTimeout(300);
await page.click('[data-prop="fontFamily"]');
const groups2 = await page.$$eval('.select-menu-group', ns => ns.map(n => n.textContent));
check('Project fonts section after adding', groups2.join(',') === 'Default,Built-in,Project fonts,This computer', groups2.join(','));
await page.click('.select-menu-item[data-value="My Brand"]');
await page.waitForTimeout(200);
const brand = await page.evaluate(async () => {
    await document.fonts.ready;
    return { el: (await import('/core/state.js')).state.slides[0].elements[0].fontFamily, loaded: document.fonts.check('48px "My Brand"') };
});
check('project font applied and loaded', brand.el === 'My Brand' && brand.loaded, JSON.stringify(brand));
html = await page.evaluate(async () => (await import('/export/html.js')).getExportHtmlString());
check('project font embedded in export', html.includes('font-family: "My Brand"'));

// 6. Unknown font in a hand-edited file still shows as current
await page.evaluate(async () => {
    const m = await import('/core/state.js'); m.state.slides[0].elements[0].fontFamily = 'Comic Neue';
    (await import('/editor/editor.js')).renderEditor();
});
check('unknown current font listed', (await page.$eval('[data-prop="fontFamily"]', s => s.value)) === 'Comic Neue');

console.log(out.join('\n'));
console.log('--- errors ---\n' + (errors.join('\n') || '(none)'));
await browser.close();
