// Help (ui/help.js, ui/tour.js, ui/tutorial.js, core/shortcuts.js): the
// tutorial presentation opens and is a valid project; the ? menu; the
// keyboard shortcuts dialog changes a shortcut (and the key works, the
// old one doesn't, a key taken from another command moves); the tour
// walks through and stops; Ctrl+E shows the .gl file.
import { launchBrowser, BASE_URL } from '../helpers.mjs';

const browser = await launchBrowser();
const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
const errors = [];
page.on('pageerror', e => errors.push(e.message));
const out = [];
const check = (n, c, x = '') => out.push(`${c ? 'PASS' : 'FAIL'} ${n}${x !== '' ? ' — ' + x : ''}`);
const app = (fn, arg) => page.evaluate(fn, arg);
const shot = (name) => page.screenshot({ path: `tests/e2e/output/help-${name}.png` });

await page.goto(`${BASE_URL}/index.html`);
await page.waitForTimeout(300);

// ---------- the tutorial, from the start screen ----------
await page.click('[data-action="help"][data-arg="tutorial"]');
await page.waitForTimeout(400);
const tut = await app(async () => {
    const { state } = await import('/core/state.js');
    const all = state.slides.flatMap(s => s.elements);
    return {
        name: state.projectName, slides: state.slides.map(s => s.title), path: state.projectPath,
        masters: state.masters.length, connector: all.find(e => e.type === 'path'),
        notes: state.slides.find(s => s.title === 'Builds').notes || '',
        types: [...new Set(all.map(e => e.type))].sort().join(','),
        hint: (all.find(e => e.id === 23) || {}).content,
        paragraphs: document.querySelectorAll('#slides-thumb-list p').length,
        editor: document.getElementById('editor-view').classList.contains('active'),
    };
});
check('the tutorial opens in the editor', tut.editor && tut.name === 'GluonSlides tutorial', JSON.stringify(tut.name));
check('…its slides', tut.slides.length === 10 && tut.slides[0] === 'Welcome' && tut.slides[9] === 'Next steps', JSON.stringify(tut.slides));
check('…not saved anywhere', !tut.path);
check('…a master, notes, and every kind of object', tut.masters === 1 && tut.notes.includes('Speaker notes') && tut.types === 'columns,figure,group,path,plot,slider,table,text', tut.types);
check('…the connector attached by name', tut.connector && tut.connector.from === '{Data}@right' && tut.connector.to === '{Model}@left' && tut.connector.width > 300, JSON.stringify(tut.connector));
check('…blank lines between paragraphs kept', /highlights\.\n\nTyping/.test(tut.hint || ''), JSON.stringify(tut.hint));
check('no tour by itself in a browser', !(await page.$('.tour-layer')));
await shot('tutorial');

// ---------- the ? menu ----------
await page.click('#help-menu [data-help-toggle]');
await page.waitForTimeout(100);
const items = await app(() => [...document.querySelectorAll('#help-menu .toolbar-menu [data-help]')].map(b => b.dataset.help));
check('the ? menu', await page.isVisible('#help-menu .toolbar-menu') && items.join() === 'tour,tutorial,shortcuts,glfile,format,guide', items.join());
const inWindow = await app(() => { const r = document.querySelector('#help-menu .toolbar-menu').getBoundingClientRect(); return r.right <= window.innerWidth && r.left >= 0; });
check('…inside the window', inWindow);
await shot('menu');

// ---------- the tour ----------
await page.click('#help-menu [data-help="tour"]');
await page.waitForTimeout(200);
check('the tour starts', await page.isVisible('.tour-card') && (await page.textContent('.tour-title')) === 'Welcome to GluonSlides');
await page.click('[data-tour="next"]');
await page.waitForTimeout(300);
const spot = await app(() => {
    const s = document.querySelector('.tour-spot').getBoundingClientRect();
    const t = document.querySelector('#slides-thumb-list').getBoundingClientRect();
    return Math.abs(s.left - (t.left - 6)) < 2 && Math.abs(s.width - (t.width + 12)) < 2;
});
check('…lights up the slides list', spot && (await page.textContent('.tour-title')) === 'Your slides');
await shot('tour');
let n = 0;
while (await page.$('.tour-layer') && n < 20) { await page.keyboard.press('ArrowRight'); await page.waitForTimeout(60); n += 1; }
check('…→ goes through all the steps to the end', !(await page.$('.tour-layer')) && n === 7, String(n));
await page.click('#help-menu [data-help-toggle]');
await page.click('#help-menu [data-help="tour"]');
await page.keyboard.press('Escape');
check('…Esc stops it', !(await page.$('.tour-layer')));

