import { launchBrowser, BASE_URL, OUT_DIR, FIXTURES_DIR, REPO_DIR } from '../helpers.mjs';
const OUT = OUT_DIR;
const browser = await launchBrowser();
const page = await browser.newPage({ viewport: { width: 1400, height: 950 } });
const errors = [];
page.on('pageerror', e => errors.push('pageerror: ' + e.message));
page.on('console', m => { if (m.type() === 'error' && !m.text().includes('404')) errors.push('console: ' + m.text()); });
page.on('dialog', d => { errors.push('dialog: ' + d.message()); d.dismiss(); });
const out = [];
const check = (n, c, x = '') => out.push(`${c ? 'PASS' : 'FAIL'} ${n}${x !== '' ? ' — ' + x : ''}`);
await page.goto(`${BASE_URL}/index.html`);
await page.waitForTimeout(400);
await page.evaluate(async () => (await import('/ui/project.js')).createProject('D'));
const S = () => page.evaluate(async () => {
    const m = await import('/core/state.js');
    return { els: JSON.parse(JSON.stringify(m.state.slides[0].elements)), defaults: JSON.parse(JSON.stringify(m.state.defaults)), gl: m.serializeProject() };
});
const canvasText = () => page.evaluate(() => {
    const t = document.querySelector('#slide-canvas .element-text');
    const p = t.querySelector('p') || t;
    return { font: getComputedStyle(p).fontFamily, size: getComputedStyle(t).fontSize };
});

// 1. New text box stores no style -> inherits
await page.click('[data-type="text"]');
let st = await S();
check('new text box stores no style values', st.els[0].fontFamily === undefined && st.els[0].fontSize === undefined && st.els[0].fontColor === undefined, JSON.stringify(Object.keys(st.els[0])));
check('panel marks inherited fields', (await page.$$('#properties-body .prop-default-tag')).length >= 5);
check('still drawn with built-in values', (await canvasText()).size === '32px', JSON.stringify(await canvasText()));

// 2. Project settings: font + size
await page.click('[data-action="open-project-settings"]');
check('settings dialog opens', await page.isVisible('#project-settings-modal.show'));
await page.click('#project-settings-modal [data-default="text.fontFamily"]');
await page.keyboard.type('garamond');
await page.keyboard.press('Enter');
await page.waitForTimeout(150);
await page.fill('#project-settings-modal [data-default="text.fontSize"]', '40');
await page.waitForTimeout(200);
st = await S();
check('defaults stored', st.defaults.text && st.defaults.text.fontFamily === 'EB Garamond' && st.defaults.text.fontSize === 40, JSON.stringify(st.defaults));
const ct = await canvasText();
check('text box follows the new defaults', ct.font.includes('EB Garamond') && ct.size === '40px', JSON.stringify(ct));
check('element still stores nothing', st.els[0].fontFamily === undefined && st.els[0].fontSize === undefined);
check('.gl header has .defaults.text', /^\.defaults\.text fontFamily:"EB Garamond" fontSize:40$/m.test(st.gl), st.gl.split('\n').find(l => l.startsWith('.defaults')));
check('licence notice in the dialog', (await page.textContent('#project-settings-modal .font-license')).includes('Open licence'));
check('↺ shown for overridden defaults', (await page.$$('#project-settings-modal [data-unset]')).length === 2);
await page.screenshot({ path: `${OUT}/settings.png` });
await page.click('[data-settings-action="close"]');

// 3. Element override + reset
await page.click('#slide-canvas .canvas-element');
await page.fill('[data-prop="fontSize"]', '60');
st = await S();
check('element override stored', st.els[0].fontSize === 60);
check('↺ next to the overridden field', await page.$('[data-reset-prop="fontSize"]') !== null);
await page.evaluate(async () => {
    const d = await import('/core/defaults.js'); d.setProjectDefault('text', 'fontSize', 44);
    (await import('/editor/editor.js')).renderEditor();
});
check('override wins over the default', (await canvasText()).size === '60px');
await page.click('[data-reset-prop="fontSize"]');
st = await S();
check('↺ returns to the default', st.els[0].fontSize === undefined && (await canvasText()).size === '44px', JSON.stringify(await canvasText()));

// 4. Shapes + lines
await page.click('[data-category="shapes"] > .toolbar-btn');
await page.click('[data-category="shapes"] .toolbar-menu button:has-text("Rectangle")');
await page.click('[data-category="shapes"] > .toolbar-btn');
await page.click('[data-category="shapes"] .toolbar-menu button:has-text("Dot")');
await page.evaluate(async () => {
    const d = await import('/core/defaults.js'); d.setProjectDefault('shape', 'bg', '#fde68a'); d.setProjectDefault('path', 'stroke', '#dc2626');
    const m = await import('/core/state.js');
    m.state.slides[0].elements.push({ type: 'path', id: m.allocateElementId(), x: 100, y: 800, width: 400, height: 1, points: [[0, .5], [1, .5]] });
    (await import('/editor/editor.js')).renderEditor();
});
const fills = await page.$$eval('#slide-canvas .shape-fill', ns => ns.map(n => n.style.backgroundColor));
check('rectangle follows shape default; dot keeps its own fill', fills[0] === 'rgb(253, 230, 138)' && fills[1] !== fills[0], JSON.stringify(fills));
const stroke = await page.$eval('#slide-canvas .element-path svg path', p => p.getAttribute('stroke'));
check('line follows the stroke default', stroke === '#dc2626', stroke);

