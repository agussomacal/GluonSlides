// ============================================================
// elements/plot/plot.js — A plot: layers drawn on shared axes, computed
// from formulas and data with the project's variables (core/variables.js),
// redrawn when a slider moves, on the canvas and in an exported HTML.
//
//   .element.plot id:40 x:100 y:200 width:1000 height:600 lang:python xmin:-6 xmax:6 xlabel:"$x$"
//   	.hist samples:2000 bins:40 density:yes color:@muted
//   	y = normal(mu, sigma)
//   	.curve color:@primary width:4 label:"$\mathcal{N}(\mu,\sigma^2)$"
//   	y = exp(-(x - mu)**2 / (2*sigma**2)) / sqrt(2*pi*sigma**2)
//   	.vline x:mu label:"μ"
//
// The body is kept as written (`code`): a line per layer (.curve, .fill,
// .parametric, .vline, .hline, .point, .text, .points, .line, .hist,
// .bar, .heatmap, .contour, .quiver: core/liveEngine.js) and its formula
// or rows. Data files (data:{data/run.csv}) come from core/plotData.js.
// Ranges left out are found from the layers at the starting values and
// kept while sliders move.
// ============================================================

import { state } from '../../core/state.js';
import { ElementRegistry } from '../../core/registry.js';
import { escapeHtml, renderMarkdownAndKatexToString } from '../../core/render.js';
import { fontStack } from '../../core/fonts.js';
import { resolveColor } from '../../core/colors.js';
import { colorField } from '../../ui/colorPicker.js';
import { parseLayers, plotSvg, plotLayout, autoRanges, legendStyle, expandPlot, shownLayers, LANGUAGES, PALETTE } from '../../core/liveEngine.js';
import '../../core/mplEngine.js'; // lang:matplotlib (registers itself)
import { allVariables, startingVariables } from '../../core/variables.js';
import { dataTable } from '../../core/plotData.js';
import { layerCardsHtml, scriptEditorHtml, mountFormulaEditors, initLayerCards } from './layerCards.js';
import { redrawCanvas } from '../../editor/editor.js';

const EXAMPLE = {
    python: '.curve color:@primary width:4 label:"$\\mathcal{N}(\\mu,\\sigma^2)$"\ny = exp(-(x - mu)**2 / (2*sigma**2)) / sqrt(2*pi*sigma**2)',
    latex: '.curve color:@primary width:4 label:"$\\mathcal{N}(\\mu,\\sigma^2)$"\n\\frac{1}{\\sqrt{2\\pi\\sigma^2}} e^{-\\frac{(x-\\mu)^2}{2\\sigma^2}}',
    matplotlib: [
        'import numpy as np',
        'import matplotlib.pyplot as plt',
        '',
        'x = np.linspace(-5, 5, 400)',
        "plt.plot(x, np.exp(-(x - mu)**2 / (2*sigma**2)) / np.sqrt(2*np.pi*sigma**2), lw=2, label=r'$\\mathcal{N}(\\mu,\\sigma^2)$')",
        "plt.xlabel('$x$')",
        'plt.legend()',
    ].join('\n'),
};
/** How a plot can be written: layers with Python or LaTeX formulas, or a matplotlib script. */
const PLOT_LANGS = [...LANGUAGES, 'matplotlib'];
const LANG_LABELS = { python: 'Layers, Python formulas: x**2, exp(…)', latex: 'Layers, LaTeX formulas: x^2, e^{…}', matplotlib: 'A matplotlib script: plt.plot(…), np.…' };

