// ============================================================
// elements/table/table.js — Tables: cells with Markdown and math, a
// header row, borders (none / horizontal, as in papers / all), striped
// rows, and per row / column / cell: bold, italic, colour, background,
// alignment, and a number format for columns. A CSV can be imported
// once, or linked: the table then follows the file (data/<name>.csv, a
// copy kept up to date from the original, like linked figures).
//
//   .element.table id:30 x:100 y:300 width:1200 height:400 header:yes borders:horizontal
//   	.data {data/results.csv} sync:yes original:"/home/me/run/results.csv"
//   	.widths 40,30,30
//   	.row 1 bold:yes bg:#eeeeee
//   	.col 3 align:right format:%.2e
//   	.cell 2,3 color:#cc0000
//   	| Method | Iterations | Error |
//   	| NGD | 120 | 0.00123 |
//
// Rows and columns count from 1. The cells are always written (also for
// a linked table: the .gl stays complete; a | in a cell is \|, a line
// break <br>). Canvas: double-click a cell to edit it (Tab / Shift+Tab,
// Enter: next cell / previous / below; Esc or a click outside: done); a
// click picks the cell the panel styles; handles on the top edge change
// column widths. Pasting cells copied from a spreadsheet makes a table.
// ============================================================

import { state, markDirty, pyApi, flashSaveIndicator, forEachElementDeep } from '../../core/state.js';
import { fontStack } from '../../core/fonts.js';
import { colorField } from '../../ui/colorPicker.js';
import { ElementRegistry } from '../../core/registry.js';
import { renderMarkdownAndKatex, escapeHtml } from '../../core/render.js';
import { fontOptions } from '../text/text.js';
import { resolveColor } from '../../core/colors.js';
import { busy } from '../../ui/busy.js';

const STYLE_KEYS = ['bold', 'italic', 'color', 'bg', 'align', 'format'];
const MIN_SHARE = 0.05;

// Transient (not saved): the cell the panel styles, per table id; and what it styles.
const activeCell = new Map();
let styleScope = 'cell';
let panelTable = null;

function notifyContentChanged() {
    document.dispatchEvent(new CustomEvent('slide-content-changed'));
}

export function rowsOf(el) {
    if (!Array.isArray(el.rows) || !el.rows.length) el.rows = [['']];
    // padded in place: editors keep a reference to this array
    const n = Math.max(...el.rows.map(r => r.length));
    el.rows.forEach(r => { while (r.length < n) r.push(''); });
    return el.rows;
}

function colCount(el) {
    return rowsOf(el)[0].length;
}

function shares(el) {
    const n = colCount(el);
    const w = Array.isArray(el.widths) && el.widths.length === n ? el.widths.map(Number) : Array(n).fill(1);
    const total = w.reduce((s, v) => s + (v > 0 ? v : 1), 0) || 1;
    return w.map(v => (v > 0 ? v : 1) / total);
}

// ---------- styles ----------

function stylesOf(el) {
    if (!Array.isArray(el.styles)) el.styles = [];
    return el.styles;
}

function findStyle(el, scope, index) {
    const key = JSON.stringify(index);
    return stylesOf(el).find(s => s.scope === scope && JSON.stringify(s.index) === key);
}

/** Effective style of a cell (1-based r, c): column < row < cell. */
function cellStyle(el, r, c) {
    const out = {};
    const apply = (s) => { if (s) Object.assign(out, s.props); };
    apply(findStyle(el, 'col', c));
    apply(findStyle(el, 'row', r));
    apply(findStyle(el, 'cell', [r, c]));
    return out;
}

function setStyle(el, scope, index, key, value) {
    let s = findStyle(el, scope, index);
    if (!s) {
        s = { scope, index, props: {} };
        stylesOf(el).push(s);
    }
    if (value === '' || value === null || value === undefined) delete s.props[key];
    else s.props[key] = value;
    if (!Object.keys(s.props).length) el.styles = stylesOf(el).filter(x => x !== s);
}

/** Shifts style indices when rows / columns are inserted (+1) or removed (-1). */
function shiftStyles(el, axis, at, delta) {
    el.styles = stylesOf(el).filter(s => {
        const idx = s.scope === 'cell' ? s.index[axis === 'row' ? 0 : 1] : s.scope === axis ? s.index : null;
        if (idx === null) return true;
        if (delta < 0 && idx === at) return false;
        if (idx >= at + (delta > 0 ? 0 : 1)) {
            if (s.scope === 'cell') s.index[axis === 'row' ? 0 : 1] += delta;
            else s.index += delta;
        }
        return true;
    });
}

// ---------- number formats: %.2f  %.3e  %.4g  %d  %.1%% ----------

