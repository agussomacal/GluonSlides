// A plot's layer cards (elements/plot/layerCards.js, core/plotLayers.js,
// core/plotSchema.js): editing one setting rewrites only that layer's
// line (formulas and comments stay as typed); cards open into the layer's
// settings; hide / move / duplicate / delete; a setting the layer doesn't
// take is flagged; the formula editor colours names, suggests, writes the
// text back and marks the line with the error.
import { launchBrowser, BASE_URL } from '../helpers.mjs';

const browser = await launchBrowser();
const page = await browser.newPage({ viewport: { width: 1400, height: 1000 } });
const errors = [];
page.on('pageerror', e => errors.push(e.message));
const out = [];
const check = (n, c, x = '') => out.push(`${c ? 'PASS' : 'FAIL'} ${n}${x !== '' ? ' — ' + JSON.stringify(x) : ''}`);
const app = (fn, arg) => page.evaluate(fn, arg);

await page.goto(`${BASE_URL}/index.html`);
await page.waitForTimeout(300);

// ---------- the text, one layer at a time ----------
const text = await app(async () => {
    const L = await import('/core/plotLayers.js');
    const code = '# the model\n.curve color:@primary label:"$\\mathcal{N}(\\mu, 1)$"\n# density\ny = exp(-(x-mu)**2/2)\n\n.hist samples:500 bins:20\ny = normal(mu, 1)';
    return {
        bins: L.setParam(code, 1, 'bins', 40),
        label: L.setParam(code, 1, 'label', 'a "quoted" $\\sigma$'),
        unset: L.setParam(code, 1, 'samples', null),
        body: L.setBody(code, 1, 'y = uniform(-1, 1)'),
        moved: L.moveLayer(code, 1, -1),
        dup: L.duplicateLayer(code, 0),
        removed: L.removeLayer(code, 0),
        plain: L.blocks('y = sin(x)')[0],
        reread: L.paramsOf(L.setParam(code, 1, 'label', 'a "quoted" $\\sigma$'), 1).label,
    };
});
check('a setting changes only its layer\'s line; comments and formulas stay', text.bins === '# the model\n.curve color:@primary label:"$\\mathcal{N}(\\mu, 1)$"\n# density\ny = exp(-(x-mu)**2/2)\n\n.hist samples:500 bins:40\ny = normal(mu, 1)', text.bins);
check('quotes and backslashes written so they read back', text.reread === 'a "quoted" $\\sigma$' && text.label.includes('label:"a \\"quoted\\" $\\sigma$"'), text.label);
check('a setting removed', text.unset.includes('.hist bins:20\n'), text.unset);
check('a layer\'s formula replaced', text.body.endsWith('.hist samples:500 bins:20\ny = uniform(-1, 1)'), text.body);
check('moved: the histogram first, the curve\'s comments travel with it', text.moved.startsWith('.hist samples:500 bins:20\ny = normal(mu, 1)\n# the model\n.curve') && text.moved.includes('# density'), text.moved);
check('duplicated and removed', (text.dup.match(/\.curve/g) || []).length === 2 && !text.removed.includes('.curve'), text.dup);
check('text before any layer line is a curve', text.plain.kind === 'curve' && text.plain.head === null);

// ---------- the cards ----------
const CODE = '.hist samples:2000 bins:30 density:yes color:@muted label:"samples"\ny = normal(mu, 1)\n.curve color:@primary label:"$\\mathcal{N}(\\mu, 1)$"\n# the density\ny = exp(-(x-mu)**2/2)/sqrt(2*pi)\n.vline x:mu label:"μ"';
await app(async (code) => {
    await (await import('/ui/project.js')).openSampleProject();
    const { state, setSelectedElementIndices } = await import('/core/state.js');
    state.gridSize = 0;
    state.slides = [{ id: 1, title: 'P', elements: [
        { type: 'slider', id: 2, x: 100, y: 950, width: 600, height: 70, var: 'mu', min: -3, max: 3, step: 0.1, value: 0 },
        { type: 'plot', id: 3, x: 100, y: 100, width: 1200, height: 800, lang: 'python', xmin: -5, xmax: 5, code },
    ] }];
    (await import('/editor/editor.js')).selectSlide(0);
    setSelectedElementIndices([1], 1);
    (await import('/editor/editor.js')).renderEditor();
}, CODE);
await page.waitForTimeout(200);
const code = () => app(async () => (await import('/core/state.js')).state.slides[0].elements[1].code);
const drawnRects = () => app(() => document.querySelectorAll('#slide-canvas [data-element-id="3"] svg g[clip-path] rect').length);