/** What ＋ Layer adds (Python formulas: a LaTeX plot's new layer says lang:python). */
const TEMPLATES = {
    curve: ['Curve', '.curve color:@primary label:"$\\sin x$"\ny = sin(x)'],
    fill: ['Area', '.fill color:@primary opacity:0.3 from:-1 to:1\ny = exp(-x**2/2) / sqrt(2*pi)'],
    parametric: ['Parametric', '.parametric color:@secondary from:0 to:2*pi\nx = cos(t)\ny = sin(t)'],
    vline: ['Vertical line', '.vline x:0 label:"x = 0"'],
    hline: ['Horizontal line', '.hline y:0'],
    point: ['Point', '.point x:0 y:0 label:"P"'],
    text: ['Text', '.text x:0 y:0 label:"A note"'],
    points: ['Points', '.points color:@primary\n# x, y (or data:{data/file.csv} x:column y:column)\n1, 1\n2, 4\n3, 9'],
    line: ['Line (data)', '.line color:@primary markers:yes\n# x, y (or data:{data/file.csv} x:column y:column)\n1, 1\n2, 4\n3, 9'],
    hist: ['Histogram', '.hist samples:2000 bins:30 density:yes color:@muted\n# samples of a formula (or data:{data/file.csv} column:…)\ny = normal(0, 1)'],
    bar: ['Bars', '.bar color:@accent\nA, 3\nB, 5\nC, 2'],
    heatmap: ['Heatmap', '.heatmap colormap:viridis\nz = sin(x) * cos(y)'],
    contour: ['Contour lines', '.contour levels:10 color:@dark\nz = x**2 + y**2'],
    quiver: ['Arrows', '.quiver grid:16 color:@dark\nu = -y\nv = x'],
};

const DATA_KINDS = new Set(['points', 'line', 'hist', 'bar']);
const MAX_EMBEDDED_ROWS = 20000; // histograms and bars (their own columns only); lines and points are thinned per pixel

/** A column's index in a table (a header name or a number from 1), or -1. */
function colIndex(table, which, fallback) {
    if (which === undefined || which === '') return fallback;
    const s = String(which).trim();
    if (/^\d+$/.test(s)) return Number(s) - 1;
    return (table.header || []).findIndex(h => String(h).trim() === s);
}

/**
 * The rows a plot keeps of a data file: as few as draw the same picture.
 * A line: in each pixel column (across `pixels`), its first, lowest,
 * highest and last point, in order. Points: one per pixel cell. Every
 * layer: only the columns it uses (all of them when one is picked by a
 * variable). Long-format files (group:) keep their groups apart.
 */
export function thinTable(layer, t, pixels) {
    let rows = t.rows || [];
    let header = t.header;
    const picked = ['x', 'y', 'yerr', 'column'].some(k => String(layer[k] ?? '').trim().startsWith('='));
    const used = [layer.x, layer.y, layer.yerr, layer.column, layer.group].filter(v => v !== undefined && v !== '' && !String(v).trim().startsWith('='));
    // only the columns used (named ones; with defaults, the first few): smaller files, same drawing
    // (only when every column it uses is named in the header: numbers, or defaults, would shift)
    const named = (v) => v !== undefined && v !== '' && !/^\d+$/.test(String(v).trim()) && colIndex(t, v, -1) >= 0;
    const given = layer.kind === 'hist' ? named(layer.column) : named(layer.x) && named(layer.y);
    if (!picked && header && given && used.every(named)) {
        const keep = [...new Set(used.map(u => colIndex(t, u, -1)))].sort((a, b) => a - b);
        rows = rows.map(r => keep.map(k => r[k]));
        header = keep.map(k => header[k]);
    }
    const table = { header, rows };
    if ((layer.kind === 'line' || layer.kind === 'points') && rows.length > 4 * pixels && !picked) {
        const xi = colIndex(table, layer.x, 0);
        const yi = colIndex(table, layer.y, rows[0] && rows[0].length > 1 ? 1 : 0);
        const gi = layer.group ? colIndex(table, layer.group, -1) : -1;
        const nums = (k) => rows.map(r => Number(r[k]));
        const xs = rows[0] && rows[0].length > 1 ? nums(xi) : rows.map((_, i) => i + 1);
        const ys = nums(yi);
        const range = (v) => { let lo = Infinity, hi = -Infinity; v.forEach(a => { if (Number.isFinite(a)) { if (a < lo) lo = a; if (a > hi) hi = a; } }); return [lo, hi === lo ? lo + 1 : hi]; };
        const [x0, x1] = range(xs);
        const [y0, y1] = range(ys);
        const keep = new Set();
        const buckets = new Map();
        rows.forEach((r, i) => {
            if (!Number.isFinite(xs[i]) || !Number.isFinite(ys[i])) return;
            const cell = (v, lo, hi) => Math.min(pixels - 1, Math.floor((v - lo) / (hi - lo) * pixels));
            const bx = cell(xs[i], x0, x1);
            const g = gi >= 0 ? String(r[gi]) : '';
            if (layer.kind === 'points') {
                const key = `${g}|${bx}|${cell(ys[i], y0, y1)}`;
                if (!buckets.has(key)) { buckets.set(key, i); keep.add(i); }
                return;
            }
            const key = `${g}|${bx}`;
            const b = buckets.get(key);
            if (!b) buckets.set(key, { first: i, last: i, lo: i, hi: i });
            else {
                b.last = i;
                if (ys[i] < ys[b.lo]) b.lo = i;
                if (ys[i] > ys[b.hi]) b.hi = i;
            }
        });
        if (layer.kind === 'line') buckets.forEach(b => { keep.add(b.first); keep.add(b.lo); keep.add(b.hi); keep.add(b.last); });
        table.rows = rows.filter((_, i) => keep.has(i));
        table.thinned = rows.length;
    } else if (rows.length > MAX_EMBEDDED_ROWS) {
        const step = rows.length / MAX_EMBEDDED_ROWS;
        table.rows = Array.from({ length: MAX_EMBEDDED_ROWS }, (_, k) => rows[Math.floor(k * step)]);
    }
    return table;
}

