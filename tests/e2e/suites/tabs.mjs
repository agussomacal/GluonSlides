// Several projects in tabs (ui/tabs.js): opening a second project makes a
// tab, switching keeps each project (and saves the one left), opening an
// open one switches to it, + gives the start screen, closing saves; and
// pasting objects copied in another tab brings their figures, macros,
// styles and theme colours along (core/projectTransfer.js).
import { launchBrowser, BASE_URL } from '../helpers.mjs';

const browser = await launchBrowser();
const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
const errors = [];
page.on('pageerror', e => errors.push(e.message));
const out = [];
const check = (n, c, x = '') => out.push(`${c ? 'PASS' : 'FAIL'} ${n}${x !== '' ? ' — ' + x : ''}`);
const app = (fn, arg) => page.evaluate(fn, arg);

const A = `.project {Alpha} version:2 width:1920 height:1080 nextid:20
.palette brand:#ff5500
.style.text {big} fontSize:80
.define {card} width:400 height:300
\t.element.shape name:back x:0 y:0 width:400 height:300 bg:@brand
.slide {Alpha one} id:1
.element.figure id:2 x:100 y:100 width:400 height:300 filePath:figures/plot.png
.element.text id:3 style:big x:600 y:100 width:800 height:200 fontColor:@brand
\tStyled text
.macro.card id:4 x:100 y:500 width:400 height:300
`;
const B = `.project {Beta} version:2 width:1920 height:1080 nextid:10
.slide {Beta one} id:1
.element.text id:2 x:100 y:100 width:800 height:200
\tBeta text
`;

await page.addInitScript(([A, B]) => {
    const red = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAIAAAABCAYAAAD0In+KAAAAEUlEUgAAAAE=';
    window.__saved = [];
    window.__imports = [];
    const files = { '/p/Alpha/Alpha.gl': A, '/p/Beta/Beta.gl': B };
    const ok = (o = {}) => Promise.resolve({ success: true, ...o });
    window.pywebview = { api: {
        load_project_at: (p) => ok({ content: files[p] }),
        save_project_data: (p, c) => { window.__saved.push(p); files[p] = c; return ok(); },
        import_figure: (folder, path) => { window.__imports.push([folder, path]); const b = path.split('/').pop(); return ok({ relative_path: `figures/${b}`, path: `${folder}/figures/${b}`, data_uri: red }); },
        load_figure_data_uri: () => ok({ data_uri: red }),
        get_recent_projects: () => ok({ projects: [] }), add_recent_project: () => ok(),
        get_inspector_settings: () => ok({ settings: null }), save_inspector_settings: () => ok(),
        list_project_fonts: () => ok({ fonts: [] }), list_system_fonts: () => ok({ families: [] }),
        load_text_file: () => Promise.resolve({ success: false }), save_text_file: () => ok(),
        read_clipboard: () => ok(), set_clipboard_text: () => ok(),
    } };
    window.dispatchEvent(new Event('pywebviewready'));
}, [A, B]);
await page.goto(`${BASE_URL}/index.html`);
await page.waitForTimeout(400);
const open = (p) => app(async (p) => (await import('/ui/project.js')).openProjectByPath(p), p);
const tabs = () => app(async () => (await import('/ui/tabs.js')).tabList());
const st = () => app(async () => { const { state } = await import('/core/state.js'); return { name: state.projectName, titles: state.slides.map(s => s.title), path: state.projectPath }; });

await open('/p/Alpha/Alpha.gl');
await page.waitForTimeout(300);
check('one project: one tab, the strip shown', (await tabs()).length === 1 && await page.isVisible('#project-tabs'));
await open('/p/Beta/Beta.gl');
await page.waitForTimeout(300);
let t = await tabs();
check('opening another project: a second tab, active', t.length === 2 && t[1].active && t[1].name === 'Beta' && t[0].name === 'Alpha', JSON.stringify(t));
check('…showing Beta', (await st()).titles[0] === 'Beta one');

