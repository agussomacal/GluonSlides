// ============================================================
// elements/colorkey/colorkey.js — A colour key: keys (the runs of a
// file, a choice's options, written ones) each with a colour, that plots
// and objects share, so a run has the same colour everywhere.
//
//   .element.colorkey id:30 var:runcol source:data/runs.csv use:column:run x:1500 y:100 width:300 height:200
//   	adam: @primary
//   	sgd
//
// Its variable: runcol.adam = '#2563eb' (each key's colour: runcol[run] in
// formulas, colors:runcol on a plot layer with group:), runcol.shown = the
// keys on (all at the start). The keys come from a file (source / use /
// skip, as a choice's options), or are written (keys:"adam, sgd"), or are
// the lines of its body. The body gives the order (a key alone takes the
// theme colour of its place) and colours set by hand. On the slide it is
// a legend: a click on a key turns it off and on while presenting
// (clickable:no: not), or nothing (legend:no: a chip in the editor only).
// ============================================================

import { state, markDirty, activeElements, pyApi, flashSaveIndicator, forEachElementDeep } from '../../core/state.js';
import { ElementRegistry } from '../../core/registry.js';
import { escapeHtml, renderMarkdownAndKatexToString } from '../../core/render.js';
import { fontStack } from '../../core/fonts.js';
import { bindSliders, liveUpdate } from '../../core/liveEngine.js';
import { allVariables, setLiveValue, colorKeyEntries, parseColorLines } from '../../core/variables.js';
import { hasFormulas, liveApplyToCanvas } from '../../core/bindings.js';
import { colorField } from '../../ui/colorPicker.js';
import { dataTable, linkDataFile } from '../../core/plotData.js';

function freshName(base) {
    const used = new Set(Object.keys(allVariables()).map(n => n.split('.')[0]));
    forEachElementDeep((state.slides || []).flatMap(s => s.elements || []), el => { if (el.var) used.add(el.var); });
    if (!used.has(base)) return base;
    let i = 2;
    while (used.has(`${base}${i}`)) i++;
    return `${base}${i}`;
}

/** The keys on now (the variable while presenting, else all). */
function shownNow(el, entries) {
    const v = allVariables()[`${el.var}.shown`];
    return Array.isArray(v) ? v : entries.map(e => e.key);
}

function legendMarkup(el, entries, shown) {
    const fs = Number(el.fontSize) || 26;
    const clickable = el.clickable !== 'no';
    const title = el.label ? `<div class="gl-colorkey-title" style="font-weight:600; margin-bottom:${fs * 0.2}px;">${renderMarkdownAndKatexToString({ content: el.label })}</div>` : '';
    const rows = entries.map(e => `<button type="button" class="gl-key${shown.includes(e.key) ? '' : ' off'}" data-glkey="${escapeHtml(e.key)}"
        style="display:flex; align-items:center; gap:${fs * 0.4}px; font:inherit; color:inherit; background:transparent; border:0; padding:${fs * 0.08}px 0; cursor:${clickable ? 'pointer' : 'default'}; text-align:left;">
        <span class="gl-key-swatch" style="display:inline-block; width:${fs * 1.1}px; height:${fs * 0.7}px; border-radius:${fs * 0.15}px; background:${escapeHtml(e.color)};"></span>
        <span>${escapeHtml(e.key)}</span></button>`).join('');
    return `<div class="gl-input gl-colorkey" data-glinput="${escapeHtml(`${el.var || 'colors'}.shown`)}" data-gltype="keys" data-glclickable="${clickable ? 'yes' : 'no'}"
        style="position:absolute; inset:0; display:flex; flex-direction:column; justify-content:flex-start; font-size:${fs}px; overflow:hidden;">${title}${rows || '<span style="opacity:0.6">no keys yet</span>'}</div>`;
}

function chipMarkup(el, entries) {
    const fs = Math.max(12, Math.min(24, (Number(el.height) || 80) / Math.max(2.4, Math.min(entries.length, 5) + 1.4)));
    return `<div class="gl-colorkey-chip" style="position:absolute; inset:0; display:flex; flex-direction:column; gap:2px; padding:4px 10px; font:${fs}px/1.25 ui-monospace, Menlo, monospace; border:2px dashed #db2777; border-radius:10px; background:rgba(219,39,119,0.07); color:#be185d; overflow:hidden; box-sizing:border-box;">
        <div style="font-weight:700;">🎨 ${escapeHtml(el.var || 'colors')}</div>
        ${entries.slice(0, 5).map(e => `<div><span style="display:inline-block; width:0.9em; height:0.9em; vertical-align:-0.1em; border-radius:2px; background:${escapeHtml(e.color)};"></span> ${escapeHtml(e.key)}</div>`).join('')}${entries.length > 5 ? '<div>…</div>' : ''}</div>`;
}

