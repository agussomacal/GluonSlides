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
await page.evaluate(async () => {
    await (await import('/ui/project.js')).createProject('C');
    const m = await import('/core/state.js'); m.state.gridSize = 0;
    const ed = await import('/editor/editor.js');
    ed.addElement('shape', 'rect');
    const e = m.state.slides[0].elements[0]; e.x = 100; e.y = 100;
    ed.addElement('text');
    const t = m.state.slides[0].elements[1]; t.x = 700; t.y = 100; t.content = 'Styled text';
    ed.addElement('text');
    const t2 = m.state.slides[0].elements[2]; t2.x = 700; t2.y = 500; t2.content = 'Plain text';
    m.setSelectedElementIndices([0], 0); ed.renderEditor();
});
const S = () => page.evaluate(async () => {
    const m = await import('/core/state.js');
    return { els: JSON.parse(JSON.stringify(m.state.slides[0].elements)), palette: m.state.palette, styles: JSON.parse(JSON.stringify(m.state.styles)), gl: m.serializeProject() };
});
const rectFill = () => page.$eval('#slide-canvas > .canvas-element .shape-fill', n => getComputedStyle(n).backgroundColor);

// --- Theme colors in the color field ---
await page.click('.color-field[data-prop="bg"]');
await page.waitForTimeout(100);
const chips = await page.$$eval('.color-popover [data-theme]', ns => ns.map(n => n.dataset.theme));
check('popover lists the theme colors', chips.join(',') === 'primary,secondary,accent,dark,muted,light', chips.join(','));
check('None, Custom and Opacity offered', await page.$('.color-popover [data-none]') && await page.$('.color-popover [data-custom]') && await page.$('.color-popover [data-alpha]'));
await page.click('.color-popover [data-theme="accent"]');
let st = await S();
check('theme color stored by name', st.els[0].bg === '@accent', st.els[0].bg);
check('canvas uses the theme color', (await rectFill()) === 'rgb(245, 158, 11)', await rectFill());
await page.screenshot({ path: `${OUT}/colorpicker.png`, clip: { x: 1000, y: 420, width: 400, height: 420 } });
await page.$eval('.color-popover [data-alpha]', r => { r.value = '40'; r.dispatchEvent(new Event('input', { bubbles: true })); });
st = await S();
check('opacity kept separately: @accent/40', st.els[0].bg === '@accent/40', st.els[0].bg);
check('canvas draws 40% opacity', (await rectFill()) === 'rgba(245, 158, 11, 0.4)', await rectFill());
check('field label shows it', (await page.textContent('.color-field[data-prop="bg"] .color-name')) === 'accent · 40%');
await page.fill('.color-popover [data-hex]', '#123456');
await page.press('.color-popover [data-hex]', 'Enter');
await page.$eval('.color-popover [data-hex]', h => h.dispatchEvent(new Event('change', { bubbles: true })));
st = await S();
check('custom color keeps the opacity', st.els[0].bg === '#123456/40', st.els[0].bg);
await page.click('.color-popover [data-theme="accent"]');
await page.keyboard.press('Escape');
check('Esc closes the popover', !(await page.$('.color-popover')));

