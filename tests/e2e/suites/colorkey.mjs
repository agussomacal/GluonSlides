// The colour key (elements/colorkey) and colour formulas: keys with
// colours (theme colours in order, or set by hand), its variable
// (runcol.adam, runcol.shown), a clickable legend, plots with colors:runcol
// and show:"=runcol.shown", objects with bg:"=runcol[pick]", palette() and
// cmap(); the panel; the .gl file; the exported HTML.
import { launchBrowser, BASE_URL } from '../helpers.mjs';

const browser = await launchBrowser();
const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
const errors = [];
page.on('pageerror', e => errors.push(e.message));
const out = [];
const check = (n, c, x = '') => out.push(`${c ? 'PASS' : 'FAIL'} ${n}${x !== '' ? ' — ' + JSON.stringify(x) : ''}`);
const app = (fn, arg) => page.evaluate(fn, arg);

await page.goto(`${BASE_URL}/index.html`);
await page.waitForTimeout(300);

const GL = `.slide {Colours} id:1
.element.colorkey id:2 var:runcol keys:"adam, sgd, ngd" x:1500 y:100 width:320 height:220 fontSize:26
	sgd: #000000
.element.choice id:3 var:pick options:"adam, sgd, ngd" value:adam x:100 y:950 width:460 height:70
.element.shape id:4 bg:"=runcol[pick]" x:1500 y:600 width:200 height:150
.element.plot id:5 x:100 y:100 width:1200 height:700 lang:python xmin:0 xmax:3 ymin:0 ymax:3
	.line group:run colors:runcol show:"=runcol.shown"
	run, step, loss
	adam, 1, 1
	adam, 2, 2
	sgd, 1, 2
	sgd, 2, 1
	ngd, 1, 0.5
	ngd, 2, 0.7
.element.shape id:6 bg:"=cmap(0.5, 0, 1, 'gray')" borderCol:"=palette(1)" borderWidth:6 x:1750 y:600 width:100 height:100
`;
await app(async (gl) => {
    await (await import('/ui/project.js')).openSampleProject();
    const { applyProjectData, parseProjectContent, state } = await import('/core/state.js');
    applyProjectData(parseProjectContent(gl));
    state.gridSize = 0;
    (await import('/editor/editor.js')).selectSlide(0);
}, GL);
await page.waitForTimeout(400);

const info = await app(async () => {
    const V = await import('/core/variables.js');
    const { palette, resolveColor } = await import('/core/colors.js');
    const pal = palette().map(p => resolveColor(p.color) || p.color);
    const v = V.allVariables();
    return { adam: v['runcol.adam'], sgd: v['runcol.sgd'], ngd: v['runcol.ngd'], shown: v['runcol.shown'], pal };
});
check('a colour key: each key a theme colour in its place, or the one set by hand', info.adam === info.pal[0] && info.sgd === '#000000' && info.ngd === info.pal[2 % info.pal.length], info);
check('…and the keys on (all at the start)', JSON.stringify(info.shown) === '["adam","sgd","ngd"]', info.shown);

const legend = () => app(() => [...document.querySelectorAll('#slide-canvas [data-element-id="2"] [data-glkey]')].map(k => `${k.dataset.glkey}${k.classList.contains('off') ? ':off' : ''}`));
check('the legend on the slide: a key each', JSON.stringify(await legend()) === '["adam","sgd","ngd"]', await legend());
const strokes = () => app(() => [...document.querySelectorAll('#slide-canvas [data-element-id="5"] svg path[stroke-linejoin]')].map(p => p.getAttribute('stroke')));
check('a plot with colors:runcol: each run its key\'s colour', JSON.stringify(await strokes()) === JSON.stringify([info.adam, '#000000', info.ngd]), await strokes());
const fill = (id) => app((id) => getComputedStyle(document.querySelector(`#slide-canvas [data-element-id="${id}"] .shape-fill`)).backgroundColor, id);
const rgb = (hex) => { const n = parseInt(hex.slice(1), 16); return `rgb(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255})`; };
check('a shape with bg:"=runcol[pick]": the colour of the run picked (adam)', (await fill(4)) === rgb(info.adam), await fill(4));
check('cmap() and palette() in colour formulas', (await fill(6)) === 'rgb(128, 128, 128)' && (await app(() => getComputedStyle(document.querySelector('#slide-canvas [data-element-id="6"] .shape-fill')).borderTopColor)) === rgb(info.pal[1 % info.pal.length]), await fill(6));

// the legend: a first click selects it, then a click on a key turns it off
await page.click('#slide-canvas [data-element-id="2"]', { position: { x: 3, y: 3 } });
await page.waitForTimeout(150);
await page.click('#slide-canvas [data-element-id="2"] [data-glkey="sgd"]');
await page.waitForTimeout(250);
check('clicking a key: off in the legend', JSON.stringify(await legend()) === '["adam","sgd:off","ngd"]', await legend());
check('…its line hidden in the plot (show:"=runcol.shown")', JSON.stringify(await strokes()) === JSON.stringify([info.adam, info.ngd]), await strokes());
await page.click('#slide-canvas [data-element-id="2"] [data-glkey="sgd"]');
await page.waitForTimeout(250);
check('…clicked again: back', (await strokes()).length === 3);

