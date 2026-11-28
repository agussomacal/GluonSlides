// ============================================================
// ui/followVariable.js — Right-click an object → "Follow a variable…":
// pick one of its settings (a search box listing them with their values
// now), then write its formula (core/bindings.js) in a field that starts
// at the value now, lists every variable, shows what it gives and moves
// the object live; Enter keeps it, Esc leaves the object as it was.
// A plot lists its own settings, a line, then its layers: clicking one
// shows that layer's settings (← back to the plot); a search also finds
// the layers' settings ("Histogram › Bins").
// Right-click an input or an animation → "Make something follow this…":
// click the object that should follow, then the same, the formula
// started with that variable.
// ============================================================

import { markDirty, findElementPath, currentSlide } from '../core/state.js';
import { ElementRegistry } from '../core/registry.js';
import { setFormula, BINDABLE_COMMON, COLOR_KEYS } from '../core/bindings.js';
import { allVariables } from '../core/variables.js';
import { parseTracks, formatValue, isScriptLanguage, PALETTE } from '../core/liveEngine.js';
import { escapeHtml } from '../core/render.js';
import { resolveColor } from '../core/colors.js';
import { LAYERS } from '../core/plotSchema.js';
import * as L from '../core/plotLayers.js';
import { attachFormulaInput } from './formulaField.js';

const LABELS = {
    x: 'X', y: 'Y', width: 'Width', height: 'Height', rotate: 'Rotation', opacity: 'Opacity', visible: 'Visible when',
    r: 'Radius', cx: 'Centre x', cy: 'Centre y', radius: 'Corner radius', fontSize: 'Text size', borderWidth: 'Border thickness',
    strokeWidth: 'Line width', gap: 'Gap', value: 'Starts at', min: 'From', max: 'To', step: 'Step', duration: 'Duration',
    samples: 'Points (curves)', xmin: 'x axis from', xmax: 'x axis to', ymin: 'y axis from', ymax: 'y axis to',
    bg: 'Fill colour', borderCol: 'Border colour', fontColor: 'Text colour', stroke: 'Line colour', fill: 'Fill colour', accent: 'Accent colour',
};

// a plot: its axis ranges are text settings ("" = found from the layers), written "=…" as they are
const PLOT_RANGES = ['xmin', 'xmax', 'ymin', 'ymax'];
// layer settings that can follow a variable
const LAYER_TYPES = new Set(['number', 'int', 'formula', 'condition']);

let box = null;

function redraw() {
    return import('../editor/editor.js').then(m => m.redrawCanvas());
}

const plain = (v) => String(v ?? '').trim().replace(/^=\s*/, '');
const isNumber = (v) => v !== '' && Number.isFinite(Number(v));

/**
 * A setting that can follow a variable: { label, now (shown in the list),
 * start (the formula to begin with, no "="), condition, whole, apply(text)
 * (null/'' = no formula), restore() }.
 */
function elementSetting(el, key) {
    const before = { formula: el.formulas ? el.formulas[key] : undefined, value: el[key], hidden: el._hidden };
    const condition = key === 'visible';
    if (COLOR_KEYS.includes(key)) {
        // a colour: a text formula (runcol[pick], palette(2), cmap(err, 0, 1))
        return {
            key, label: LABELS[key] || key, condition: false, color: true,
            formula: before.formula !== undefined,
            now: before.formula ? `=${before.formula}` : String(before.value ?? ''),
            start: before.formula !== undefined ? before.formula : '',
            apply(text) { setFormula(el, key, text || null); if (!text) el[key] = before.value; },
            restore() { setFormula(el, key, before.formula ?? null); if (before.formula === undefined) el[key] = before.value; },
        };
    }
    return {
        key,
        label: LABELS[key] || key,
        condition,
        formula: before.formula !== undefined,
        now: before.formula ? `=${before.formula}` : condition ? 'always' : key === 'opacity' && el.opacity === undefined ? '1' : formatValue(Number(el[key]) || 0),
        start: before.formula !== undefined ? before.formula : condition ? '' : formatValue(Number(el[key]) || 0).replace('−', '-'),
        apply(text) {
            setFormula(el, key, text || null);
            if (!text && !condition && before.value !== undefined) el[key] = before.value;
        },
        restore() {
            setFormula(el, key, before.formula ?? null);
            if (before.formula === undefined && before.value !== undefined) el[key] = before.value;
            if (before.hidden === undefined) delete el._hidden;
        },
    };
}