function redrawLater() {
    import('../../editor/editor.js').then(m => m.redrawCanvas());
}

// ---------- the panel ----------

function selected() {
    const el = activeElements()[state.selectedElementIndex];
    return el && el.type === 'colorkey' ? el : null;
}

/** Writes the body: the order of `entries`, the colours set by hand. */
function writeEntries(el, entries) {
    el.entries = entries.map(e => (e.written ? `${e.key}: ${e.written}` : e.key)).join('\n');
}

let panelReady = false;
function initPanel() {
    const panel = document.getElementById('properties-body');
    if (!panel || panelReady) return;
    panelReady = true;
    const changed = () => { markDirty(); document.dispatchEvent(new CustomEvent('slide-content-changed')); };
    panel.addEventListener('click', async (e) => {
        const op = e.target.closest('[data-ck-op]');
        const el = selected();
        if (!op || !el) return;
        const entries = colorKeyEntries(el);
        const i = Number(op.dataset.i);
        switch (op.dataset.ckOp) {
            case 'up': case 'down': {
                const j = op.dataset.ckOp === 'up' ? i - 1 : i + 1;
                if (j < 0 || j >= entries.length) return;
                [entries[i], entries[j]] = [entries[j], entries[i]];
                writeEntries(el, entries);
                break;
            }
            case 'shuffle': {
                for (let k = entries.length - 1; k > 0; k--) { const r = Math.floor(Math.random() * (k + 1)); [entries[k], entries[r]] = [entries[r], entries[k]]; }
                writeEntries(el, entries.map(x => ({ ...x, written: '' })));
                break;
            }
            // the keys in their own order, each the theme colour of its place
            case 'reset': el.entries = el.source || el.keys ? '' : parseColorLines(el.entries).map(l => l.key).join('\n'); break;
            case 'clear': entries[i].written = ''; writeEntries(el, entries); break;
            case 'pick': {
                const api = pyApi();
                if (!api || typeof api.select_vars_file !== 'function') { flashSaveIndicator('Files need the app'); return; }
                const picked = await api.select_vars_file();
                if (!picked || !picked.success || !picked.path) return;
                const res = await linkDataFile(picked.path);
                if (!res || !res.success) { flashSaveIndicator((res && res.error) || 'The file could not be read'); return; }
                el.source = res.relative_path;
                el.original = res.original;
                delete el.keys;
                delete el.use;
                break;
            }
            case 'unlink': el.keys = colorKeyEntries(el).map(x => x.key).join(', '); delete el.source; delete el.use; delete el.original; delete el.skip; break;
            default: return;
        }
        changed();
    });
    panel.addEventListener('change', (e) => {
        const f = e.target.closest('[data-ck-color]');
        const el = selected();
        if (!f || !el) return;
        const entries = colorKeyEntries(el);
        const entry = entries[Number(f.dataset.ckColor)];
        if (!entry) return;
        entry.written = f.value;
        writeEntries(el, entries);
        changed();
    });
}

function usesOf(el) {
    const t = el.source ? dataTable(el.source) : null;
    if (!t || t.error) return [];
    if (t.json !== undefined) return [['keys', 'its keys']];
    return [['header', 'the column names'], ...(t.header || []).map(h => [`column:${h}`, `the values of ${h}`])];
}

