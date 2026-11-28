// ============================================================
// elements/inputs/inputs.js — Inputs that set a variable, besides the
// slider (elements/slider): a checkbox (true / false), a number box, a
// text box and a choice from a list (one option, or several with
// multiple:yes). Like the slider they work on the canvas, while
// presenting and in an exported HTML (core/liveEngine.js), and what is
// chosen there doesn't change the file; `value` is where they start.
//
//   .element.checkbox  id:3 var:show_fit value:yes label:"Show the fit"
//   .element.numberbox id:4 var:n min:1 max:1000 step:1 value:100 label:"Samples"
//   .element.textbox   id:5 var:method value:"Adam" label:"Optimiser"
//   .element.choice    id:6 var:opts options:"Adam, SGD, NGD" value:"Adam" multiple:no label:"Methods"
//   .element.choice    id:7 var:run source:data/runs.csv use:header original:"/home/me/exp/runs.csv"
//
// A choice may take its options from a file in the project (copied into
// data/ and followed when the original changes): a CSV's column names
// (use:header) or a column's values (use:column:optimizer), a JSON's keys
// (use:keys) or the keys of an object inside it (use:keys:runs.final).
// ============================================================

import { state, activeElements, markDirty, pyApi, flashSaveIndicator } from '../../core/state.js';
import { dataTable, linkDataFile } from '../../core/plotData.js';
import { ElementRegistry } from '../../core/registry.js';
import { escapeHtml, renderMarkdownAndKatexToString } from '../../core/render.js';
import { fontStack } from '../../core/fonts.js';
import { resolveColor } from '../../core/colors.js';
import { colorField } from '../../ui/colorPicker.js';
import { bindSliders, liveUpdate } from '../../core/liveEngine.js';
import { allVariables, setLiveValue, inputStart, choiceOptions, fileOptions } from '../../core/variables.js';
import { hasFormulas, liveApplyToCanvas } from '../../core/bindings.js';

function redrawCanvasLater() {
    import('../../editor/editor.js').then(m => m.redrawCanvas());
}

/** Label + control, laid out in the box. */
function frame(el, control, { column = false } = {}) {
    const fs = Number(el.fontSize) || 28;
    const label = el.label ? `<span class="gl-input-label">${renderMarkdownAndKatexToString({ content: el.label })}</span>` : '';
    return `<div class="gl-input" style="position:absolute; inset:0; display:flex; ${column ? 'flex-direction:column; align-items:stretch;' : 'align-items:center;'} gap:${fs * 0.4}px; font-size:${fs}px;">${label}${control}</div>`;
}

/** On the canvas the control works: the variable follows (not saved); let go, the canvas redrawn. */
function bindOnCanvas(domEl, ctx) {
    const nodes = domEl.querySelectorAll('[data-glinput]');
    if (ctx.context !== 'canvas') {
        nodes.forEach(n => { n.disabled = true; n.style.pointerEvents = 'none'; });
        return;
    }
    bindSliders(domEl, {}, (name, v) => {
        setLiveValue(name, v);
        const canvas = document.getElementById('slide-canvas');
        liveUpdate(canvas, allVariables());
        if (hasFormulas()) liveApplyToCanvas(canvas, allVariables());
    });
    nodes.forEach(n => n.addEventListener('change', () => { if (hasFormulas()) requestAnimationFrame(redrawCanvasLater); }));
}

const accentStyle = (el) => `accent-color:${escapeHtml(resolveColor(el.accent) || el.accent || '#2563eb')};`;
const current = (el) => { const v = allVariables()[el.var]; return v === undefined ? inputStart(el) : v; };
const field = (el, key, label, type = 'text', extra = '') => `
    <div class="prop-group">
        <label>${label}</label>
        <input type="${type}" class="prop-control" ${type === 'number' ? 'step="any"' : 'spellcheck="false"'} value="${escapeHtml(el[key] ?? '')}" data-prop="${key}" ${extra}>
    </div>`;
const commonFields = (el) => `
    <div class="prop-divider"></div>
    <div class="prop-row">${field(el, 'var', 'Variable', 'text', 'pattern="[A-Za-z_][A-Za-z0-9_]*"')}${field(el, 'label', 'Label')}</div>`;
const styleFields = (el) => `
    <div class="prop-row">
        <div class="prop-group"><label>Text size</label><input type="number" class="prop-control" min="6" value="${Number(el.fontSize) || 28}" data-prop="fontSize"></div>
        <div class="prop-group"><label>Colour</label>${colorField({ 'data-prop': 'accent' }, el.accent || '#2563eb', { allowNone: false })}</div>
    </div>`;
