// ============================================================
// ui/followVariable.js — Right-click an object → "Follow a variable…":
// pick one of its settings (a search box listing them with their values
// now), then write its formula (core/bindings.js) in a field that starts
// at the value now, lists every variable, shows what it gives and moves
// the object live; Enter keeps it, Esc leaves the object as it was.
// Right-click an input or an animation → "Make something follow this…":
// click the object that should follow, then the same, the formula
// started with that variable.
// ============================================================

import { markDirty, findElementPath, currentSlide } from '../core/state.js';
import { ElementRegistry } from '../core/registry.js';
import { setFormula, BINDABLE_COMMON } from '../core/bindings.js';
import { parseTracks, formatValue } from '../core/liveEngine.js';
import { escapeHtml } from '../core/render.js';
import { attachFormulaInput } from './formulaField.js';

const LABELS = {
    x: 'X', y: 'Y', width: 'Width', height: 'Height', rotate: 'Rotation', opacity: 'Opacity', visible: 'Visible when',
    r: 'Radius', cx: 'Centre x', cy: 'Centre y', radius: 'Corner radius', fontSize: 'Text size', borderWidth: 'Border thickness',
    strokeWidth: 'Line width', gap: 'Gap', value: 'Starts at', min: 'From', max: 'To', step: 'Step', duration: 'Duration',
};

let box = null;

function redraw() {
    return import('../editor/editor.js').then(m => m.redrawCanvas());
}

/** The settings of `el` that can follow a variable: [{ key, label, now }]. */
function settingsOf(el) {
    const def = ElementRegistry.get(el.type);
    const own = ((def && def.gl && def.gl.numericProps) || []).filter(k => !['step', 'until'].includes(k));
    let keys = [...new Set([...BINDABLE_COMMON, ...own])];
    // a circle: centre and radius first, its box last
    if (el.kind === 'circle') keys = ['r', 'cx', 'cy', ...keys.filter(k => !['r', 'cx', 'cy'].includes(k))];
    return keys.map(key => ({
        key,
        label: LABELS[key] || key,
        now: el.formulas && el.formulas[key] ? `=${el.formulas[key]}` : key === 'visible' ? 'always' : key === 'opacity' && el.opacity === undefined ? '1' : formatValue(Number(el[key]) || 0),
    }));
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
function formulaStep(el, setting, at, withVar) {
    const before = { formula: el.formulas ? el.formulas[setting.key] : undefined, value: el[setting.key], hidden: el._hidden };
    const isCondition = setting.key === 'visible';
    let start = before.formula !== undefined ? before.formula : '';
    if (!start) {
        const now = isCondition ? '' : formatValue(Number(el[setting.key]) || 0).replace('−', '-');
        start = isCondition ? (withVar || '') : withVar ? `${now} + ${withVar}` : now;
    }
    box.innerHTML = `
        <div class="follow-title">${escapeHtml(setting.label)} <span>follows</span></div>
        <div class="prop-group"><input type="text" class="prop-control follow-formula" spellcheck="false" ${isCondition ? 'data-formula-only' : ''}
            value="${escapeHtml(isCondition ? start : `=${start}`)}" placeholder="${isCondition ? 'a condition, e.g. mu > 0' : '=…'}"></div>
        <div class="follow-hint">Enter: keep · Esc: as it was</div>`;
    const input = box.querySelector('input');
    attachFormulaInput(input);
    place(at);
    input.focus();
    input.setSelectionRange(input.value.length, input.value.length);
    // the list of variables right away
    input.dispatchEvent(new KeyboardEvent('keydown', { key: ' ', ctrlKey: true, bubbles: true }));
    const apply = () => {
        const text = input.value.trim().replace(/^=\s*/, '');
        setFormula(el, setting.key, text || null);
        if (!text && !isCondition && before.value !== undefined) el[setting.key] = before.value;
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
            setFormula(el, setting.key, before.formula ?? null);
            if (before.formula === undefined && before.value !== undefined) el[setting.key] = before.value;
            if (before.hidden === undefined) delete el._hidden;
            closeFollow();
            redraw();
        }
    });
}

/** Opens "Follow a variable…" for `el` at screen point `at`; `withVar`: start the formula with that variable. */
export function openFollow(el, at = { x: window.innerWidth / 2 - 150, y: 160 }, withVar = null) {
    closeFollow();
    box = document.createElement('div');
    box.className = 'follow-box';
    const settings = settingsOf(el);
    box.innerHTML = `
        <div class="follow-title">${withVar ? `Follow <code>${escapeHtml(withVar)}</code>` : 'Follow a variable'} <span>— which setting?</span></div>
        <input type="text" class="prop-control follow-search" placeholder="Search a setting…" spellcheck="false">
        <div class="follow-list"></div>`;
    document.body.appendChild(box);
    const search = box.querySelector('.follow-search');
    const list = box.querySelector('.follow-list');
    let shown = settings;
    let active = 0;
    const render = () => {
        const q = search.value.trim().toLowerCase();
        shown = settings.filter(s => !q || s.label.toLowerCase().includes(q) || s.key.toLowerCase().includes(q));
        active = Math.min(active, Math.max(0, shown.length - 1));
        list.innerHTML = shown.map((s, i) => `<div class="follow-item${i === active ? ' active' : ''}" data-i="${i}"><span>${escapeHtml(s.label)}</span><span class="follow-now">${escapeHtml(s.now)}</span></div>`).join('') || '<div class="follow-none">No setting of that name</div>';
    };
    render();
    place(at);
    search.focus();
    search.addEventListener('input', () => { active = 0; render(); });
    search.addEventListener('keydown', (e) => {
        if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); active = (active + (e.key === 'ArrowDown' ? 1 : -1) + shown.length) % Math.max(1, shown.length); render(); }
        else if (e.key === 'Enter' && shown[active]) { e.preventDefault(); formulaStep(el, shown[active], at, withVar); }
        else if (e.key === 'Escape') { e.preventDefault(); closeFollow(); }
    });
    list.addEventListener('mousedown', (e) => {
        const row = e.target.closest('[data-i]');
        if (!row) return;
        e.preventDefault();
        formulaStep(el, shown[Number(row.dataset.i)], at, withVar);
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

