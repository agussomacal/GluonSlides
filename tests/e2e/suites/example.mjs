// "📊 Example: results that update" (ui/example.js): a project folder
// with data/runs.csv, data/summary.json and make_results.py; its slides
// draw from them, and rewriting the files (the script run again) changes
// the slides. The script itself runs and writes what the slides read.
import { launchBrowser, BASE_URL } from '../helpers.mjs';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, readFileSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const browser = await launchBrowser();
const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
const errors = [];
page.on('pageerror', e => errors.push(e.message));
const out = [];
const check = (n, c, x = '') => out.push(`${c ? 'PASS' : 'FAIL'} ${n}${x !== '' ? ' — ' + JSON.stringify(x) : ''}`);
const app = (fn, arg) => page.evaluate(fn, arg);

await page.addInitScript(() => {
    const ok = (o = {}) => Promise.resolve({ success: true, ...o });
    window.__mtime = 1;
    const csv = (text) => { const rows = text.trim().split('\n').map(l => l.split(',')); return { header: rows[0], rows: rows.slice(1), total: rows.length - 1 }; };
    const flat = (obj, prefix = '', outv = {}) => { Object.entries(obj).forEach(([k, v]) => { if (v && typeof v === 'object' && !Array.isArray(v)) flat(v, `${prefix}${k}.`, outv); else if (!Array.isArray(v)) outv[`${prefix}${k}`] = v; }); return outv; };
    window.pywebview = { api: {
        create_example_project: (name, files) => { window.__files = files; window.__created = name; return ok({ path: '/home/me/Results that update/Results that update.gl', folder: '/home/me/Results that update' }); },
        read_plot_data: (folder, path) => (window.__files && window.__files[path] ? ok({ ...csv(window.__files[path]), mtime: window.__mtime }) : Promise.resolve({ success: false, error: 'no file' })),
        refresh_plot_data: (folder, items) => ok({ updated: items.filter(i => i.mtime !== window.__mtime && window.__files[i.src]).map(i => ({ src: i.src, success: true, ...csv(window.__files[i.src]), mtime: window.__mtime })) }),
        refresh_vars: (folder, items) => ok({ updated: items.filter(i => i.mtime !== window.__mtime).map(i => ({ src: i.src, success: true, values: flat(JSON.parse(window.__files[i.src])), mtime: window.__mtime })) }),
        read_vars_file: (folder, path) => ok({ values: flat(JSON.parse(window.__files[path])), mtime: window.__mtime }),
        list_project_files: () => ok({ files: [] }),
        get_recent_projects: () => ok({ projects: [] }),
        add_recent_project: () => ok(),
        get_inspector_settings: () => ok({ settings: null }),
        save_inspector_settings: () => ok(),
        list_project_fonts: () => ok({ fonts: [] }),
        list_system_fonts: () => ok({ families: [] }),
        save_project_data: () => ok(),
        save_text_file: () => ok(),
        load_text_file: () => Promise.resolve({ success: false }),
        load_project_at: () => ok({ content: window.__files['project.gl'] }),
    } };
});
await page.goto(`${BASE_URL}/index.html`);
await page.waitForTimeout(300);
await page.click('[data-action="open-example"]');
await page.waitForTimeout(800);

const opened = await app(async () => {
    const { state } = await import('/core/state.js');
    return { name: state.projectName, slides: state.slides.map(s => s.title), folder: state.projectFolder, files: Object.keys(window.__files || {}), vars: state.varFiles };
});
check('📊 Example: a project folder with its data and script, opened', opened.name === 'Results that update' && opened.slides.length === 3 && JSON.stringify(opened.files) === '["project.gl","data/runs.csv","data/summary.json","make_results.py","bibliography.bib"]', opened);