function rangeSetting(el, key) {
    const before = el[key];
    return {
        key,
        label: LABELS[key],
        condition: false,
        formula: before !== undefined && before !== '' && !isNumber(before),
        now: before === undefined || before === '' ? 'auto' : String(before),
        start: plain(before),
        apply(text) { el[key] = !text ? before : isNumber(text) ? text : `=${text}`; },
        restore() { el[key] = before; },
    };
}

function layerSetting(el, i, param, layerLabel) {
    const code = el.code;
    const current = L.paramsOf(code, i)[param.key];
    const condition = param.type === 'condition';
    return {
        key: param.key,
        label: param.label,
        layer: i,
        layerLabel,
        condition,
        whole: param.type === 'int',
        formula: current !== undefined && current !== '' && !isNumber(current),
        now: current !== undefined && current !== '' ? (condition ? plain(current) : String(current)) : condition ? 'always' : param.def !== undefined && param.def !== '' ? String(param.def) : 'auto',
        start: current !== undefined ? plain(current) : condition ? '' : param.def !== undefined ? String(param.def) : '',
        apply(text) {
            el.code = !text ? code : L.setParam(code, i, param.key, isNumber(text) && !condition ? text : `=${text}`);
        },
        restore() { el.code = code; },
    };
}

/** A plot's layers, each with its settings that can follow a variable: [{ i, label, icon, color, settings }]. */
function layersOf(el) {
    if (el.type !== 'plot' || isScriptLanguage(el.lang)) return [];
    return L.blocks(el.code).map((b, i) => {
        const kind = LAYERS[b.kind] || { label: b.kind, icon: '?', params: [] };
        const p = Object.fromEntries(b.params);
        const name = p.label ? `${kind.label} — ${p.label.replace(/\$/g, '')}` : `${kind.label} ${i + 1}`;
        return {
            i,
            label: name,
            icon: kind.icon,
            color: resolveColor(p.color) || p.color || (b.kind === 'heatmap' ? '' : PALETTE[i % PALETTE.length]),
            settings: (kind.params || []).filter(prm => LAYER_TYPES.has(prm.type) && !prm.hiddenField).map(prm => layerSetting(el, i, prm, name)),
        };
    });
}

/** The settings of `el` itself (a plot: without the layers'). */
function settingsOf(el) {
    const def = ElementRegistry.get(el.type);
    const own = ((def && def.gl && def.gl.numericProps) || []).filter(k => !['step', 'until'].includes(k));
    let keys = [...new Set([...BINDABLE_COMMON, ...own])];
    // a circle: centre and radius first, its box last
    if (el.kind === 'circle') keys = ['r', 'cx', 'cy', ...keys.filter(k => !['r', 'cx', 'cy'].includes(k))];
    if (el.type === 'plot') {
        // the points a curve is computed at: only with a curve, an area or a parametric curve
        const curves = L.blocks(el.code).some(b => ['curve', 'fill', 'parametric'].includes(b.kind));
        if (!curves || isScriptLanguage(el.lang)) keys = keys.filter(k => k !== 'samples');
        keys = keys.filter(k => k !== 'fontSize' && k !== 'borderWidth');
    }
    // its colours (those it has)
    const typeDefaults = (() => { try { return (def && typeof def.defaults === 'function' && def.defaults({})) || {}; } catch (e) { return {}; } })();
    keys = [...keys, ...COLOR_KEYS.filter(k => (el[k] !== undefined || typeDefaults[k] !== undefined) && !(el.type === 'path' && k === 'fill' && el.closed !== 'yes') && !['plot', 'colorkey', 'animation'].includes(el.type))];
    const list = keys.map(key => elementSetting(el, key));
    if (el.type === 'plot') list.push(...PLOT_RANGES.map(key => rangeSetting(el, key)));
    return list;
}

export function closeFollow() {
    if (box) box.remove();
    box = null;
}

function place(at) {
    const w = box.offsetWidth || 300;
    const h = box.offsetHeight || 300;
    box.style.left = `${Math.max(8, Math.min(window.innerWidth - w - 8, at.x))}px`;
    box.style.top = `${Math.max(8, Math.min(window.innerHeight - h - 8, at.y))}px`;
}

