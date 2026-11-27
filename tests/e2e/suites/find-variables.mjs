// Find (Ctrl+F, ui/find.js) over the project's .gl text, and variables in
// code: coloured in the source view (\var{…} in text, names in plot
// bodies), Ctrl+click on one goes to its definition (a slider, a file, a
// written value), suggestions while typing a plot formula there.
import { launchBrowser, BASE_URL } from '../helpers.mjs';

const browser = await launchBrowser();
const page = await browser.newPage({ viewport: { width: 1400, height: 1000 } });
const errors = [];
page.on('pageerror', e => errors.push(e.message));
const out = [];
const check = (n, c, x = '') => out.push(`${c ? 'PASS' : 'FAIL'} ${n}${x !== '' ? ' — ' + JSON.stringify(x) : ''}`);
const app = (fn, arg) => page.evaluate(fn, arg);

const GL = `.project {Find} version:2 width:1920 height:1080 grid:0 nextid:80
.vars alpha:0.05 Banana:3
.master {Main} id:70
.element.text id:71 x:10 y:1000 width:400 height:60 fontSize:20
	footer banana

.slide {One} id:1
.element.text id:2 x:100 y:100 width:800 height:100 fontSize:40
	The error is \\var{alpha} here
.element.slider id:3 x:100 y:900 width:600 height:70 var:mu min:-3 max:3 step:0.1 value:0
.slide {Two} id:4
.element.group id:5 x:100 y:300 width:800 height:300 frameWidth:800 frameHeight:300
	.element.text id:6 x:0 y:0 width:800 height:100 fontSize:40
		A banana inside a group
.element.plot id:7 x:900 y:100 width:900 height:700 lang:python xmin:-5 xmax:5
	.vline x:mu
	.curve
	y = exp(-(x - mu)**2 / 2) * alpha
`;
await page.goto(`${BASE_URL}/index.html`);
await app(async (gl) => {
    await (await import('/ui/project.js')).openSampleProject();
    const { state, applyProjectData, parseProjectContent } = await import('/core/state.js');
    applyProjectData(parseProjectContent(gl));
    (await import('/editor/editor.js')).selectSlide(0);
}, GL);
await page.waitForTimeout(300);
const where = () => app(async () => {
    const { state, activeElements } = await import('/core/state.js');
    const el = activeElements()[state.selectedElementIndex];
    return { slide: state.currentSlideIndex, master: state.editingMasterIndex, group: state.editingGroupId, el: el ? el.id : null };
});

// ---------- find ----------
await page.mouse.click(700, 980);
await page.keyboard.press('Control+f');
await page.waitForTimeout(100);
check('Ctrl+F opens the find bar', await page.isVisible('.find-bar input[type=text]'));
await page.keyboard.type('banana');
await page.waitForTimeout(400);
let count = await page.textContent('.find-count');
let w = await where();
check('matches counted (case-insensitive: the vars line, the master, the group)', count === '1 / 3', count);
check('…the first one, Banana:3 in .vars: the source view opens at it', await app(() => document.querySelector('#gl-inspector-drawer')?.classList.contains('open')) && await app(() => { const cm = document.querySelector('.gl-code-editor .CodeMirror').CodeMirror; return cm.getSelection(); }) === 'Banana', w);
await page.keyboard.press('Enter');
await page.waitForTimeout(200);
w = await where();
check('Enter: next — the master slide\'s footer, selected', w.master === 0 && w.el === 71, w);
check('…with where it is', (await page.textContent('.find-where')).includes('master “Main”'));
await page.keyboard.press('Enter');
await page.waitForTimeout(200);
w = await where();
check('next: the text inside a group on slide Two (the group entered, the text selected)', w.slide === 1 && w.group === 5 && w.el === 6 && w.master === null, w);
check('…flashed on the canvas', await app(() => !!document.querySelector('#slide-canvas .find-flash')));
await page.keyboard.press('Shift+Enter');
await page.waitForTimeout(200);
check('Shift+Enter: back to the master', (await where()).el === 71);
await page.click('.find-case input');
await page.waitForTimeout(300);
count = await page.textContent('.find-count');
check('Aa: case-sensitive (banana twice)', count === '1 / 2', count);
await page.keyboard.press('Escape');
check('Esc closes it', !(await page.isVisible('.find-bar')));

