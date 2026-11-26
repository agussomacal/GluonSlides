// Pasting and dropping images in the app (fake backend):
//   Ctrl+V asks the backend for the clipboard (WebKitGTK sends no paste
//   event without a text field): a screenshot, copied image files, or
//   nothing (then the app's own copied objects are pasted); Ctrl+C in the
//   app replaces the system clipboard.
//   Files dropped on the window never open in place of the app; images
//   become linked figures where they are dropped, or replace the figure
//   they are dropped on.
import { launchBrowser, BASE_URL } from '../helpers.mjs';

const browser = await launchBrowser();
const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
const errors = [];
page.on('pageerror', e => errors.push(e.message));
const out = [];
const check = (n, c, x = '') => out.push(`${c ? 'PASS' : 'FAIL'} ${n}${x !== '' ? ' — ' + x : ''}`);
const app = (fn, arg) => page.evaluate(fn, arg);

await page.addInitScript(() => {
    // 2×1 red PNG
    const red = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAIAAAABCAYAAAD0In+KAAAAEUlEQVR42mP8z8DwnwEJMAIAKjYD/0QNRfwAAAAASUVORK5CYII=';
    window.__red = red;
    window.__clipboard = {};          // what read_clipboard_image returns
    window.__clipboardText = [];
    window.__dropPaths = [];
    const ok = (o = {}) => Promise.resolve({ success: true, ...o });
    window.pywebview = { api: {
        read_clipboard_image: () => ok(window.__clipboard),
        set_clipboard_text: (t) => { window.__clipboardText.push(t); window.__clipboard = {}; return ok(); },
        take_dropped_paths: () => { const p = window.__dropPaths; window.__dropPaths = []; return ok({ paths: p }); },
        save_figure_data: (folder, uri, name) => ok({ relative_path: `figures/${name.replace(/\.\w+$/, '')}.png`, data_uri: uri }),
        import_figure: (folder, path) => {
            const base = path.split('/').pop();
            return ok({ relative_path: `figures/${base}`, path: `${folder}/figures/${base}`, data_uri: red });
        },
        refresh_linked_figures: () => ok({ updated: [] }),
        load_figure_data_uri: () => ok({ data_uri: red }),
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
    state.masters = [];
    state.nextId = 10;
    (await import('/editor/editor.js')).selectSlide(0);
});
const elements = () => app(async () => (await import('/core/state.js')).state.slides[0].elements);

// ---------- Ctrl+V through the backend ----------
await app(() => { window.__clipboard = { data_uri: window.__red }; });
await page.mouse.click(700, 860);
await page.keyboard.press('Control+v');
await page.waitForTimeout(300);
let els = await elements();
check('Ctrl+V: a screenshot on the clipboard becomes a figure', els.length === 1 && els[0].type === 'figure' && /^figures\/pasted-\d{14}\.png$/.test(els[0].filePath), JSON.stringify(els));
check('…centred, in proportion', els[0] && els[0].width === 2 * els[0].height, JSON.stringify(els[0]));

// Copy it in the app: the system clipboard is replaced, so Ctrl+V pastes the object.
await page.keyboard.press('Control+c');
await page.waitForTimeout(100);
check('Ctrl+C in the app replaces the system clipboard', (await app(() => window.__clipboardText)).length === 1);
await page.keyboard.press('Control+v');
await page.waitForTimeout(300);
els = await elements();
check('…and Ctrl+V then pastes the copied object', els.length === 2 && els[1].filePath === els[0].filePath && els[1].x === els[0].x + 40, JSON.stringify(els.map(e => [e.filePath, e.x])));

// Image files copied in a file manager: linked figures
await app(() => { window.__clipboard = { paths: ['/home/me/analysis/plot.png'] }; });
await page.keyboard.press('Control+v');
await page.waitForTimeout(300);
els = await elements();
const linked = els[2];
check('Ctrl+V of a copied image file: a linked figure', linked && linked.filePath === 'figures/plot.png' && linked.originalPath === '/home/me/analysis/plot.png' && linked.sync === 'yes', JSON.stringify(linked));

// Typing in a text field: Ctrl+V is the field's, not the slide's
await app(() => { window.__clipboard = { data_uri: window.__red }; });
await page.click('#slide-title-input').catch(() => {});
const focusedField = await app(() => document.activeElement && document.activeElement.tagName);
await page.keyboard.press('Control+v');
await page.waitForTimeout(300);
check('Ctrl+V in a text field doesn\'t add a figure', (await elements()).length === 3, focusedField);
await page.mouse.click(700, 860);

// ---------- Dropping files ----------
/** Drops files on (x, y) client point, as dragging from a file manager would. */
const drop = (x, y, names, paths = []) => app(async ([x, y, names, paths]) => {
    window.__dropPaths = paths;
    const dt = new DataTransfer();
    for (const n of names) {
        const blob = await (await fetch(window.__red)).blob();
        dt.items.add(new File([blob], n, { type: n.endsWith('.png') ? 'image/png' : 'text/plain' }));
    }
    const target = document.elementFromPoint(x, y);
    const over = new DragEvent('dragover', { dataTransfer: dt, bubbles: true, cancelable: true, clientX: x, clientY: y });
    target.dispatchEvent(over);
    const ev = new DragEvent('drop', { dataTransfer: dt, bubbles: true, cancelable: true, clientX: x, clientY: y });
    target.dispatchEvent(ev);
    return { overPrevented: over.defaultPrevented, dropPrevented: ev.defaultPrevented };
}, [x, y, names, paths]);
const toClient = (x, y) => app(([x, y]) => {
    const r = document.getElementById('slide-canvas').getBoundingClientRect();
    const s = r.width / 1920; return [r.left + x * s, r.top + y * s];
}, [x, y]);

await app(async () => {
    const { state } = await import('/core/state.js');
    state.slides[0].elements = [];
    (await import('/editor/editor.js')).renderEditor();
});
let [cx, cy] = await toClient(500, 400);
let res = await drop(cx, cy, ['result.png'], ['/home/me/analysis/result.png']);
await page.waitForTimeout(300);
els = await elements();
check('the browser never opens a dropped file (default prevented)', res.overPrevented && res.dropPrevented, JSON.stringify(res));
check('a dropped image becomes a figure centred where it was dropped', els.length === 1 && Math.abs(els[0].x + els[0].width / 2 - 500) <= 1 && Math.abs(els[0].y + els[0].height / 2 - 400) <= 1, JSON.stringify(els[0]));
check('…linked to the original file', els[0] && els[0].originalPath === '/home/me/analysis/result.png' && els[0].filePath === 'figures/result.png' && els[0].sync === 'yes');

// Without a path (browser): the image data is saved
[cx, cy] = await toClient(1400, 700);
await drop(cx, cy, ['shot.png'], []);
await page.waitForTimeout(900);
els = await elements();
check('without a known path: saved into figures/', els.length === 2 && els[1].filePath === 'figures/shot.png' && !els[1].originalPath, JSON.stringify(els[1]));

// On an existing figure: its image is replaced
const first = els[0];
[cx, cy] = await toClient(first.x + first.width / 2, first.y + first.height / 2);
await drop(cx, cy, ['newer.png'], ['/home/me/analysis/newer.png']);
await page.waitForTimeout(300);
els = await elements();
check('dropped on a figure: replaces its image', els.length === 2 && els[0].filePath === 'figures/newer.png' && els[0].originalPath === '/home/me/analysis/newer.png', JSON.stringify(els[0]));

// Not an image
res = await drop(cx, cy, ['notes.txt'], ['/home/me/notes.txt']);
await page.waitForTimeout(900);
check('a non-image is refused (and not opened)', (await elements()).length === 2 && res.dropPrevented);

// On the start screen: nothing is added, the window stays
await app(async () => {
    document.getElementById('editor-view').classList.remove('active');
});
res = await drop(20, 20, ['x.png'], ['/tmp/x.png']);
await page.waitForTimeout(900);
check('outside the editor: ignored, but never opened', res.dropPrevented && (await elements()).length === 2);
await app(() => document.getElementById('editor-view').classList.add('active'));

console.log(out.join('\n'));
console.log('--- errors ---\n' + (errors.join('\n') || '(none)'));
await browser.close();