/** What the engine draws: the element's settings, colours resolved, data attached, ranges found once. */
export function plotSpec(el) {
    const script = el.lang === 'matplotlib';
    const lang = script ? 'matplotlib' : LANGUAGES.includes(el.lang) ? el.lang : 'python';
    const layers = script ? [] : parseLayers(el.code || '', lang).map((l, i) => {
        const layer = { ...l, lang: LANGUAGES.includes(l.lang) ? l.lang : lang };
        if (l.color) layer.color = resolveColor(l.color) || l.color;
        else if (!['heatmap'].includes(l.kind) && !l.group) layer.color = PALETTE[i % PALETTE.length]; // groups: a colour each
        if (DATA_KINDS.has(l.kind) && l.data) {
            const t = dataTable(l.data);
            if (t && t.error) layer.tableError = t.error;
            else if (t) {
                const thin = thinTable(layer, t, Math.max(200, Math.round(Number(el.width) || 1000)));
                layer.table = { header: thin.header, rows: thin.rows };
            }
        }
        return layer;
    });
    const spec = {
        width: el.width, height: el.height, xmin: el.xmin, xmax: el.xmax, ymin: el.ymin, ymax: el.ymax,
        xscale: el.xscale === 'log' ? 'log' : '', yscale: el.yscale === 'log' ? 'log' : '',
        xticks: el.xticks === 'pi' ? 'pi' : '', yticks: el.yticks === 'pi' ? 'pi' : '', aspect: el.aspect === 'equal' ? 'equal' : '',
        axes: ['none', 'zero'].includes(el.axes) ? el.axes : '',
        grid: el.grid === 'no' ? 'no' : 'yes', samples: el.samples, lang, layers,
        fontSize: Number(el.fontSize) || 24, fontFamily: fontStack(el.fontFamily), color: resolveColor(el.fontColor) || el.fontColor || '#0f172a',
        xlabel: el.xlabel || '', ylabel: el.ylabel || '',
    };
    // a matplotlib script: read again with the values at every drawing (core/mplEngine.js)
    if (script) spec.script = String(el.code || '');
    // ranges from the layers at the starting values: they stay put while sliders move;
    // not when a column is picked by a variable (another column: the axes fit it)
    const pickedColumn = layers.some(l => DATA_KINDS.has(l.kind) && ['x', 'y', 'yerr', 'column'].some(k => String(l[k] ?? '').trim().startsWith('=')));
    if (!pickedColumn) spec.auto = autoRanges(spec, startingVariables());
    return spec;
}

