// Figures: pasting an image (Ctrl+V) saves it into figures/ and adds it
// centred and in proportion; objects copied in the app still paste as
// objects; linked figures (sync:yes) are redrawn when the original file
// changes; the ↻ button; figures on master slides load with the project.
import { launchBrowser, BASE_URL } from '../helpers.mjs';

const browser = await launchBrowser();
const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
const errors = [];
page.on('pageerror', e => errors.push(e.message));
const out = [];
const check = (n, c, x = '') => out.push(`${c ? 'PASS' : 'FAIL'} ${n}${x !== '' ? ' — ' + x : ''}`);
const app = (fn, arg) => page.evaluate(fn, arg);

// A fake backend: files in memory; "original" plots can change.
await page.addInitScript(() => {
    const red = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAIAAAABCAYAAAD0In+KAAAAEUlEQVR42mP8z8DwnwEJMAIAKjYD/0QNRfwAAAAASUVORK5CYII=';
    window.__saved = {};
    window.__originals = { '/home/me/analysis/plot.png': { version: 1 } };
    window.__copies = { 'figures/plot.png': 1 };
    const ok = (o = {}) => Promise.resolve({ success: true, ...o });
    window.pywebview = { api: {
        save_figure_data: (folder, uri, name) => {
            const rel = `figures/${name}.png`;
            window.__saved[rel] = uri;
            return ok({ relative_path: rel, data_uri: uri });
        },
        refresh_linked_figures: (folder, items) => {
            const updated = items.filter(i => window.__originals[i.originalPath]
                && window.__originals[i.originalPath].version !== window.__copies[i.filePath])
                .map(i => {
                    window.__copies[i.filePath] = window.__originals[i.originalPath].version;
                    return { filePath: i.filePath, data_uri: `${red}#v${window.__copies[i.filePath]}` };
                });
            window.__refreshCalls = (window.__refreshCalls || 0) + 1;
            return ok({ updated });
        },
        load_figure_data_uri: (folder, key) => ok({ data_uri: `${red}#loaded-${key}` }),
        get_recent_projects: () => ok({ projects: [] }),
        get_inspector_settings: () => ok({ settings: null }),
        save_inspector_settings: () => ok(),
        list_project_fonts: () => ok({ fonts: [] }),
        list_system_fonts: () => ok({ families: [] }),
        save_project_data: () => ok(),
        save_text_file: () => ok(),
        load_text_file: () => Promise.resolve({ success: false }),
    } };
});
await page.goto(`${BASE_URL}/index.html`);
await app(async () => {
    await (await import('/ui/project.js')).openSampleProject();
    const { state } = await import('/core/state.js');
    state.projectFolder = '/home/me/talk';
    state.slides = [{ id: 1, title: 'One', elements: [] }];
    state.nextId = 10;
    (await import('/editor/editor.js')).selectSlide(0);
});

/** Fires a paste event carrying a 400×200 PNG, as Ctrl+V of a screenshot would. */
const pasteImage = () => app(async () => {
    const c = document.createElement('canvas');
    c.width = 400; c.height = 200;
    c.getContext('2d').fillRect(0, 0, 400, 200);
    const blob = await new Promise(r => c.toBlob(r, 'image/png'));
    const dt = new DataTransfer();
    dt.items.add(new File([blob], 'image.png', { type: 'image/png' }));
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'v', ctrlKey: true, bubbles: true }));
    document.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }));
});

// ---------- Pasting an image ----------
await page.mouse.click(700, 700); // focus the canvas area
await pasteImage();
await page.waitForTimeout(300);
let els = await app(async () => (await import('/core/state.js')).state.slides[0].elements);
const fig = els[0];
check('Ctrl+V with an image adds a figure', els.length === 1 && fig.type === 'figure', JSON.stringify(els));
check('the image is saved into figures/', /^figures\/pasted-\d{14}\.png$/.test(fig.filePath) && Boolean(await app((p) => window.__saved[p], fig.filePath)), fig.filePath);
check('in proportion, centred', fig.width / fig.height === 2 && Math.abs(fig.x + fig.width / 2 - 960) <= 1 && Math.abs(fig.y + fig.height / 2 - 540) <= 1, JSON.stringify(fig));
check('the pasted figure shows the image and is selected', Boolean(await page.$(`#slide-canvas [data-element-id="${fig.id}"] img`))
    && await page.$eval(`#slide-canvas [data-element-id="${fig.id}"]`, n => n.classList.contains('selected')));

