// Started by double-clicking a .gl file: the backend hands the page that
// path (get_startup_file) and the page opens the project straight away,
// without the start screen in the way. Without one, the start screen stays.
import { launchBrowser, BASE_URL } from '../helpers.mjs';

const browser = await launchBrowser();
const out = [];
const check = (n, c, x = '') => out.push(`${c ? 'PASS' : 'FAIL'} ${n}${x !== '' ? ' — ' + x : ''}`);
const errors = [];

const PROJECT = `.project {Double-clicked} version:2 width:1920 height:1080 nextid:5
.slide {First} id:1
.element.text id:2 x:100 y:100 width:800 height:200
	Opened from the file manager
`;

async function start(startupPath) {
    const page = await browser.newPage({ viewport: { width: 1300, height: 850 } });
    page.on('pageerror', e => errors.push(e.message));
    await page.addInitScript(([startupPath, project]) => {
        window.__loaded = [];
        const ok = (o = {}) => Promise.resolve({ success: true, ...o });
        window.pywebview = { api: {
            get_startup_file: () => ok({ path: startupPath }),
            load_project_at: (p) => { window.__loaded.push(p); return ok({ content: project }); },
            get_recent_projects: () => ok({ projects: [] }), add_recent_project: () => ok(),
            get_inspector_settings: () => ok({ settings: null }), save_inspector_settings: () => ok(),
            list_project_fonts: () => ok({ fonts: [] }), list_system_fonts: () => ok({ families: [] }),
            load_text_file: () => Promise.resolve({ success: false }), save_text_file: () => ok(),
            save_project_data: () => ok(), load_figure_data_uri: () => ok({ data_uri: '' }),
            read_clipboard: () => ok(), take_dropped_paths: () => ok({ paths: [] }),
        } };
        window.dispatchEvent(new Event('pywebviewready'));
    }, [startupPath, PROJECT]);
    await page.goto(`${BASE_URL}/index.html`);
    await page.waitForTimeout(800);
    return page;
}

let page = await start('/home/me/talks/Double-clicked.gl');
check('the double-clicked project is loaded', JSON.stringify(await page.evaluate(() => window.__loaded)) === '["/home/me/talks/Double-clicked.gl"]');
check('…and opened in the editor', await page.isVisible('#editor-view.active') && (await page.textContent('#slide-canvas')).includes('Opened from the file manager'));
await page.close();

page = await start(null);
check('no file given: the start screen stays', !(await page.isVisible('#editor-view.active')) && JSON.stringify(await page.evaluate(() => window.__loaded)) === '[]');
await page.close();

console.log(out.join('\n'));
console.log('--- errors ---\n' + (errors.join('\n') || '(none)'));
await browser.close();
