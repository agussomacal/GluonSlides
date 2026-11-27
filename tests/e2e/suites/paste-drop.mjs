// Pasting and dropping images in the app (fake backend):
//   Ctrl+V asks the backend for the clipboard (WebKitGTK sends no paste
//   event without a text field): a screenshot, copied image files, or
//   text (a new text box), or nothing (then the app's own copied objects
//   are pasted); Ctrl+C in the app replaces the system clipboard.
//   Files dropped on the window never open in place of the app; images
//   become linked figures where they are dropped, or replace the figure
//   they are dropped on. A CSV becomes a linked table (data/ copy).
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
        read_clipboard: () => ok(window.__clipboard),
        set_clipboard_text: (t) => { window.__clipboardText.push(t); window.__clipboard = { text: t }; return ok(); },
        take_dropped_paths: () => { const p = window.__dropPaths; window.__dropPaths = []; return ok({ paths: p }); },
        save_figure_data: (folder, uri, name) => ok({ relative_path: `figures/${name.replace(/\.\w+$/, '')}.png`, data_uri: uri }),
        import_figure: (folder, path) => {
            const base = path.split('/').pop();
            const res = { success: true, relative_path: `figures/${base}`, path: `${folder}/figures/${base}`, data_uri: red };
            return window.__slowMs ? new Promise(r => setTimeout(() => r(res), window.__slowMs)) : Promise.resolve(res);
        },
        refresh_linked_figures: () => ok({ updated: [] }),
        link_table_file: (folder, path) => ok({ rows: [['k', 'v'], ['a', '1']], mtime: 1, relative_path: `data/${path.split('/').pop()}`, original: path }),
        read_table_file: () => ok({ rows: [['k', 'v'], ['a', '1']], mtime: 1 }),
        refresh_tables: () => ok({ updated: [] }),
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

// Text copied outside the app: a new text box
await app(() => { window.__clipboard = { text: 'Copied from a paper\nsecond line' }; });
await page.keyboard.press('Control+v');
await page.waitForTimeout(300);
els = await elements();
const tb = els[3];
check('Ctrl+V of outside text: a new text box with it', tb && tb.type === 'text' && tb.content === 'Copied from a paper\nsecond line', JSON.stringify(tb));
check('…selected, sized for two lines, left-aligned', tb && tb.height >= 80 && tb.width < 1920 * 0.7 + 1 && tb.textAlign === 'left'
    && await page.$eval(`#slide-canvas [data-element-id="${tb.id}"]`, n => n.classList.contains('selected') && n.innerText.includes('second line')), JSON.stringify(tb));
await app(async () => { const { state } = await import('/core/state.js'); state.slides[0].elements.pop(); (await import('/editor/editor.js')).renderEditor(); });

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
check('a dropped image becomes a figure centred where it was dropped', els.length === 1 && Math.abs(els[0].x + els[0].width / 2 - 500) <= 3 && Math.abs(els[0].y + els[0].height / 2 - 400) <= 3, JSON.stringify(els[0]));
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

// WebKitGTK may give only a uri-list (no Files type, no files): still taken
const uriDrop = (x, y, uris) => app(([x, y, uris]) => {
    const dt = new DataTransfer();
    dt.setData('text/uri-list', uris.join('\r\n'));
    const target = document.elementFromPoint(x, y);
    const over = new DragEvent('dragover', { dataTransfer: dt, bubbles: true, cancelable: true, clientX: x, clientY: y });
    target.dispatchEvent(over);
    const ev = new DragEvent('drop', { dataTransfer: dt, bubbles: true, cancelable: true, clientX: x, clientY: y });
    target.dispatchEvent(ev);
    return { overPrevented: over.defaultPrevented, dropPrevented: ev.defaultPrevented };
}, [x, y, uris]);
[cx, cy] = await toClient(300, 800);
res = await uriDrop(cx, cy, ['file:///home/me/My%20plots/fig%201.png']);
await page.waitForTimeout(300);
els = await elements();
check('a drop given only as file:// uris: prevented, imported by path', res.overPrevented && res.dropPrevented
    && els.length === 3 && els[2].originalPath === '/home/me/My plots/fig 1.png' && els[2].filePath === 'figures/fig 1.png', JSON.stringify({ res, el: els[2] }));
res = await uriDrop(cx, cy, ['https://example.org/pic.png']);
await page.waitForTimeout(100);
check('a web image: prevented (the window stays), explained', res.dropPrevented && (await elements()).length === 3);
// The backend's drop (from GTK): paths and a page point; the page's own
// drop event for the same file doesn't add it twice
[cx, cy] = await toClient(1500, 300);
await app(([x, y]) => window.gluonNativeDrop(['/home/me/analysis/native.png'], x, y), [cx, cy]);
await drop(cx, cy, ['native.png'], []);
await page.waitForTimeout(900);
els = await elements();
const nat = els.filter(e => (e.filePath || '').includes('native'));
check('a drop sent by the backend: a linked figure where it was dropped, once', nat.length === 1 && nat[0].originalPath === '/home/me/analysis/native.png'
    && Math.abs(nat[0].x + nat[0].width / 2 - 1500) <= 1, JSON.stringify(nat));