// the choice picks another run: the shape takes its colour
await page.click('#slide-canvas [data-element-id="3"]', { position: { x: 3, y: 3 } });
await page.waitForTimeout(150);
await page.selectOption('#slide-canvas [data-element-id="3"] select', 'ngd');
await page.waitForTimeout(250);
check('choosing ngd: the shape turns ngd\'s colour', (await fill(4)) === rgb(info.ngd), await fill(4));

// ---------- the panel ----------
await app(async () => {
    const { setSelectedElementIndices } = await import('/core/state.js');
    (await import('/core/variables.js')).resetLiveValues();
    setSelectedElementIndices([0], 0);
    (await import('/editor/editor.js')).renderEditor();
});
await page.waitForTimeout(200);
const keysOf = () => app(async () => (await import('/core/state.js')).state.slides[0].elements[0].entries);
await page.click('[data-ck-op="down"][data-i="0"]');
await page.waitForTimeout(150);
check('↓: adam after sgd (the order written, sgd keeps its colour)', (await keysOf()) === 'sgd: #000000\nadam\nngd', await keysOf());
const afterMove = await app(async () => { const v = (await import('/core/variables.js')).allVariables(); return [v['runcol.adam'], v['runcol.ngd']]; });
check('…adam now takes the second theme colour', afterMove[0] === info.pal[1 % info.pal.length], afterMove);
await page.click('[data-ck-op="reset"]');
await page.waitForTimeout(150);
check('↺ Palette order: no order or colour written', (await keysOf()) === '', await keysOf());
await page.click('[data-ck-op="shuffle"]');
await page.waitForTimeout(150);
const shuffled = (await keysOf()).split('\n');
check('🔀 Shuffle: every key, in some order, no colour set by hand', shuffled.length === 3 && ['adam', 'sgd', 'ngd'].every(k => shuffled.includes(k)), shuffled);

// ---------- the file ----------
const gl = await app(async () => (await import('/core/state.js')).serializeProject());
check('.gl: the colour key with its body; bg:"=runcol[pick]" written as a formula', /\.element\.colorkey id:2 [^\n]*var:runcol[^\n]*keys:"adam, sgd, ngd"/.test(gl) && gl.includes('bg:"=runcol[pick]"') && gl.includes('colors:runcol'), gl.split('\n').filter(l => /colorkey|runcol/.test(l)));
const reread = await app(async (text) => {
    const { parseProjectContent } = await import('/core/state.js');
    const data = parseProjectContent(text);
    const shape = data.slides[0].elements.find(e => e.id === 4);
    return { formulas: shape.formulas, bg: shape.bg };
}, gl);
check('…read back: the formula kept (not a colour)', reread.formulas && reread.formulas.bg === 'runcol[pick]', reread);

// Follow a variable on a shape: its colours listed
await app(async () => { const { state } = await import('/core/state.js'); (await import('/ui/followVariable.js')).openFollow(state.slides[0].elements.find(e => e.id === 4), { x: 300, y: 200 }); });
await page.waitForTimeout(100);
const followRows = await app(() => [...document.querySelectorAll('.follow-item span:first-child')].map(s => s.textContent));
check('Follow a variable… on a shape: its colours too', followRows.includes('Fill colour') && followRows.includes('Border colour'), followRows);
await page.keyboard.press('Escape');