const hint = (el, what) => `<p class="prop-hint">${what} In formulas <code>${escapeHtml(el.var || 'x')}</code>, in text <code>\\var{${escapeHtml(el.var || 'x')}}</code>. Using it on the canvas or while presenting doesn't change the file; <em>Starts at</em> does.</p>`;

/** A new variable name for an input: `base`, base2, base3… not used yet. */
function freshName(base) {
    const used = new Set();
    (state.slides || []).forEach(s => (s.elements || []).forEach(e => { if (e.var) used.add(e.var); }));
    if (!used.has(base)) return base;
    let i = 2;
    while (used.has(`${base}${i}`)) i++;
    return `${base}${i}`;
}

const base = (type, extra, size) => (ctx) => {
    void ctx;
    const scale = state.slideWidth / 1920;
    return {
        type, x: 0, y: 0, width: Math.round(size[0] * scale), height: Math.round(size[1] * scale),
        fontSize: Math.round(30 * scale), fontFamily: 'sans-serif', fontColor: state.isDarkMode ? '#f8fafc' : '#0f172a',
        bg: 'transparent', borderCol: 'transparent', borderWidth: 0, borderStyle: 'solid', ...extra(),
    };
};

const COMMON_PROPS = ['x', 'y', 'width', 'height', 'var', 'label', 'value', 'accent', 'fontSize', 'fontFamily', 'fontColor', 'bg', 'borderCol', 'borderWidth', 'borderStyle'];
const COMMON_NUMERIC = ['x', 'y', 'width', 'height', 'fontSize', 'borderWidth'];
const exportStyle = (el) => `font-family:${fontStack(el.fontFamily)}; color:${el.fontColor};`;
function renderBox(domEl, el) {
    domEl.style.fontFamily = fontStack(el.fontFamily);
    domEl.style.color = el.fontColor;
}

// ---------- checkbox ----------

const checkboxMarkup = (el, on) => {
    const fs = Number(el.fontSize) || 28;
    const label = el.label ? renderMarkdownAndKatexToString({ content: el.label }) : '';
    return `<label class="gl-input gl-checkbox" style="position:absolute; inset:0; display:flex; align-items:center; gap:${fs * 0.4}px; font-size:${fs}px; cursor:pointer;">
        <input type="checkbox" data-glinput="${escapeHtml(el.var || 'show')}" data-gltype="bool" ${on ? 'checked' : ''} style="width:${fs * 0.9}px; height:${fs * 0.9}px; margin:0; ${accentStyle(el)}">
        <span class="gl-input-label">${label}</span></label>`;
};

ElementRegistry.register({
    type: 'checkbox', label: 'Add Checkbox', icon: '☑️', className: 'element-checkbox', category: 'interactive',
    gl: { props: COMMON_PROPS, numericProps: COMMON_NUMERIC, body: null },
    defaults: base('checkbox', () => ({ var: freshName('show'), value: 'yes', label: 'Show it' }), [420, 60]),
    renderDom(domEl, el, ctx) { renderBox(domEl, el); domEl.innerHTML = checkboxMarkup(el, Boolean(current(el))); bindOnCanvas(domEl, ctx); },
    exportStyle,
    exportInner: (el) => checkboxMarkup(el, Boolean(inputStart(el))),
    properties: (el) => `${commonFields(el)}
        <label class="prop-check"><input type="checkbox" data-prop="value" ${el.value === 'yes' ? 'checked' : ''}> Starts ticked</label>
        ${styleFields(el)}
        ${hint(el, 'True or false: in formulas <code>True</code> / <code>False</code> (1 / 0), e.g. <em>Visible when</em> <code>' + escapeHtml(el.var || 'show') + '</code>; in text true / false, or your own words: <code>\\var{' + escapeHtml(el.var || 'show') + '}[on|off]</code>.')}`,
});

// ---------- number box ----------

const numberMarkup = (el, v) => frame(el, `<input type="number" data-glinput="${escapeHtml(el.var || 'n')}" data-gltype="number" value="${escapeHtml(v)}"${el.min !== undefined && el.min !== '' ? ` min="${el.min}"` : ''}${el.max !== undefined && el.max !== '' ? ` max="${el.max}"` : ''} step="${el.step || 'any'}"
    style="flex:1; min-width:0; font:inherit; padding:0.1em 0.3em; border:1px solid currentColor; border-radius:0.2em; background:transparent; color:inherit; ${accentStyle(el)}">`);