await app(async () => { const { state } = await import('/core/state.js'); state.slides[0].elements = state.slides[0].elements.filter(e => !(e.filePath || '').includes('native')); (await import('/editor/editor.js')).renderEditor(); });

// A slow import (a big PDF figure): a box on the slide says so until the figure is there
await app(() => { window.__slowMs = 1200; });
[cx, cy] = await toClient(960, 540);
await app(([x, y]) => window.gluonNativeDrop(['/home/me/analysis/big.pdf'], x, y), [cx, cy]);
await page.waitForTimeout(600);
const shown = (sel) => `(() => { const n = document.querySelector('${sel}'); return !!n && getComputedStyle(n).display !== 'none'; })()`;
const during = await app((js) => ({ box: document.querySelector('#slide-canvas .busy-placeholder')?.textContent || '', bar: eval(js) }), shown('.busy-bar'));
await page.waitForTimeout(1100);
const after = await app((js) => ({ box: !!document.querySelector('.busy-placeholder'), bar: eval(js) }), shown('.busy-bar'));
els = await elements();
check('a slow image import shows a box on the slide and a busy bar', during.box.includes('Importing big.pdf') && during.bar, JSON.stringify(during));
check('…gone once the figure is added', !after.box && !after.bar && els.some(e => (e.filePath || '').includes('big.pdf')), JSON.stringify(after));
await app(async () => { window.__slowMs = 0; const { state } = await import('/core/state.js'); state.slides[0].elements = state.slides[0].elements.filter(e => !(e.filePath || '').includes('big')); (await import('/editor/editor.js')).renderEditor(); });

// A CSV: a table linked to the file (copied into data/), centred where dropped
[cx, cy] = await toClient(960, 700);
await app(([x, y]) => window.gluonNativeDrop(['/home/me/run/results.csv'], x, y), [cx, cy]);
await page.waitForTimeout(400);
els = await elements();
let tab = els.find(e => e.type === 'table');
check('a dropped CSV: a table linked to it, data/ copy + original', tab && tab.data && tab.data.src === 'data/results.csv' && tab.data.original === '/home/me/run/results.csv'
    && JSON.stringify(tab.rows) === '[["k","v"],["a","1"]]', JSON.stringify(tab && tab.data));
check('…centred where it was dropped', tab && Math.abs(tab.x + tab.width / 2 - 960) <= 3 && Math.abs(tab.y + tab.height / 2 - 700) <= 3, tab && `${tab.x},${tab.y} ${tab.width}x${tab.height}`);
// Another CSV dropped on that table: the table takes it
await app(async () => { const m = await import('/core/state.js'); m.state.slides[0].elements.find(e => e.type === 'table').rows = [['old']]; (await import('/editor/editor.js')).renderEditor(); });
[cx, cy] = await app(() => { const b = document.querySelector('#slide-canvas .element-table').getBoundingClientRect(); return [b.x + b.width / 2, b.y + b.height / 2]; });
await app(([x, y]) => window.gluonNativeDrop(['/home/me/run/other.csv'], x, y), [cx, cy]);
await page.waitForTimeout(400);
els = await elements();
const tables = els.filter(e => e.type === 'table');
check('a CSV dropped on a table: that table follows the new file', tables.length === 1 && tables[0].data.src === 'data/other.csv' && tables[0].rows.length === 2, JSON.stringify(tables.map(t => t.data)));
// From a browser (no path): the cells, not linked
await app(async ([x, y]) => {
    const dt = new DataTransfer();
    dt.items.add(new File(['x;y\n1;2\n3;4\n'], 'plain.csv', { type: 'text/csv' }));
    document.elementFromPoint(x, y).dispatchEvent(new DragEvent('drop', { dataTransfer: dt, bubbles: true, cancelable: true, clientX: x, clientY: y }));
}, await toClient(400, 200));
await page.waitForTimeout(900);
els = await elements();
tab = els.find(e => e.type === 'table' && !e.data);
check('a CSV without its path: a table of its cells', tab && JSON.stringify(tab.rows) === '[["x","y"],["1","2"],["3","4"]]', JSON.stringify(tab && tab.rows));
await app(async () => { const { state } = await import('/core/state.js'); state.slides[0].elements = state.slides[0].elements.filter(e => e.type !== 'table'); (await import('/editor/editor.js')).renderEditor(); });

// Text dragged into a text field is left to the field
const fieldDrop = await app(() => {
    const input = document.getElementById('slide-title-input');
    const dt = new DataTransfer();
    dt.setData('text/plain', 'hello');
    const over = new DragEvent('dragover', { dataTransfer: dt, bubbles: true, cancelable: true });
    input.dispatchEvent(over);
    return over.defaultPrevented;
});
check('text dragged over a text field: left to the field', fieldDrop === false);

// On the start screen: nothing is added, the window stays
await app(async () => {
    document.getElementById('editor-view').classList.remove('active');
});
res = await drop(20, 20, ['x.png'], ['/tmp/x.png']);
await page.waitForTimeout(900);
check('outside the editor: ignored, but never opened', res.dropPrevented && (await elements()).length === 3);
await app(() => document.getElementById('editor-view').classList.add('active'));

console.log(out.join('\n'));
console.log('--- errors ---\n' + (errors.join('\n') || '(none)'));
await browser.close();