// ---------- the colour picker: ƒ Follow a variable ----------
await app(async () => {
    const { state, setSelectedElementIndices } = await import('/core/state.js');
    const i = state.slides[0].elements.findIndex(e => e.id === 4);
    setSelectedElementIndices([i], i);
    (await import('/editor/editor.js')).renderEditor();
});
await page.waitForTimeout(200);
const bgField = await app(() => document.querySelector('#properties-body .color-field[data-prop="bg"] .color-name')?.textContent.trim());
check('a shape\'s fill given by a formula: its field says so (ƒ runcol[pick])', bgField === 'ƒ runcol[pick]', bgField);
await page.click('#properties-body .color-field[data-prop="bg"]');
await page.waitForTimeout(150);
const pop = await app(() => ({ title: [...document.querySelectorAll('#color-popover .color-pop-title')].map(t => t.textContent.trim()), chips: [...document.querySelectorAll('#color-popover [data-follow]')].map(c => c.dataset.follow), input: document.querySelector('#color-popover [data-color-follow]')?.value }));
check('…its picker: ƒ Follow a variable, the colour key\'s colours, the formula', pop.title.includes('ƒ Follow a variable') && JSON.stringify([...pop.chips].sort()) === `["=runcol['adam']","=runcol['ngd']","=runcol['sgd']"]` && pop.input === '=runcol[pick]', pop);
await page.click(`#color-popover [data-follow="=runcol['ngd']"]`);
await page.waitForTimeout(200);
const shapeF = await app(async () => (await import('/core/state.js')).state.slides[0].elements.find(e => e.id === 4).formulas);
check('…a click on ngd\'s colour: bg:"=runcol[\'ngd\']"', shapeF && shapeF.bg === "runcol['ngd']", shapeF);
await page.keyboard.press('Escape');
// a plot layer's colour, from the picker
await app(async () => {
    const { state, setSelectedElementIndices } = await import('/core/state.js');
    const p = state.slides[0].elements.find(e => e.id === 5);
    p.code = '.curve\ny = x';
    const i = state.slides[0].elements.indexOf(p);
    setSelectedElementIndices([i], i);
    (await import('/editor/editor.js')).renderEditor();
});
await page.waitForTimeout(250);
await page.click('#properties-body .color-field[data-layer-field="color"]');
await page.waitForTimeout(150);
await page.click(`#color-popover [data-follow="=runcol['sgd']"]`);
await page.waitForTimeout(250);
const layerCode = await app(async () => (await import('/core/state.js')).state.slides[0].elements.find(e => e.id === 5).code);
check('a plot layer\'s colour from the picker: color:"=runcol[\'sgd\']"', layerCode.startsWith(`.curve color:"=runcol['sgd']"`), layerCode);
const curveStroke = await app(async () => ({ drawn: document.querySelector('#slide-canvas [data-element-id="5"] svg path[stroke-linejoin]')?.getAttribute('stroke'), sgd: (await import('/core/variables.js')).allVariables()['runcol.sgd'] }));
check('…drawn in sgd\'s colour', curveStroke.drawn === curveStroke.sgd, curveStroke);
const layerField = await app(() => document.querySelector('#properties-body .color-field[data-layer-field="color"] .color-name')?.textContent.trim());
check('…its field: ƒ runcol[\'sgd\']', layerField === "ƒ runcol['sgd']", layerField);
await page.keyboard.press('Escape');
// Colours from: the colour keys
await app(async () => {
    const { state } = await import('/core/state.js');
    state.slides[0].elements.find(e => e.id === 5).code = '.line group:run colors:runcol show:"=runcol.shown"\nrun, step, loss\nadam, 1, 1\nadam, 2, 2\nsgd, 1, 2\nsgd, 2, 1\nngd, 1, 0.5\nngd, 2, 0.7';
    state.slides[0].elements.find(e => e.id === 4).formulas.bg = 'runcol[pick]';
    (await import('/editor/editor.js')).renderEditor();
});
await page.waitForTimeout(250);
const colorsFrom = await app(() => [...document.querySelectorAll('#properties-body select[data-layer-field="colors"] option')].map(o => `${o.textContent.trim()}${o.selected ? '*' : ''}`));
check('Colours from: a list of the colour keys', JSON.stringify(colorsFrom) === '["the plot\'s own","🎨 runcol*"]', colorsFrom);

// ---------- the exported HTML ----------
await app(async () => { const { state } = await import('/core/state.js'); state.slides[0].elements[0].entries = 'sgd: #000000'; (await import('/core/variables.js')).resetLiveValues(); (await import('/editor/editor.js')).redrawCanvas(); });
await page.waitForTimeout(200);
const html = await app(async () => (await import('/export/html.js')).getExportHtmlString({ localAssets: true }));
const exp = await browser.newPage({ viewport: { width: 1400, height: 900 } });
const expErrors = [];
exp.on('pageerror', x => expErrors.push(x.message));
await exp.goto(`${BASE_URL}/index.html`);
await exp.setContent(html);
await exp.waitForTimeout(300);
const eStrokes = () => exp.evaluate(() => [...document.querySelectorAll('.slide.active svg path[stroke-linejoin]')].map(p => p.getAttribute('stroke')));
check('export: the runs in their key\'s colours', JSON.stringify(await eStrokes()) === JSON.stringify([info.adam, '#000000', info.ngd]), await eStrokes());
await exp.click('.slide.active [data-glkey="adam"]');
await exp.waitForTimeout(150);
check('export: a click on a key in the legend hides its run', JSON.stringify(await eStrokes()) === JSON.stringify(['#000000', info.ngd]), await eStrokes());
const eFill = () => exp.evaluate(() => getComputedStyle(document.querySelector('.slide.active [data-glid="4"] .shape-fill')).backgroundColor);
check('export: the shape the colour of the run picked', (await eFill()) === rgb(info.adam), await eFill());
await exp.selectOption('.slide.active [data-glinput="pick"]', 'sgd');
await exp.waitForTimeout(150);
check('export: picking sgd: the shape turns black', (await eFill()) === 'rgb(0, 0, 0)', await eFill());
check('export: palette() knows the theme there too', (await exp.evaluate(() => getComputedStyle(document.querySelector('.slide.active [data-glid="6"] .shape-fill')).borderTopColor)) === rgb(info.pal[1 % info.pal.length]));
check('export: no page errors', expErrors.length === 0, expErrors);
await exp.close();

check('no page errors', errors.length === 0, errors);
console.log(out.join('\n'));
await browser.close();
