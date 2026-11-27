// "Import Talk…" on the start screen (ui/importTalk.js), with a fake
// backend: choosing the file and folder, the PDF options only for PDFs,
// building and opening the project (slides, steps, sections, notes,
// masters, macros, bibliography), the warnings list, the PDF component
// download (asked first), and errors.
import { launchBrowser, BASE_URL } from '../helpers.mjs';

const browser = await launchBrowser();
const out = [];
const check = (n, c, x = '') => out.push(`${c ? 'PASS' : 'FAIL'} ${n}${x !== '' ? ' — ' + x : ''}`);
const errors = [];

const PROJECT = {
    title: 'A Test Talk', author: 'Ana, Bo', date: '2026', width: 1920, height: 1080,
    slides: [
        { title: 'A Test Talk', master: 'Plain', elements: [{ type: 'text', x: 100, y: 100, width: 800, height: 120, content: '**A Test Talk**', fontSize: 60 }] },
        { title: 'First', section: 'Intro', master: 'Beamer', notes: 'Say hello first.', elements: [
            { type: 'text', x: 100, y: 200, width: 800, height: 60, content: '- One', fontSize: 36 },
            { type: 'text', x: 100, y: 260, width: 800, height: 60, content: '- Two', fontSize: 36, step: 2 },
            { type: 'text', x: 100, y: 320, width: 800, height: 80, content: '$$\\R$$', fontSize: 36, step: 2 },
        ] },
        { title: 'Plain one', section: 'Intro', master: 'none', elements: [] },
    ],
    masters: [
        { name: 'Beamer', elements: [{ type: 'shape', kind: 'rect', x: 0, y: 0, width: 1920, height: 90, bg: '#d9d9d9' }] },
        { name: 'Plain', elements: [] },
    ],
    macros: '\\newcommand{\\R}{\\mathbb{R}}\n',
    bib: '@article{smith2020, author={Smith, Jane}, title={A}, year={2020}}',
    warnings: [],
};

async function start(behaviour) {
    const page = await browser.newPage({ viewport: { width: 1300, height: 850 } });
    page.on('pageerror', e => errors.push(e.message));
    await page.addInitScript(([project, behaviour]) => {
        const files = {};
        window.__calls = [];
        window.__files = files;
        let attempts = 0;
        const ok = (o = {}) => Promise.resolve({ success: true, ...o });
        window.pywebview = { api: {
            select_import_file: () => ok({ path: behaviour.source }),
            ...(behaviour.sources ? { select_import_files: () => ok({ paths: behaviour.sources }) } : {}),
            select_folder: () => ok({ path: '/home/me/talks' }),
            import_talk: (source, folder, name, options) => {
                window.__calls.push(['import', source, folder, name, options.pdfMode, options.usePdf]);
                attempts += 1;
                if (behaviour.error) return Promise.resolve({ success: false, error: behaviour.error });
                if (behaviour.needsExtra && attempts === 1) {
                    return Promise.resolve({ success: false, needs_extra: 'pymupdf', extra_message: 'PDF import needs an extra component (about 20 MB). Download it now?' });
                }
                const p = JSON.parse(JSON.stringify(project));
                if (behaviour.warnings) p.warnings = behaviour.warnings;
                if (behaviour.groundTruth) p.groundTruth = behaviour.groundTruth;
                return ok({ path: `${folder}/${name}/${name}.gl`, folder: `${folder}/${name}`, project: p });
            },
            install_extra: (name) => { window.__calls.push(['install', name]); return ok(); },
            save_text_file: (folder, name, content) => { files[name] = content; return ok(); },
            load_text_file: (folder, name) => Promise.resolve(files[name] !== undefined ? { success: true, content: files[name] } : { success: false }),
            save_project_data: (path, content) => { files.__gl = content; files.__path = path; return ok(); },
            load_project_at: () => ok({ content: files.__gl }),
            load_figure_data_uri: () => ok({ data_uri: '' }),
            get_recent_projects: () => ok({ projects: [] }), add_recent_project: () => ok(),
            get_inspector_settings: () => ok({ settings: null }), save_inspector_settings: () => ok(),
            list_project_fonts: () => ok({ fonts: [] }), list_system_fonts: () => ok({ families: [] }),
        } };
        window.dispatchEvent(new Event('pywebviewready'));
    }, [PROJECT, behaviour]);
    await page.goto(`${BASE_URL}/index.html`);
    await page.waitForTimeout(500);
    await page.click('[data-action="import-talk"]');
    return page;
}