export function formatNumber(text, fmt) {
    const raw = String(text ?? '').trim();
    if (!fmt || raw === '' || !/^[-+]?(\d+\.?\d*|\.\d+)([eE][-+]?\d+)?$/.test(raw)) return text;
    const v = Number(raw);
    const m = String(fmt).match(/^%(\.(\d+))?([fegd%])$/);
    if (!m) return text;
    const p = m[2] !== undefined ? Number(m[2]) : 2;
    switch (m[3]) {
        case 'f': return v.toFixed(p);
        case 'e': return v.toExponential(p);
        case 'g': return String(Number(v.toPrecision(Math.max(1, p))));
        case 'd': return String(Math.round(v));
        case '%': return `${(v * 100).toFixed(p)}%`;
        default: return text;
    }
}

// ---------- drawing ----------

function buildTable(domEl, el, { editing = null, context = 'canvas' } = {}) {
    const rows = rowsOf(el);
    const table = document.createElement('table');
    table.className = `gl-table borders-${el.borders || 'horizontal'}${el.stripes === 'yes' ? ' stripes' : ''}`;
    // Colours may be theme colours (@primary, @accent/40): resolved to CSS
    table.style.setProperty('--rule', resolveColor(el.ruleColor || el.fontColor || '#0f172a'));
    table.style.setProperty('--header-bg', resolveColor(el.headerBg || 'transparent'));
    const colgroup = document.createElement('colgroup');
    shares(el).forEach(f => {
        const col = document.createElement('col');
        col.style.width = `${(f * 100).toFixed(2)}%`;
        colgroup.appendChild(col);
    });
    table.appendChild(colgroup);
    const body = document.createElement('tbody');
    const active = activeCell.get(el.id);
    rows.forEach((row, ri) => {
        const tr = document.createElement('tr');
        const isHeader = el.header !== 'no' && ri === 0;
        if (isHeader) tr.className = 'gl-table-header';
        row.forEach((text, ci) => {
            const cell = document.createElement(isHeader ? 'th' : 'td');
            cell.dataset.r = String(ri + 1);
            cell.dataset.c = String(ci + 1);
            const st = cellStyle(el, ri + 1, ci + 1);
            if (st.bold === 'yes') cell.style.fontWeight = '700';
            else if (st.bold === 'no') cell.style.fontWeight = '400';
            if (st.italic === 'yes') cell.style.fontStyle = 'italic';
            if (st.color) cell.style.color = resolveColor(st.color);
            if (st.bg) cell.style.background = resolveColor(st.bg);
            if (st.align) cell.style.textAlign = st.align;
            if (context === 'canvas' && active && active[0] === ri + 1 && active[1] === ci + 1) cell.classList.add('gl-cell-active');
            if (editing && editing[0] === ri + 1 && editing[1] === ci + 1) {
                cell.contentEditable = 'true';
                cell.classList.add('gl-cell-editing');
                cell.innerText = text;
            } else {
                const shown = formatNumber(text, cellStyle(el, ri + 1, ci + 1).format);
                try {
                    renderMarkdownAndKatex(cell, shown);
                } catch (err) {
                    cell.textContent = shown;
                }
            }
            tr.appendChild(cell);
        });
        body.appendChild(tr);
    });
    table.appendChild(body);
    domEl.replaceChildren(table);
    return table;
}

// ---------- editing cells ----------

function commitCell(domEl, el) {
    const cell = domEl.querySelector('.gl-cell-editing');
    if (cell) {
        const r = Number(cell.dataset.r) - 1;
        const c = Number(cell.dataset.c) - 1;
        if (rowsOf(el)[r]) el.rows[r][c] = cell.innerText.replace(/\n$/, '');
    }
    domEl.classList.remove('editing-mode');
    delete domEl.dataset.editingCell;
    markDirty();
}

function editCell(domEl, el, r, c) {
    if (el.data && el.data.src) {
        flashSaveIndicator(`Linked to ${el.data.src}: edit the file, or Unlink the table`);
        return;
    }
    activeCell.set(el.id, [r, c]);
    domEl.classList.add('editing-mode');
    domEl.dataset.editingCell = `${r},${c}`;
    buildTable(domEl, el, { editing: [r, c] });
    const cell = domEl.querySelector('.gl-cell-editing');
    if (!cell) return;
    cell.focus();
    const range = document.createRange();
    range.selectNodeContents(cell);
    range.collapse(false);
    const sel = window.getSelection();
    sel.removeAllRanges();
    sel.addRange(range);
    const rows = rowsOf(el);
    const move = (dr, dc, grow) => {
        commitCell(domEl, el);
        let nr = r + dr;
        let nc = c + dc;
        const ncols = colCount(el);
        if (nc > ncols) { nc = 1; nr += 1; }
        if (nc < 1) { nc = ncols; nr -= 1; }
        if (nr > rows.length) {
            if (!grow) { notifyContentChanged(); return; }
            rows.push(Array(ncols).fill(''));
        }
        if (nr < 1) nr = 1;
        editCell(domEl, el, nr, nc);
    };
    cell.addEventListener('input', () => {
        rows[r - 1][c - 1] = cell.innerText;
        markDirty();
    });
    cell.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') {
            e.preventDefault();
            e.stopPropagation();
            commitCell(domEl, el);
            notifyContentChanged();
        } else if (e.key === 'Tab') {
            e.preventDefault();
            e.stopPropagation();
            move(0, e.shiftKey ? -1 : 1, !e.shiftKey);
        } else if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            e.stopPropagation();
            move(1, 0, false);
        }
    });
    cell.addEventListener('blur', () => {
        setTimeout(() => {
            if (domEl.classList.contains('editing-mode') && !domEl.contains(document.activeElement)) {
                commitCell(domEl, el);
                notifyContentChanged();
            }
        }, 0);
    });
}