ElementRegistry.register({
    type: 'colorkey', label: 'Add Colour key', icon: '🎨', className: 'element-colorkey', category: 'interactive',

    gl: {
        props: ['x', 'y', 'width', 'height', 'var', 'label', 'keys', 'source', 'use', 'skip', 'original', 'legend', 'clickable', 'fontSize', 'fontFamily', 'fontColor'],
        numericProps: ['x', 'y', 'width', 'height', 'fontSize'],
        body: 'entries',
    },

    defaults() {
        const scale = state.slideWidth / 1920;
        // the options of a choice on the slide, if any: a colour each
        const choice = activeElements().find(e => e.type === 'choice');
        const keys = choice ? (choice.source ? '' : choice.options) : 'A, B, C';
        return {
            type: 'colorkey', x: 0, y: 0, width: Math.round(320 * scale), height: Math.round(200 * scale),
            var: freshName('colors'), keys: keys || 'A, B, C', ...(choice && choice.source ? { source: choice.source, use: choice.use, original: choice.original, keys: undefined } : {}),
            entries: '', legend: 'yes', clickable: 'yes', label: '',
            fontSize: Math.round(26 * scale), fontFamily: 'sans-serif', fontColor: state.isDarkMode ? '#f8fafc' : '#0f172a',
            bg: 'transparent', borderCol: 'transparent', borderWidth: 0, borderStyle: 'solid',
        };
    },

    renderDom(domEl, el, ctx) {
        const entries = colorKeyEntries(el);
        domEl.style.fontFamily = fontStack(el.fontFamily);
        domEl.style.color = el.fontColor;
        domEl.innerHTML = el.legend === 'no' ? chipMarkup(el, entries) : legendMarkup(el, entries, shownNow(el, entries));
        if (ctx.context !== 'canvas' || el.legend === 'no') return;
        // on the canvas the legend works once selected (style.css), like the other inputs
        bindSliders(domEl, {}, (name, v) => {
            setLiveValue(name, v);
            const canvas = document.getElementById('slide-canvas');
            liveUpdate(canvas, allVariables());
            if (hasFormulas()) liveApplyToCanvas(canvas, allVariables());
            redrawLater();
        });
    },

    exportStyle: (el) => (el.legend === 'no' ? 'display:none;' : `font-family:${fontStack(el.fontFamily)}; color:${el.fontColor};`),
    exportInner(el) {
        const entries = colorKeyEntries(el);
        return el.legend === 'no' ? '' : legendMarkup(el, entries, entries.map(e => e.key));
    },

    properties(el) {
        initPanel();
        const entries = colorKeyEntries(el);
        const uses = usesOf(el);
        const rows = entries.map((e, i) => `
            <div class="ck-row">
                <span class="ck-key" title="${escapeHtml(e.key)}">${escapeHtml(e.key)}</span>
                ${colorField({ 'data-ck-color': String(i), 'data-color-key': `ck-${i}` }, e.written || e.color, { allowNone: false })}
                ${e.set ? `<button type="button" class="prop-reset" data-ck-op="clear" data-i="${i}" title="Back to the theme colour of its place">↺</button>` : '<span class="ck-auto" title="The theme colour of its place">auto</span>'}
                <button type="button" class="prop-reset" data-ck-op="up" data-i="${i}" title="Earlier" ${i === 0 ? 'disabled' : ''}>↑</button>
                <button type="button" class="prop-reset" data-ck-op="down" data-i="${i}" title="Later" ${i === entries.length - 1 ? 'disabled' : ''}>↓</button>
            </div>`).join('');
        const source = el.source
            ? `<div class="prop-group"><label>Keys from</label><div class="layer-file"><code>${escapeHtml(el.source)}</code>
                <button type="button" class="btn btn-secondary" data-ck-op="pick">Choose…</button>
                <button type="button" class="prop-reset" data-ck-op="unlink" title="Write the keys instead">✕</button></div></div>
               ${uses.length ? `<div class="prop-group"><label>Take</label><select class="prop-control" data-prop="use">${uses.map(([u, t]) => `<option value="${escapeHtml(u)}" ${(el.use || 'header') === u ? 'selected' : ''}>${escapeHtml(t)}</option>`).join('')}</select></div>` : ''}`
            : `<div class="prop-group"><label>Keys (separated by commas)</label><input type="text" class="prop-control" data-prop="keys" value="${escapeHtml(el.keys || '')}" spellcheck="false"></div>
               <button type="button" class="btn btn-secondary" data-ck-op="pick" title="The runs of a CSV column, its column names, a JSON's keys">📄 Keys from a file…</button>`;
        const name = escapeHtml(el.var || 'colors');
        return `
            <div class="prop-divider"></div>
            <div class="prop-row">
                <div class="prop-group"><label>Variable</label><input type="text" class="prop-control" data-prop="var" value="${name}" spellcheck="false"></div>
                <div class="prop-group"><label>Title</label><input type="text" class="prop-control" data-prop="label" value="${escapeHtml(el.label || '')}"></div>
            </div>
            ${source}
            <div class="prop-group"><label>Colours</label><div class="ck-rows">${rows || '<p class="prop-hint"><em>No keys yet.</em></p>'}</div>
                <div class="arrange-row" style="margin-top:6px;"><button type="button" class="btn btn-secondary" data-ck-op="shuffle">🔀 Shuffle</button><button type="button" class="btn btn-secondary" data-ck-op="reset">↺ Palette order</button></div></div>
            <label class="prop-check"><input type="checkbox" data-prop="legend" ${el.legend !== 'no' ? 'checked' : ''}> Shown on the slide as a legend</label>
            <label class="prop-check"><input type="checkbox" data-prop="clickable" ${el.clickable !== 'no' ? 'checked' : ''} ${el.legend === 'no' ? 'disabled' : ''}> A click on a key turns it off and on (while presenting)</label>
            <p class="prop-hint">Each key has a colour: <code>${name}[run]</code> in formulas (a shape's fill: <code>=${name}[pick]</code>), <code>colors:${name}</code> on a plot layer with <em>One per value of</em>. The keys on: <code>${name}.shown</code> (<em>Only show</em> <code>=${name}.shown</code>).</p>`;
    },
});

export { parseColorLines };