// ---------- keyboard shortcuts ----------
const selectTwo = () => app(async () => {
    const { state, setSelectedElementIndices } = await import('/core/state.js');
    state.slides = [{ id: 1, title: 'S', elements: [
        { type: 'shape', id: 5, x: 100, y: 100, width: 200, height: 100, bg: '#93c5fd' },
        { type: 'shape', id: 6, x: 400, y: 100, width: 200, height: 100, bg: '#fca5a5' },
    ] }];
    state.masters = [];
    (await import('/editor/editor.js')).selectSlide(0);
    setSelectedElementIndices([0, 1], 0);
    (await import('/editor/editor.js')).renderEditor();
    document.activeElement && document.activeElement.blur && document.activeElement.blur();
});
const groups = () => app(async () => (await import('/core/state.js')).state.slides[0].elements.filter(e => e.type === 'group').length);

await page.keyboard.press('Control+/');
await page.waitForTimeout(150);
check('Ctrl+/ opens the shortcuts', await page.isVisible('#shortcuts-modal .shortcuts-modal'));
const groupRow = '#shortcuts-modal [data-record="group"]';
check('…Group is Ctrl+G', (await page.textContent(groupRow)).includes('Ctrl+G'));
await page.click(groupRow);
await page.keyboard.press('Control+k');
await page.waitForTimeout(100);
check('…changed to Ctrl+K', (await page.textContent(groupRow)).includes('Ctrl+K') && await page.isVisible('#shortcuts-modal [data-reset="group"]'));
await page.keyboard.press('Escape');
check('…Esc closes it', !(await page.isVisible('#shortcuts-modal .shortcuts-modal')));

await selectTwo();
await page.keyboard.press('Control+g');
await page.waitForTimeout(100);
check('the old keys do nothing', await groups() === 0);
await page.keyboard.press('Control+k');
await page.waitForTimeout(150);
check('the new keys group', await groups() === 1);

// a key taken from another command moves
await page.keyboard.press('F1');
await page.waitForTimeout(100);
await page.click('#shortcuts-modal [data-record="lock"]');
await page.keyboard.press('Control+k');
await page.waitForTimeout(100);
const note = await page.textContent('.shortcuts-note');
check('a key another command has: moves, with a note', note.includes('was used by Group') && (await page.textContent(groupRow)).includes('none'), note);
await page.click('#shortcuts-modal [data-reset-all]');
check('Reset all', (await page.textContent(groupRow)).includes('Ctrl+G') && !(await page.textContent('#shortcuts-modal [data-record="lock"]')).includes('Ctrl+K'));
const kept = await app(() => JSON.parse(localStorage.getItem('gluonslides.prefs') || '{}').shortcuts);
check('…kept in the preferences', kept && Object.keys(kept).length === 0, JSON.stringify(kept));
await page.keyboard.press('Escape');

// the panes' buttons say their keys
check('pane buttons show the shortcut', (await page.getAttribute('[data-arg="slides"].pane-btn', 'title')).includes('Ctrl+Alt+1'));

// ---------- Ctrl+E: the .gl file ----------
await page.mouse.click(5, 880);
await page.keyboard.press('Control+e');
await page.waitForTimeout(300);
const open = await app(() => document.querySelector('#gl-inspector-drawer')?.classList.contains('open'));
check('Ctrl+E shows the .gl file', open);
await shot('glfile');
await app(() => document.activeElement && document.activeElement.blur());
await page.keyboard.press('Control+e');
await page.waitForTimeout(200);
check('…and hides it again', !(await app(() => document.querySelector('#gl-inspector-drawer')?.classList.contains('open'))));

console.log(out.join('\n'));
console.log('--- errors ---\n' + (errors.join('\n') || '(none)'));
await browser.close();