const cards = await app(() => [...document.querySelectorAll('[data-layer-card]')].map(c => ({ icon: c.querySelector('.plot-layer-icon').textContent, name: c.querySelector('.plot-layer-name').textContent.trim().slice(0, 12), open: c.classList.contains('open'), math: !!c.querySelector('.katex') })));
check('a card per layer, its name (math rendered), all closed', cards.length === 3 && cards[0].name === 'samples' && cards[1].math && cards.every(c => !c.open), cards);
check('no text box of the code in the panel', !(await app(() => document.querySelector('#properties-body textarea[data-prop="code"]'))));

await page.click('[data-layer-toggle="0"]');
await page.waitForTimeout(150);
const fields = await app(() => [...document.querySelectorAll('[data-layer-card="0"] [data-layer-field]')].map(f => f.dataset.layerField));
check('opened: the histogram\'s settings', ['label', 'color', 'data', 'column', 'samples', 'seed', 'bins', 'density', 'from', 'to', 'opacity', 'lang'].every(k => fields.includes(k) || k === 'data'), fields);
check('…and its formula editor', await app(() => !!document.querySelector('[data-layer-card="0"] .plot-formula .CodeMirror')));

// a number
await page.fill('[data-layer-card="0"] [data-layer-field="bins"]', '12');
await page.press('[data-layer-card="0"] [data-layer-field="bins"]', 'Enter');
await page.waitForTimeout(200);
let c = await code();
check('bins 12: only that line changed', c.startsWith('.hist samples:2000 bins:12 density:yes') && c.includes('# the density\n'), c);
check('…and drawn with 12 bars or fewer', (await drawnRects()) <= 12 && (await drawnRects()) > 5, await drawnRects());
// a checkbox: back to its default removes the setting
await page.click('[data-layer-card="0"] [data-layer-field="density"]');
await page.waitForTimeout(200);
check('density off: removed (no is the default)', !(await code()).split('\n')[0].includes('density'), (await code()).split('\n')[0]);
// a colour
await app(() => {
    const f = document.querySelector('[data-layer-card="0"] [data-layer-field="color"]');
    f.value = '#ff0000';
    f.setAttribute('value', '#ff0000');
    f.dispatchEvent(new Event('change', { bubbles: true }));
});
await page.waitForTimeout(200);
check('colour', (await code()).split('\n')[0].includes('color:#ff0000'), (await code()).split('\n')[0]);

// hide: kept, not drawn, not in the legend
await page.click('[data-layer-op="hide"][data-layer="0"]');
await page.waitForTimeout(200);
check('hide: hidden:yes, not drawn', (await code()).split('\n')[0].includes('hidden:yes') && (await drawnRects()) === 0 && await app(() => document.querySelector('[data-layer-card="0"]').classList.contains('is-hidden')));
check('…not in the legend', !(await app(() => document.querySelector('#slide-canvas [data-element-id="3"] .gl-plot-legend')?.textContent.includes('samples'))));
await page.click('[data-layer-op="hide"][data-layer="0"]');
await page.waitForTimeout(200);
check('show again', !(await code()).includes('hidden') && (await drawnRects()) > 0);

// move, duplicate, delete
await page.click('[data-layer-op="down"][data-layer="0"]');
await page.waitForTimeout(200);
c = await code();
check('↓: the histogram drawn after the curve (the curve keeps its comment)', c.startsWith('.curve') && c.indexOf('# the density') < c.indexOf('.hist'), c);
await page.click('[data-layer-op="dup"][data-layer="2"]');
await page.waitForTimeout(200);
check('duplicate', ((await code()).match(/\.vline/g) || []).length === 2);
await page.click('[data-layer-op="del"][data-layer="3"]');
await page.waitForTimeout(200);
check('delete', ((await code()).match(/\.vline/g) || []).length === 1 && (await app(() => document.querySelectorAll('[data-layer-card]').length)) === 3);

// a setting the layer doesn't take
await app(async () => {
    const { state } = await import('/core/state.js');
    state.slides[0].elements[1].code = state.slides[0].elements[1].code.replace('.vline x:mu', '.vline x:mu bins:3');
    document.dispatchEvent(new CustomEvent('slide-content-changed'));
});
await page.waitForTimeout(150);
await page.click('[data-layer-toggle="2"]');
await page.waitForTimeout(150);
check('a setting the layer doesn\'t take is flagged', await app(() => document.querySelector('[data-layer-card="2"] .prop-error')?.textContent.includes('bins')));
await page.click('[data-layer-card="2"] [data-layer-op="unset"]');
await page.waitForTimeout(150);
check('…and removed', !(await code()).includes('bins:3'));