// ---------- A Beamer talk ----------
let page = await start({ source: '/home/me/Downloads/Natural_Gradient.zip' });
check('the dialog opens from the start screen', await page.isVisible('#import-modal.show'));
check('Import is disabled until file and folder are chosen', await page.isDisabled('#import-go'));
await page.click('[data-action="import-choose-source"]');
check('choosing a file fills in the project name', await page.inputValue('#import-name') === 'Natural Gradient');
check('PDF options are hidden for a .zip', !(await page.isVisible('#import-pdf-options')));
await page.click('[data-action="import-choose-folder"]');
check('…and with a folder, Import is enabled', !(await page.isDisabled('#import-go')));
await page.click('#import-go');
await page.waitForTimeout(800);
const calls = await page.evaluate(() => window.__calls);
check('the backend is asked to import into <folder>/<name>', JSON.stringify(calls[0]) === JSON.stringify(['import', '/home/me/Downloads/Natural_Gradient.zip', '/home/me/talks', 'Natural Gradient', 'editable', true]));
check('the project opens in the editor', await page.isVisible('#editor-view.active'));
const st = await page.evaluate(async () => JSON.parse(JSON.stringify((await import('/core/state.js')).state, (k, v) => (k.startsWith('_') || k === 'undoStack' || k === 'redoStack' ? undefined : v))));
check('size, author, date from the talk', st.slideWidth === 1920 && st.slideHeight === 1080 && st.author === 'Ana, Bo' && st.date === '2026');
check('slides with sections, notes and steps', st.slides.length === 3 && st.slides[1].section === 'Intro' && st.slides[1].notes === 'Say hello first.'
    && st.slides[1].elements.map(e => e.step || 1).join(',') === '1,2,2', JSON.stringify(st.slides.map(s => s.title)));
check('empty masters dropped; slides on the first master don\'t name it; master:none kept',
    st.masters.length === 1 && st.masters[0].name === 'Beamer' && st.slides[1].master === undefined && st.slides[0].master === 'none' && st.slides[2].master === 'none',
    JSON.stringify([st.masters.map(m => m.name), st.slides.map(s => s.master)]));
const files = await page.evaluate(() => window.__files);
check('macros.tex and bibliography.bib written', files['macros.tex'].includes('\\newcommand{\\R}') && files['bibliography.bib'].includes('smith2020'));
check('the .gl is written where the backend said', files.__path === '/home/me/talks/Natural Gradient/Natural Gradient.gl' && files.__gl.includes('.slide {First}'));
check('math uses the imported macros', await page.evaluate(async () => {
    const { selectSlide } = await import('/editor/editor.js');
    selectSlide(1);
    await new Promise(r => setTimeout(r, 200));
    return !document.querySelector('#slide-canvas .katex-error') && Boolean(document.querySelector('#slide-canvas .katex'));
}));
await page.close();

// ---------- Warnings are shown before opening ----------
page = await start({ source: '/x/talk.tex', warnings: ['Figure not found: figures/missing', 'Slide 4 was very full and is shown smaller.'] });
await page.click('[data-action="import-choose-source"]');
await page.click('[data-action="import-choose-folder"]');
await page.click('#import-go');
await page.waitForTimeout(600);
check('warnings listed, the dialog stays open', (await page.textContent('#import-warnings')).includes('Figure not found') && await page.isVisible('#import-modal.show'));
check('…with "Open project"', (await page.textContent('#import-go')).trim() === 'Open project');
await page.click('#import-go');
await page.waitForTimeout(600);
check('which opens it', await page.isVisible('#editor-view.active') && !(await page.isVisible('#import-modal.show')));
await page.close();

// ---------- A PDF: options, and the extra component (asked first) ----------
page = await start({ source: '/x/slides.pdf', needsExtra: true });
await page.click('[data-action="import-choose-source"]');
check('PDF options shown for a .pdf', await page.isVisible('#import-pdf-options'));
await page.check('input[name="import-pdf-mode"][value="overlay"]');
await page.click('[data-action="import-choose-folder"]');
await page.click('#import-go');
await page.waitForTimeout(400);
check('asks before downloading the PDF component', await page.isVisible('#import-extra') && (await page.textContent('#import-extra')).includes('about 20 MB'));
await page.click('[data-extra="yes"]');
await page.waitForTimeout(800);
const pdfCalls = await page.evaluate(() => window.__calls);
check('downloads it, then imports with the chosen mode', JSON.stringify(pdfCalls.map(c => c[0])) === '["import","install","import"]' && pdfCalls[2][4] === 'overlay', JSON.stringify(pdfCalls));
check('…and opens the project', await page.isVisible('#editor-view.active'));
await page.close();

