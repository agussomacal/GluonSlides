// ============================================================
// elements/plot/plot.js — A plot of formulas: curves y = f(x) computed
// from the project's variables (core/variables.js), redrawn when a
// slider moves, on the canvas and in an exported HTML.
//
//   .element.plot id:40 x:100 y:200 width:1000 height:600 lang:python xmin:-6 xmax:6 ymin:0 ymax:0.5 xlabel:"$x$"
//   	.curve color:@primary width:4 label:"$\mathcal{N}(\mu,\sigma^2)$"
//   	s2 = sigma**2
//   	y = exp(-(x - mu)**2 / (2*s2)) / sqrt(2*pi*s2)
//   	.curve color:@muted dash:dashed label:"standard"
//   	y = exp(-x**2 / 2) / sqrt(2*pi)
//
// The body is kept as written (`code`): `.curve` lines (colour, width,
// dash, label, lang) and each curve's formula. lang:python or lang:latex
// (core/liveEngine.js reads both; the plot's lang is the default, a
// curve may have its own). ymin / ymax left out: from the curves at the
// starting values, kept while sliders move.
// ============================================================

import { state, markDirty } from '../../core/state.js';
import { ElementRegistry } from '../../core/registry.js';
import { escapeHtml, renderMarkdownAndKatexToString } from '../../core/render.js';
import { fontStack } from '../../core/fonts.js';
import { resolveColor } from '../../core/colors.js';
import { colorField } from '../../ui/colorPicker.js';
import { parseCurves, plotSvg, plotLayout, sampleCurves, yRange, LANGUAGES, PALETTE } from '../../core/liveEngine.js';
import { allVariables, startingVariables } from '../../core/variables.js';

const EXAMPLE = {
    python: '.curve color:@primary width:4 label:"$\\mathcal{N}(\\mu,\\sigma^2)$"\ny = exp(-(x - mu)**2 / (2*sigma**2)) / sqrt(2*pi*sigma**2)',
    latex: '.curve color:@primary width:4 label:"$\\mathcal{N}(\\mu,\\sigma^2)$"\n\\frac{1}{\\sqrt{2\\pi\\sigma^2}} e^{-\\frac{(x-\\mu)^2}{2\\sigma^2}}',
};

/** What the engine draws: the element's settings, colours resolved, the y range fixed once. */
export function plotSpec(el, vars) {
    const lang = LANGUAGES.includes(el.lang) ? el.lang : 'python';
    const curves = parseCurves(el.code || '', lang).map((c, i) => ({
        code: c.code, lang: LANGUAGES.includes(c.lang) ? c.lang : lang,
        color: resolveColor(c.color) || c.color || PALETTE[i % PALETTE.length],
        width: Number(c.width) || 3, dash: c.dash || '', label: c.label || '',
    }));
    const spec = {
        width: el.width, height: el.height, xmin: el.xmin, xmax: el.xmax, ymin: el.ymin, ymax: el.ymax,
        grid: el.grid === 'no' ? 'no' : 'yes', samples: el.samples, lang, curves,
        fontSize: Number(el.fontSize) || 24, fontFamily: fontStack(el.fontFamily), color: resolveColor(el.fontColor) || el.fontColor || '#0f172a',
        xlabel: el.xlabel || '', ylabel: el.ylabel || '',
    };
    // y range from the curves at the starting values: it stays put while sliders move
    const fixed = (v) => v !== undefined && v !== null && v !== '' && Number.isFinite(Number(v));
    if (!(fixed(el.ymin) && fixed(el.ymax))) spec.yAuto = yRange(spec, sampleCurves(spec, startingVariables()));
    return spec;
}

/** Axis labels and the legend: HTML on top of the drawing (Markdown and math, like any text). */
function overlays(el, spec) {
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
    const labelled = spec.curves.filter(c => c.label);
    if (labelled.length && el.legend !== 'no') {
        const rows = labelled.map(c => {
            const dash = c.dash === 'dashed' ? `${c.width * 3} ${c.width * 2}` : c.dash === 'dotted' ? `${c.width} ${c.width * 1.6}` : '';
            return `<div style="display:flex; align-items:center; gap:${fs * 0.4}px;"><svg width="${fs * 1.6}" height="${fs * 0.6}"><line x1="0" y1="${fs * 0.3}" x2="${fs * 1.6}" y2="${fs * 0.3}" stroke="${escapeHtml(c.color)}" stroke-width="${c.width}"${dash ? ` stroke-dasharray="${dash}"` : ''}/></svg><span>${md(c.label)}</span></div>`;
        }).join('');
        html += `<div class="gl-plot-legend" style="position:absolute; right:${L.right + fs * 0.5}px; top:${L.top + fs * 0.4}px; padding:${fs * 0.2}px ${fs * 0.4}px; background:rgba(255,255,255,0.75); border-radius:${fs * 0.2}px; ${font} font-size:${fs * 0.8}px;">${rows}</div>`;
    }
    return html;
}

