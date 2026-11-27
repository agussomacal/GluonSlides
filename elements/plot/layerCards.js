// ============================================================
// elements/plot/layerCards.js — A plot's layers in its properties panel:
// one card each (kind, colour, name; hide, move, duplicate, delete),
// opening into a form of its settings (core/plotSchema.js) and a small
// formula editor (CodeMirror: colours, suggestions, the error on its
// line). Every change goes through core/plotLayers.js, which rewrites
// only that layer's line or formula: the .gl text (Ctrl+E) stays as typed.
// ============================================================

import { state, markDirty, activeElements, pyApi, flashSaveIndicator } from '../../core/state.js';
import { escapeHtml, renderMarkdownAndKatexToString } from '../../core/render.js';
import { resolveColor } from '../../core/colors.js';
import { colorField } from '../../ui/colorPicker.js';
import { LAYERS, unknownParams } from '../../core/plotSchema.js';
import * as L from '../../core/plotLayers.js';
import { PALETTE, LANGUAGES, plotErrors, formulaNames, expandPlot } from '../../core/liveEngine.js';
import { matplotlibNames } from '../../core/mplEngine.js';
import { allVariables } from '../../core/variables.js';
import { dataTable, linkDataFile } from '../../core/plotData.js';

const open = new Map();   // plot id -> Set of open layer indices (this session)
let hooks = null;         // { templates, spec(el), redraw() } from plot.js

const openSet = (el) => {
    if (!open.has(el.id)) open.set(el.id, new Set(L.blocks(el.code).length === 1 ? [0] : []));
    return open.get(el.id);
};

function selectedPlot() {
    const el = activeElements()[state.selectedElementIndex];
    return el && el.type === 'plot' ? el : null;
}

function layerName(b, i) {
    const p = Object.fromEntries(b.params);
    const kind = LAYERS[b.kind] || { label: b.kind };
    return p.label ? renderMarkdownAndKatexToString({ content: p.label }) : `${escapeHtml(kind.label)} ${i + 1}`;
}

function field(b, i, param, el) {
    const p = Object.fromEntries(b.params);
    const value = p[param.key];
    const attrs = `data-layer-field="${param.key}" data-layer="${i}"`;
    const title = param.help ? ` title="${escapeHtml(param.help)}"` : '';
    const wrap = (control, wide = false) => `<div class="prop-group${wide ? ' layer-wide' : ''}"><label${title}>${escapeHtml(param.label)}</label>${control}</div>`;
    switch (param.type) {
        case 'color':
            return wrap(colorField({ 'data-color-key': `layer-${i}-${param.key}`, 'data-layer-field': param.key, 'data-layer': String(i) }, value || PALETTE[i % PALETTE.length], { allowNone: false }));
        case 'bool': {
            const on = (value || param.def || 'no') === 'yes';
            return `<label class="prop-check layer-check"${title}><input type="checkbox" ${attrs} ${on ? 'checked' : ''}> ${escapeHtml(param.label)}</label>`;
        }
        case 'select':
            return wrap(`<select class="prop-control" ${attrs}>${param.options.map(([v, t]) => `<option value="${v}" ${String(value ?? param.def ?? '') === v ? 'selected' : ''}>${escapeHtml(t)}</option>`).join('')}</select>`);
        case 'number':
        case 'int':
            return wrap(`<input type="number" class="prop-control" step="${param.type === 'int' ? 1 : 'any'}" ${attrs} value="${escapeHtml(value ?? '')}" placeholder="${escapeHtml(param.def ?? '')}">`);
        case 'file': {
            const t = value ? dataTable(value) : null;
            const info = !value ? `<span class="prop-hint">none: ${b.kind === 'hist' ? 'the formula or rows' : 'the rows'} below</span>`
                : !t ? '<span class="prop-hint">reading…</span>'
                    : t.error ? `<span class="prop-error">${escapeHtml(t.error)}</span>` : `<span class="prop-hint">${t.total ?? t.rows.length} rows</span>`;
            return wrap(`<div class="layer-file"><code>${escapeHtml(value || '—')}</code>${info}
                <button type="button" class="btn btn-secondary" data-layer-op="pickfile" data-layer="${i}">Choose…</button>
                ${value ? `<button type="button" class="prop-reset" data-layer-op="clearfile" data-layer="${i}" title="Use rows written below instead">✕</button>` : ''}</div>`, true);
        }
        case 'column': {
            const t = p.data ? dataTable(p.data) : null;
            if (t && t.header && t.header.length) {
                return wrap(`<select class="prop-control" ${attrs}><option value="">${param.key === 'yerr' ? 'none' : 'default'}</option>${t.header.map(h => `<option value="${escapeHtml(h)}" ${value === h ? 'selected' : ''}>${escapeHtml(h)}</option>`).join('')}</select>`);
            }
            return wrap(`<input type="text" class="prop-control" ${attrs} value="${escapeHtml(value ?? '')}" placeholder="name or number" spellcheck="false">`);
        }
        case 'formula':
            return wrap(`<input type="text" class="prop-control" list="plot-variable-names" ${attrs} value="${escapeHtml(value ?? '')}" placeholder="${escapeHtml(param.def ?? '')}" spellcheck="false">`);
        default:
            return wrap(`<input type="text" class="prop-control" ${attrs} value="${escapeHtml(value ?? '')}" spellcheck="false">`, param.key === 'label');
    }
}