// ---------- rows and columns ----------

function addRow(el, after) {
    const rows = rowsOf(el);
    rows.splice(after, 0, Array(colCount(el)).fill(''));
    shiftStyles(el, 'row', after + 1, +1);
}

function addCol(el, after) {
    rowsOf(el).forEach(r => r.splice(after, 0, ''));
    if (Array.isArray(el.widths) && el.widths.length === colCount(el) - 1) {
        el.widths.splice(after, 0, Math.round(100 / colCount(el)));
    }
    shiftStyles(el, 'col', after + 1, +1);
}

function deleteRow(el, r) {
    const rows = rowsOf(el);
    if (rows.length <= 1) return;
    rows.splice(r - 1, 1);
    shiftStyles(el, 'row', r, -1);
}

function deleteCol(el, c) {
    if (colCount(el) <= 1) return;
    rowsOf(el).forEach(r => r.splice(c - 1, 1));
    if (Array.isArray(el.widths)) el.widths.splice(c - 1, 1);
    shiftStyles(el, 'col', c, -1);
}

// ---------- .gl ----------

function quote(v) {
    return /[\s"]/.test(v) ? `"${String(v).replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"` : v;
}

function params(text) {
    const out = {};
    for (const m of text.matchAll(/(\w+):(?:"((?:\\.|[^"\\])*)"|(\S+))/g)) {
        out[m[1]] = m[2] !== undefined ? m[2].replace(/\\(.)/g, '$1') : m[3];
    }
    return out;
}

function encodeCell(text) {
    return String(text ?? '').replace(/\|/g, '\\|').replace(/\n/g, '<br>');
}

function decodeCell(text) {
    return text.replace(/\\\|/g, '|').replace(/<br\s*\/?>/gi, '\n').trim();
}

export function splitRow(line) {
    let s = line.trim();
    if (s.startsWith('|')) s = s.slice(1);
    if (s.endsWith('|') && !s.endsWith('\\|')) s = s.slice(0, -1);
    return s.split(/(?<!\\)\|/).map(decodeCell);
}

// ---------- CSV ----------

async function chooseCsv() {
    const api = pyApi();
    if (!api || typeof api.select_table_file !== 'function') return null;
    const res = await api.select_table_file();
    return res && res.success ? res.path : null;
}

function sizeToFit(el) {
    // keep the box; a new table from a file gets room for its rows
    const rows = rowsOf(el).length;
    const want = Math.round(rows * (Number(el.fontSize) || 28) * 1.9);
    if (want > el.height) el.height = Math.min(want, state.slideHeight - el.y);
}

function linkedTables() {
    const out = [];
    const lists = [...(state.slides || []).map(s => s.elements), ...(state.masters || []).map(m => m.elements)];
    lists.forEach(list => forEachElementDeep(list || [], el => {
        if (el.type === 'table' && el.data && el.data.src) out.push(el);
    }));
    return out;
}

let syncBusy = false;

/** Re-reads linked CSVs that changed (force: all of them). */
export async function syncLinkedTables({ force = false } = {}) {
    const api = pyApi();
    if (syncBusy || !api || typeof api.refresh_tables !== 'function' || !state.projectFolder) return 0;
    const tables = linkedTables().filter(t => force || t.data.sync !== 'no');
    if (!tables.length) return 0;
    syncBusy = true;
    try {
        const items = tables.map(t => ({ src: t.data.src, original: t.data.original || '', mtime: force ? 0 : (t._mtime || 0) }));
        const res = await api.refresh_tables(state.projectFolder, items);
        let changed = 0;
        (res && res.updated || []).forEach(u => {
            tables.filter(t => t.data.src === u.src).forEach(t => {
                const before = JSON.stringify(t.rows);
                t._mtime = u.mtime;
                t.rows = u.rows;
                if (JSON.stringify(t.rows) !== before) changed++;
            });
        });
        if (changed) {
            markDirty();
            notifyContentChanged();
        }
        return changed;
    } finally {
        syncBusy = false;
    }
}

let syncTimer = null;

export function startTableSync(intervalMs = 3000) {
    if (syncTimer) return;
    const tick = () => {
        const editor = document.getElementById('editor-view');
        if (editor && editor.classList.contains('active') && !document.hidden) syncLinkedTables();
    };
    syncTimer = setInterval(tick, intervalMs);
    window.addEventListener('focus', tick);
}

/** Cells of pasted text: tab-separated (a spreadsheet), a Markdown table,
 *  or CSV (comma or semicolon, with "quoted, cells"). [] when empty. */
export function parseCellsText(text) {
    const t = String(text || '').replace(/^﻿/, '').replace(/\r\n?/g, '\n').replace(/\n+$/, '');
    if (!t.trim()) return [];
    const lines = t.split('\n');
    let rows;
    if (lines.every(l => /^\s*\|.*\|\s*$/.test(l))) {
        rows = lines.filter(l => !/^\s*\|[\s:|-]+\|\s*$/.test(l)).map(l => splitRow(l.trim()));
    } else {
        const first = lines.slice(0, 20).join('\n');
        const count = (ch) => (first.match(new RegExp(ch, 'g')) || []).length;
        const delim = count('\t') ? '\t' : count(';') > count(',') ? ';' : ',';
        rows = [];
        let row = [], cell = '', quoted = false;
        for (let i = 0; i < t.length; i++) {
            const ch = t[i];
            if (quoted) {
                if (ch === '"' && t[i + 1] === '"') { cell += '"'; i++; }
                else if (ch === '"') quoted = false;
                else cell += ch;
            } else if (ch === '"' && cell === '') quoted = true;
            else if (ch === delim) { row.push(cell); cell = ''; }
            else if (ch === '\n') { row.push(cell); rows.push(row); row = []; cell = ''; }
            else cell += ch;
        }
        row.push(cell);
        rows.push(row);
        rows = rows.map(r => r.map(c => c.trim()));
    }
    const n = Math.max(...rows.map(r => r.length));
    return rows.map(r => [...r, ...Array(n - r.length).fill('')]);
}

/** Props for a new table holding `rows`: the box grows to fit them. */
function propsForRows(rows, extra = {}) {
    const scale = state.slideWidth / 1920;
    const cols = rows.length ? rows[0].length : 1;
    const fontSize = Math.round(28 * scale);
    return {
        rows,
        width: Math.round(Math.min(state.slideWidth * 0.85, Math.max(1000 * scale, cols * 200 * scale))),
        height: Math.round(Math.min(state.slideHeight * 0.8, Math.max(120 * scale, rows.length * fontSize * 1.9))),
        ...extra,
    };
}

/**
 * Props for a table made from a CSV file. Linked (copied into data/,
 * following the original) when the project is saved; otherwise the
 * cells are imported once. null if the file can't be read.
 */
export async function tablePropsFromCsv(path) {
    const api = pyApi();
    if (!api || !path) return null;
    if (state.projectFolder && typeof api.link_table_file === 'function') {
        const res = await busy(`Reading ${path.split(/[/\\]/).pop()}…`, api.link_table_file(state.projectFolder, path));
        if (res && res.success) {
            flashSaveIndicator(`Linked to ${res.relative_path} ✓`);
            return propsForRows(res.rows, {
                data: { src: res.relative_path, sync: 'yes', original: res.original }, _mtime: res.mtime,
            });
        }
    }
    const res = await api.read_table_file(state.projectFolder || '', path);
    if (!res || !res.success) {
        flashSaveIndicator(`Could not read ${path}${res && res.error ? ': ' + res.error : ''}`);
        return null;
    }
    flashSaveIndicator('Imported (save the project to link the table to the file)');
    return propsForRows(res.rows);
}

/** The "From pasted cells" dialog: resolves to rows, or null. */
async function askPastedCells() {
    let initial = '';
    try {
        const api = pyApi();
        const clip = api && typeof api.read_clipboard === 'function' ? await api.read_clipboard() : null;
        if (clip && typeof clip.text === 'string' && /[\t,;|]/.test(clip.text)) initial = clip.text;
    } catch (e) { /* no clipboard: an empty box */ }
    return new Promise((resolve) => {
        const back = document.createElement('div');
        back.className = 'modal-backdrop show';
        back.id = 'table-paste-modal';
        back.innerHTML = `
            <div class="modal" style="width: 560px;">
                <h3>Table from pasted cells</h3>
                <p class="prop-hint">Paste cells copied from a spreadsheet, a CSV or a Markdown table.</p>
                <textarea class="prop-control table-paste-text" rows="10" spellcheck="false"
                    placeholder="Method&#9;Iterations&#9;Error&#10;NGD&#9;120&#9;0.00123"></textarea>
                <label class="prop-check"><input type="checkbox" class="table-paste-header" checked> The first row is a header</label>
                <div class="prop-hint table-paste-status"></div>
                <div class="modal-actions">
                    <button class="btn btn-secondary" data-paste="cancel">Cancel</button>
                    <button class="btn btn-primary" data-paste="ok">Create table</button>
                </div>
            </div>`;
        document.body.appendChild(back);
        const area = back.querySelector('.table-paste-text');
        const status = back.querySelector('.table-paste-status');
        const ok = back.querySelector('[data-paste="ok"]');
        area.value = initial;
        const update = () => {
            const rows = parseCellsText(area.value);
            ok.disabled = !rows.length;
            status.textContent = rows.length ? `${rows.length} row${rows.length > 1 ? 's' : ''} × ${rows[0].length} column${rows[0].length > 1 ? 's' : ''}` : 'Nothing pasted yet';
        };
        const done = (value) => {
            back.remove();
            window.removeEventListener('keydown', onKey, true);
            resolve(value);
        };
        const onKey = (e) => {
            if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); done(null); }
        };
        area.addEventListener('input', update);
        back.addEventListener('click', (e) => {
            const b = e.target.closest('[data-paste]');
            if (e.target === back || (b && b.dataset.paste === 'cancel')) done(null);
            else if (b && b.dataset.paste === 'ok' && !ok.disabled) {
                done({ rows: parseCellsText(area.value), header: back.querySelector('.table-paste-header').checked ? 'yes' : 'no' });
            }
        });
        window.addEventListener('keydown', onKey, true);
        update();
        area.focus();
    });
}