function markup(el, vars) {
    const spec = plotSpec(el, vars);
    return `${plotSvg(spec, vars)}${overlays(el, spec)}`;
}

const specAttr = (el) => escapeHtml(JSON.stringify(plotSpec(el, startingVariables())));

const PlotElement = {
    type: 'plot',
    label: 'Add Plot',
    icon: '📈',
    className: 'element-plot',
    category: 'interactive',
    variants: [
        { id: 'python', label: 'Plot (Python formula)', icon: '📈', preset: () => ({ lang: 'python', code: EXAMPLE.python }) },
        { id: 'latex', label: 'Plot (LaTeX formula)', icon: '📉', preset: () => ({ lang: 'latex', code: EXAMPLE.latex }) },
    ],

    gl: {
        props: ['x', 'y', 'width', 'height', 'lang', 'xmin', 'xmax', 'ymin', 'ymax', 'xlabel', 'ylabel', 'grid', 'legend', 'samples',
            'fontSize', 'fontFamily', 'fontColor', 'bg', 'borderCol', 'borderWidth', 'borderStyle'],
        numericProps: ['x', 'y', 'width', 'height', 'samples', 'fontSize', 'borderWidth'], // the ranges stay text: empty = auto
        body: 'code',
        // Written as typed: .curve lines too (not a top-level directive once indented).
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
        inner.setAttribute('data-gl-plot', JSON.stringify(plotSpec(el, startingVariables())));
        inner.innerHTML = markup(el, allVariables());
        domEl.appendChild(inner);
    },

    exportInner(el) {
        return `<div class="gl-plot" data-gl-plot="${specAttr(el)}" style="position:absolute; inset:0;">${markup(el, startingVariables())}</div>`;
    },

    properties(el) {
        const lang = LANGUAGES.includes(el.lang) ? el.lang : 'python';
        const num = (key, label, placeholder = '') => `
            <div class="prop-group">
                <label>${label}</label>
                <input type="number" class="prop-control" step="any" value="${el[key] ?? ''}" placeholder="${placeholder}" data-prop="${key}">
            </div>`;
        const vars = allVariables();
        const names = Object.keys(vars).sort();
        return `
            <div class="prop-divider"></div>
            <div class="prop-group">
                <label>Formulas</label>
                <select class="prop-control" data-prop="lang">
                    ${LANGUAGES.map(l => `<option value="${l}" ${l === lang ? 'selected' : ''}>${l === 'python' ? 'Python: x**2, exp(…), np.sin(…)' : 'LaTeX: x^2, e^{…}, \\frac{…}{…}'}</option>`).join('')}
                </select>
                <textarea class="prop-control plot-code" rows="8" spellcheck="false" data-prop="code">${escapeHtml(el.code || '')}</textarea>
                <p class="prop-hint">One curve per <code>.curve</code> line (color, width, dash:dashed|dotted, label, lang), then its formula in <em>x</em>: <code>y = …</code>, with helper lines before it. Variables: ${names.length ? names.map(n => `<code>${escapeHtml(n)}</code>`).join(' ') : 'none yet (a slider, or Project settings → Variables)'}.</p>
            </div>
            <div class="prop-row">${num('xmin', 'x from')}${num('xmax', 'x to')}</div>
            <div class="prop-row">${num('ymin', 'y from', 'auto')}${num('ymax', 'y to', 'auto')}</div>
            <div class="prop-row">
                <div class="prop-group"><label>x label</label><input type="text" class="prop-control" value="${escapeHtml(el.xlabel || '')}" data-prop="xlabel"></div>
                <div class="prop-group"><label>y label</label><input type="text" class="prop-control" value="${escapeHtml(el.ylabel || '')}" data-prop="ylabel"></div>
            </div>
            <div class="prop-row">
                <div class="prop-group"><label>Text size</label><input type="number" class="prop-control" min="6" value="${Number(el.fontSize) || 24}" data-prop="fontSize"></div>
                <div class="prop-group"><label>Text and axes</label>${colorField({ 'data-prop': 'fontColor' }, el.fontColor, { allowNone: false })}</div>
            </div>
            <label class="prop-check"><input type="checkbox" data-prop="grid" data-on="yes" data-off="no" ${el.grid === 'no' ? '' : 'checked'}> Grid</label>
            <label class="prop-check"><input type="checkbox" data-prop="legend" data-on="yes" data-off="no" ${el.legend === 'no' ? '' : 'checked'}> Legend (curves with a label)</label>`;
    },
};

ElementRegistry.register(PlotElement);