/** Whether a layer shows its formula box (formulas; rows when there is no data file). */
function hasFormulaBox(b) {
    const kind = LAYERS[b.kind];
    if (!kind || !kind.formula) return false;
    const p = Object.fromEntries(b.params);
    if (kind.rows && p.data) return b.kind === 'hist' && p.samples !== undefined;
    return true;
}

/** The cards of a plot's layers, and ＋ Layer. */
export function layerCardsHtml(el) {
    const list = L.blocks(el.code);
    const opened = openSet(el);
    let errors = [];
    try {
        errors = plotErrors(hooks.spec(el), allVariables());
    } catch (e) { /* drawn anyway */ }
    const cards = list.map((b, i) => {
        const kind = LAYERS[b.kind] || { label: b.kind, icon: '?', params: [] };
        const p = Object.fromEntries(b.params);
        const isOpen = opened.has(i);
        const swatch = resolveColor(p.color) || p.color || (b.kind === 'heatmap' ? '' : PALETTE[i % PALETTE.length]);
        const unknown = unknownParams(b.kind, p);
        const fields = kind.params.filter(prm => !prm.hiddenField && prm.key !== 'hidden').map(prm => field(b, i, prm, el)).join('');
        const formula = hasFormulaBox(b) ? `
            <div class="prop-group layer-wide"><label title="${escapeHtml(kind.formula)}">${kind.rows && !kind.coords ? 'Rows' : b.kind === 'hist' ? 'Formula or rows' : 'Formula'}</label>
                <div class="plot-formula" data-layer-formula="${i}"></div>
                <p class="prop-hint">${escapeHtml(kind.formula)}</p></div>` : '';
        return `
            <div class="plot-layer${isOpen ? ' open' : ''}${p.hidden === 'yes' ? ' is-hidden' : ''}" data-layer-card="${i}">
                <div class="plot-layer-head" data-layer-toggle="${i}" title="${isOpen ? 'Close' : 'Open its settings'}">
                    <span class="plot-layer-icon">${kind.icon}</span>
                    ${swatch ? `<span class="plot-layer-swatch" style="background:${escapeHtml(swatch)}"></span>` : ''}
                    <span class="plot-layer-name">${layerName(b, i)}</span>
                    ${errors[i] ? '<span class="plot-layer-warn" title="See the error below">⚠</span>' : ''}
                    <span class="plot-layer-ops">
                        <button type="button" data-layer-op="hide" data-layer="${i}" title="${p.hidden === 'yes' ? 'Show it' : 'Hide it (kept, not drawn)'}">${p.hidden === 'yes' ? '◌' : '👁'}</button>
                        <button type="button" data-layer-op="up" data-layer="${i}" title="Draw it earlier (under the others)" ${i === 0 ? 'disabled' : ''}>↑</button>
                        <button type="button" data-layer-op="down" data-layer="${i}" title="Draw it later (on top)" ${i === list.length - 1 ? 'disabled' : ''}>↓</button>
                        <button type="button" data-layer-op="dup" data-layer="${i}" title="Duplicate">⧉</button>
                        <button type="button" data-layer-op="del" data-layer="${i}" title="Delete">✕</button>
                    </span>
                </div>
                ${isOpen ? `<div class="plot-layer-body">
                    <div class="plot-layer-fields">${fields}</div>
                    ${formula}
                    ${unknown.length ? `<p class="prop-error">Not a setting of this layer (ignored): ${unknown.map(k => `<code>${escapeHtml(k)}</code> <button type="button" class="prop-reset" data-layer-op="unset" data-layer="${i}" data-arg="${escapeHtml(k)}" title="Remove it">✕</button>`).join(' ')}</p>` : ''}
                    <p class="prop-error" data-layer-error="${i}">${escapeHtml(errors[i] || '')}</p>
                </div>` : (errors[i] ? `<p class="prop-error plot-layer-closed-error">${escapeHtml(errors[i])}</p>` : '')}
            </div>`;
    }).join('');
    const names = Object.keys(allVariables()).sort();
    return `
        <div class="plot-layers">${cards || '<p class="prop-hint"><em>No layers yet: add one.</em></p>'}</div>
        <datalist id="plot-variable-names">${names.map(n => `<option value="${escapeHtml(n)}">`).join('')}</datalist>
        <div class="prop-group">
            <label>＋ Layer</label>
            <div class="plot-layer-buttons">
                ${Object.entries(hooks.templates).map(([k]) => `<button type="button" class="btn btn-secondary" data-layer-add="${k}" title="${escapeHtml(LAYERS[k].formula || LAYERS[k].label)}">${LAYERS[k].icon} ${escapeHtml(LAYERS[k].label)}</button>`).join('')}
            </div>
            <p class="prop-hint">The plot's text, with every layer as written, is in the source view (Ctrl+E).</p>
        </div>`;
}