// Objects copied in the app still paste as objects (no image in the event)
await page.click(`#slide-canvas [data-element-id="${fig.id}"]`);
await page.keyboard.press('Control+c');
await page.keyboard.press('Control+v');
await page.waitForTimeout(200);
els = await app(async () => (await import('/core/state.js')).state.slides[0].elements);
check('Ctrl+C / Ctrl+V of objects still works', els.length === 2 && els[1].filePath === fig.filePath && els[1].id !== fig.id);

// ---------- Linked figures ----------
await app(async () => {
    const { state } = await import('/core/state.js');
    state.slides[0].elements.push({ type: 'figure', id: 30, x: 100, y: 100, width: 400, height: 300, filePath: 'figures/plot.png', originalPath: '/home/me/analysis/plot.png', sync: 'yes' });
    state.masters = [{ id: 40, name: 'Default', elements: [{ type: 'figure', id: 41, x: 1700, y: 20, width: 200, height: 100, filePath: 'figures/logo.png', originalPath: '' }] }];
    (await import('/editor/editor.js')).selectSlide(0);
});
const src30 = () => page.$eval('#slide-canvas [data-element-id="30"] img', n => n.getAttribute('src')).catch(() => null);
await app(() => { window.__originals['/home/me/analysis/plot.png'].version = 2; }); // the script wrote a new plot
await app(async () => (await import('/elements/figure/figure.js')).syncLinkedFigures());
await page.waitForTimeout(150);
check('a linked figure is redrawn when its original changes', (await src30() || '').endsWith('#v2'), await src30());
const calls = await app(() => window.__refreshCalls);
await app(async () => (await import('/elements/figure/figure.js')).syncLinkedFigures());
check('…and only re-copied once', (await src30() || '').endsWith('#v2') && await app(() => window.__refreshCalls) === calls + 1);
await page.waitForTimeout(3500); // the periodic check
await app(() => { window.__originals['/home/me/analysis/plot.png'].version = 3; });
await page.waitForTimeout(3500);
check('checked every few seconds without doing anything', (await src30() || '').endsWith('#v3'), await src30());

// The figure panel: option and ↻
await page.click('#slide-canvas [data-element-id="30"]');
check('figure panel: "Update when the original file changes", on', await page.isChecked('[data-prop="sync"]'));
await page.uncheck('[data-prop="sync"]');
await app(() => { window.__originals['/home/me/analysis/plot.png'].version = 4; });
await app(async () => (await import('/elements/figure/figure.js')).syncLinkedFigures());
await page.waitForTimeout(100);
check('unchecked: not updated automatically', (await src30() || '').endsWith('#v3'));
const saved = await app(async () => (await import('/core/state.js')).serializeProject());
check('.gl: sync:no written when unchecked', /\.element\.figure id:30 [^\n]*sync:no/.test(saved));
await page.click('#slide-canvas [data-element-id="30"]');
await page.click('[data-element-action="refresh"]');
await page.waitForTimeout(150);
check('↻ reloads from the original anyway', (await src30() || '').endsWith('#v4'), await src30());

// Figures on masters are loaded with the project
const masterLoaded = await app(async () => {
    const fig = await import('/elements/figure/figure.js');
    fig.clearFigureCache();
    const { state } = await import('/core/state.js');
    await fig.hydrateFigures([...state.slides, ...state.masters], state.projectFolder);
    return fig.figureSrc(state.masters[0].elements[0]);
});
check('figures on master slides are loaded', masterLoaded.includes('#loaded-figures/logo.png'), masterLoaded);
const projectJs = await (await fetch(`${BASE_URL}/ui/project.js`)).text();
check('opening a project loads master figures too', projectJs.includes('...(state.masters || [])'));

console.log(out.join('\n'));
console.log('--- errors ---\n' + (errors.join('\n') || '(none)'));
await browser.close();
