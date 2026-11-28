// ============================================================
// elements/slider/slider.js — A slider that sets a variable (core/
// variables.js): plots and \var{…} values in text follow it, on the
// canvas, while presenting and in an exported HTML.
//
//   .element.slider id:41 x:100 y:850 width:600 height:80 var:mu min:-3 max:3 step:0.1 value:0 label:"$\mu$"
//
// `value` is where it starts (saved); moving it on the canvas or while
// presenting changes the value shown, not the file.
// ============================================================

import { state } from '../../core/state.js';
import { ElementRegistry } from '../../core/registry.js';
import { escapeHtml, renderMarkdownAndKatexToString } from '../../core/render.js';
import { fontStack } from '../../core/fonts.js';
import { resolveColor } from '../../core/colors.js';
import { colorField } from '../../ui/colorPicker.js';
import { formatValue, bindSliders, liveUpdate } from '../../core/liveEngine.js';
import { allVariables, setLiveValue } from '../../core/variables.js';
import { hasFormulas, liveApplyToCanvas } from '../../core/bindings.js';

/** The canvas redrawn (through editor.js, loaded later: no import cycle at load). */
function redrawCanvasLater() {
    import('../../editor/editor.js').then(m => m.redrawCanvas());
}

const num = (v, d) => (v === '' || v === undefined || v === null || !Number.isFinite(Number(v)) ? d : Number(v));

/** The slider's markup at `value`. */
function markup(el, value) {
    const name = String(el.var || 'a');
    const fs = num(el.fontSize, 28);
    const accent = resolveColor(el.accent) || el.accent || '#2563eb';
    const label = el.label ? renderMarkdownAndKatexToString({ content: el.label }) : '';
    const shown = el.showValue === 'no' ? '' : `<span class="gl-var gl-slider-value" data-glvar="${escapeHtml(name)}"${el.format ? ` data-glfmt="${escapeHtml(el.format)}"` : ''}>${escapeHtml(formatValue(value, el.format))}</span>`;
    return `<div class="gl-slider" style="position:absolute; inset:0; display:flex; align-items:center; gap:${fs * 0.5}px; font-size:${fs}px;">
        ${label ? `<span class="gl-slider-label">${label}</span>` : ''}
        <input type="range" data-glslider="${escapeHtml(name)}" min="${num(el.min, 0)}" max="${num(el.max, 1)}" step="${num(el.step, 0.01) || 'any'}" value="${value}"
               style="flex:1; min-width:0; accent-color:${escapeHtml(accent)}; height:${fs * 0.9}px; cursor:pointer;">
        ${shown}
    </div>`;
}

const SliderElement = {
    type: 'slider',
    label: 'Add Slider',
    icon: '🎚️',
    className: 'element-slider',
    category: 'interactive',

    gl: {
        props: ['x', 'y', 'width', 'height', 'var', 'min', 'max', 'step', 'value', 'label', 'format', 'showValue', 'accent',
            'fontSize', 'fontFamily', 'fontColor', 'bg', 'borderCol', 'borderWidth', 'borderStyle'],
        numericProps: ['x', 'y', 'width', 'height', 'min', 'max', 'step', 'value', 'fontSize', 'borderWidth'],
        body: null,
    },

    defaults() {
        const scale = state.slideWidth / 1920;
        // a new variable name: a, b, c... not used by another slider
        const used = new Set();
        (state.slides || []).forEach(s => (s.elements || []).forEach(e => { if (e.type === 'slider') used.add(e.var); }));
        const name = ['mu', 'sigma', 'a', 'b', 'c', 'k', 'n', 't'].find(n => !used.has(n)) || `v${used.size + 1}`;
        return {
            type: 'slider',
            x: 0, y: 0,
            width: Math.round(600 * scale),
            height: Math.round(70 * scale),
            var: name, min: name === 'sigma' ? 0.2 : -3, max: 3, step: 0.1, value: name === 'sigma' ? 1 : 0,
            label: ['mu', 'sigma'].includes(name) ? `$\\${name}$` : `$${name}$`,
            fontSize: Math.round(30 * scale),
            fontFamily: 'sans-serif',
            fontColor: state.isDarkMode ? '#f8fafc' : '#0f172a',
            bg: 'transparent',
            borderCol: 'transparent',
            borderWidth: 0,
            borderStyle: 'solid',
        };
    },

    renderDom(domEl, el, ctx) {
        domEl.style.fontFamily = fontStack(el.fontFamily);
        domEl.style.color = el.fontColor;
        const vars = allVariables();
        const value = num(vars[el.var], num(el.value, 0));
        domEl.innerHTML = markup(el, value);
        const input = domEl.querySelector('input');
        if (ctx.context !== 'canvas') {
            input.disabled = true;
            input.style.pointerEvents = 'none';
            return;
        }
        // On the canvas the slider works: plots and values follow (not saved).
        bindSliders(domEl, {}, (name, v) => {
            setLiveValue(name, v);
            const canvas = document.getElementById('slide-canvas');
            liveUpdate(canvas, allVariables());
            if (hasFormulas()) liveApplyToCanvas(canvas, allVariables());
        });
        // let go: objects driven by formulas drawn again in full (handles, thumbnails…)
        domEl.querySelector('input').addEventListener('change', () => {
            if (hasFormulas()) document.dispatchEvent(new CustomEvent('slide-thumbnail-changed'));
            if (hasFormulas()) requestAnimationFrame(() => redrawCanvasLater());
        });
    },

    exportStyle(el) {
        return `font-family:${fontStack(el.fontFamily)}; color:${el.fontColor};`;
    },

    exportInner(el) {
        return markup(el, num(el.value, 0));
    },

    properties(el) {
        const field = (key, label, type = 'number', extra = '') => `
            <div class="prop-group">
                <label>${label}</label>
                <input type="${type}" class="prop-control" ${type === 'number' ? 'step="any"' : 'spellcheck="false"'} value="${escapeHtml(el[key] ?? '')}" data-prop="${key}" ${extra}>
            </div>`;
        return `
            <div class="prop-divider"></div>
            <div class="prop-row">${field('var', 'Variable', 'text', 'pattern="[A-Za-z_][A-Za-z0-9_]*"')}${field('label', 'Label', 'text')}</div>
            <div class="prop-row">${field('min', 'From')}${field('max', 'To')}</div>
            <div class="prop-row">${field('step', 'Step')}${field('value', 'Starts at')}</div>
            <div class="prop-row">
                ${field('format', 'Value shown as', 'text', 'placeholder="e.g. %.2f"')}
                <div class="prop-group"><label>Colour</label>${colorField({ 'data-prop': 'accent' }, el.accent || '#2563eb', { allowNone: false })}</div>
            </div>
            <label class="prop-check"><input type="checkbox" data-prop="showValue" ${el.showValue === 'no' ? '' : 'checked'}> Show the value</label>
            <p class="prop-hint">Plots and text use it by name: in a formula <code>${escapeHtml(el.var || 'mu')}</code>, in text <code>\\var{${escapeHtml(el.var || 'mu')}}</code>. Moving it here or while presenting doesn't change the file; <em>Starts at</em> does.</p>`;
    },
};

ElementRegistry.register(SliderElement);
