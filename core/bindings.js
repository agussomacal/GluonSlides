// ============================================================
// core/bindings.js — Settings given by a formula of the variables (a
// value starting with "="): an object's position, size, rotation,
// opacity, a visibility condition, font size…
//
//   .element.shape id:5 x:"=860 + 300*mu" width:"=100*sigma" rotate:"=30*mu" visible:"=mu > 0"
//
// The formula is kept in el.formulas[key] (what the file writes); el[key]
// holds its value now, so everything that reads positions works as
// before. applyFormulas() recomputes them (a slider moved, a file
// changed); after a drag or a resize, reconcileFormulas() moves the
// formula's constant by what the object moved (860 + 300*mu -> 900 +
// 300*mu). Formulas are read by core/liveEngine.js (Python syntax; never
// run as code).
// ============================================================

import { state, forEachElementDeep } from './state.js';
import { ElementRegistry } from './registry.js';
import { compileFormula, COLOR_KEYS, setThemeColors, applyColor } from './liveEngine.js';
import { palette, resolveColor } from './colors.js';
import { allVariables } from './variables.js';

/** Settings every object can take a formula for (besides its own numbers and colours). */
export const BINDABLE_COMMON = ['x', 'y', 'width', 'height', 'rotate', 'opacity', 'visible'];
export { COLOR_KEYS };

/** The engine's theme colours (palette(i), @name in formulas) from the project's. */
export function syncThemeColors() {
    setThemeColors(palette().map(p => ({ name: p.name, color: resolveColor(p.color) || p.color })));
}

/** A colour formula's value: { value: '#2563eb' } (a theme colour resolved) or { error }. */
export function evaluateColor(formula, vars = allVariables()) {
    const f = compileFormula(String(formula), 'python');
    if (f.error) return { error: f.error };
    const missing = f.names.filter(n => !(n in vars));
    if (missing.length) return { error: `unknown name${missing.length > 1 ? 's' : ''}: ${missing.join(', ')}` };
    try {
        const v = f.exec(Object.assign(Object.create(null), vars));
        if (typeof v !== 'string' || !v.trim()) return { error: 'not a colour (a text like \'#2563eb\' or \'@primary\')' };
        return { value: resolveColor(v.trim()) || v.trim() };
    } catch (e) {
        return { error: e.message };
    }
}

/** The value of a formula with these variables: { value } or { error }. */
export function evaluateFormula(formula, vars = allVariables()) {
    const f = compileFormula(String(formula), 'python');
    if (f.error) return { error: f.error };
    const missing = f.names.filter(n => !(n in vars) && n !== 'x');
    if (missing.length) return { error: `unknown name${missing.length > 1 ? 's' : ''}: ${missing.join(', ')}` };
    try {
        const v = f.exec(Object.assign(Object.create(null), vars));
        return { value: typeof v === 'boolean' ? (v ? 1 : 0) : Number(v) };
    } catch (e) {
        return { error: e.message };
    }
}

function everyElement(fn) {
    const visit = (els) => forEachElementDeep(els || [], el => { if (el.formulas) fn(el); });
    (state.slides || []).forEach(s => visit(s.elements));
    (state.masters || []).forEach(m => visit(m.elements));
    Object.values(state.macros || {}).forEach(m => visit(m.children));
}

function everyElementAtAll(fn) {
    const visit = (els) => forEachElementDeep(els || [], fn);
    (state.slides || []).forEach(s => visit(s.elements));
    (state.masters || []).forEach(m => visit(m.elements));
    Object.values(state.macros || {}).forEach(m => visit(m.children));
}

/** Elements with two descriptions of their geometry kept in step (a circle: centre and radius, and its box). */
export function syncDerived(el = null) {
    const one = (e) => { const def = ElementRegistry.get(e.type); if (def && typeof def.syncGeometry === 'function') def.syncGeometry(e); };
    if (el) one(el); else everyElementAtAll(one);
}

/** Whether the project has any formula-driven setting. */
export function hasFormulas() {
    let any = false;
    everyElement(() => { any = true; });
    return any;
}

/** Sets one object's formula-driven values (errors in el._formulaErrors). */
export function applyElementFormulas(el, vars = allVariables()) {
    if (!el.formulas) return;
    const errors = {};
    Object.entries(el.formulas).forEach(([key, formula]) => {
        // a colour: the text it gives (not a number; dragging doesn't change it)
        if (COLOR_KEYS.includes(key)) {
            const c = evaluateColor(formula, vars);
            if (c.error) errors[key] = c.error; else el[key] = c.value;
            return;
        }
        const r = evaluateFormula(formula, vars);
        if (r.error) { errors[key] = r.error; return; }
        if (key === 'visible') el._hidden = !r.value;
        else if (Number.isFinite(r.value)) {
            el[key] = Math.round(r.value * 1000) / 1000;
            // what was set: an edit that changes the value moves the formula's constant
            el._formulaValues = { ...(el._formulaValues || {}), [key]: el[key] };
        }
    });
    if (!('visible' in el.formulas)) delete el._hidden;
    if (Object.keys(errors).length) el._formulaErrors = errors; else delete el._formulaErrors;
}

