// ============================================================
// core/defaults.js — Project-wide style defaults (a small cascade,
// like CSS):
//
//   element's own value  >  project default  >  built-in default
//
//   .defaults.text  fontFamily:"EB Garamond" fontSize:32 fontColor:#0f172a
//   .defaults.shape bg:#e0f2fe borderCol:#0369a1
//   .defaults.path  stroke:#0f172a strokeWidth:4
//
// Elements store only the style properties they change; anything they
// leave out is inherited, so changing a default updates every element
// that inherits it. Built-in defaults come from each element type's
// defaults() (so they still follow dark mode).
// ============================================================

import { state } from './state.js';
import { ElementRegistry } from './registry.js';

/** Style properties that may be inherited, per element type. */
export const STYLE_KEYS = {
    text: ['fontFamily', 'fontSize', 'fontColor', 'textAlign', 'verticalAlign', 'bg', 'borderCol', 'borderWidth', 'borderStyle'],
    shape: ['bg', 'borderCol', 'borderWidth', 'borderStyle'],
    figure: ['bg', 'borderCol', 'borderWidth', 'borderStyle'],
    path: ['stroke', 'strokeWidth', 'dash'],
};

export function isStyleKey(type, key) {
    return Boolean(STYLE_KEYS[type] && STYLE_KEYS[type].includes(key));
}

/** Built-in style values of a type (from its defaults()). */
export function builtinStyle(type) {
    const def = ElementRegistry.get(type);
    const keys = STYLE_KEYS[type];
    if (!def || !keys) return {};
    const d = def.defaults({}) || {};
    const out = {};
    keys.forEach(k => { if (d[k] !== undefined) out[k] = d[k]; });
    if (type === 'path' && out.dash === undefined) out.dash = 'solid';
    return out;
}

/** The project's own defaults for a type (may be partial). */
export function projectStyle(type) {
    return (state.defaults && state.defaults[type]) || {};
}

/** Value an element of `type` gets for `key` when it does not set it. */
export function defaultValue(type, key) {
    const p = projectStyle(type);
    if (p[key] !== undefined && p[key] !== '') return p[key];
    return builtinStyle(type)[key];
}

/**
 * The element as seen with its defaults: reading a style property it
 * does not set returns the default; everything else (and every write)
 * goes to the element itself. Used wherever elements are drawn.
 */
export function withDefaults(el) {
    if (!el || !STYLE_KEYS[el.type]) return el;
    return new Proxy(el, {
        get(target, key, receiver) {
            const value = Reflect.get(target, key, receiver);
            if (value !== undefined || typeof key !== 'string' || !isStyleKey(target.type, key)) return value;
            return defaultValue(target.type, key);
        },
    });
}

/** True when the element inherits `key` (does not set it itself). */
export function inheritsKey(el, key) {
    return isStyleKey(el.type, key) && (el[key] === undefined || el[key] === null || el[key] === '');
}

/** A copy of `props` without the type's style keys (for new elements). */
export function withoutStyle(type, props) {
    const keys = new Set(STYLE_KEYS[type] || []);
    return Object.fromEntries(Object.entries(props).filter(([k]) => !keys.has(k)));
}

/** Sets (or, with value '' / null, removes) a project default. */
export function setProjectDefault(type, key, value) {
    state.defaults = state.defaults || {};
    const current = { ...(state.defaults[type] || {}) };
    if (value === '' || value === null || value === undefined) delete current[key];
    else current[key] = value;
    if (Object.keys(current).length) state.defaults[type] = current;
    else delete state.defaults[type];
}

/**
 * "Use project defaults": elements stop setting style values that are
 * just the built-in or project default (typically everything older
 * projects stored), so they follow the defaults from now on. Values an
 * element deliberately changed are kept. Returns how many values were
 * cleared.
 */
export function adoptDefaults() {
    let cleared = 0;
    const visit = (elements) => (elements || []).forEach(el => {
        const keys = STYLE_KEYS[el.type] || [];
        const builtin = builtinStyle(el.type);
        keys.forEach(k => {
            if (el[k] === undefined) return;
            const same = (v) => v !== undefined && String(v) === String(el[k]);
            if (same(builtin[k]) || same(projectStyle(el.type)[k])) {
                delete el[k];
                cleared++;
            }
        });
        visit(el.children);
        visit(el.extras);
    });
    state.slides.forEach(s => visit(s.elements));
    Object.values(state.macros || {}).forEach(m => visit(m.children));
    return cleared;
}