// switching keeps each project; the one left is saved
await page.click('.project-tab[data-tab="0"]');
await page.waitForTimeout(300);
check('back to Alpha', (await st()).titles[0] === 'Alpha one' && (await tabs())[0].active);
await app(async () => { const m = await import('/core/state.js'); m.state.slides[0].title = 'Alpha edited'; m.markDirty(); });
await page.click('.project-tab[data-tab="1"]');
await page.waitForTimeout(300);
check('leaving a tab saves its project', (await app(() => window.__saved)).includes('/p/Alpha/Alpha.gl'));
await page.click('.project-tab[data-tab="0"]');
await page.waitForTimeout(300);
check('…and its changes are there when coming back', (await st()).titles[0] === 'Alpha edited');
await open('/p/Alpha/Alpha.gl');
await page.waitForTimeout(200);
check('opening a project that is open: its tab, no new one', (await tabs()).length === 2 && (await tabs())[0].active);

// copy in Alpha, paste in Beta
await app(async () => { const m = await import('/core/state.js'); m.setSelectedElementIndices([0, 1, 2], 2); (await import('/editor/editor.js')).renderEditor(); });
await page.mouse.click(5, 450); // focus the page outside text fields
await app(async () => { const m = await import('/core/state.js'); m.setSelectedElementIndices([0, 1, 2], 2); });
await page.keyboard.press('Control+c');
await page.click('.project-tab[data-tab="1"]');
await page.waitForTimeout(300);
await app(async () => { const m = await import('/core/state.js'); m.setSelectedElementIndices([], null); });
await page.keyboard.press('Control+v');
await page.waitForTimeout(600);
const pasted = await app(async () => {
    const { state } = await import('/core/state.js');
    const els = state.slides[0].elements;
    return { types: els.map(e => e.type), fig: els.find(e => e.type === 'figure'), macro: Object.keys(state.macros), styles: state.styles, palette: state.palette };
});
check('pasted in the other project', JSON.stringify(pasted.types) === '["text","figure","text","macro"]', JSON.stringify(pasted.types));
check('the figure file is copied into this project', JSON.stringify(await app(() => window.__imports)) === JSON.stringify([['/p/Beta', '/p/Alpha/figures/plot.png']]) && pasted.fig.filePath === 'figures/plot.png' && pasted.fig.x === 100, JSON.stringify(await app(() => window.__imports)));
check('the macro, the named style and the theme colour come along', pasted.macro.includes('card') && pasted.styles.text && pasted.styles.text.big && (pasted.palette || []).some(p => p.name === 'brand' && p.color === '#ff5500'), JSON.stringify([pasted.macro, pasted.styles, pasted.palette]));

// + : the start screen; going back drops the empty tab
await page.click('.project-tab-new');
await page.waitForTimeout(300);
t = await tabs();
check('+: the start screen in a new tab', t.length === 3 && t[2].name === 'New tab' && await page.isVisible('#welcome-view.active'), JSON.stringify(t));
await page.click('.project-tab[data-tab="0"]');
await page.waitForTimeout(300);
t = await tabs();
check('leaving the empty tab removes it', t.length === 2 && t[0].active && await page.isVisible('#editor-view.active'), JSON.stringify(t));
await page.keyboard.press('Control+Tab');
await page.waitForTimeout(300);
check('Ctrl+Tab: the next tab', (await tabs())[1].active && (await st()).titles[0] === 'Beta one');

// closing saves and shows the other
const savedBefore = (await app(() => window.__saved)).length;
await app(async () => { const m = await import('/core/state.js'); m.state.slides[0].title = 'Beta edited'; m.markDirty(); });
await page.click('.project-tab[data-tab="1"] .project-tab-close');
await page.waitForTimeout(300);
t = await tabs();
check('closing a tab saves it and shows the other', t.length === 1 && t[0].name === 'Alpha' && (await app(() => window.__saved)).length > savedBefore && (await st()).titles[0] === 'Alpha edited', JSON.stringify(t));

console.log(out.join('\n'));
console.log('--- errors ---\n' + (errors.join('\n') || '(none)'));
await browser.close();