/** Recomputes every formula-driven value of the project. */
export function applyFormulas(vars = allVariables()) {
    syncThemeColors();
    everyElement(el => applyElementFormulas(el, vars));
    syncDerived(); // e.g. a circle's box from a radius given by a formula
}

const round = (v) => Math.round(v * 100) / 100;
const fmt = (v) => String(round(v));

/**
 * The formula moved by `delta`: its constant term changed (a leading or a
 * trailing number), else "+ delta" added.
 */
export function shiftConstant(formula, delta) {
    const f = String(formula).trim();
    if (!delta) return f;
    const lead = f.match(/^(-?\d+(?:\.\d+)?)(\s*[-+][\s\S]*)$/);
    if (lead) {
        return `${fmt(Number(lead[1]) + delta)}${lead[2]}`;
    }
    const trail = f.match(/^([\s\S]*?)([-+])\s*(\d+(?:\.\d+)?)$/);
    if (trail && trail[1].trim() && !/[*/]\s*$/.test(trail[1]) && !/\*\*\s*$/.test(trail[1])) {
        const n = (trail[2] === '-' ? -1 : 1) * Number(trail[3]) + delta;
        return `${trail[1].replace(/\s+$/, '')} ${n < 0 ? '-' : '+'} ${fmt(Math.abs(n))}`;
    }
    if (/^-?\d+(?:\.\d+)?$/.test(f)) return fmt(Number(f) + delta);
    return `${f} ${delta < 0 ? '-' : '+'} ${fmt(Math.abs(delta))}`;
}

/**
 * After an edit (a drag, a resize, a turn, align…): a formula-driven value
 * that is no longer the one last set moves the formula's constant by the
 * difference (whatever the variables are now).
 */
export function reconcileFormulas() {
    syncDerived(); // a moved circle: its centre and radius first
    everyElement(el => {
        Object.keys(el.formulas).forEach(key => {
            if (key === 'visible' || !el._formulaValues || !(key in el._formulaValues)) return;
            const now = Number(el[key]);
            const was = Number(el._formulaValues[key]);
            if (!Number.isFinite(now) || !Number.isFinite(was)) return;
            const delta = round(now - was);
            if (Math.abs(delta) < 0.01) return;
            el.formulas[key] = shiftConstant(el.formulas[key], delta);
            el._formulaValues[key] = now;
        });
    });
}

/** Sets (formula) or clears (null) a setting's formula, and its value now. */
export function setFormula(el, key, formula) {
    if (formula === null || formula === undefined || !String(formula).trim()) {
        if (el.formulas) {
            delete el.formulas[key];
            if (!Object.keys(el.formulas).length) delete el.formulas;
        }
        if (key === 'visible') delete el._hidden;
        if (el._formulaValues) delete el._formulaValues[key];
        return;
    }
    el.formulas = { ...(el.formulas || {}), [key]: String(formula).trim().replace(/^=\s*/, '') };
    applyElementFormulas(el);
    syncDerived(el);
}

/**
 * While a slider is dragged on the canvas: the formula-driven objects of
 * `root` moved in place (the canvas is redrawn when the slider is let go).
 */
export function liveApplyToCanvas(root, vars = allVariables()) {
    if (!root) return;
    everyElement(el => {
        applyElementFormulas(el, vars);
        syncDerived(el);
        const node = root.querySelector(`[data-element-id="${CSS.escape(String(el.id))}"]`);
        if (!node) return;
        node.style.left = `${el.x}px`;
        node.style.top = `${el.y}px`;
        node.style.width = `${el.width}px`;
        node.style.height = `${el.height}px`;
        node.style.transform = Number(el.rotate) ? `rotate(${Number(el.rotate)}deg)` : '';
        node.style.opacity = el.opacity !== undefined && Number(el.opacity) < 1 ? String(Math.max(0, Number(el.opacity))) : '';
        if (el.formulas.fontSize) node.style.fontSize = `${el.fontSize}px`;
        COLOR_KEYS.forEach(key => { if (el.formulas && el.formulas[key] && el[key]) applyColor(node, key, el[key]); });
        node.classList.toggle('formula-hidden', Boolean(el._hidden));
    });
}
