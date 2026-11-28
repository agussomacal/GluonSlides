// ============================================================
// ui/dataDrop.js — A CSV (or JSON) dropped on a slide: a small panel
// where it was dropped, with a preview, asks what to make of it:
//
//   ▦ Table    following the file, or its cells copied in once
//   📈 Plot    line, points, bars or histogram; x and the y columns
//              ("wide": one line per y column), or one line per value
//              of a column ("long": run, step, loss → group:run);
//              optionally a choice under it to pick the column(s), or
//              the run(s), while presenting
//   📋 Choice  options from the file (its column names, a column's
//              values; a JSON's keys)
//   𝑥 Variables  (a JSON) its values as variables
//
// The file is read where it is (nothing copied until you choose); then
// it is copied into data/ (core/plotData.js, backend/projectfiles.py)
// and followed. Enter makes the same kind of thing as last time.
// ============================================================

import { state, pyApi, flashSaveIndicator, forEachElementDeep } from '../core/state.js';
import { escapeHtml } from '../core/render.js';
import { linkDataFile } from '../core/plotData.js';
import { allVariables, linkVarFile } from '../core/variables.js';
import { tablePropsFromCsv, propsForRows } from '../elements/table/table.js';

const KINDS = [['line', 'Line'], ['points', 'Points'], ['bar', 'Bars'], ['hist', 'Histogram']];
let last = null; // what was made last time (Enter makes the same)
let box = null;
let done = null;

try { last = JSON.parse(localStorage.getItem('gluon-data-drop') || 'null'); } catch (e) { last = null; }