/** Step 2: the formula of one setting. */
function formulaStep(setting, at, withVar) {
    const isCondition = setting.condition;
    let start = setting.start;
    // a variable to follow: a setting without a formula starts at its value plus it (a colour key: its first key's colour)
    if (withVar && !setting.formula) {
        const vars = allVariables();
        const keyed = Object.keys(vars).filter(n => n.startsWith(`${withVar}.`) && n !== `${withVar}.shown`).map(n => n.slice(withVar.length + 1));
        if (setting.color) start = keyed.length ? `${withVar}['${keyed[0].replace(/'/g, "\\'")}']` : withVar;
        else start = isCondition ? withVar : start ? `${start} + ${withVar}` : withVar;
    }
    const title = setting.layerLabel ? `${escapeHtml(setting.layerLabel)} › ${escapeHtml(setting.label)}` : escapeHtml(setting.label);
    box.innerHTML = `
        <div class="follow-title">${title} <span>follows</span></div>
        <div class="prop-group"><input type="text" class="prop-control follow-formula" spellcheck="false" ${isCondition ? 'data-formula-only' : ''} ${setting.whole ? 'data-whole' : ''} ${setting.color ? 'data-color-formula' : ''}
            value="${escapeHtml(isCondition ? start : `=${start}`)}" placeholder="${isCondition ? 'a condition, e.g. mu > 0' : setting.color ? "=runcol[pick], =palette(2), ='#dc2626'" : '=…'}"></div>
        <div class="follow-hint">Enter: keep · Esc: as it was${setting.whole ? ' · whole numbers: rounded' : ''}</div>`;
    const input = box.querySelector('input');
    attachFormulaInput(input);
    place(at);
    input.focus();
    input.setSelectionRange(input.value.length, input.value.length);
    // the list of variables right away
    input.dispatchEvent(new KeyboardEvent('keydown', { key: ' ', ctrlKey: true, bubbles: true }));
    const apply = () => {
        setting.apply(plain(input.value));
        redraw();
    };
    input.addEventListener('input', apply);
    input.addEventListener('keydown', (e) => {
        if (e.defaultPrevented) return; // the suggestion list took the key
        if (e.key === 'Enter') {
            e.preventDefault();
            apply();
            markDirty();
            closeFollow();
            import('../editor/editor.js').then(m => m.renderEditor());
        } else if (e.key === 'Escape') {
            e.preventDefault();
            setting.restore();
            closeFollow();
            redraw();
        }
    });
}

/**
 * Opens "Follow a variable…" for `el` at screen point `at`; `withVar`:
 * start the formula with that variable. A plot lists its own settings,
 * a line, then its layers: one opens into its settings (← back); a search
 * also finds the layers' settings ("Histogram › Bins").
 */