/** Axis labels and the legend: HTML on top of the drawing (Markdown and math, like any text). */
function overlays(el, spec0) {
    const spec = expandPlot(spec0, startingVariables());
    const L = plotLayout(spec);
    const fs = L.fs;
    const font = `font-size:${fs}px; font-family:${escapeHtml(spec.fontFamily)}; color:${escapeHtml(spec.color)};`;
    const md = (text) => renderMarkdownAndKatexToString({ content: text });
    let html = '';
    if (spec.xlabel) {
        html += `<div class="gl-plot-label" style="position:absolute; left:${L.left}px; width:${L.w}px; bottom:${fs * 0.15}px; text-align:center; ${font}">${md(spec.xlabel)}</div>`;
    }
    if (spec.ylabel) {
        html += `<div class="gl-plot-label" style="position:absolute; left:${fs * 0.2}px; top:${L.top + L.h / 2}px; width:${L.h}px; transform:translate(-50%, -50%) rotate(-90deg) translateY(${fs * 0.7}px); transform-origin:center; text-align:center; ${font}">${md(spec.ylabel)}</div>`;
    }
    // every labelled layer has a row; the ones not shown now (a "visible when") are hidden, and follow the values (liveUpdate)
    const shown = shownLayers(spec, startingVariables());
    const labelled = spec.layers.map((l, i) => ({ ...l, index: i })).filter(l => l.label && l.hidden !== 'yes' && !['vline', 'hline', 'point', 'text'].includes(l.kind));
    if (spec.title) {
        html += `<div class="gl-plot-title" style="position:absolute; left:${L.left}px; width:${L.w}px; top:${fs * 0.2}px; text-align:center; ${font} font-size:${fs * 1.1}px;">${md(spec.title)}</div>`;
    }
    // a script shows a legend when it calls legend(); layers unless the panel says no
    if (labelled.length && (spec0.script !== undefined ? spec.legend === 'yes' : el.legend !== 'no')) {
        const rows = labelled.map(l => {
            const w = Number(l.width) || 3;
            const c = escapeHtml(l.color || spec.color);
            const style = legendStyle(l.kind);
            const dash = l.dash === 'dashed' ? `${w * 3} ${w * 2}` : l.dash === 'dotted' ? `${w} ${w * 1.6}` : '';
            const swatch = style === 'line'
                ? `<line x1="0" y1="${fs * 0.3}" x2="${fs * 1.6}" y2="${fs * 0.3}" stroke="${c}" stroke-width="${w}"${dash ? ` stroke-dasharray="${dash}"` : ''}/>`
                : style === 'dot' ? `<circle cx="${fs * 0.8}" cy="${fs * 0.3}" r="${fs * 0.22}" fill="${c}"/>`
                    : `<rect x="${fs * 0.2}" y="0" width="${fs * 1.2}" height="${fs * 0.6}" fill="${c}" fill-opacity="${Number(l.opacity) || (l.kind === 'fill' ? 0.3 : 0.6)}"/>`;
            return `<div data-gl-legend-layer="${l.index}" style="display:${shown[l.index] === false ? 'none' : 'flex'}; align-items:center; gap:${fs * 0.4}px;"><svg width="${fs * 1.6}" height="${fs * 0.6}">${swatch}</svg><span>${md(l.label)}</span></div>`;
        }).join('');
        const none = labelled.every(l => shown[l.index] === false);
        html += `<div class="gl-plot-legend" style="${none ? 'display:none; ' : ''}position:absolute; right:${L.right + fs * 0.5}px; top:${L.top + fs * 0.4}px; padding:${fs * 0.2}px ${fs * 0.4}px; background:rgba(255,255,255,0.75); border-radius:${fs * 0.2}px; ${font} font-size:${fs * 0.8}px;">${rows}</div>`;
    }
    return html;
}

function markup(el, spec, vars) {
    return `${plotSvg(spec, vars)}${overlays(el, spec)}`;
}

