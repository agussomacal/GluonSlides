// ============================================================
// elements/columns/columns.js — Text in 2-4 columns: one box, each
// column edited like a text box (Markdown, math, lists, citations,
// ![](figures/x.png) images).
//
//   .element.columns id:12 x:100 y:200 width:1700 height:600 gap:40 divider:line
//   	.column width:60
//   	Left column, **Markdown** and $math$
//   	.column width:40 valign:center align:center
//   	Right column
//
// Column widths are relative (60/40 = 60% / 40% of the space left by the
// gaps). Double-click a column to edit it (Tab / Shift+Tab: next /
// previous column, Esc or a click outside: done); drag the handles on the
// dividers to change the widths.
// ============================================================

import { state, markDirty } from '../../core/state.js';
import { fontStack } from '../../core/fonts.js';
import { colorField } from '../../ui/colorPicker.js';
import { ElementRegistry } from '../../core/registry.js';
import { renderMarkdownAndKatex, escapeHtml } from '../../core/render.js';
import { fontOptions } from '../text/text.js';

const MIN_SHARE = 0.08;             // a column keeps at least 8% of the width
const VALIGN = { top: 'flex-start', center: 'center', bottom: 'flex-end' };

export function columnsOf(el) {
    if (!Array.isArray(el.columns) || !el.columns.length) el.columns = [{ width: 50, content: '' }, { width: 50, content: '' }];
    return el.columns;
}

function shares(el) {
    const cols = columnsOf(el);
    const total = cols.reduce((s, c) => s + (Number(c.width) > 0 ? Number(c.width) : 1), 0) || 1;
    return cols.map(c => (Number(c.width) > 0 ? Number(c.width) : 1) / total);
}

function notifyContentChanged() {
    document.dispatchEvent(new CustomEvent('slide-content-changed'));
}

/** The columns' DOM: a grid, each column a Markdown box. */
function buildColumns(domEl, el, { editing = -1 } = {}) {
    const cols = columnsOf(el);
    const grid = document.createElement('div');
    grid.className = 'gl-columns';
    grid.style.gridTemplateColumns = shares(el).map(f => `${(f * 1000).toFixed(1)}fr`).join(' ');
    grid.style.columnGap = `${Number(el.gap) || 0}px`;
    cols.forEach((c, i) => {
        const col = document.createElement('div');
        col.className = 'gl-column';
        col.dataset.column = String(i);
        col.style.justifyContent = VALIGN[c.valign || 'top'] || 'flex-start';
        col.style.textAlign = c.align || 'left';
        if (el.divider === 'line' && i > 0) {
            col.style.borderLeft = `${Math.max(1, Math.round((Number(el.fontSize) || 32) / 16))}px solid ${el.dividerColor || el.fontColor || '#94a3b8'}`;
            col.style.paddingLeft = `${Math.round((Number(el.gap) || 0) / 2)}px`;
            col.style.marginLeft = `-${Math.round((Number(el.gap) || 0) / 2)}px`;
        }
        const inner = document.createElement('div');
        inner.className = 'gl-column-text';
        if (i === editing) {
            inner.contentEditable = 'true';
            inner.innerText = c.content || '';
            col.classList.add('gl-column-editing');
        } else {
            try {
                renderMarkdownAndKatex(inner, c.content || '');
            } catch (e) {
                inner.textContent = c.content || '';
            }
        }
        col.appendChild(inner);
        grid.appendChild(col);
    });
    domEl.replaceChildren(grid);
    return grid;
}

/** Saves the column being edited and leaves editing. */
function commitColumn(domEl, el) {
    const editing = domEl.querySelector('.gl-column-editing');
    if (editing) {
        const i = Number(editing.dataset.column);
        const text = editing.querySelector('.gl-column-text').innerText.replace(/\n$/, '');
        if (columnsOf(el)[i]) columnsOf(el)[i].content = text;
    }
    domEl.classList.remove('editing-mode');
    delete domEl.dataset.editingColumn;
    markDirty();
}

function startEditing(domEl, el, i) {
    domEl.classList.add('editing-mode');
    domEl.dataset.editingColumn = String(i);
    buildColumns(domEl, el, { editing: i });
    const box = domEl.querySelector('.gl-column-editing .gl-column-text');
    if (!box) return;
    box.focus();
    // caret at the end
    const range = document.createRange();
    range.selectNodeContents(box);
    range.collapse(false);
    const sel = window.getSelection();
    sel.removeAllRanges();
    sel.addRange(range);
    box.addEventListener('input', () => {
        columnsOf(el)[i].content = box.innerText;
        markDirty();
    });
    box.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') {
            e.preventDefault();
            e.stopPropagation();
            commitColumn(domEl, el);
            notifyContentChanged();
        } else if (e.key === 'Tab') {
            e.preventDefault();
            e.stopPropagation();
            commitColumn(domEl, el);
            const n = columnsOf(el).length;
            startEditing(domEl, el, (i + (e.shiftKey ? n - 1 : 1)) % n);
        }
    });
    box.addEventListener('blur', () => {
        // leaving for another column of this element is handled by startEditing
        setTimeout(() => {
            if (domEl.classList.contains('editing-mode') && !domEl.contains(document.activeElement)) {
                commitColumn(domEl, el);
                notifyContentChanged();
            }
        }, 0);
    });
}