ElementRegistry.register({
    type: 'numberbox', label: 'Add Number box', icon: '🔢', className: 'element-numberbox', category: 'interactive',
    gl: { props: [...COMMON_PROPS, 'min', 'max', 'step'], numericProps: [...COMMON_NUMERIC, 'min', 'max', 'step', 'value'], body: null },
    defaults: base('numberbox', () => ({ var: freshName('n'), value: 10, min: 0, max: 100, step: 1, label: '$n$' }), [380, 70]),
    renderDom(domEl, el, ctx) { renderBox(domEl, el); domEl.innerHTML = numberMarkup(el, current(el)); bindOnCanvas(domEl, ctx); },
    exportStyle,
    exportInner: (el) => numberMarkup(el, inputStart(el)),
    properties: (el) => `${commonFields(el)}
        <div class="prop-row">${field(el, 'min', 'From', 'number', 'placeholder="none"')}${field(el, 'max', 'To', 'number', 'placeholder="none"')}</div>
        <div class="prop-row">${field(el, 'step', 'Step', 'number', 'placeholder="any"')}${field(el, 'value', 'Starts at', 'number')}</div>
        ${styleFields(el)}${hint(el, 'A number typed in (kept inside From…To).')}`,
});

// ---------- text box ----------

const textMarkup = (el, v) => frame(el, `<input type="text" data-glinput="${escapeHtml(el.var || 'name')}" data-gltype="text" value="${escapeHtml(v)}" spellcheck="false"
    style="flex:1; min-width:0; font:inherit; padding:0.1em 0.3em; border:1px solid currentColor; border-radius:0.2em; background:transparent; color:inherit;">`);

ElementRegistry.register({
    type: 'textbox', label: 'Add Text box', icon: '🔤', className: 'element-textbox', category: 'interactive',
    gl: { props: COMMON_PROPS, numericProps: COMMON_NUMERIC, body: null },
    defaults: base('textbox', () => ({ var: freshName('name'), value: '', label: 'Name' }), [520, 70]),
    renderDom(domEl, el, ctx) { renderBox(domEl, el); domEl.innerHTML = textMarkup(el, current(el)); bindOnCanvas(domEl, ctx); },
    exportStyle,
    exportInner: (el) => textMarkup(el, inputStart(el)),
    properties: (el) => `${commonFields(el)}
        <div class="prop-row">${field(el, 'value', 'Starts with')}</div>
        ${styleFields(el)}${hint(el, 'A text typed in; in formulas compare it: <code>' + escapeHtml(el.var || 'name') + " == 'Adam'</code>.")}`,
});

// ---------- choice ----------

function choiceMarkup(el, v) {
    const many = el.multiple === 'yes';
    const opts = choiceOptions(el);
    const picked = new Set(Array.isArray(v) ? v : [v]);
    const options = opts.map(o => `<option value="${escapeHtml(o)}" ${picked.has(o) ? 'selected' : ''}>${escapeHtml(o)}</option>`).join('');
    return frame(el, `<select data-glinput="${escapeHtml(el.var || 'choice')}" data-gltype="${many ? 'choices' : 'choice'}" ${many ? `multiple size="${Math.max(2, Math.min(opts.length, 8))}"` : ''}
        style="flex:1; min-width:0; font:inherit; padding:0.1em 0.2em; border:1px solid currentColor; border-radius:0.2em; background:transparent; color:inherit; ${accentStyle(el)}">${options}</select>`, { column: many });
}

// ---------- a choice's options from a file (source:data/run.csv use:header) ----------

/** What "Take" offers for the file: [[use, label]] (a CSV: its header, a column's values; a JSON: its keys, an object's keys inside). */
function usesOf(el) {
    const t = el.source ? dataTable(el.source) : null;
    if (!t || t.error) return [];
    if (t.json !== undefined) {
        const out = [['keys', Array.isArray(t.json) ? 'its items' : 'its keys']];
        const walk = (node, path, depth) => {
            if (!node || typeof node !== 'object' || Array.isArray(node) || depth > 3) return;
            Object.entries(node).forEach(([k, v]) => {
                if (v && typeof v === 'object') {
                    const at = path ? `${path}.${k}` : k;
                    out.push([`keys:${at}`, Array.isArray(v) ? `the items of ${at}` : `the keys of ${at}`]);
                    walk(v, at, depth + 1);
                }
            });
        };
        walk(t.json, '', 0);
        return out.slice(0, 60);
    }
    return [['header', 'the column names'], ...(t.header || []).map(h => [`column:${h}`, `the values of ${h}`])];
}