const isNumber = (v) => v !== '' && v !== undefined && v !== null && Number.isFinite(Number(v));
/** A setting's value as written in a plot line: quoted if it needs it. */
const q = (v) => (/^[^\s"{}=]+$/.test(String(v)) ? String(v) : `"${String(v).replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`);

/** What the file holds: { kind: 'table' | 'names' | 'json', header, rows, cols: [{ ref, label, numeric, repeats }] }. */
export function describeData(res) {
    if (res.json !== undefined) return { kind: 'json', json: res.json };
    const rows = (res.rows || []).filter(r => r.some(c => String(c ?? '').trim() !== ''));
    const header = res.header && res.header.length ? res.header : null;
    // names only: one per line, or one row (the options of a choice)
    if (!header && rows.length && rows.every(r => r.every(c => !isNumber(c))) && (rows.length === 1 || rows.every(r => r.filter(c => String(c).trim()).length === 1))) {
        return { kind: 'names', header: null, rows, total: res.total || rows.length };
    }
    const width = Math.max(0, ...rows.map(r => r.length), header ? header.length : 0);
    const sample = rows.slice(0, 200);
    const cols = Array.from({ length: width }, (_, k) => {
        const values = sample.map(r => String(r[k] ?? '').trim()).filter(Boolean);
        return {
            ref: header ? String(header[k] ?? `${k + 1}`) : String(k + 1),
            label: header ? String(header[k] ?? `column ${k + 1}`) : `column ${k + 1}`,
            numeric: values.length > 0 && values.every(isNumber),
            repeats: new Set(values).size < values.length,
        };
    });
    return { kind: 'table', header, rows, cols, total: res.total || rows.length };
}

/** The guess: long format when a text column repeats its values (run: adam, adam, sgd…). */
export function guessPlot(info) {
    const cols = info.cols || [];
    const numeric = cols.map((c, k) => (c.numeric ? k : -1)).filter(k => k >= 0);
    const group = cols.findIndex(c => !c.numeric && c.repeats);
    const text = cols.findIndex(c => !c.numeric);
    const long = group >= 0 && numeric.length >= 1;
    return {
        format: long ? 'long' : 'wide',
        group: group >= 0 ? group : text,
        x: numeric.length > 1 || !long ? (numeric[0] ?? 0) : numeric[0],
        y: long ? (numeric[1] ?? numeric[0] ?? 0) : (numeric[1] ?? numeric[0] ?? 0),
        ys: numeric.length > 1 ? numeric.slice(1) : numeric.slice(0, 1),
        barX: text >= 0 ? text : (numeric[0] ?? 0),
    };
}

function freshVar(base) {
    const used = new Set(Object.keys(allVariables()));
    const visit = (els) => forEachElementDeep(els || [], el => { if (el.var) used.add(el.var); });
    (state.slides || []).forEach(s => visit(s.elements));
    if (!used.has(base)) return base;
    let i = 2;
    while (used.has(`${base}${i}`)) i++;
    return `${base}${i}`;
}

/** The plot's layers (and the choice, if any) for these settings: { code, choice, xlabel, ylabel }. */
export function plotFrom(info, cfg, file, original) {
    const ref = (k) => info.cols[k].ref;
    const head = `data:{${file}}${original ? ` original:${q(original)}` : ''}`;
    const kind = cfg.kind;
    const xPart = kind === 'hist' ? '' : ` x:${q(ref(kind === 'bar' && cfg.format === 'wide' ? cfg.barX : cfg.x))}`;
    const yKey = kind === 'hist' ? 'column' : 'y';
    const pick = cfg.interactive ? freshVar('pick') : null;
    let code;
    let choice = null;
    if (cfg.format === 'long') {
        const g = ref(cfg.group);
        // a colour key for the runs: their colours, and (without a choice) its legend shows and hides them
        const key = cfg.colorkey ? freshVar(`${g.replace(/\W+/g, '_').replace(/^(\d)/, '_$1')}col`) : null;
        const show = pick ? ` show:"=${pick}"` : key && cfg.keyLegend ? ` show:"=${key}.shown"` : '';
        code = `.${kind} ${head}${xPart} ${yKey}:${q(ref(cfg.y))} group:${q(g)}${key ? ` colors:${key}` : ''}${show}`;
        const values = [...new Set(info.rows.map(r => String(r[cfg.group] ?? '').trim()).filter(Boolean))];
        if (pick) {
            choice = { var: pick, source: file, use: `column:${g}`, original, multiple: cfg.several ? 'yes' : 'no', value: cfg.several ? values.join(', ') : (values[0] || ''), label: g, options: values.join(', ') };
        }
        const colorkey = key ? { var: key, source: file, use: `column:${g}`, original, keys: undefined, label: g, legend: cfg.keyLegend ? 'yes' : 'no', clickable: pick ? 'no' : 'yes', entries: '', rows: values.length } : null;
        return { code, choice, colorkey, xlabel: kind === 'hist' ? ref(cfg.y) : ref(cfg.x), ylabel: kind === 'hist' ? '' : ref(cfg.y) };
    }
    const ys = [...cfg.ys].sort((a, b) => a - b);
    const names = ys.map(ref);
    // a colour key: each column its colour (color:"=colors['loss_adam']"); shown as a legend, it also shows and hides them
    const key = cfg.colorkey ? freshVar('colors') : null;
    const lit = (n) => `'${String(n).replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`;
    const colorOf = (n) => (key ? ` color:"=${key}[${lit(n)}]"` : '');
    if (pick && !cfg.several) {
        code = `.${kind} ${head}${xPart} ${yKey}:"=${pick}"${key ? ` color:"=${key}[${pick}]"` : ''}`;
    } else {
        code = names.map((n, k) => {
            const bars = kind === 'bar' && names.length > 1 ? ` barwidth:${(0.8 / names.length).toFixed(2)} offset:${((k - (names.length - 1) / 2) * 0.8 / names.length).toFixed(2)}` : '';
            const cond = pick ? ` visible:"=${lit(n)} in ${pick}"` : key && cfg.keyLegend ? ` visible:"=${lit(n)} in ${key}.shown"` : '';
            return `.${kind} ${head}${xPart} ${yKey}:${q(n)} label:${q(n)}${colorOf(n)}${bars}${cond}`;
        }).join('\n');
    }
    const colorkey = key ? { var: key, keys: names.join(', '), label: '', legend: cfg.keyLegend ? 'yes' : 'no', clickable: pick ? 'no' : 'yes', entries: '', rows: names.length } : null;
    if (pick) {
        const skip = info.cols.map(c => c.ref).filter(r => !names.includes(r));
        choice = { var: pick, source: info.header ? file : '', use: 'header', skip: skip.join(', '), original, multiple: cfg.several ? 'yes' : 'no', value: cfg.several ? names.join(', ') : names[0], label: 'Show', options: names.join(', ') };
        if (!info.header) delete choice.source; // no names in the file: the options are written
    }
    return { code, choice, colorkey, xlabel: kind === 'hist' ? (names.length === 1 ? names[0] : '') : ref(kind === 'bar' ? cfg.barX : cfg.x), ylabel: kind !== 'hist' && names.length === 1 && !pick ? names[0] : '' };
}

// ---------- the panel ----------

function close(result = null) {
    if (box) box.remove();
    box = null;
    if (marker) marker.remove();
    marker = null;
    document.removeEventListener('keydown', onKey, true);
    const d = done;
    done = null;
    if (d) d(result);
}

function onKey(e) {
    if (!box) return;
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(null); }
    else if (e.key === 'Enter' && !e.target.closest('select')) { e.preventDefault(); e.stopPropagation(); box.querySelector('[data-dd-add]')?.click(); }
}

function preview(info) {
    if (info.kind === 'json') {
        const keys = info.json && typeof info.json === 'object' ? Object.keys(info.json) : [];
        return `<div class="dd-keys">${keys.slice(0, 12).map(k => `<code>${escapeHtml(k)}</code>`).join(' ')}${keys.length > 12 ? ' …' : ''}</div>`;
    }
    const head = info.cols ? `<tr>${info.cols.map(c => `<th>${escapeHtml(c.label)}</th>`).join('')}</tr>` : '';
    const body = info.rows.slice(0, 4).map(r => `<tr>${r.map(c => `<td>${escapeHtml(c)}</td>`).join('')}</tr>`).join('');
    return `<div class="dd-preview"><table>${head}${body}</table>${info.total > 4 ? `<div class="dd-more">… ${info.total} rows</div>` : ''}</div>`;
}

function body(info, cfg) {
    if (cfg.mode === 'table') {
        return `<label class="prop-check"><input type="radio" name="dd-link" data-dd="linked" value="yes" ${cfg.linked ? 'checked' : ''}> following the file (its copy in data/)</label>
            <label class="prop-check"><input type="radio" name="dd-link" data-dd="linked" value="no" ${cfg.linked ? '' : 'checked'}> its cells copied in once</label>`;
    }
    if (cfg.mode === 'choice') {
        if (info.kind === 'json') return '<p class="prop-hint">Options: its keys (in the choice\'s panel: the keys of an object inside it).</p>';
        if (info.kind === 'names') return `<p class="prop-hint">Options: ${escapeHtml(info.rows.flat().filter(Boolean).slice(0, 8).join(', '))}</p>`;
        return `<div class="prop-group"><label>Options</label><select class="prop-control" data-dd="use">
            <option value="header" ${cfg.use === 'header' ? 'selected' : ''}>the column names</option>
            ${info.cols.map(c => `<option value="column:${escapeHtml(c.ref)}" ${cfg.use === `column:${c.ref}` ? 'selected' : ''}>the values of ${escapeHtml(c.label)}</option>`).join('')}</select></div>`;
    }
    if (cfg.mode === 'vars') return '<p class="prop-hint">Its values become variables (Project settings → Variables), followed when your script rewrites it: <code>\\var{name}</code> in text, <code>name</code> in formulas.</p>';
    // a plot
    const opt = (k, sel) => `<option value="${k}" ${sel ? 'selected' : ''}>${escapeHtml(info.cols[k].label)}</option>`;
    const cols = info.cols.map((_, k) => k);
    const hist = cfg.kind === 'hist';
    const xCol = cfg.kind === 'bar' && cfg.format === 'wide' ? cfg.barX : cfg.x;
    const longOk = info.cols.some(c => !c.numeric);
    return `
        <div class="dd-kinds">${KINDS.map(([k, t]) => `<button type="button" class="dd-chip${cfg.kind === k ? ' on' : ''}" data-dd-kind="${k}">${t}</button>`).join('')}</div>
        <div class="dd-format">
            <label class="prop-check"><input type="radio" name="dd-format" data-dd="format" value="wide" ${cfg.format === 'wide' ? 'checked' : ''}> one ${hist ? 'histogram' : 'line'} per ${hist ? '' : 'y '}column</label>
            <label class="prop-check" ${longOk ? '' : 'title="No column of names to split by"'}><input type="radio" name="dd-format" data-dd="format" value="long" ${cfg.format === 'long' ? 'checked' : ''} ${longOk ? '' : 'disabled'}> one per value of
                <select class="prop-control dd-inline" data-dd="group" ${cfg.format === 'long' ? '' : 'disabled'}>${cols.filter(k => !info.cols[k].numeric).map(k => opt(k, k === cfg.group)).join('')}</select></label>
        </div>
        <div class="prop-row">
            ${hist ? '' : `<div class="prop-group"><label>x</label><select class="prop-control" data-dd="${cfg.kind === 'bar' && cfg.format === 'wide' ? 'barX' : 'x'}">${cols.map(k => opt(k, k === xCol)).join('')}</select></div>`}
            ${cfg.format === 'long'
        ? `<div class="prop-group"><label>${hist ? 'Values' : 'y'}</label><select class="prop-control" data-dd="y">${cols.filter(k => info.cols[k].numeric).map(k => opt(k, k === cfg.y)).join('')}</select></div>`
        : `<div class="prop-group"><label>${hist ? 'Columns' : 'y'}</label><div class="dd-ys">${cols.filter(k => info.cols[k].numeric && (hist || k !== xCol)).map(k => `<label class="prop-check"><input type="checkbox" data-dd-y="${k}" ${cfg.ys.has(k) ? 'checked' : ''}> ${escapeHtml(info.cols[k].label)}</label>`).join('')}</div></div>`}
        </div>
        <label class="prop-check"><input type="checkbox" data-dd="interactive" ${cfg.interactive ? 'checked' : ''}> let me choose the ${cfg.format === 'long' ? escapeHtml(info.cols[cfg.group] ? info.cols[cfg.group].label : 'group') : 'column'} while presenting (a choice under the plot)</label>
        ${cfg.interactive ? `<label class="prop-check dd-sub"><input type="checkbox" data-dd="several" ${cfg.several ? 'checked' : ''}> several at once (Ctrl+click)</label>` : ''}
        <label class="prop-check"><input type="checkbox" data-dd="colorkey" ${cfg.colorkey ? 'checked' : ''}> 🎨 a colour key to set the colours of the ${cfg.format === 'long' ? `${escapeHtml(info.cols[cfg.group] ? info.cols[cfg.group].label : 'group')}s` : 'lines'} (the same in every plot; hidden while presenting)</label>
        ${cfg.colorkey ? `<label class="prop-check dd-sub"><input type="checkbox" data-dd="keyLegend" ${cfg.keyLegend ? 'checked' : ''}> shown as a legend${cfg.interactive ? '' : ': a click shows and hides them'}</label>` : ''}`;
}

function render(info, cfg, name) {
    const modes = info.kind === 'json' ? [['choice', '📋 Choice'], ['vars', '𝑥 Variables']]
        : info.kind === 'names' ? [['choice', '📋 Choice'], ['table', '▦ Table']]
            : [['table', '▦ Table'], ['plot', '📈 Plot'], ['choice', '📋 Choice']];
    if (!modes.some(([m]) => m === cfg.mode)) cfg.mode = modes[0][0];
    const what = info.kind === 'json' ? 'a JSON file' : info.kind === 'names' ? `${info.rows.flat().filter(Boolean).length} names` : `${info.total} rows · ${info.cols.length} columns`;
    const scroll = box.querySelector('.dd-scroll')?.scrollTop || 0;
    box.innerHTML = `
        <div class="dd-title" title="Drag to move">📄 ${escapeHtml(name)} <span>· ${escapeHtml(what)}</span></div>
        <div class="dd-scroll">
            ${preview(info)}
            <div class="dd-modes">${modes.map(([m, t]) => `<button type="button" class="dd-mode${cfg.mode === m ? ' on' : ''}" data-dd-mode="${m}">${t}</button>`).join('')}</div>
            <div class="dd-body">${body(info, cfg)}</div>
        </div>
        <div class="dd-actions"><button type="button" class="btn btn-secondary" data-dd-cancel>Cancel</button><button type="button" class="btn btn-primary" data-dd-add>Add ⏎</button></div>`;
    box.querySelector('.dd-scroll').scrollTop = scroll;
    showMarker(cfg);
}

// ---------- where it will go: a dashed frame on the slide ----------

let marker = null;
let markerAt = null;

/** The size of what the panel would make now (slide pixels). */
function sizeFor(cfg) {
    const scale = state.slideWidth / 1920;
    if (cfg.mode === 'plot') return { w: 1100 * scale + (cfg.colorkey && cfg.keyLegend ? 196 * scale : 0), h: 640 * scale + (cfg.interactive ? ((cfg.several ? 200 : 70) + 16) * scale : 0) };
    if (cfg.mode === 'choice') return { w: 460 * scale, h: 70 * scale };
    if (cfg.mode === 'table') return { w: 1000 * scale, h: 400 * scale };
    return null;
}

function showMarker(cfg) {
    const canvas = document.getElementById('slide-canvas');
    const size = sizeFor(cfg);
    if (!canvas || !size) { if (marker) marker.remove(); marker = null; return; }
    if (!marker || !canvas.contains(marker)) {
        marker = document.createElement('div');
        marker.className = 'dd-marker';
        canvas.appendChild(marker);
    }
    const pos = placeAt(markerAt, size.w, size.h);
    Object.assign(marker.style, { left: `${pos.x}px`, top: `${pos.y}px`, width: `${size.w}px`, height: `${size.h}px` });
}

/** The title bar moves the panel. */
function draggable() {
    box.addEventListener('mousedown', (e) => {
        const title = e.target.closest('.dd-title');
        if (!title || e.button !== 0) return;
        e.preventDefault();
        const r = box.getBoundingClientRect();
        const dx = e.clientX - r.left;
        const dy = e.clientY - r.top;
        box.classList.add('moved');
        const move = (ev) => {
            box.style.left = `${Math.max(0, Math.min(window.innerWidth - 60, ev.clientX - dx))}px`;
            box.style.top = `${Math.max(0, Math.min(window.innerHeight - 40, ev.clientY - dy))}px`;
        };
        const up = () => { document.removeEventListener('mousemove', move); document.removeEventListener('mouseup', up); };
        move(e);
        document.addEventListener('mousemove', move);
        document.addEventListener('mouseup', up);
    });
}

/**
 * Asks what to make of a dropped data file and makes it. `item`: { name,
 * path }; `at`: the drop point (slide coordinates) or null; `client`:
 * where to show the panel (window coordinates); `insert(type, props)`.
 * Resolves when done or cancelled.
 */
export async function openDataDrop(item, at, client, insert) {
    const api = pyApi();
    if (!api || typeof api.read_plot_data !== 'function') return false;
    const res = await api.read_plot_data(state.projectFolder || '', item.path);
    if (!res || !res.success) { flashSaveIndicator(`Could not read ${item.name}${res && res.error ? `: ${res.error}` : ''}`); return true; }
    const info = describeData(res);
    const guess = info.kind === 'table' ? guessPlot(info) : {};
    const cfg = {
        mode: (last && last.mode) || (info.kind === 'table' ? 'table' : 'choice'),
        linked: last ? last.linked !== false : true,
        kind: (last && last.kind) || 'line',
        format: guess.format || 'wide',
        group: guess.group, x: guess.x, y: guess.y, barX: guess.barX,
        ys: new Set(guess.ys || []),
        interactive: Boolean(last && last.interactive),
        colorkey: last ? last.colorkey !== false : true, // a colour key comes with a plot unless turned off
        keyLegend: Boolean(last && last.keyLegend),
        several: Boolean(last && last.several),
        use: 'header',
    };
    if (info.kind === 'table' && cfg.format === 'wide' && !info.header) cfg.use = 'column:1';
    if (!info.cols || !info.cols.some(c => !c.numeric)) cfg.format = 'wide';
    closeDataDrop();
    // in the middle of the window, whole (it scrolls inside if needed); a frame on the slide shows where it goes
    void client;
    markerAt = at;
    box = document.createElement('div');
    box.className = 'data-drop';
    document.body.appendChild(box);
    render(info, cfg, item.name);
    draggable();
    document.addEventListener('keydown', onKey, true);
    box.addEventListener('mousedown', (e) => e.stopPropagation());
    box.addEventListener('click', (e) => {
        const mode = e.target.closest('[data-dd-mode]');
        const kind = e.target.closest('[data-dd-kind]');
        if (mode) { cfg.mode = mode.dataset.ddMode; render(info, cfg, item.name); return; }
        if (kind) {
            cfg.kind = kind.dataset.ddKind;
            if (cfg.kind === 'hist' && cfg.format === 'wide' && !cfg.ys.size) cfg.ys = new Set(info.cols.map((c, k) => (c.numeric ? k : -1)).filter(k => k >= 0).slice(0, 1));
            render(info, cfg, item.name);
            return;
        }
        if (e.target.closest('[data-dd-cancel]')) { close(null); return; }
        if (e.target.closest('[data-dd-add]')) make(info, cfg, item, at, insert).then(ok => { if (ok) close(true); });
    });
    box.addEventListener('change', (e) => {
        const t = e.target;
        if (t.dataset.ddY !== undefined) { const k = Number(t.dataset.ddY); if (t.checked) cfg.ys.add(k); else cfg.ys.delete(k); return; }
        const key = t.dataset.dd;
        if (!key) return;
        if (key === 'linked') cfg.linked = t.value === 'yes';
        else if (key === 'format') cfg.format = t.value;
        else if (['interactive', 'several', 'colorkey', 'keyLegend'].includes(key)) cfg[key] = t.checked;
        else if (key === 'use') cfg.use = t.value;
        else cfg[key] = Number(t.value);
        if (key === 'x') cfg.ys.delete(cfg.x);
        render(info, cfg, item.name);
    });
    box.querySelector('[data-dd-add]')?.focus();
    return new Promise(resolve => { done = resolve; });
}

export function closeDataDrop() {
    if (box) close(null);
}

function placeAt(at, w, h) {
    const cx = at ? at.x : state.slideWidth / 2;
    const cy = at ? at.y : state.slideHeight / 2;
    return {
        x: Math.round(Math.max(0, Math.min(state.slideWidth - w, cx - w / 2))),
        y: Math.round(Math.max(0, Math.min(state.slideHeight - h, cy - h / 2))),
    };
}

/** Makes what the panel says. False: stay open (a message said why). */
async function make(info, cfg, item, at, insert) {
    const scale = state.slideWidth / 1920;
    const remember = () => {
        last = { mode: cfg.mode, linked: cfg.linked, kind: cfg.kind, interactive: cfg.interactive, several: cfg.several, colorkey: cfg.colorkey, keyLegend: cfg.keyLegend };
        try { localStorage.setItem('gluon-data-drop', JSON.stringify(last)); } catch (e) { /* not kept */ }
    };
    const needFolder = () => { if (state.projectFolder) return true; flashSaveIndicator('Save the project first: the file is copied into its folder'); return false; };
    if (cfg.mode === 'table') {
        let props;
        if (cfg.linked && state.projectFolder) props = await tablePropsFromCsv(item.path);
        else {
            const rows = info.kind === 'names' ? info.rows : [...(info.header ? [info.header] : []), ...info.rows].slice(0, 200);
            props = propsForRows(rows.map(r => r.map(c => String(c ?? ''))));
        }
        if (!props) return false;
        Object.assign(props, placeAt(at, props.width, props.height));
        insert('table', props);
        remember();
        return true;
    }
    if (cfg.mode === 'vars') {
        if (!needFolder()) return false;
        const res = await linkVarFile(item.path);
        if (!res || !res.success) { flashSaveIndicator((res && res.error) || 'Could not read the file'); return false; }
        flashSaveIndicator(`${Object.keys(res.values || {}).length} variables from ${res.relative_path} ✓`);
        document.dispatchEvent(new CustomEvent('slide-content-changed'));
        remember();
        return true;
    }
    if (!needFolder()) return false;
    if (cfg.mode === 'plot' && cfg.format === 'wide' && !cfg.ys.size) { flashSaveIndicator('Tick at least one column to draw'); return false; }
    const link = await linkDataFile(item.path);
    if (!link || !link.success) { flashSaveIndicator((link && link.error) || 'Could not copy the file'); return false; }
    const file = link.relative_path;
    if (cfg.mode === 'choice') {
        const use = info.kind === 'json' ? 'keys' : info.kind === 'names' ? 'header' : cfg.use;
        const h = Math.round(70 * scale);
        const props = { var: freshVar('choice'), source: file, original: link.original, use, label: 'Choose', options: '', value: '', multiple: 'no', width: Math.round(460 * scale), height: h };
        Object.assign(props, placeAt(at, props.width, h));
        insert('choice', props);
        remember();
        return true;
    }
    const plot = plotFrom(info, cfg, file, link.original);
    const choiceH = plot.choice ? Math.round((cfg.several ? 200 : 70) * scale) : 0;
    // a colour key: a legend on the plot's right
    const keyShown = plot.colorkey && plot.colorkey.legend === 'yes';
    const keyW = keyShown ? Math.round(300 * scale) : 0;
    const w = Math.round(1100 * scale) - (keyW ? Math.round(120 * scale) : 0);
    const h = Math.min(Math.round(640 * scale), state.slideHeight - choiceH - Math.round(30 * scale));
    const pos = placeAt(at, w + (keyW ? keyW + Math.round(16 * scale) : 0), h + (choiceH ? choiceH + Math.round(16 * scale) : 0));
    insert('plot', { ...pos, width: w, height: h, lang: 'python', code: plot.code, xmin: '', xmax: '', ymin: '', ymax: '', xlabel: plot.xlabel, ylabel: plot.ylabel, ...(keyShown ? { legend: 'no' } : {}) });
    if (plot.colorkey) {
        const { rows, ...props } = plot.colorkey;
        if (keyShown) insert('colorkey', { ...props, x: pos.x + w + Math.round(16 * scale), y: pos.y + Math.round(20 * scale), width: keyW, height: Math.min(h, Math.round((rows + (props.label ? 1.3 : 0)) * 40 * scale + 20 * scale)) });
        else {
            // hidden while presenting: a small chip in the editor, by the plot's top right corner
            const cw = Math.round(260 * scale);
            const ch = Math.round(Math.min(6, rows + 1.6) * 30 * scale);
            insert('colorkey', { ...props, x: Math.min(state.slideWidth - cw, pos.x + w - cw), y: Math.max(0, pos.y - ch - Math.round(8 * scale)), width: cw, height: ch });
        }
    }
    if (plot.choice) {
        insert('choice', { ...plot.choice, x: pos.x, y: pos.y + h + Math.round(16 * scale), width: Math.round(520 * scale), height: choiceH });
    }
    remember();
    return true;
}