export function openFollow(el, at = { x: window.innerWidth / 2 - 150, y: 160 }, withVar = null) {
    closeFollow();
    box = document.createElement('div');
    box.className = 'follow-box';
    const own = settingsOf(el);
    const layers = layersOf(el);
    let level = null; // null: the object; a number: that layer
    let shown = [];   // [{ setting } | { layer }]
    let active = 0;
    box.innerHTML = `
        <div class="follow-back" hidden>← Back to the plot</div>
        <div class="follow-title"></div>
        <input type="text" class="prop-control follow-search" placeholder="Search a setting…" spellcheck="false">
        <div class="follow-list"></div>`;
    document.body.appendChild(box);
    const back = box.querySelector('.follow-back');
    const titleBox = box.querySelector('.follow-title');
    const search = box.querySelector('.follow-search');
    const list = box.querySelector('.follow-list');
    const head = withVar ? `Follow <code>${escapeHtml(withVar)}</code>` : 'Follow a variable';
    const matches = (s, q) => !q || s.label.toLowerCase().includes(q) || s.key.toLowerCase().includes(q);
    const settingRow = (s, i, prefix = '') => `<div class="follow-item${i === active ? ' active' : ''}" data-i="${i}"><span>${prefix}${escapeHtml(s.label)}</span><span class="follow-now">${escapeHtml(s.now)}</span></div>`;
    const render = () => {
        const q = search.value.trim().toLowerCase();
        let html = '';
        if (level === null) {
            titleBox.innerHTML = `${head} <span>— which setting?</span>`;
            back.hidden = true;
            const mine = own.filter(s => matches(s, q)).map(setting => ({ setting }));
            // a search: the layers' settings too; else the layers to open
            const theirs = q ? layers.flatMap(l => l.settings.filter(s => matches(s, q)).map(setting => ({ setting, from: l })))
                : layers.map(layer => ({ layer }));
            shown = [...mine, ...theirs];
            active = Math.min(active, Math.max(0, shown.length - 1));
            html = mine.map((r, i) => settingRow(r.setting, i)).join('');
            if (theirs.length) html += `<div class="follow-sep">${layers.length > 1 ? 'layers' : 'layer'}</div>`;
            html += theirs.map((r, k) => {
                const i = mine.length + k;
                if (r.setting) return settingRow(r.setting, i, `<span class="follow-now">${escapeHtml(r.from.icon)} ${escapeHtml(r.from.label)} ›</span> `);
                const l = r.layer;
                return `<div class="follow-item follow-layer${i === active ? ' active' : ''}" data-i="${i}"><span>${l.color ? `<span class="follow-swatch" style="background:${escapeHtml(l.color)}"></span>` : ''}${escapeHtml(l.icon)} ${escapeHtml(l.label)}</span><span class="follow-now">›</span></div>`;
            }).join('');
        } else {
            const l = layers[level];
            titleBox.innerHTML = `${escapeHtml(l.icon)} ${escapeHtml(l.label)} <span>— which setting?</span>`;
            back.hidden = false;
            shown = l.settings.filter(s => matches(s, q)).map(setting => ({ setting }));
            active = Math.min(active, Math.max(0, shown.length - 1));
            html = shown.map((r, i) => settingRow(r.setting, i)).join('');
        }
        list.innerHTML = html || '<div class="follow-none">No setting of that name</div>';
        list.querySelector('.follow-item.active')?.scrollIntoView({ block: 'nearest' });
    };
    const openLayer = (i) => { level = i; active = 0; search.value = ''; render(); search.focus(); };
    const goBack = () => { const from = level; level = null; search.value = ''; active = own.length + (from ?? 0); render(); search.focus(); };
    const choose = (row) => {
        if (!row) return;
        if (row.layer) openLayer(row.layer.i);
        else formulaStep(row.setting, at, withVar);
    };
    render();
    place(at);
    search.focus();
    search.addEventListener('input', () => { active = 0; render(); });
    search.addEventListener('keydown', (e) => {
        if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); active = (active + (e.key === 'ArrowDown' ? 1 : -1) + shown.length) % Math.max(1, shown.length); render(); }
        else if (e.key === 'ArrowRight' && shown[active] && shown[active].layer && search.selectionStart === search.value.length) { e.preventDefault(); openLayer(shown[active].layer.i); }
        else if ((e.key === 'ArrowLeft' || e.key === 'Backspace') && level !== null && !search.value) { e.preventDefault(); goBack(); }
        else if (e.key === 'Enter' && shown[active]) { e.preventDefault(); choose(shown[active]); }
        else if (e.key === 'Escape') { e.preventDefault(); if (level !== null) goBack(); else closeFollow(); }
    });
    back.addEventListener('mousedown', (e) => { e.preventDefault(); goBack(); });
    list.addEventListener('mousedown', (e) => {
        const row = e.target.closest('[data-i]');
        if (!row) return;
        e.preventDefault();
        choose(shown[Number(row.dataset.i)]);
    });
}

// a click outside closes it
document.addEventListener('mousedown', (e) => {
    if (box && !box.contains(e.target) && !e.target.closest('.formula-menu')) closeFollow();
}, true);

// ---------- "Make something follow this…" ----------

let picking = null; // { name, banner }

function stopPicking() {
    if (!picking) return;
    picking.banner.remove();
    document.body.classList.remove('picking-follower');
    picking = null;
}

/** The variable an input or an animation sets (an animation's first). */
export function variableOf(el) {
    if (el.type === 'animation') return (parseTracks(el.tracks).find(t => !t.error) || {}).name || null;
    return el.var || null;
}

/** Right-click an input → click the object that should follow its variable. */
export function pickFollower(source) {
    const name = variableOf(source);
    if (!name) return;
    stopPicking();
    const banner = document.createElement('div');
    banner.className = 'follow-banner';
    banner.innerHTML = `Click the object that should follow <code>${escapeHtml(name)}</code> · Esc: cancel`;
    document.body.appendChild(banner);
    document.body.classList.add('picking-follower');
    picking = { name, banner };
}

document.addEventListener('mousedown', (e) => {
    if (!picking) return;
    const node = e.target.closest && e.target.closest('#slide-canvas [data-element-id]');
    if (!node) { if (!e.target.closest('.follow-banner')) stopPicking(); return; }
    e.preventDefault();
    e.stopPropagation();
    const id = Number(node.dataset.elementId);
    const slide = currentSlide();
    const path = findElementPath(slide, id);
    const container = path && path.length ? path[path.length - 1].children : slide && slide.elements;
    const el = container ? container.find(x => x.id === id) : null;
    const name = picking.name;
    stopPicking();
    if (el) openFollow(el, { x: e.clientX + 12, y: e.clientY + 12 }, name);
}, true);

document.addEventListener('keydown', (e) => {
    if (picking && e.key === 'Escape') { e.preventDefault(); stopPicking(); }
}, true);