/** Even widths for `n` columns, keeping existing text. */
function setColumnCount(el, n) {
    const cols = columnsOf(el);
    while (cols.length < n) cols.push({ width: 0, content: '' });
    if (cols.length > n) {
        // text of removed columns is kept, appended to the last remaining one
        const extra = cols.splice(n).map(c => c.content).filter(Boolean);
        if (extra.length) cols[n - 1].content = [cols[n - 1].content, ...extra].filter(Boolean).join('\n\n');
    }
    cols.forEach(c => { c.width = Math.round(100 / n); });
}

const PRESETS = { 2: [[50, 50], [60, 40], [40, 60], [70, 30], [30, 70]], 3: [[33, 34, 33], [25, 50, 25], [50, 25, 25]], 4: [[25, 25, 25, 25]] };

const ColumnsElement = {
    type: 'columns',
    label: 'Add Columns',
    icon: '▥',
    className: 'element-columns',
    category: 'columns',

    variants: [
        { id: 'two', label: 'Two columns', icon: '◫', preset: () => ({ columns: [{ width: 50, content: 'Left column' }, { width: 50, content: 'Right column' }] }) },
        { id: 'wide-left', label: 'Two columns, wide left (60/40)', icon: '◧', preset: () => ({ columns: [{ width: 60, content: 'Left column' }, { width: 40, content: 'Right column' }] }) },
        { id: 'three', label: 'Three columns', icon: '▥', preset: () => ({ columns: [{ width: 33, content: 'One' }, { width: 34, content: 'Two' }, { width: 33, content: 'Three' }] }) },
    ],

    gl: {
        props: ['x', 'y', 'width', 'height', 'gap', 'divider', 'fontSize', 'fontFamily', 'fontColor',
            'bg', 'borderCol', 'borderWidth', 'borderStyle'],
        numericProps: ['x', 'y', 'width', 'height', 'gap', 'fontSize', 'borderWidth'],
        body: 'columns',
        serializeBody(el) {
            const lines = [];
            columnsOf(el).forEach(c => {
                const params = [`width:${Math.round(Number(c.width) || 0)}`];
                if (c.valign && c.valign !== 'top') params.push(`valign:${c.valign}`);
                if (c.align && c.align !== 'left') params.push(`align:${c.align}`);
                lines.push(`\t.column ${params.join(' ')}`);
                String(c.content || '').split('\n').forEach(line => {
                    if (line === '') lines.push('');
                    // text starting with ".column" gets one more escape than other dot lines
                    else if (/^\.column\b/.test(line)) lines.push(`\t\\\\${line}`);
                    else lines.push(`\t${line.startsWith('.') ? '\\' : ''}${line}`);
                });
            });
            return lines.join('\n');
        },
        parseBody(text, el) {
            const cols = [];
            let current = null;
            text.split('\n').forEach(line => {
                const m = line.match(/^\.column\b(.*)$/);
                if (m) {
                    current = { width: 0, content: '' };
                    const lines = [];
                    current._lines = lines;
                    for (const [, k, v] of m[1].matchAll(/(\w+):(\S+)/g)) {
                        if (k === 'width') current.width = Number(v) || 0;
                        if (k === 'valign' && VALIGN[v]) current.valign = v;
                        if (k === 'align' && ['left', 'center', 'right'].includes(v)) current.align = v;
                    }
                    cols.push(current);
                    return;
                }
                if (!current) {  // text before any .column: the first column
                    current = { width: 0, content: '', _lines: [] };
                    cols.push(current);
                }
                current._lines.push(line.replace(/^\\\\(\.column\b)/, '$1'));
            });
            cols.forEach(c => {
                c.content = c._lines.join('\n').replace(/^\n+|\n+$/g, '');
                delete c._lines;
                if (!(c.width > 0)) c.width = Math.round(100 / cols.length);
            });
            el.columns = cols.length ? cols : [{ width: 50, content: '' }, { width: 50, content: '' }];
        },
    },

    defaults() {
        const scale = state.slideWidth / 1920;
        return {
            type: 'columns',
            x: 0, y: 0,
            width: Math.round(1400 * scale),
            height: Math.round(400 * scale),
            gap: Math.round(48 * scale),
            columns: [{ width: 50, content: 'Left column' }, { width: 50, content: 'Right column' }],
            fontSize: Math.round(32 * scale),
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
                const col = e.target.closest('.gl-column');
                const i = col ? Number(col.dataset.column) : 0;
                if (domEl.classList.contains('editing-mode')) commitColumn(domEl, el);
                startEditing(domEl, el, i);
            };
            const editing = domEl.dataset.editingColumn;
            if (domEl.classList.contains('editing-mode') && editing !== undefined) {
                startEditing(domEl, el, Number(editing));
                return;
            }
        }
        buildColumns(domEl, el);
    },

    /** The editor commits an edit in progress (a click elsewhere). */
    commitEditing(domEl, el) {
        commitColumn(domEl, el);
        notifyContentChanged();
    },

    // Divider handles: drag to change the widths.
    handles(el) {
        const f = shares(el);
        const out = [];
        let acc = 0;
        const gap = Number(el.gap) || 0;
        const usable = el.width - gap * (f.length - 1);
        for (let i = 0; i < f.length - 1; i++) {
            acc += f[i];
            out.push({ id: `d${i}`, kind: 'divider', x: usable * acc + gap * (i + 0.5), y: el.height / 2 });
        }
        return out;
    },

    dragHandle(el, id, px) {
        const i = Number(id.slice(1));
        const cols = columnsOf(el);
        const f = shares(el);
        const gap = Number(el.gap) || 0;
        const usable = el.width - gap * (f.length - 1);
        const local = (px - el.x - gap * (i + 0.5)) / (usable || 1); // boundary as a share of the usable width
        const before = f.slice(0, i).reduce((s, v) => s + v, 0);
        const pair = f[i] + f[i + 1];
        const left = Math.max(MIN_SHARE, Math.min(pair - MIN_SHARE, local - before));
        f[i] = left;
        f[i + 1] = pair - left;
        cols.forEach((c, k) => { c.width = Math.round(f[k] * 1000) / 10; });
    },

    actions: {
        setCount(elIndex, n, el) {
            setColumnCount(el, Number(n));
        },
        preset(elIndex, widths, el) {
            const w = widths.split(',').map(Number);
            setColumnCount(el, w.length);
            columnsOf(el).forEach((c, i) => { c.width = w[i]; });
        },
        colAlign(elIndex, arg, el) {
            const [i, key, value] = arg.split(':');
            const c = columnsOf(el)[Number(i)];
            if (c) c[key] = value;
        },
    },

    exportInner(el) {
        const div = document.createElement('div');
        buildColumns(div, el);
        return div.innerHTML;
    },

    properties(el) {
        const cols = columnsOf(el);
        const n = cols.length;
        const widths = cols.map(c => Math.round(Number(c.width) || 0)).join(',');
        const presetBtns = (PRESETS[n] || []).map(p => {
            const v = p.join(',');
            return `<button type="button" class="btn btn-secondary arrange-btn${v === widths ? ' active' : ''}" data-element-action="preset" data-arg="${v}" title="Widths ${p.join(' / ')}">${p.join('/')}</button>`;
        }).join('');
        const colRows = cols.map((c, i) => `
            <div class="column-row">
                <span class="column-label">${i + 1}</span>
                ${['left', 'center', 'right'].map(a => `<button type="button" class="btn btn-secondary arrange-btn${(c.align || 'left') === a ? ' active' : ''}" data-element-action="colAlign" data-arg="${i}:align:${a}" title="Align ${a}">${{ left: '⇤', center: '↔', right: '⇥' }[a]}</button>`).join('')}
                ${['top', 'center', 'bottom'].map(v => `<button type="button" class="btn btn-secondary arrange-btn${(c.valign || 'top') === v ? ' active' : ''}" data-element-action="colAlign" data-arg="${i}:valign:${v}" title="Vertical: ${v}">${{ top: '⤒', center: '↕', bottom: '⤓' }[v]}</button>`).join('')}
            </div>`).join('');
        return `
            <div class="prop-divider"></div>
            <div class="prop-group">
                <label>Columns</label>
                <div class="arrange-row">
                    ${[2, 3, 4].map(k => `<button type="button" class="btn btn-secondary arrange-btn${k === n ? ' active' : ''}" data-element-action="setCount" data-arg="${k}">${k}</button>`).join('')}
                </div>
            </div>
            ${presetBtns ? `<div class="prop-group"><label>Widths (drag the handles on the dividers too)</label><div class="arrange-row">${presetBtns}</div></div>` : ''}
            <div class="prop-row">
                <div class="prop-group">
                    <label>Gap</label>
                    <input type="number" class="prop-control" min="0" value="${Number(el.gap) || 0}" data-prop="gap">
                </div>
                <div class="prop-group">
                    <label>Divider</label>
                    <select class="prop-control" data-prop="divider">
                        <option value="none" ${el.divider !== 'line' ? 'selected' : ''}>None</option>
                        <option value="line" ${el.divider === 'line' ? 'selected' : ''}>Line</option>
                    </select>
                </div>
            </div>
            <div class="prop-group">
                <label>Each column: alignment</label>
                ${colRows}
            </div>
            <p class="prop-hint">Double-click a column to edit it; <strong>Tab</strong> goes to the next one. Images: <code>![](figures/plot.png)</code>.</p>
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

ElementRegistry.register(ColumnsElement);
