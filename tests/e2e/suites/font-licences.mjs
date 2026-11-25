import { launchBrowser, BASE_URL, OUT_DIR, FIXTURES_DIR, REPO_DIR } from '../helpers.mjs';
const OUT = OUT_DIR;
const browser = await launchBrowser();
const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
const errors = [];
const dialogs = [];
page.on('pageerror', e => errors.push('pageerror: ' + e.message));
page.on('dialog', d => { dialogs.push(d.message()); d.dismiss(); });
await page.addInitScript(() => {
    window.__calls = [];
    const ok = (o = {}) => Promise.resolve({ success: true, ...o });
    const LIC = {
        'DejaVu Sans': { name: 'Bitstream Vera license, public domain changes', url: 'http://dejavu.sourceforge.net/wiki/index.php/License', open: true, embeddable: true },
        'Fancy Pro': { name: 'Copyright Foundry Inc. All rights reserved', url: 'https://foundry.example/eula', open: false, embeddable: true },
        'Locked Sans': { name: 'Commercial EULA', url: 'https://locked.example/licence', open: false, embeddable: false },
    };
    window.pywebview = { api: {
        get_recent_projects: () => ok({ projects: [] }), add_recent_project: () => ok(),
        get_inspector_settings: () => ok({ settings: null }), save_inspector_settings: () => ok(),
        create_project: (n) => ok({ path: `/p/${n}/${n}.gl`, folder: `/p/${n}` }),
        save_project_data: () => ok(), load_text_file: () => Promise.resolve({ success: false }),
        save_text_file: (d, n) => ok({ path: `${d}/${n}` }),
        open_file_with_system: () => ok(),
        list_project_fonts: () => ok({ fonts: [] }),
        list_system_fonts: () => ok({ families: Object.keys(LIC) }),
        system_font_license: (family) => { window.__calls.push('license:' + family); return ok({ license: LIC[family] }); },
        system_font_faces: (family) => { window.__calls.push('faces:' + family); return ok({ fonts: [{ family, weight: 400, style: 'normal', data_uri: 'data:font/ttf;base64,AAAA', license: LIC[family] }] }); },
        open_url: (url) => { window.__calls.push('open:' + url); return ok(); },
    } };
});
const out = [];
const check = (n, c, x = '') => out.push(`${c ? 'PASS' : 'FAIL'} ${n}${x !== '' ? ' — ' + x : ''}`);
await page.goto(`${BASE_URL}/index.html`);
await page.waitForTimeout(500);
await page.evaluate(async () => {
    await (await import('/ui/project.js')).createProject('L');
    const m = await import('/core/state.js');
    m.state.slides[0].elements.push({ id: m.allocateElementId(), type: 'text', x: 200, y: 200, width: 900, height: 200, content: 'Hello', fontSize: 48, fontFamily: 'sans-serif', fontColor: '#000', textAlign: 'center', verticalAlign: 'center', bg: 'transparent', borderCol: 'transparent', borderWidth: 0, borderStyle: 'solid' });
    m.setSelectedElementIndices([0], 0);
    (await import('/editor/editor.js')).renderEditor();
});
const pick = async (family) => {
    await page.click('[data-prop="fontFamily"]');
    await page.click(`.select-menu-item[data-value="${family}"]`);
    await page.waitForTimeout(150);
};
const notice = () => page.$eval('.font-license', n => ({ cls: n.className, text: n.textContent.trim() }));

check('no notice for the default fonts', (await notice()).text === '');
await pick('EB Garamond');
let n = await notice();
check('built-in: quiet open-licence line', n.cls === 'font-license font-license-ok' && n.text.startsWith('Licence: Open licence'), JSON.stringify(n));

await pick('DejaVu Sans');
n = await notice();
check('system font with open licence: quiet line', n.cls.endsWith('-ok') && n.text.includes('Bitstream'), JSON.stringify(n));

await pick('Fancy Pro');
n = await notice();
check('system font without open licence: warning', n.cls.endsWith('-warn') && n.text.includes('Not an open licence'), JSON.stringify(n));
await page.screenshot({ path: `${OUT}/fontlicense.png`, clip: { x: 1100, y: 280, width: 300, height: 250 } });
await page.click('[data-element-action="openFontLicense"]');
await page.waitForTimeout(100);
check('View licence opens the URL', (await page.evaluate(() => window.__calls)).includes('open:https://foundry.example/eula'));

// Export: warning about the non-open font, still embedded
await page.evaluate(async () => (await import('/export/index.js')).projectExportHtml());
await page.waitForTimeout(200);
check('export warns about non-open font', dialogs.length === 1 && dialogs[0].includes('Embedded without a recognised open licence') && dialogs[0].includes('Fancy Pro'), JSON.stringify(dialogs));
check('non-open but embeddable font is embedded', (await page.evaluate(() => window.__calls)).includes('faces:Fancy Pro'));

// Restricted font: red notice, not embedded, export says so
await pick('Locked Sans');
n = await notice();
check('restricted font: blocked notice', n.cls.endsWith('-blocked') && n.text.includes('forbids embedding'), JSON.stringify(n));
const html = await page.evaluate(async () => (await import('/export/html.js')).getExportHtmlString());
check('restricted font not embedded', !html.includes('font-family: "Locked Sans"') && !(await page.evaluate(() => window.__calls)).includes('faces:Locked Sans'));
dialogs.length = 0;
await page.evaluate(async () => (await import('/export/index.js')).projectExportHtml());
await page.waitForTimeout(200);
check('export reports the left-out font', dialogs.length === 1 && dialogs[0].includes('Not embedded') && dialogs[0].includes('Locked Sans'), JSON.stringify(dialogs));

// Only built-in fonts: no warning
await pick('Inter');
dialogs.length = 0;
await page.evaluate(async () => (await import('/export/index.js')).projectExportHtml());
await page.waitForTimeout(200);
check('no warning with open fonts only', dialogs.length === 0, JSON.stringify(dialogs));

console.log(out.join('\n'));
console.log('--- errors ---\n' + (errors.join('\n') || '(none)'));
await browser.close();