function sourceFields(el) {
    if (!el.source) {
        return `${field(el, 'options', 'Options (separated by commas)')}
        <button type="button" class="btn btn-secondary" data-choice-op="pick" title="A CSV (its column names, or a column's values) or a JSON (its keys), followed when your script rewrites it">📄 Options from a file…</button>`;
    }
    const r = fileOptions(el);
    const uses = usesOf(el);
    const use = el.use || (uses[0] && uses[0][0]) || '';
    const info = r.loading ? '<span class="prop-hint">reading…</span>'
        : r.error ? `<span class="prop-error">${escapeHtml(r.error)}</span>`
            : `<span class="prop-hint">${r.options.length} option${r.options.length === 1 ? '' : 's'}: ${escapeHtml(r.options.slice(0, 6).join(', '))}${r.options.length > 6 ? ', …' : ''}</span>`;
    return `<div class="prop-group"><label>Options from</label>
            <div class="layer-file"><code>${escapeHtml(el.source)}</code>
            <button type="button" class="btn btn-secondary" data-choice-op="pick">Choose…</button>
            <button type="button" class="prop-reset" data-choice-op="clear" title="Write the options instead">✕</button></div></div>
        ${uses.length ? `<div class="prop-group"><label>Take</label><select class="prop-control" data-prop="use">${uses.map(([u, t]) => `<option value="${escapeHtml(u)}" ${u === use ? 'selected' : ''}>${escapeHtml(t)}</option>`).join('')}</select></div>` : ''}
        <div class="prop-group">${info}</div>`;
}

let choicePanel = false;
function initChoicePanel() {
    const panel = document.getElementById('properties-body');
    if (!panel || choicePanel) return;
    choicePanel = true;
    panel.addEventListener('click', async (e) => {
        const op = e.target.closest('[data-choice-op]');
        if (!op) return;
        const el = activeElements()[state.selectedElementIndex];
        if (!el || el.type !== 'choice') return;
        if (op.dataset.choiceOp === 'clear') {
            el.options = choiceOptions(el).join(', '); // the options it had, now written
            delete el.source; delete el.use; delete el.original;
        } else {
            const api = pyApi();
            if (!api || typeof api.select_vars_file !== 'function') { flashSaveIndicator('Files need the app'); return; }
            const picked = await api.select_vars_file();
            if (!picked || !picked.success || !picked.path) return;
            const res = await linkDataFile(picked.path);
            if (!res || !res.success) { flashSaveIndicator((res && res.error) || 'The file could not be read'); return; }
            el.source = res.relative_path;
            el.original = res.original;
            delete el.use;
        }
        markDirty();
        document.dispatchEvent(new CustomEvent('slide-content-changed'));
    });
}

/** The options a file gave are kept written too (the file says what it last gave; an export without it reads them). */
function keepFileOptions(el) {
    if (!el.source) return;
    const r = fileOptions(el);
    if (!r.loading && !r.error) el.options = r.options.join(', ');
}

ElementRegistry.register({
    type: 'choice', label: 'Add Choice', icon: '📋', className: 'element-choice', category: 'interactive',
    gl: { props: [...COMMON_PROPS, 'options', 'multiple', 'source', 'use', 'original'], numericProps: COMMON_NUMERIC, body: null },
    defaults: base('choice', () => ({ var: freshName('choice'), options: 'A, B, C', value: 'A', multiple: 'no', label: 'Choose' }), [460, 70]),
    renderDom(domEl, el, ctx) { keepFileOptions(el); renderBox(domEl, el); domEl.innerHTML = choiceMarkup(el, current(el)); bindOnCanvas(domEl, ctx); },
    exportStyle,
    exportInner: (el) => choiceMarkup(el, inputStart(el)),
    // several options: the list grows to show them
    propChanged(el, prop) {
        if (prop === 'multiple' && el.multiple === 'yes') el.height = Math.max(el.height, Math.round((Number(el.fontSize) || 28) * 1.5 * Math.min(8, Math.max(2, choiceOptions(el).length)) + (el.label ? (Number(el.fontSize) || 28) * 1.4 : 0)));
    },
    properties: (el) => `${(initChoicePanel(), '')}${commonFields(el)}
        ${sourceFields(el)}
        <div class="prop-row">${field(el, 'value', el.multiple === 'yes' ? 'Starts with (commas)' : 'Starts with')}</div>
        <label class="prop-check"><input type="checkbox" data-prop="multiple" ${el.multiple === 'yes' ? 'checked' : ''}> Several at once (Ctrl+click in the list)</label>
        ${styleFields(el)}
        ${hint(el, el.multiple === 'yes' ? 'The options chosen, a list: in formulas <code>\'B\' in ' + escapeHtml(el.var || 'choice') + '</code>; in text they are listed.' : 'The option chosen, a text: in formulas <code>' + escapeHtml(el.var || 'choice') + " == 'B'</code>.")}`,
});
