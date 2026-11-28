// 🗂 Project files (ui/projectFiles.js): the files of figures/ and data/,
// what uses each (a click goes to it), unused ones, duplicates (merge:
// what used it uses the other copy, and it is deleted), open a file or
// its folder, delete the ticked; the sidebar button counts what could be
// cleaned up.
import { launchBrowser, BASE_URL } from '../helpers.mjs';

const browser = await launchBrowser();
const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
const errors = [];
page.on('pageerror', e => errors.push(e.message));
const out = [];
const check = (n, c, x = '') => out.push(`${c ? 'PASS' : 'FAIL'} ${n}${x !== '' ? ' — ' + JSON.stringify(x) : ''}`);
const app = (fn, arg) => page.evaluate(fn, arg);

await page.addInitScript(() => {
    const ok = (o = {}) => Promise.resolve({ success: true, ...o });
    window.__files = [
        { path: 'figures/plot.png', size: 2048, same_as: null },
        { path: 'data/run.csv', size: 39, same_as: null },
        { path: 'data/run_1.csv', size: 39, same_as: 'data/run.csv' },
        { path: 'data/old.csv', size: 120, same_as: null },
    ];
    window.__opened = [];
    window.__deleted = [];
    window.pywebview = { api: {
        list_project_files: (folder, text) => ok({ files: window.__files.map(f => ({ ...f, mtime: 1, named: text.includes(f.path) })) }),
        open_project_file: (folder, rel, folderOnly) => { window.__opened.push(`${rel}${folderOnly ? ' (folder)' : ''}`); return ok(); },
        delete_project_files: (folder, paths) => { window.__deleted.push(...paths); window.__files = window.__files.filter(f => !paths.includes(f.path)); return ok({ deleted: paths, errors: [] }); },
        read_plot_data: () => ok({ header: ['x', 'y'], rows: [['1', '2']], total: 1, mtime: 1 }),
        refresh_plot_data: () => ok({ updated: [] }),
        read_table_file: () => ok({ rows: [['x', 'y'], ['1', '2']], total: 2, mtime: 1 }),
        refresh_tables: () => ok({ updated: [] }),
        load_figure_data_uri: () => ok({ data_uri: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAIAAAABCAYAAAD0In+KAAAAEUlEQVR42mP8z8DwnwEJMAIAKjYD/0QNRfwAAAAASUVORK5CYII=' }),
        refresh_linked_figures: () => ok({ updated: [] }),
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
    state.slides = [
        { id: 1, title: 'One', elements: [{ type: 'figure', id: 2, x: 100, y: 100, width: 400, height: 300, filePath: 'figures/plot.png', originalPath: '/home/me/exp/plot.png', sync: 'yes' }] },
        { id: 3, title: 'Two', elements: [
            { type: 'plot', id: 4, x: 100, y: 100, width: 900, height: 500, lang: 'python', xmin: '', xmax: '', code: '.line data:{data/run.csv} original:/home/me/exp/run.csv x:x y:y' },
            { type: 'table', id: 5, x: 1100, y: 100, width: 600, height: 200, rows: [['x', 'y'], ['1', '2']], data: { src: 'data/run_1.csv', sync: 'yes', original: '/home/me/exp/run.csv' } },
        ] },
    ];
    state.nextId = 10;
    (await import('/editor/editor.js')).selectSlide(0);
    await (await import('/ui/projectFiles.js')).refreshFilesBadge();
});
await page.waitForTimeout(200);

const badge = await app(() => { const b = document.querySelector('[data-action="open-project-files"] .files-badge'); return b && !b.hidden ? b.textContent : ''; });
check('the sidebar button: how many could be cleaned up (a duplicate, an unused file)', badge === '2 to clean', badge);

await page.click('[data-action="open-project-files"]');
await page.waitForTimeout(250);
const rows = await app(() => [...document.querySelectorAll('.pf-row')].map(r => r.textContent.replace(/\s+/g, ' ').trim()));
check('the dialog: figures and data, each file with what uses it', rows.length === 4 && /plot\.png 2 KB slide 1 · figure/.test(rows[0]) && /run\.csv 39 B slide 2 · plot/.test(rows[1]), rows);
check('…an unused file, and a duplicate (same content as run.csv)', rows.some(r => /old\.csv 120 B unused/.test(r)) && rows.some(r => /run_1\.csv 39 B slide 2 · table\s?⚠ same content as data\/run\.csv\s?Merge/.test(r)), rows);
const ticks = await app(() => [...document.querySelectorAll('[data-pf-tick]')].map(t => `${t.dataset.pfTick}${t.checked ? '*' : ''}`));
check('…only the unused ones can be ticked (ticked)', JSON.stringify(ticks) === '["data/old.csv*"]', ticks);

// open a file, its folder, a folder
await page.click('[data-pf-open="data/run.csv"]');
await page.click('[data-pf-folder="data/run.csv"]');
await page.click('.pf-head [data-pf-folder="figures"]');
await page.waitForTimeout(100);
check('↗ opens the file, 📁 its folder, 📁 Open figures/ the folder', JSON.stringify(await app(() => window.__opened)) === '["data/run.csv","data/run.csv (folder)","figures (folder)"]', await app(() => window.__opened));

// merge the duplicate
await page.click('[data-pf-merge="data/run_1.csv"]');
await page.waitForTimeout(300);
const merged = await app(async () => ({ src: (await import('/core/state.js')).state.slides[1].elements[1].data.src, deleted: window.__deleted }));
check('Merge: the table now uses data/run.csv, run_1.csv deleted', merged.src === 'data/run.csv' && JSON.stringify(merged.deleted) === '["data/run_1.csv"]', merged);
const rows2 = await app(() => [...document.querySelectorAll('.pf-row')].map(r => r.textContent.replace(/\s+/g, ' ').trim()));
check('…the list looked at again: run.csv used by the plot and the table', rows2.length === 3 && rows2.some(r => /run\.csv 39 B slide 2 · plot\s?slide 2 · table/.test(r)), rows2);

// a duplicate following another original can't be merged
await app(async () => {
    window.__files.push({ path: 'data/other.csv', size: 39, same_as: 'data/run.csv' });
    const { state } = await import('/core/state.js');
    state.slides[1].elements.push({ type: 'table', id: 6, x: 100, y: 700, width: 600, height: 200, rows: [['a']], data: { src: 'data/other.csv', sync: 'yes', original: '/home/me/exp_b/run.csv' } });
});
await page.click('[data-pf-refresh]');
await page.waitForTimeout(250);
const blocked = await app(() => { const b = document.querySelector('[data-pf-merge="data/other.csv"]'); return b && { disabled: b.disabled, title: b.title }; });
check('…a duplicate that follows another original: Merge off, saying why', blocked && blocked.disabled && /different originals/.test(blocked.title), blocked);

// delete the ticked
await page.click('[data-pf-delete]');
await page.waitForTimeout(80);
const asking = await app(() => document.querySelector('[data-pf-delete]').textContent.trim());
check('Delete asks once more', asking === 'Click again: delete 1 file' && !(await app(() => window.__deleted.includes('data/old.csv'))), asking);
await page.click('[data-pf-delete]');
await page.waitForTimeout(250);
check('…then deletes it', await app(() => window.__deleted.includes('data/old.csv') && ![...document.querySelectorAll('.pf-row')].some(r => r.textContent.includes('old.csv'))));

// a click on what uses a file goes to it
await page.click('.pf-use[data-pf-goto="2"]');
await page.waitForTimeout(250);
const went = await app(async () => { const { state } = await import('/core/state.js'); return { slide: state.currentSlideIndex, open: document.getElementById('project-files-modal').classList.contains('show') }; });
check('a click on "slide 1 · figure": the dialog closes, slide 1 shown', went.slide === 0 && !went.open, went);
const badge2 = await app(async () => { await (await import('/ui/projectFiles.js')).refreshFilesBadge(); const b = document.querySelector('[data-action="open-project-files"] .files-badge'); return b.hidden ? 'hidden' : b.textContent; });
check('the button\'s count follows (other.csv is still the same as run.csv)', badge2 === '1 to clean', badge2);

check('no page errors', errors.length === 0, errors);
console.log(out.join('\n'));
await browser.close();