await app(async () => (await import('/editor/editor.js')).selectSlide(1));
await page.waitForTimeout(600);
const s2 = await app(() => ({
    title: document.querySelector('#slide-canvas [data-element-id="21"]')?.textContent.trim(),
    lines: [...document.querySelectorAll('#slide-canvas [data-element-id="22"] svg path[stroke-linejoin]')].map(p => p.getAttribute('stroke')),
    keys: [...document.querySelectorAll('#slide-canvas [data-element-id="23"] [data-glkey]')].map(k => k.dataset.glkey),
    swatches: [...document.querySelectorAll('#slide-canvas [data-element-id="23"] .gl-key-swatch')].map(s => getComputedStyle(s).backgroundColor),
}));
check('slide 2: a line per run, in the colour key\'s colours', s2.lines.length === 3 && new Set(s2.lines).size === 3 && JSON.stringify(s2.keys) === '["adam","sgd","ngd"]', s2);
check('…the title shows the steps from summary.json (20)', s2.title === 'Loss per run (20 steps)', s2.title);

await app(async () => (await import('/editor/editor.js')).selectSlide(2));
await page.waitForTimeout(500);
const s3 = await app(() => ({
    text: document.querySelector('#slide-canvas [data-element-id="34"]')?.textContent.replace(/\s+/g, ' ').trim(),
    lines: document.querySelectorAll('#slide-canvas [data-element-id="36"] svg path[stroke-linejoin]').length,
    box: getComputedStyle(document.querySelector('#slide-canvas [data-element-id="33"] .shape-fill')).backgroundColor,
}));
check('slide 3: the run picked, its numbers from summary.json, only its line', /^adam loss 0\.\d{3} accuracy \d+(\.\d)?%$/.test(s3.text) && s3.lines === 1, s3);

// the script run again: other results (10 steps, other numbers)
await app(() => {
    const rows = ['run,step,loss'];
    ['adam', 'sgd', 'ngd'].forEach((r, k) => { for (let s = 1; s <= 10; s++) rows.push(`${r},${s},${(1 / (s + k)).toFixed(4)}`); });
    window.__files['data/runs.csv'] = rows.join('\n');
    window.__files['data/summary.json'] = JSON.stringify({ summary: { adam: { loss: 0.1, acc: 0.933 }, sgd: { loss: 0.0909, acc: 0.94 }, ngd: { loss: 0.0833, acc: 0.944 } }, steps: 10 });
    window.__mtime = 2;
});
await page.waitForTimeout(3600);
const s3b = await app(() => document.querySelector('#slide-canvas [data-element-id="34"]')?.textContent.replace(/\s+/g, ' ').trim());
check('the files rewritten (the script run again): the numbers change by themselves', s3b === 'adam loss 0.100 accuracy 93.3%', s3b);
await app(async () => (await import('/editor/editor.js')).selectSlide(1));
await page.waitForTimeout(300);
const title2 = await app(() => document.querySelector('#slide-canvas [data-element-id="21"]')?.textContent.trim());
check('…and the steps in the title', title2 === 'Loss per run (10 steps)', title2);

// the script itself: it runs, and writes what the slides read
const files = await app(async () => (await import('/ui/example.js')).exampleFiles());
const dir = mkdtempSync(join(tmpdir(), 'gluon-example-'));
let ran = '';
try {
    writeFileSync(join(dir, 'make_results.py'), files['make_results.py']);
    mkdirSync(join(dir, 'data'));
    ran = execFileSync('python3', ['-I', 'make_results.py'], { cwd: dir, encoding: 'utf8' });
    const csvText = readFileSync(join(dir, 'data', 'runs.csv'), 'utf8').trim().split(/\r?\n/);
    const summary = JSON.parse(readFileSync(join(dir, 'data', 'summary.json'), 'utf8'));
    check('make_results.py runs: runs.csv (run, step, loss) and summary.json (each run\'s loss and accuracy, the steps)',
        csvText[0] === 'run,step,loss' && new Set(csvText.slice(1).map(l => l.split(',')[0])).size === 3 && Object.keys(summary.summary).join() === 'adam,sgd,ngd' && Number.isInteger(summary.steps) && typeof summary.summary.adam.acc === 'number', [ran.trim(), csvText[0], summary.steps]);
} catch (e) {
    check('make_results.py runs', false, e.message);
} finally {
    rmSync(dir, { recursive: true, force: true });
}

check('no page errors', errors.length === 0, errors);
console.log(out.join('\n'));
await browser.close();