// ---------- variables in the source view ----------
await app(async () => (await import('/editor/editor.js')).leaveMaster());
const colours = await app(async () => {
    const cm = document.querySelector('.gl-code-editor .CodeMirror').CodeMirror;
    cm.refresh();
    const tokens = [];
    for (let l = 0; l < cm.lineCount(); l++) cm.getLineTokens(l).forEach(t => { if (t.type && t.type.includes('gl-var')) tokens.push([l, t.string]); });
    return { tokens, text: cm.getValue() };
});
const lineOf = (s) => colours.text.split('\n').findIndex(l => l.includes(s));
const marked = (s, name) => colours.tokens.some(([l, t]) => l === lineOf(s) && t === name);
check('\\var{alpha} in a text: alpha coloured as a variable', marked('The error is', 'alpha'), colours.tokens);
check('in a plot: x:mu and the formula\'s mu, alpha coloured; exp and x not', marked('.vline x:mu', 'mu') && marked('y = exp(', 'mu') && marked('y = exp(', 'alpha') && !colours.tokens.some(([, t]) => t === 'exp' || t === 'x'), colours.tokens);

// suggestions while typing a plot formula in the source view
await app(() => {
    const cm = document.querySelector('.gl-code-editor .CodeMirror').CodeMirror;
    const line = cm.getValue().split('\n').findIndex(l => l.includes('y = exp('));
    cm.focus();
    cm.setCursor({ line, ch: cm.getLine(line).length });
});
await page.keyboard.type(' + al', { delay: 40 });
await page.waitForTimeout(250);
const hints = await app(() => [...document.querySelectorAll('.CodeMirror-hints li')].map(li => li.textContent));
await page.keyboard.press('Escape');
for (let k = 0; k < 5; k++) await page.keyboard.press('Backspace');
await page.waitForTimeout(1500); // the source view applies the typed text a moment later
check('source view: typing in a plot formula suggests the variables', hints.some(h => h.startsWith('alpha')), hints);

// Ctrl+click on mu in the source view: its slider
await app(async () => { const m = await import('/core/state.js'); (await import('/editor/editor.js')).selectSlide(1); m.setEditingGroup(null); m.setSelectedElementIndices([], null); (await import('/editor/editor.js')).renderEditor(); });
await page.waitForTimeout(400); // the source view follows the selection: let it settle
// click the coloured mu itself on the .vline line (Playwright scrolls it into view)
await page.locator('.gl-code-editor .CodeMirror-line', { hasText: '.vline x:mu' }).locator('.cm-gl-var').first().click({ modifiers: ['Control'] });
await page.waitForTimeout(250);
w = await where();
check('Ctrl+click on mu in the source view: the slider, on its slide, selected', w.slide === 0 && w.el === 3, w);

// Ctrl+click in a plot's formula editor: alpha, a written value -> Project settings, its row
await app(async () => (await import('/editor/inspector/index.js')).closeGlInspector());
await app(async () => {
    const { state, setSelectedElementIndices } = await import('/core/state.js');
    (await import('/editor/editor.js')).selectSlide(1);
    setSelectedElementIndices([1], 1);
    (await import('/editor/editor.js')).renderEditor();
});
await page.waitForTimeout(150);
await page.click('[data-layer-toggle="1"]');
await page.waitForTimeout(250);
const apos = await app(() => {
    const cm = document.querySelector('[data-layer-card="1"] .CodeMirror').CodeMirror;
    cm.getWrapperElement().scrollIntoView({ block: 'center' });
    const ch = cm.getLine(0).indexOf('alpha') + 2;
    const c = cm.charCoords({ line: 0, ch }, 'window');
    return { x: c.left, y: (c.top + c.bottom) / 2 };
});
await page.keyboard.down('Control');
await page.mouse.click(apos.x, apos.y);
await page.keyboard.up('Control');
await page.waitForTimeout(300);
check('Ctrl+click in a formula editor on a written value: Project settings → Variables, its row', await page.isVisible('#project-settings-modal.show') && await app(() => !!document.querySelector('[data-var-name="alpha"].find-flash')));
// from the All variables table: a slider row goes to the slider
await page.click('[data-settings-action="var-goto"][data-var="mu"]');
await page.waitForTimeout(250);
w = await where();
check('…and from the table, "a slider" shows that slider', !(await page.isVisible('#project-settings-modal.show')) && w.el === 3, w);

// Ctrl+F is a changeable shortcut
check('Find is in Keyboard shortcuts', await app(async () => (await import('/core/shortcuts.js')).COMMANDS.some(c => c.id === 'find' && c.keys.includes('Ctrl+F'))));

console.log(out.join('\n'));
console.log('--- errors ---\n' + (errors.join('\n') || '(none)'));
await browser.close();