// ---------- a matplotlib script ----------

/** The editor of a plot written as a matplotlib script. */
export function scriptEditorHtml(el) {
    void el;
    return `
        <div class="prop-group">
            <div class="plot-formula plot-script" data-plot-script></div>
            <p class="prop-error" data-script-error></p>
            <p class="prop-hint">numpy and matplotlib as usual (<code>np.linspace</code>, <code>np.random.normal</code>, <code>plt.plot</code>, <code>plt.hist</code>, <code>ax.contour</code>…), with the project's variables by name; read by GluonSlides, not run as Python, so it also works in the exported HTML. Unsupported calls are said with their line.</p>
        </div>`;
}

let scriptModeDefined = false;
function defineScriptMode(CM) {
    if (scriptModeDefined) return;
    scriptModeDefined = true;
    const KW = new Set(['for', 'in', 'if', 'elif', 'else', 'and', 'or', 'not', 'import', 'from', 'as', 'True', 'False', 'None', 'is', 'pass']);
    CM.defineMode('gl-script', (config, opts) => ({
        token(stream) {
            if (stream.eatSpace()) return null;
            if (stream.match(/^#.*/)) return 'gl-fcomment';
            if (stream.match(/^[rRfFbB]{0,2}("[^"]*"?|'[^']*'?)/)) return 'gl-fstr';
            if (stream.match(/^(\d+(\.\d*)?|\.\d+)([eE][-+]?\d+)?/)) return 'gl-fnum';
            const word = stream.match(/^[A-Za-z_][A-Za-z0-9_]*/);
            if (word) {
                const w = word[0];
                if (KW.has(w)) return 'gl-fkw';
                if (['np', 'plt', 'ax', 'fig', 'numpy', 'math'].includes(w)) return 'gl-fmod';
                if (opts.vars.has(w)) return 'gl-fvar';
                return null;
            }
            if (stream.match(/^(\*\*|\/\/|<=|>=|==|!=|[-+*/%=<>@&|~])/)) return 'gl-fop';
            stream.next();
            return null;
        },
    }));
}

function showScriptErrors(el, cm) {
    let message = '';
    try {
        const spec = expandPlot(hooks.spec(el), allVariables());
        message = spec.scriptError || plotErrors(hooks.spec(el), allVariables()).filter(Boolean).join(' · ');
    } catch (e) { message = e.message; }
    const p = document.querySelector('[data-script-error]');
    if (p) p.textContent = message;
    cm.eachLine(line => cm.removeLineClass(line, 'background', 'plot-formula-error'));
    const m = message.match(/^line (\d+)/);
    if (m && Number(m[1]) - 1 < cm.lineCount()) cm.addLineClass(Number(m[1]) - 1, 'background', 'plot-formula-error');
}

function scriptHint(ed) {
    if (typeof ed.showHint !== 'function') return;
    ed.showHint({
        completeSingle: false,
        hint: (cm) => {
            const cur = cm.getCursor();
            const line = cm.getLine(cur.line).slice(0, cur.ch);
            const m = line.match(/(?:(np\.random|numpy\.random|np|numpy|plt|ax|math)\.)?([A-Za-z_][A-Za-z0-9_]*)?$/);
            if (!m || (!m[1] && !m[2])) return null;
            const typed = m[2] || '';
            const names = matplotlibNames();
            const vars = allVariables();
            let list;
            if (m[1] === 'np.random' || m[1] === 'numpy.random') list = names.random.map(n => ({ text: `${n}(`, displayText: `np.random.${n}(…)` }));
            else if (m[1] === 'np' || m[1] === 'numpy' || m[1] === 'math') list = names.np.map(n => ({ text: n === 'random' ? 'random.' : ['pi', 'e', 'inf', 'nan'].includes(n) ? n : `${n}(`, displayText: `np.${n}` }));
            else if (m[1] === 'plt' || m[1] === 'ax') list = names.plt.map(n => ({ text: `${n}(`, displayText: `${m[1]}.${n}(…)` }));
            else {
                list = [
                    ...Object.keys(vars).sort().map(n => ({ text: n, displayText: `${n}  — ${vars[n]}` })),
                    ...['np', 'plt'].map(n => ({ text: `${n}.`, displayText: n })),
                    ...names.builtins.map(n => ({ text: `${n}(`, displayText: `${n}(…)` })),
                ];
            }
            list = list.filter(it => it.text.toLowerCase().startsWith(typed.toLowerCase()) && it.text !== typed);
            return list.length ? { list: list.slice(0, 60), from: { line: cur.line, ch: cur.ch - typed.length }, to: cur } : null;
        },
    });
}

function mountScriptEditor(el, host) {
    const CM = window.CodeMirror;
    defineScriptMode(CM);
    const modeOf = () => ({ name: 'gl-script', vars: new Set(Object.keys(allVariables())) });
    const cm = CM(host, { value: String(el.code || ''), mode: modeOf(), lineNumbers: true, lineWrapping: true, viewportMargin: Infinity, indentUnit: 4, extraKeys: { 'Ctrl-Space': scriptHint, Tab: (ed) => ed.replaceSelection('    ') } });
    let timer = null;
    cm.on('change', () => {
        clearTimeout(timer);
        timer = setTimeout(() => {
            const plot = selectedPlot();
            if (!plot || plot.id !== el.id) return;
            plot.code = cm.getValue();
            markDirty();
            hooks.redraw();
            showScriptErrors(plot, cm);
        }, 300);
    });
    cm.on('inputRead', (ed, change) => {
        if (change.origin === '+input' && /[A-Za-z_.]/.test(change.text[change.text.length - 1].slice(-1))) scriptHint(ed);
    });
    showScriptErrors(el, cm);
}

// ---------- the formula editors ----------

let modeDefined = false;
function defineFormulaMode(CM) {
    if (modeDefined) return;
    modeDefined = true;
    CM.defineMode('gl-formula', (config, opts) => ({
        token(stream) {
            if (stream.eatSpace()) return null;
            if (stream.match(/^#.*/)) return 'gl-fcomment';
            if (stream.match(/^(\d+(\.\d*)?|\.\d+)([eE][-+]?\d+)?/)) return 'gl-fnum';
            if (stream.match(/^\\[A-Za-z]+/)) return 'gl-ffn';
            const word = stream.match(/^[A-Za-z_][A-Za-z0-9_.]*/);
            if (word) {
                const w = word[0].replace(/^(?:(?:np|numpy)\.random\.|random\.|math\.|np\.|numpy\.|scipy\.special\.)/, '');
                if (opts.functions.has(w)) return 'gl-ffn';
                if (opts.coords.has(w)) return 'gl-fcoord';
                if (opts.known.has(w) || ['and', 'or', 'not', 'if', 'else'].includes(w)) return 'gl-fvar';
                return opts.lang === 'latex' ? 'gl-fvar' : 'gl-funknown';
            }
            if (stream.match(/^(\*\*|\/\/|<=|>=|==|!=|[-+*/%^=<>|])/)) return 'gl-fop';
            stream.next();
            return null;
        },
    }));
}

const editors = [];   // { cm, index, el }

function assignedNames(text) {
    return [...String(text).matchAll(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=(?!=)/gm)].map(m => m[1]);
}

function modeFor(el, b, text) {
    const kind = LAYERS[b.kind] || {};
    const p = Object.fromEntries(b.params);
    const lang = LANGUAGES.includes(p.lang) ? p.lang : (LANGUAGES.includes(el.lang) ? el.lang : 'python');
    const { functions, constants } = formulaNames();
    return {
        name: 'gl-formula', lang,
        functions: new Set(functions),
        coords: new Set(kind.coords || []),
        known: new Set([...Object.keys(allVariables()), ...constants, ...(kind.outputs || []), ...assignedNames(text)]),
    };
}

function showErrors() {
    const el = selectedPlot();
    if (!el) return;
    let errors = [];
    try { errors = plotErrors(hooks.spec(el), allVariables()); } catch (e) { return; }
    document.querySelectorAll('[data-layer-error]').forEach(p => { p.textContent = errors[Number(p.dataset.layerError)] || ''; });
    document.querySelectorAll('[data-layer-toggle]').forEach(head => {
        const i = Number(head.dataset.layerToggle);
        let warn = head.querySelector('.plot-layer-warn');
        if (errors[i] && !warn) head.querySelector('.plot-layer-name').insertAdjacentHTML('afterend', '<span class="plot-layer-warn" title="See the error below">⚠</span>');
        else if (!errors[i] && warn) warn.remove();
    });
    editors.forEach(({ cm, index }) => {
        cm.eachLine(line => cm.removeLineClass(line, 'background', 'plot-formula-error'));
        const message = String(errors[index] || '');
        const m = message.match(/line (\d+)/);
        let line = m ? Number(m[1]) - 1 : -1;
        // an unknown name: the first line that uses it
        const names = message.match(/unknown names?: ([\w., ]+?)(?: \(|$)/);
        if (line < 0 && names) {
            const first = names[1].split(',')[0].trim();
            const re = new RegExp(`(^|[^\\w.])${first.replace(/\./g, '\\.')}(?![\\w])`);
            for (let k = 0; k < cm.lineCount(); k++) if (re.test(cm.getLine(k).replace(/#.*$/, ''))) { line = k; break; }
        }
        if (line >= 0 && line < cm.lineCount()) cm.addLineClass(line, 'background', 'plot-formula-error');
    });
}

/** Mounts the formula editors of the open cards (after the panel is drawn). */
export function mountFormulaEditors(el) {
    const CM = window.CodeMirror;
    editors.length = 0;
    if (!CM) return;
    const scriptHost = document.querySelector('#properties-body [data-plot-script]');
    if (scriptHost) { mountScriptEditor(el, scriptHost); return; }
    defineFormulaMode(CM);
    const list = L.blocks(el.code);
    document.querySelectorAll('#properties-body [data-layer-formula]').forEach(host => {
        const i = Number(host.dataset.layerFormula);
        const b = list[i];
        if (!b) return;
        const text = L.bodyOf(el.code, i);
        const cm = CM(host, { value: text, mode: modeFor(el, b, text), lineNumbers: true, lineWrapping: true, viewportMargin: Infinity, indentUnit: 4, extraKeys: { 'Ctrl-Space': (ed) => hint(ed, el, i) } });
        let timer = null;
        cm.on('change', () => {
            clearTimeout(timer);
            timer = setTimeout(() => {
                const plot = selectedPlot();
                if (!plot || plot.id !== el.id) return;
                plot.code = L.setBody(plot.code, i, cm.getValue());
                cm.setOption('mode', modeFor(plot, L.blocks(plot.code)[i] || b, cm.getValue()));
                markDirty();
                hooks.redraw();
                showErrors();
            }, 250);
        });
        cm.on('inputRead', (ed, change) => {
            if (change.origin === '+input' && /[A-Za-z_.\\]/.test(change.text[change.text.length - 1].slice(-1))) hint(ed, el, i);
        });
        editors.push({ cm, index: i, el });
    });
    showErrors();
}

/** Suggestions in a formula editor: variables, coordinates, functions, constants. */
function hint(ed, el, i) {
    if (typeof ed.showHint !== 'function') return;
    const b = L.blocks(el.code)[i] || { kind: 'curve', params: [] };
    const kind = LAYERS[b.kind] || {};
    ed.showHint({
        completeSingle: false,
        hint: (cm) => {
            const cur = cm.getCursor();
            const line = cm.getLine(cur.line).slice(0, cur.ch);
            const m = line.match(/\\?[A-Za-z_][A-Za-z0-9_]*$/);
            if (!m) return null;
            const typed = m[0];
            const vars = allVariables();
            const { functions, constants } = formulaNames();
            const items = [
                ...(kind.coords || []).map(n => ({ text: n, displayText: `${n}  — the layer's ${n}` })),
                ...Object.keys(vars).sort().map(n => ({ text: n, displayText: `${n}  — ${vars[n]}` })),
                ...(kind.outputs || []).map(n => ({ text: `${n} = `, displayText: `${n} = …  — what the layer draws` })),
                ...functions.map(n => ({ text: `${n}(`, displayText: `${n}(…)` })),
                ...constants.map(n => ({ text: n, displayText: n })),
            ].filter(it => it.text.toLowerCase().startsWith(typed.toLowerCase()) && it.text !== typed);
            return items.length ? { list: items.slice(0, 40), from: { line: cur.line, ch: cur.ch - typed.length }, to: cur } : null;
        },
    });
}

// ---------- changes ----------

function apply(el, code, { redrawPanel = true, openIndex = null } = {}) {
    el.code = code;
    if (openIndex !== null) openSet(el).add(openIndex);
    markDirty();
    if (redrawPanel) document.dispatchEvent(new CustomEvent('slide-content-changed'));
    else { hooks.redraw(); showErrors(); }
}

async function pickFile(el, i) {
    const api = pyApi();
    if (!api || typeof api.select_table_file !== 'function') { flashSaveIndicator('Data files need the app'); return; }
    const picked = await api.select_table_file();
    if (!picked || !picked.success) return;
    const res = await linkDataFile(picked.path);
    if (!res || !res.success) { flashSaveIndicator((res && res.error) || 'Could not read the file'); return; }
    let code = L.setParam(el.code, i, 'data', res.relative_path);
    code = L.setParam(code, i, 'original', res.original);
    const h = res.header || [];
    const p = L.paramsOf(code, i);
    const kind = L.blocks(code)[i].kind;
    if (kind === 'hist' && !p.column && h[0]) code = L.setParam(code, i, 'column', h[0]);
    if (kind !== 'hist' && !p.x && h.length >= 2) { code = L.setParam(code, i, 'x', h[0]); code = L.setParam(code, i, 'y', h[1]); }
    if (kind === 'hist') code = L.setParam(code, i, 'samples', null);
    apply(el, code);
    flashSaveIndicator(`${res.relative_path}: ${res.total} rows ✓`);
}

/** Listens once on the properties panel. `h`: { templates, spec(el), redraw() } from plot.js. */
export function initLayerCards(h) {
    hooks = h;
    const panel = document.getElementById('properties-body');
    if (!panel || panel._layerCards) return;
    panel._layerCards = true;
    panel.addEventListener('click', (e) => {
        const el = selectedPlot();
        if (!el) return;
        const add = e.target.closest('[data-layer-add]');
        if (add) {
            const kind = add.dataset.layerAdd;
            let text = hooks.templates[kind];
            const lang = LANGUAGES.includes(el.lang) ? el.lang : 'python';
            if (lang !== 'python' && LAYERS[kind].coords) text = text.replace(/^(\.[a-z]+)/, '$1 lang:python');
            const code = L.addLayer(el.code, text);
            apply(el, code, { openIndex: L.blocks(code).length - 1 });
            return;
        }
        const op = e.target.closest('[data-layer-op]');
        if (op) {
            e.stopPropagation();
            const i = Number(op.dataset.layer);
            const p = L.paramsOf(el.code, i);
            const opened = openSet(el);
            const shift = (delta) => { const was = opened.has(i); opened.delete(i); if (opened.has(i + delta)) { opened.delete(i + delta); opened.add(i); } if (was) opened.add(i + delta); };
            switch (op.dataset.layerOp) {
                case 'hide': apply(el, L.setParam(el.code, i, 'hidden', p.hidden === 'yes' ? null : 'yes')); break;
                case 'up': shift(-1); apply(el, L.moveLayer(el.code, i, -1)); break;
                case 'down': shift(1); apply(el, L.moveLayer(el.code, i, 1)); break;
                case 'dup': apply(el, L.duplicateLayer(el.code, i), { openIndex: i + 1 }); break;
                case 'del':
                    opened.clear();
                    apply(el, L.removeLayer(el.code, i));
                    break;
                case 'unset': apply(el, L.setParam(el.code, i, op.dataset.arg, null)); break;
                case 'clearfile': {
                    let code = L.setParam(el.code, i, 'data', null);
                    code = L.setParam(code, i, 'original', null);
                    apply(el, code);
                    break;
                }
                case 'pickfile': pickFile(el, i); break;
                default: break;
            }
            return;
        }
        const head = e.target.closest('[data-layer-toggle]');
        if (head) {
            const i = Number(head.dataset.layerToggle);
            const opened = openSet(el);
            if (opened.has(i)) opened.delete(i); else opened.add(i);
            document.dispatchEvent(new CustomEvent('slide-content-changed'));
        }
    });
    panel.addEventListener('change', (e) => {
        const control = e.target.closest('[data-layer-field]');
        const el = selectedPlot();
        if (!control || !el) return;
        const i = Number(control.dataset.layer);
        const key = control.dataset.layerField;
        const b = L.blocks(el.code)[i];
        const param = (LAYERS[b.kind].params || []).find(p => p.key === key) || {};
        let value = control.type === 'checkbox' ? (control.checked ? 'yes' : 'no') : (control.value ?? control.getAttribute('value'));
        if (value === String(param.def ?? '') && param.type !== 'select') value = null; // the default: not written
        if (param.type === 'select' && value === '') value = null;
        apply(el, L.setParam(el.code, i, key, value));
    });
}