// the formula editor
await page.click('[data-layer-toggle="0"]');
await page.waitForTimeout(200);
const tokens = await app(() => {
    const cm = document.querySelector('[data-layer-card="0"] .CodeMirror');
    return { fn: [...cm.querySelectorAll('.cm-gl-ffn')].map(t => t.textContent), v: [...cm.querySelectorAll('.cm-gl-fvar')].map(t => t.textContent), coord: [...cm.querySelectorAll('.cm-gl-fcoord')].map(t => t.textContent) };
});
check('formula colours: functions, variables, x', tokens.fn.includes('exp') && tokens.fn.includes('sqrt') && tokens.v.includes('mu') && tokens.coord.includes('x'), tokens);
await page.click('[data-layer-card="0"] .CodeMirror');
await page.keyboard.press('Control+End');
await page.keyboard.type(' * k', { delay: 20 });
await page.waitForTimeout(500);
const typed = await app(() => {
    const cm = document.querySelector('[data-layer-card="0"] .CodeMirror');
    return {
        unknown: [...cm.querySelectorAll('.cm-gl-funknown')].map(t => t.textContent),
        errorLine: cm.querySelectorAll('.plot-formula-error').length,
        message: document.querySelector('[data-layer-error="0"]').textContent,
    };
});
c = await code();
check('typing writes the formula back (only its layer)', c.includes('y = exp(-(x-mu)**2/2)/sqrt(2*pi) * k') && c.startsWith('.curve color:@primary'), c);
check('…an unknown name is underlined, its line marked, the error said', typed.unknown.includes('k') && typed.errorLine === 1 && typed.message.includes('unknown name: k'), typed);
await page.keyboard.press('Backspace');
await page.keyboard.press('Backspace');
await page.keyboard.press('Backspace');
await page.keyboard.press('Backspace');
await page.keyboard.type(' * si');
await page.waitForTimeout(300);
const hints = await app(() => [...document.querySelectorAll('.CodeMirror-hints li')].map(li => li.textContent));
check('suggestions while typing: functions (sin, sinh, sign, sinc)', hints.some(h => h.startsWith('sin(')) && hints.some(h => h.startsWith('sinh(')), hints);
await page.keyboard.press('Escape');

// ＋ Layer opens the new card
await page.click('[data-layer-add="heatmap"]');
await page.waitForTimeout(200);
const added = await app(() => { const cards = [...document.querySelectorAll('[data-layer-card]')]; const last = cards[cards.length - 1]; return { n: cards.length, open: last.classList.contains('open'), name: last.querySelector('.plot-layer-name').textContent }; });
check('＋ Layer: the new layer\'s card is open', added.open && added.name.startsWith('Heatmap'), added);

// ---------- the source view (Ctrl+E): suggestions and colours in a plot's body ----------
const source = await app(async () => {
    const { glHints } = await import('/editor/inspector/completions.js');
    const { scanGlLine } = await import('/editor/inspector/tokenizer.js');
    const doc = ['.project {P}', '.slide {S} id:1', '.element.plot id:3 x:0 y:0 width:10 height:10', '\t.hi', '\t.hist bi', '\t.heatmap colormap:ma', '\t.curve', '\ty = ex', '\t.vline x:m'];
    const at = (line) => {
        const cm = { getCursor: () => ({ line, ch: doc[line].length }), getLine: (i) => doc[i], lineCount: () => doc.length };
        const r = glHints(cm);
        return r ? r.list.map(x => x.text) : [];
    };
    return {
        kinds: at(3), keys: at(4), maps: at(5), fns: at(7), vars: at(8),
        tokens: scanGlLine('\t.hist bins:30 density:yes', true).tokens.map(t => t.type),
    };
});
check('source view: layer kinds after a dot', source.kinds.includes('.hist '), source.kinds);
check('…a layer\'s settings', source.keys.includes('bins:'), source.keys);
check('…a setting\'s values', source.maps.includes('colormap:magma '), source.maps);
check('…functions in a formula', source.fns.includes('exp('), source.fns);
check('…variables in a setting that takes a formula', source.vars.includes('x:mu '), source.vars);
check('…a layer line coloured as one', source.tokens.includes('directive-struct') && source.tokens.includes('param-key'), source.tokens);

console.log(out.join('\n'));
console.log('--- errors ---\n' + (errors.join('\n') || '(none)'));
await browser.close();