// 5. Undo a defaults change made in the dialog
await page.evaluate(async () => { const m = await import('/core/state.js'); m.markDirty(); }); // checkpoint
await page.click('[data-action="open-project-settings"]');
await page.evaluate(() => { const c = document.querySelector('#project-settings-modal [data-default="path.stroke"]'); c.value = '#16a34a'; c.dispatchEvent(new Event('change', { bubbles: true })); });
await page.click('[data-settings-action="close"]');
st = await S();
const strokeSet = st.defaults.path.stroke;
await page.evaluate(() => document.activeElement && document.activeElement.blur());
await page.keyboard.press('Control+z');
st = await S();
check('undo reverts a defaults change', strokeSet === '#16a34a' && st.defaults.path.stroke === '#dc2626', `${strokeSet} -> ${st.defaults.path && st.defaults.path.stroke}`);

// 6. Round-trip + export
st = await S();
const rt = await page.evaluate(async (gl) => {
    const f = await import('/core/gl/glformat.js'); const p = f.parseGl(gl);
    return { same: f.serializeGl({ ...p, projectName: p.name }) === gl, defaults: p.defaults };
}, st.gl);
check('.gl round-trips with defaults', rt.same, JSON.stringify(rt.defaults));
const html = await page.evaluate(async () => (await import('/export/html.js')).getExportHtmlString());
check('export embeds the default font', html.includes('font-family: "EB Garamond"; src: url("data:font/woff2'));
check('exported text uses the default', html.includes("font-family:'EB Garamond', serif"));

// 7. Older project: explicit built-in values -> adopt
await page.evaluate(async () => {
    const m = await import('/core/state.js');
    m.state.slides[0].elements.push({ type: 'text', id: m.allocateElementId(), x: 900, y: 300, width: 500, height: 120, content: 'Old style',
        fontSize: 32, fontFamily: 'sans-serif', fontColor: '#0f172a', textAlign: 'center', verticalAlign: 'center', bg: 'transparent', borderCol: 'transparent', borderWidth: 0, borderStyle: 'solid' },
      { type: 'text', id: m.allocateElementId(), x: 900, y: 500, width: 500, height: 120, content: 'Custom', fontSize: 72, fontFamily: 'Inter', fontColor: '#0f172a', textAlign: 'center', verticalAlign: 'center', bg: 'transparent', borderCol: 'transparent', borderWidth: 0, borderStyle: 'solid' });
    (await import('/editor/editor.js')).renderEditor();
});
await page.click('[data-action="open-project-settings"]');
await page.click('[data-settings-action="adopt"]');
st = await S();
const old = st.els.find(e => e.content === 'Old style');
const custom = st.els.find(e => e.content === 'Custom');
check('adopt: standard values now inherited', old.fontSize === undefined && old.fontFamily === undefined && old.fontColor === undefined, JSON.stringify(old));
check('adopt: deliberate values kept', custom.fontSize === 72 && custom.fontFamily === 'Inter', JSON.stringify(custom));
check('adopt reports what it did', (await page.textContent('.settings-result')).includes('removed'));
await page.keyboard.press('Escape');
check('Esc closes the dialog', !(await page.isVisible('#project-settings-modal.show')));

// 8. Inside a macro definition the defaults apply too
await page.evaluate(async () => {
    const mac = await import('/core/macros.js'); const m = await import('/core/state.js');
    mac.applyLibraryText('macros.gl', '.define {tag} width:300 height:100\n\t.element.text name:label x:0 y:0 width:300 height:100\n\t\tTag\n');
    m.state.slides[0].elements.push({ type: 'macro', id: m.allocateElementId(), ref: 'tag', x: 100, y: 500, width: 300, height: 100, overrides: [], extras: [] });
    (await import('/editor/editor.js')).renderEditor();
});
const macroFont = await page.evaluate(() => {
    const t = document.querySelector('#slide-canvas .element-macro .element-text');
    return getComputedStyle(t.querySelector('p') || t).fontFamily;
});
check('macro contents inherit the project font', macroFont.includes('EB Garamond'), macroFont);

// 9. Autocomplete knows .defaults
await page.click('#slide-canvas .element-macro', { button: 'right' });
await page.click('#gl-context-menu button');
await page.waitForTimeout(300);
await page.evaluate(() => { const cm = document.querySelector('.CodeMirror').CodeMirror; cm.focus(); cm.setCursor({ line: cm.lineCount() - 1, ch: 0 }); });
await page.keyboard.type('.defaults.sh');
await page.waitForTimeout(120);
await page.keyboard.press('Enter');
await page.keyboard.type('bor');
await page.waitForTimeout(120);
const hints = await page.$$eval('.CodeMirror-hint', ns => ns.map(n => n.textContent));
check('autocomplete: .defaults.shape params', hints.join(',') === 'borderCol,borderWidth,borderStyle', hints.join(','));

console.log(out.join('\n'));
console.log('--- errors ---\n' + (errors.join('\n') || '(none)'));
await browser.close();