page = await start({ source: '/x/slides.pdf', needsExtra: true });
await page.click('[data-action="import-choose-source"]');
await page.click('[data-action="import-choose-folder"]');
await page.click('#import-go');
await page.waitForTimeout(400);
await page.click('[data-extra="no"]');
await page.waitForTimeout(300);
check('declining: nothing downloaded or imported', JSON.stringify((await page.evaluate(() => window.__calls)).map(c => c[0])) === '["import"]'
    && (await page.textContent('#import-error')).includes('nothing was imported'));
await page.close();

// ---------- A talk split over several files, dropped or chosen; its compiled PDF ----------
page = await start({ sources: ['/home/me/talk/sections/intro.tex', '/home/me/talk/main.tex'], groundTruth: { pdf: 'main.pdf', slides: 3 } });
check('the dialog says a zip, a folder or many files are fine', /zip/.test(await page.textContent('#import-drop')) && /folder/.test(await page.textContent('#import-drop')) && /several/.test(await page.textContent('#import-drop')));
await page.click('[data-action="import-choose-source"]');
check('several files chosen at once are listed', JSON.stringify(await page.$$eval('#import-source li .import-source-name', ns => ns.map(n => n.textContent.trim().replace(/^\S+\s/, '')))) === '["intro.tex","main.tex"]');
check('the name comes from the main file\'s folder', await page.inputValue('#import-name') === 'talk', await page.inputValue('#import-name'));
check('the compiled-PDF option is offered for LaTeX', await page.isVisible('#import-use-pdf-row'));
// dropping more files on the dialog (from the backend, with paths): added, not put on a slide
await page.evaluate(() => window.gluonNativeDrop(['/home/me/talk/main.pdf', '/home/me/talk/extra.tex'], 600, 300));
await page.waitForTimeout(100);
let listed = await page.$$eval('#import-source li .import-source-name', ns => ns.map(n => n.textContent.trim().replace(/^\S+\s/, '')));
check('files dropped on the dialog are added', JSON.stringify(listed) === '["intro.tex","main.tex","main.pdf","extra.tex"]', JSON.stringify(listed));
await page.click('#import-source li:nth-child(4) [data-remove-source]');
listed = await page.$$eval('#import-source li', ns => ns.length);
check('× removes one', listed === 3);
await page.click('[data-action="import-choose-folder"]');
await page.click('#import-go');
await page.waitForTimeout(800);
let c = (await page.evaluate(() => window.__calls))[0];
check('all of them go to the backend, with the PDF option on', JSON.stringify(c[1]) === JSON.stringify(['/home/me/talk/sections/intro.tex', '/home/me/talk/main.tex', '/home/me/talk/main.pdf']) && c[5] === true, JSON.stringify(c));
check('it says the layout was checked against the PDF', (await page.textContent('#save-indicator')).includes('checked against main.pdf'), await page.textContent('#save-indicator'));
await page.close();

page = await start({ sources: ['/home/me/talk'] });
await page.click('[data-action="import-choose-source"]');
await page.uncheck('#import-use-pdf');
await page.click('[data-action="import-choose-folder"]');
await page.click('#import-go');
await page.waitForTimeout(600);
c = (await page.evaluate(() => window.__calls))[0];
check('a folder alone is one source; the PDF can be left out', c[1] === '/home/me/talk' && c[5] === false, JSON.stringify(c));
await page.close();

// ---------- Errors ----------
page = await start({ source: '/x/talk.tex', error: 'A folder with this name already exists there: choose another name.' });
await page.click('[data-action="import-choose-source"]');
await page.click('[data-action="import-choose-folder"]');
await page.click('#import-go');
await page.waitForTimeout(400);
check('an error is shown, the dialog stays', (await page.textContent('#import-error')).includes('already exists') && await page.isVisible('#import-modal.show'));
await page.close();

console.log(out.join('\n'));
console.log('--- errors ---\n' + (errors.join('\n') || '(none)'));
await browser.close();