const PlotElement = {
    type: 'plot',
    label: 'Add Plot',  // its panel chooses how formulas are written (lang)
    icon: '📈',
    className: 'element-plot',
    category: 'plots',
    // Plots ▾: a plot already holding one kind of layer (more come from its panel's ＋ Layer)
    variants: [
        ...['curve', 'fill', 'parametric', 'points', 'line', 'hist', 'bar', 'heatmap', 'contour', 'quiver'].map(k => ({
            id: k, label: { curve: 'Curve  y = f(x)', fill: 'Area under a curve', parametric: 'Parametric curve', points: 'Points (data)', line: 'Line (data)', hist: 'Histogram', bar: 'Bars', heatmap: 'Heatmap  z = f(x, y)', contour: 'Contour lines', quiver: 'Arrows (vector field)' }[k],
            icon: { curve: '〰️', fill: '◭', parametric: '➰', points: '⁘', line: '📈', hist: '📊', bar: '▮', heatmap: '▦', contour: '◎', quiver: '↗️' }[k],
            preset: () => ({ code: TEMPLATES[k][1], ...(['points', 'line', 'bar'].includes(k) ? { xmin: '', xmax: '' } : {}), ...(k === 'heatmap' || k === 'contour' || k === 'quiver' ? { ymin: -3, ymax: 3 } : {}) }),
        })),
        { id: 'empty', label: 'Empty plot', icon: '▫️', preset: () => ({ code: '' }) },
        { id: 'matplotlib', label: 'Matplotlib script', icon: '🐍', preset: () => ({ lang: 'matplotlib', code: EXAMPLE.matplotlib }) },
    ],
    // Choosing the formulas' language while the plot still has the example: the example in that language.
    propChanged(el, prop, before) {
        const before0 = EXAMPLE[before] ? before : 'python';
        if (prop === 'lang' && String(el.code || '').trim() === EXAMPLE[before0].trim() && EXAMPLE[el.lang]) {
            el.code = EXAMPLE[el.lang];
        }
    },

    gl: {
        props: ['x', 'y', 'width', 'height', 'lang', 'xmin', 'xmax', 'ymin', 'ymax', 'xscale', 'yscale', 'xticks', 'yticks', 'aspect', 'axes',
            'xlabel', 'ylabel', 'grid', 'legend', 'samples',
            'fontSize', 'fontFamily', 'fontColor', 'bg', 'borderCol', 'borderWidth', 'borderStyle'],
        numericProps: ['x', 'y', 'width', 'height', 'samples', 'fontSize', 'borderWidth'], // the ranges stay text: empty = auto
        body: 'code',
        // Written as typed: the layers' lines too (not top-level directives once indented).
        serializeBody(el) {
            const lines = String(el.code || '').split('\n');
            return lines.map(l => (l === '' ? '' : `\t${l}`)).join('\n') || null;
        },
        parseBody(text, el) {
            el.code = text.split('\n').map(l => l.replace(/^\\(?=\.)/, '')).join('\n');
        },
    },

    defaults() {
        const scale = state.slideWidth / 1920;
        return {
            type: 'plot',
            x: 0, y: 0,
            width: Math.round(1000 * scale),
            height: Math.round(600 * scale),
            lang: 'python',
            xmin: -5, xmax: 5,
            xlabel: '$x$',
            code: EXAMPLE.python,
            fontSize: Math.round(28 * scale),
            fontFamily: 'sans-serif',
            fontColor: state.isDarkMode ? '#f8fafc' : '#0f172a',
            bg: 'transparent',
            borderCol: 'transparent',
            borderWidth: 0,
            borderStyle: 'solid',
        };
    },

    renderDom(domEl, el) {
        domEl.style.overflow = 'visible';
        const inner = document.createElement('div');
        inner.className = 'gl-plot';
        inner.style.cssText = 'position:absolute; inset:0; pointer-events:none;';
        const spec = plotSpec(el);
        inner.setAttribute('data-gl-plot', JSON.stringify(spec));
        inner.innerHTML = markup(el, spec, allVariables());
        domEl.appendChild(inner);
    },

    exportInner(el) {
        const spec = plotSpec(el);
        return `<div class="gl-plot" data-gl-plot="${escapeHtml(JSON.stringify(spec))}" style="position:absolute; inset:0;">${markup(el, spec, startingVariables())}</div>`;
    },

    properties(el) {
        const lang = PLOT_LANGS.includes(el.lang) ? el.lang : 'python';
        const num = (key, label, placeholder = '') => `
            <div class="prop-group">
                <label>${label}</label>
                <input type="number" class="prop-control" step="any" value="${el[key] ?? ''}" placeholder="${placeholder}" data-prop="${key}">
            </div>`;
        const choice = (key, label, options) => `
            <div class="prop-group"><label>${label}</label>
                <select class="prop-control" data-prop="${key}">${options.map(([v, t]) => `<option value="${v}" ${String(el[key] || '') === v ? 'selected' : ''}>${t}</option>`).join('')}</select>
            </div>`;
        // the formula editors go in once the panel is drawn
        queueMicrotask(() => mountFormulaEditors(el));
        return `
            <div class="prop-divider"></div>
            <div class="prop-group">
                <label>Written as</label>
                <select class="prop-control" data-prop="lang">
                    ${PLOT_LANGS.map(l => `<option value="${l}" ${l === lang ? 'selected' : ''}>${LANG_LABELS[l]}</option>`).join('')}
                </select>
            </div>
            ${lang === 'matplotlib' ? `<div class="settings-section-title">Script</div>${scriptEditorHtml(el)}`
        : `<div class="settings-section-title">Layers</div>${layerCardsHtml(el)}`}
            <div class="settings-section-title">Axes</div>
            ${choice('axes', 'Axes', [['', 'box: axes, ticks and numbers'], ['zero', 'through the origin'], ['none', 'none: only the plot']])}
            <div class="prop-row">${num('xmin', 'x from', 'auto')}${num('xmax', 'x to', 'auto')}</div>
            <div class="prop-row">${num('ymin', 'y from', 'auto')}${num('ymax', 'y to', 'auto')}</div>
            <div class="prop-row">
                ${choice('xscale', 'x axis', [['', 'linear'], ['log', 'log']])}
                ${choice('yscale', 'y axis', [['', 'linear'], ['log', 'log']])}
            </div>
            <div class="prop-row">
                ${choice('xticks', 'x ticks', [['', 'numbers'], ['pi', 'multiples of π']])}
                ${choice('aspect', 'Proportions', [['', 'fill the box'], ['equal', 'same unit on x and y']])}
            </div>
            <div class="prop-row">
                <div class="prop-group"><label>x label</label><input type="text" class="prop-control" value="${escapeHtml(el.xlabel || '')}" data-prop="xlabel"></div>
                <div class="prop-group"><label>y label</label><input type="text" class="prop-control" value="${escapeHtml(el.ylabel || '')}" data-prop="ylabel"></div>
            </div>
            <div class="prop-row">
                <div class="prop-group"><label>Text size</label><input type="number" class="prop-control" min="6" value="${Number(el.fontSize) || 24}" data-prop="fontSize"></div>
                <div class="prop-group"><label>Text and axes</label>${colorField({ 'data-prop': 'fontColor' }, el.fontColor, { allowNone: false })}</div>
            </div>
            <label class="prop-check"><input type="checkbox" data-prop="grid" ${el.grid === 'no' ? '' : 'checked'}> Grid</label>
            <label class="prop-check"><input type="checkbox" data-prop="legend" ${el.legend === 'no' ? '' : 'checked'}> Legend (layers with a label)</label>`;
    },
};

ElementRegistry.register(PlotElement);

// The layer cards listen on the properties panel (once).
initLayerCards({
    templates: Object.fromEntries(Object.entries(TEMPLATES).map(([k, [, text]]) => [k, text])),
    spec: (el) => plotSpec(el),
    redraw: () => redrawCanvas(),
});