/** Rows × columns for a drawn box (about 320 × 100 px cells at 1920 wide:
 *  the usual 1000 × 320 box is 3 × 3). */
function gridForBox(w, h) {
    const scale = state.slideWidth / 1920;
    const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
    return { rows: clamp(Math.round(h / (100 * scale)), 1, 40), cols: clamp(Math.round(w / (320 * scale)), 1, 12) };
}

/** Cells from text copied in a spreadsheet (tab-separated rows), or null. */
export function rowsFromClipboardText(text) {
    const lines = String(text || '').replace(/\r\n?/g, '\n').replace(/\n+$/, '').split('\n');
    if (lines.length < 2 || !lines.every(l => l.includes('\t'))) return null;
    const rows = lines.map(l => l.split('\t'));
    const n = rows[0].length;
    if (n < 2 || !rows.every(r => r.length === n)) return null;
    return rows;
}

// ---------- the panel's colour / format fields (change events) ----------

document.addEventListener('change', (e) => {
    const t = e.target;
    if (!panelTable || !t.dataset) return;
    const el = panelTable;
    if (t.dataset.tableStyle) {
        const [r, c] = activeCell.get(el.id) || [1, 1];
        const index = styleScope === 'row' ? r : styleScope === 'col' ? c : [r, c];
        setStyle(el, styleScope, index, t.dataset.tableStyle, t.value === 'transparent' ? '' : t.value);
    } else if (t.dataset.tableFormat !== undefined) {
        const [, c] = activeCell.get(el.id) || [1, 1];
        setStyle(el, 'col', c, 'format', t.value.trim());
    } else if (t.dataset.tableScope) {
        styleScope = t.value;
    } else {
        return;
    }
    markDirty();
    notifyContentChanged();
});