// --- Colors tab: edit, rename, remove ---
await page.click('[data-action="open-project-settings"]');
await page.click('.settings-tab[data-tab="colors"]');
const usage = await page.$eval('.palette-row[data-index="2"] .palette-usage', n => n.textContent);
check('palette shows usage', usage === '1 use', usage);
await page.$eval('.palette-row[data-index="2"] [data-palette-color]', i => { i.value = '#22c55e'; i.dispatchEvent(new Event('input', { bubbles: true })); });
check('changing a theme color updates its uses', (await rectFill()) === 'rgba(34, 197, 94, 0.4)', await rectFill());
await page.fill('.palette-row[data-index="2"] [data-palette-name]', 'highlight');
await page.$eval('.palette-row[data-index="2"] [data-palette-name]', i => i.dispatchEvent(new Event('change', { bubbles: true })));
st = await S();
check('rename updates references', st.els[0].bg === '@highlight/40' && st.palette[2].name === 'highlight', st.els[0].bg);
check('.gl has the palette + reference', /^\.palette primary:#1d4ed8 secondary:#0f766e highlight:#22c55e dark:#0f172a muted:#64748b light:#f1f5f9$/m.test(st.gl) && st.gl.includes('bg:@highlight/40'));
await page.click('[data-settings-action="add-color"]');
st = await S();
check('add color', st.palette.length === 7 && st.palette[6].name === 'color7');
await page.click('.palette-row[data-index="2"] [data-palette-remove]');
st = await S();
check('remove keeps the look (reference -> its color)', st.els[0].bg === '#22c55e/40' && !st.palette.some(p => p.name === 'highlight'), st.els[0].bg);

// --- Styles ---
await page.click('[data-settings-action="close"]');
await page.evaluate(async () => { const m = await import('/core/state.js'); m.setSelectedElementIndices([1], 1); (await import('/editor/editor.js')).renderEditor(); });
check('Style dropdown in the panel', await page.$('[data-prop="style"]') !== null);
await page.fill('[data-prop="fontSize"]', '56');
await page.click('[data-action="style-from-element"]');
await page.waitForTimeout(150);
st = await S();
check('＋ makes a style from the element', st.styles.text && st.styles.text['text-style1'] && st.styles.text['text-style1'].fontSize === 56 && st.els[1].style === 'text-style1' && st.els[1].fontSize === undefined, JSON.stringify([st.styles, st.els[1].style, st.els[1].fontSize]));
check('settings open on the new style', await page.isVisible('.settings-tab.active[data-tab="styles"]') && (await page.inputValue('[data-rename-style]')) === 'text-style1');
await page.fill('[data-rename-style]', 'title');
await page.$eval('[data-rename-style]', i => i.dispatchEvent(new Event('change', { bubbles: true })));
st = await S();
check('rename style updates its elements', st.els[1].style === 'title' && st.styles.text.title);
await page.click('#project-settings-modal .color-field[data-style-field="fontColor"]');
await page.click('.color-popover [data-theme="primary"]');
await page.keyboard.press('Escape');
await page.fill('#project-settings-modal [data-style-field="fontSize"]', '64');
await page.waitForTimeout(100);
await page.screenshot({ path: `${OUT}/styles-tab.png` });
const sizes = await page.$$eval('#slide-canvas .element-text', ns => ns.map(n => [getComputedStyle(n).fontSize, getComputedStyle(n).color]));
check('style applies to its element only', sizes[0][0] === '64px' && sizes[0][1] === 'rgb(29, 78, 216)' && sizes[1][0] === '32px', JSON.stringify(sizes));
await page.click('[data-settings-action="close"]');
await page.evaluate(async () => (await import('/editor/editor.js')).renderEditor());
const tag = await page.$eval('[data-prop="fontSize"]', c => c.closest('.prop-group').querySelector('.prop-default-tag')?.textContent);
check('panel tag says where the value comes from', tag === 'title', tag);
await page.fill('[data-prop="fontSize"]', '80');
check('element override beats its style', (await page.$$eval('#slide-canvas .element-text', ns => getComputedStyle(ns[0]).fontSize)) === '80px');
await page.click('[data-reset-prop="fontSize"]');
check('↺ returns to the style', (await page.$$eval('#slide-canvas .element-text', ns => getComputedStyle(ns[0]).fontSize)) === '64px');

// File format + round-trip
st = await S();
check('.gl: style definition + use', /^\.style\.text \{title\} fontSize:64 fontColor:@primary$/m.test(st.gl) && /^\.element\.text id:\d+ style:title x:/m.test(st.gl), st.gl.split('\n').filter(l => /^\.style|style:/.test(l)).join(' | '));
const rt = await page.evaluate(async (gl) => { const f = await import('/core/gl/glformat.js'); const p = f.parseGl(gl); return f.serializeGl({ ...p, projectName: p.name }) === gl; }, st.gl);
check('round-trip stable', rt);

// Export resolves colors/styles
const exp = await page.evaluate(async () => {
    const { exportElementMarkup } = await import('/core/render.js'); const m = await import('/core/state.js');
    return m.state.slides[0].elements.map(exportElementMarkup).join('');
});
check('export: resolved opacity color', exp.includes('rgba(34, 197, 94, 0.40)'), exp.slice(0, 160));
check('export: style values', exp.includes('font-size:64px') && exp.includes('color:#1d4ed8'));

// Delete style -> falls back
await page.evaluate(async () => { const d = await import('/core/defaults.js'); d.deleteStyle('text', 'title'); });
st = await S();
check('deleting a style clears its uses', st.els[1].style === undefined);

// Undo a palette change
await page.evaluate(async () => {
    const m = await import('/core/state.js'); const c = await import('/core/colors.js');
    m.markDirty();
    c.setPalette(c.palette().map(p => p.name === 'primary' ? { ...p, color: '#000000' } : p)); m.markDirty();
});
await page.evaluate(() => document.activeElement && document.activeElement.blur());
await page.keyboard.press('Control+z');
st = await S();
check('undo covers palette changes', st.palette.find(p => p.name === 'primary').color === '#1d4ed8');

// Autocomplete
await page.click('#slide-canvas .element-text >> nth=1', { button: 'right' });
await page.click('#gl-context-menu button');
await page.waitForTimeout(300);
await page.evaluate(() => { const cm = document.querySelector('.CodeMirror').CodeMirror; cm.focus(); cm.setCursor({ line: cm.lineCount() - 1, ch: 0 }); });
await page.keyboard.type('.element.shape bg:@');
await page.waitForTimeout(150);
const h = await page.$$eval('.CodeMirror-hint', ns => ns.map(n => n.textContent));
check('autocomplete offers theme colors', h.includes('@primary') && h.includes('@accent') === false, h.join(','));

console.log(out.join('\n'));
console.log('--- errors ---\n' + (errors.join('\n') || '(none)'));
await browser.close();