// ---------- the element ----------

const TableElement = {
    type: 'table',
    label: 'Add Table',
    icon: '▦',
    className: 'element-table',
    category: 'text', // the Text ▾ menu

    // Text ▾: draw the box (its grid follows the size), or start from a
    // CSV file (linked) or from pasted cells.
    variants: [
        { id: 'draw', label: 'Table (draw it)', icon: '▦', create: 'box', preset: () => ({}) },
        {
            id: 'csv', label: 'Table from a CSV file…', icon: '📄', preset: () => ({}),
            async pick() {
                return tablePropsFromCsv(await chooseCsv());
            },
        },
        {
            id: 'paste', label: 'Table from pasted cells…', icon: '📋', preset: () => ({}),
            async pick() {
                const got = await askPastedCells();
                return got && propsForRows(got.rows, { header: got.header });
            },
        },
    ],

    boxGuides: gridForBox,

    /** A drawn box: a grid sized to it, with a header row. */
    fromPoints([a, b]) {
        const x = Math.min(a[0], b[0]), y = Math.min(a[1], b[1]);
        const width = Math.abs(b[0] - a[0]), height = Math.abs(b[1] - a[1]);
        const { rows, cols } = gridForBox(width, height);
        const cells = Array.from({ length: rows }, (_, r) => Array.from({ length: cols }, (_, c) => (r === 0 ? `Column ${c + 1}` : '')));
        return { x: Math.round(x), y: Math.round(y), width: Math.round(width), height: Math.round(height), rows: cells };
    },

    gl: {
        props: ['x', 'y', 'width', 'height', 'header', 'borders', 'stripes', 'headerBg', 'ruleColor',
            'fontSize', 'fontFamily', 'fontColor', 'bg', 'borderCol', 'borderWidth', 'borderStyle'],
        numericProps: ['x', 'y', 'width', 'height', 'fontSize', 'borderWidth'],
        body: 'rows',
        serializeBody(el) {
            const lines = [];
            if (el.data && el.data.src) {
                const extra = [`sync:${el.data.sync === 'no' ? 'no' : 'yes'}`];
                if (el.data.original) extra.push(`original:${quote(el.data.original)}`);
                lines.push(`\t.data {${el.data.src}} ${extra.join(' ')}`);
            }
            if (Array.isArray(el.widths) && el.widths.length) lines.push(`\t.widths ${el.widths.map(w => Math.round(Number(w) * 10) / 10).join(',')}`);
            stylesOf(el).forEach(s => {
                const idx = s.scope === 'cell' ? s.index.join(',') : String(s.index);
                const props = STYLE_KEYS.filter(k => s.props[k] !== undefined).map(k => `${k}:${quote(s.props[k])}`);
                if (props.length) lines.push(`\t.${s.scope} ${idx} ${props.join(' ')}`);
            });
            rowsOf(el).forEach(r => lines.push(`\t| ${r.map(encodeCell).join(' | ')} |`));
            return lines.join('\n');
        },
        parseBody(text, el) {
            const rows = [];
            const styles = [];
            text.split('\n').forEach(line => {
                const t = line.trim();
                let m;
                if ((m = t.match(/^\.data\s*\{([^}]*)\}(.*)$/))) {
                    const p = params(m[2]);
                    el.data = { src: m[1].trim(), sync: p.sync === 'no' ? 'no' : 'yes' };
                    if (p.original) el.data.original = p.original;
                } else if ((m = t.match(/^\.widths\s+([\d.,\s]+)$/))) {
                    el.widths = m[1].split(',').map(Number).filter(v => v > 0);
                } else if ((m = t.match(/^\.(row|col|cell)\s+(\d+)(?:\s*,\s*(\d+))?(.*)$/))) {
                    const index = m[1] === 'cell' ? [Number(m[2]), Number(m[3] || 1)] : Number(m[2]);
                    const p = params(m[4]);
                    const props = {};
                    STYLE_KEYS.forEach(k => { if (p[k] !== undefined) props[k] = p[k]; });
                    if (Object.keys(props).length) styles.push({ scope: m[1], index, props });
                } else if (t.startsWith('|')) {
                    rows.push(splitRow(t));
                }
            });
            el.rows = rows.length ? rows : [['']];
            if (styles.length) el.styles = styles;
        },
    },

    defaults() {
        const scale = state.slideWidth / 1920;
        return {
            type: 'table',
            x: 0, y: 0,
            width: Math.round(1000 * scale),
            height: Math.round(320 * scale),
            rows: [['Column 1', 'Column 2', 'Column 3'], ['', '', ''], ['', '', '']],
            header: 'yes',
            borders: 'horizontal',
            stripes: 'no',
            fontSize: Math.round(28 * scale),
            fontFamily: 'sans-serif',
            fontColor: state.isDarkMode ? '#f8fafc' : '#0f172a',
            bg: 'transparent',
            borderCol: 'transparent',
            borderWidth: 0,
            borderStyle: 'solid',
        };
    },

    renderDom(domEl, el, ctx) {
        domEl.style.fontSize = `${el.fontSize}px`;
        domEl.style.fontFamily = fontStack(el.fontFamily);
        domEl.style.color = el.fontColor;
        if (ctx.context === 'canvas') {
            domEl.ondblclick = (e) => {
                e.stopPropagation();
                const cell = e.target.closest('td, th');
                if (!cell) return;
                if (domEl.classList.contains('editing-mode')) commitCell(domEl, el);
                editCell(domEl, el, Number(cell.dataset.r), Number(cell.dataset.c));
            };
            domEl.addEventListener('click', (e) => {
                const cell = e.target.closest('td, th');
                if (!cell || domEl.classList.contains('editing-mode')) return;
                const rc = [Number(cell.dataset.r), Number(cell.dataset.c)];
                const prev = activeCell.get(el.id);
                if (prev && prev[0] === rc[0] && prev[1] === rc[1]) return;
                activeCell.set(el.id, rc);
                notifyContentChanged();  // the panel shows that cell
            });
            const editing = domEl.dataset.editingCell;
            if (domEl.classList.contains('editing-mode') && editing) {
                const [r, c] = editing.split(',').map(Number);
                editCell(domEl, el, r, c);
                return;
            }
        }
        buildTable(domEl, el, { context: ctx.context });
    },

    commitEditing(domEl, el) {
        commitCell(domEl, el);
        notifyContentChanged();
    },

    // Column borders on the top edge: drag to change widths.
    handles(el) {
        const f = shares(el);
        const out = [];
        let acc = 0;
        for (let i = 0; i < f.length - 1; i++) {
            acc += f[i];
            out.push({ id: `w${i}`, kind: 'divider', x: el.width * acc, y: 0 });
        }
        return out;
    },

    dragHandle(el, id, px) {
        const i = Number(id.slice(1));
        const f = shares(el);
        const local = (px - el.x) / (el.width || 1);
        const before = f.slice(0, i).reduce((s, v) => s + v, 0);
        const pair = f[i] + f[i + 1];
        const left = Math.max(MIN_SHARE, Math.min(pair - MIN_SHARE, local - before));
        f[i] = left;
        f[i + 1] = pair - left;
        el.widths = f.map(v => Math.round(v * 1000) / 10);
    },

    actions: {
        addRow(elIndex, where, el) {
            const [r] = activeCell.get(el.id) || [rowsOf(el).length, 1];
            addRow(el, where === 'above' ? r - 1 : r);
            activeCell.set(el.id, [where === 'above' ? r : r + 1, (activeCell.get(el.id) || [1, 1])[1]]);
        },
        addCol(elIndex, where, el) {
            const [r, c] = activeCell.get(el.id) || [1, colCount(el)];
            addCol(el, where === 'left' ? c - 1 : c);
            activeCell.set(el.id, [r, where === 'left' ? c : c + 1]);
        },
        deleteRow(elIndex, arg, el) {
            const [r, c] = activeCell.get(el.id) || [rowsOf(el).length, 1];
            deleteRow(el, r);
            activeCell.set(el.id, [Math.min(r, rowsOf(el).length), c]);
        },
        deleteCol(elIndex, arg, el) {
            const [r, c] = activeCell.get(el.id) || [1, colCount(el)];
            deleteCol(el, c);
            activeCell.set(el.id, [r, Math.min(c, colCount(el))]);
        },
        toggle(elIndex, key, el) {
            const [r, c] = activeCell.get(el.id) || [1, 1];
            const index = styleScope === 'row' ? r : styleScope === 'col' ? c : [r, c];
            const current = cellStyle(el, r, c)[key];
            setStyle(el, styleScope, index, key, current === 'yes' ? '' : 'yes');
        },
        align(elIndex, value, el) {
            const [r, c] = activeCell.get(el.id) || [1, 1];
            const index = styleScope === 'row' ? r : styleScope === 'col' ? c : [r, c];
            setStyle(el, styleScope, index, 'align', value);
        },
        clearStyle(elIndex, arg, el) {
            const [r, c] = activeCell.get(el.id) || [1, 1];
            const index = styleScope === 'row' ? r : styleScope === 'col' ? c : [r, c];
            const s = findStyle(el, styleScope, index);
            if (s) el.styles = stylesOf(el).filter(x => x !== s);
        },
        evenWidths(elIndex, arg, el) {
            delete el.widths;
        },
        async importCsv(elIndex, arg, el) {
            const path = await chooseCsv();
            if (!path) return;
            const res = await pyApi().read_table_file(state.projectFolder || '', path);
            if (!res || !res.success) { flashSaveIndicator(`Could not read ${path}: ${res && res.error}`); return; }
            el.rows = res.rows;
            delete el.widths;
            delete el.data;
            sizeToFit(el);
            markDirty();
            notifyContentChanged();
            flashSaveIndicator(`${res.rows.length} rows imported ✓`);
        },
        async linkCsv(elIndex, arg, el) {
            const path = await chooseCsv();
            if (!path) return;
            const res = await pyApi().link_table_file(state.projectFolder || '', path);
            if (!res || !res.success) { flashSaveIndicator(res && res.error ? res.error : 'Could not link the file'); return; }
            el.rows = res.rows;
            el.data = { src: res.relative_path, sync: 'yes', original: res.original };
            el._mtime = res.mtime;
            delete el.widths;
            sizeToFit(el);
            markDirty();
            notifyContentChanged();
            flashSaveIndicator(`Linked to ${res.relative_path} ✓`);
        },
        async refresh() {
            const n = await syncLinkedTables({ force: true });
            flashSaveIndicator(n ? 'Table updated ✓' : 'Already up to date');
        },
        unlink(elIndex, arg, el) {
            delete el.data;
            delete el._mtime;
            flashSaveIndicator('Unlinked: the cells are now part of the slide');
        },
        toggleSync(elIndex, arg, el) {
            if (el.data) el.data.sync = el.data.sync === 'no' ? 'yes' : 'no';
        },
    },

    exportInner(el) {
        const div = document.createElement('div');
        buildTable(div, el, { context: 'export' });
        return div.innerHTML;
    },

    properties(el) {
        panelTable = el;
        const [r, c] = activeCell.get(el.id) || [1, 1];
        const st = cellStyle(el, r, c);
        const linked = el.data && el.data.src;
        const colFormat = (findStyle(el, 'col', c) || { props: {} }).props.format || '';
        const scopeName = { cell: `cell ${r},${c}`, row: `row ${r}`, col: `column ${c}` }[styleScope];
        const btn = (action, arg, text, title, active = false) =>
            `<button type="button" class="btn btn-secondary arrange-btn${active ? ' active' : ''}" data-element-action="${action}" data-arg="${arg}" title="${title}">${text}</button>`;
        return `
            <div class="prop-divider"></div>
            <div class="prop-row">
                <div class="prop-group">
                    <label>Header row</label>
                    <select class="prop-control" data-prop="header">
                        <option value="yes" ${el.header !== 'no' ? 'selected' : ''}>Yes</option>
                        <option value="no" ${el.header === 'no' ? 'selected' : ''}>No</option>
                    </select>
                </div>
                <div class="prop-group">
                    <label>Borders</label>
                    <select class="prop-control" data-prop="borders">
                        <option value="horizontal" ${(el.borders || 'horizontal') === 'horizontal' ? 'selected' : ''}>Horizontal</option>
                        <option value="all" ${el.borders === 'all' ? 'selected' : ''}>All</option>
                        <option value="none" ${el.borders === 'none' ? 'selected' : ''}>None</option>
                    </select>
                </div>
            </div>
            <label class="prop-check"><input type="checkbox" data-prop="stripes" ${el.stripes === 'yes' ? 'checked' : ''}> Striped rows</label>
            <div class="prop-row">
                <div class="prop-group">
                    <label>Header background</label>
                    ${colorField({ 'data-prop': 'headerBg' }, el.headerBg || 'transparent')}
                </div>
                <div class="prop-group">
                    <label>Lines</label>
                    ${colorField({ 'data-prop': 'ruleColor' }, el.ruleColor || el.fontColor || '#0f172a', { allowNone: false })}
                </div>
            </div>
            <div class="prop-divider"></div>
            <div class="prop-group">
                <label>Rows and columns (at cell ${r},${c})</label>
                <div class="arrange-row">
                    ${btn('addRow', 'above', '+ Row ↑', 'Insert a row above')}${btn('addRow', 'below', '+ Row ↓', 'Insert a row below')}
                    ${btn('addCol', 'left', '+ Col ←', 'Insert a column to the left')}${btn('addCol', 'right', '+ Col →', 'Insert a column to the right')}
                </div>
                <div class="arrange-row" style="margin-top:4px">
                    ${btn('deleteRow', '', '− Row', 'Delete this row')}${btn('deleteCol', '', '− Column', 'Delete this column')}${btn('evenWidths', '', 'Even widths', 'All columns the same width')}
                </div>
            </div>
            <div class="prop-group">
                <label>Style the</label>
                <select class="prop-control" data-table-scope="1">
                    <option value="cell" ${styleScope === 'cell' ? 'selected' : ''}>Cell (${r},${c})</option>
                    <option value="row" ${styleScope === 'row' ? 'selected' : ''}>Row ${r}</option>
                    <option value="col" ${styleScope === 'col' ? 'selected' : ''}>Column ${c}</option>
                </select>
                <div class="arrange-row" style="margin-top:4px">
                    ${btn('toggle', 'bold', '<strong>B</strong>', `Bold (${scopeName})`, st.bold === 'yes')}
                    ${btn('toggle', 'italic', '<em>I</em>', `Italic (${scopeName})`, st.italic === 'yes')}
                    ${btn('align', 'left', '⇤', 'Align left', st.align === 'left')}${btn('align', 'center', '↔', 'Centre', st.align === 'center')}${btn('align', 'right', '⇥', 'Align right', st.align === 'right')}
                    ${btn('clearStyle', '', '✕', `Clear the style of the ${scopeName}`)}
                </div>
            </div>
            <div class="prop-row">
                <div class="prop-group">
                    <label>Text colour</label>
                    ${colorField({ 'data-table-style': 'color' }, st.color || 'transparent')}
                </div>
                <div class="prop-group">
                    <label>Background</label>
                    ${colorField({ 'data-table-style': 'bg' }, st.bg || 'transparent')}
                </div>
            </div>
            <div class="prop-group">
                <label>Numbers in column ${c}</label>
                <input type="text" class="prop-control" data-table-format="1" value="${escapeHtml(colFormat)}" placeholder="%.2f  %.3e  %.1%  %d">
            </div>
            <div class="prop-divider"></div>
            <div class="prop-group">
                <label>Data</label>
                ${linked ? `
                    <p class="prop-hint">🔗 Linked to <code>${escapeHtml(el.data.src)}</code>${el.data.original ? ` (from ${escapeHtml(el.data.original)})` : ''}: the cells follow the file; style them here.</p>
                    <label class="prop-check"><input type="checkbox" data-element-action="toggleSync" ${el.data.sync !== 'no' ? 'checked' : ''}> Update when the file changes</label>
                    <div class="arrange-row">${btn('refresh', '', '↻ Reload', 'Read the file again')}${btn('unlink', '', 'Unlink', 'Keep the cells; stop following the file')}</div>`
                : `<div class="arrange-row">${btn('importCsv', '', 'Import CSV…', 'Copy the cells of a CSV file into the table')}${btn('linkCsv', '', 'Link CSV…', 'The table follows a CSV file (copied into data/, updated when the original changes)')}</div>`}
            </div>
            <p class="prop-hint">Double-click a cell to edit it; <strong>Tab</strong> / <strong>Enter</strong>: next cell / below. A click picks the cell styled here. Paste cells from a spreadsheet to make a table.</p>
            <div class="prop-divider"></div>
            <div class="prop-group">
                <label>Font Family</label>
                <select class="prop-control" data-prop="fontFamily">${fontOptions(el.fontFamily || 'sans-serif')}</select>
            </div>
            <div class="prop-row">
                <div class="prop-group">
                    <label>Font Size</label>
                    <input type="number" class="prop-control" value="${el.fontSize}" data-prop="fontSize">
                </div>
                <div class="prop-group">
                    <label>Text Color</label>
                    ${colorField({ 'data-prop': 'fontColor' }, el.fontColor, { allowNone: false })}
                </div>
            </div>`;
    },
};

ElementRegistry.register(TableElement);
