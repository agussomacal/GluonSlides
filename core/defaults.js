// ============================================================
// core/defaults.js — Project-wide style defaults and named styles
// (a small cascade, like CSS):
//
//   element's own value  >  its named style  >  project default  >  built-in
//
//   .style.text {title} fontFamily:Montserrat fontSize:64 fontColor:@primary
//   (an element uses it with style:title)
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
import { COLOR_KEYS, resolveColor } from './colors.js';

export const STYLE_NAME_RE = /^[A-Za-z][\w-]*$/;

/** Style properties that may be inherited, per element type. */
export const STYLE_KEYS = {
    text: ['fontFamily', 'fontSize', 'fontColor', 'textAlign', 'verticalAlign', 'bg', 'borderCol', 'borderWidth', 'borderStyle'],
    shape: ['bg', 'borderCol', 'borderWidth', 'borderStyle'],
    figure: ['bg', 'borderCol', 'borderWidth', 'borderStyle'],
    path: ['stroke', 'strokeWidth', 'dash', 'fill'],
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

// ---------- Named styles ----------

/** Names of the styles defined for a type, in order of creation. */
export function styleNames(type) {
    return Object.keys((state.styles && state.styles[type]) || {});
}

/** A style's own values (may be partial), or null. */
export function getStyle(type, name) {
    return (state.styles && state.styles[type] && state.styles[type][name]) || null;
}

/** Creates a style (optionally with values); false if the name is taken/invalid. */
export function createStyle(type, name, values = {}) {
    if (!STYLE_NAME_RE.test(name || '') || getStyle(type, name)) return false;
    state.styles = state.styles || {};
    state.styles[type] = { ...(state.styles[type] || {}), [name]: { ...values } };
    return true;
}

/** Sets (or with '' / null removes) one value of a style. */
export function setStyleValue(type, name, key, value) {
    const style = getStyle(type, name);
    if (!style) return;
    if (value === '' || value === null || value === undefined) delete style[key];
    else style[key] = value;
}

/** Calls fn(el) for every element in the project (slides, macros). */
function forEachElement(fn) {
    const visit = (elements) => (elements || []).forEach(el => {
        fn(el);
        visit(el.children);
        visit(el.extras);
    });
    state.slides.forEach(s => visit(s.elements));
    Object.values(state.macros || {}).forEach(m => visit(m.children));
}

/** Renames a style and every element using it. */
export function renameStyle(type, oldName, newName) {
    if (!STYLE_NAME_RE.test(newName || '') || getStyle(type, newName) || !getStyle(type, oldName)) return false;
    // Keep the order of the styles.
    state.styles[type] = Object.fromEntries(Object.entries(state.styles[type])
        .map(([n, v]) => [n === oldName ? newName : n, v]));
    forEachElement(el => { if (el.type === type && el.style === oldName) el.style = newName; });
    return true;
}

/** Deletes a style; its elements fall back to the project defaults. */
export function deleteStyle(type, name) {
    if (!getStyle(type, name)) return;
    delete state.styles[type][name];
    if (!Object.keys(state.styles[type]).length) delete state.styles[type];
    forEachElement(el => { if (el.type === type && el.style === name) delete el.style; });
}

/** How many elements use a style. */
export function styleUsage(type, name) {
    let n = 0;
    forEachElement(el => { if (el.type === type && el.style === name) n++; });
    return n;
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
export function withDefaults(el, { resolveColors = false } = {}) {
    if (!el || (!STYLE_KEYS[el.type] && !resolveColors)) return el;
    return new Proxy(el, {
        get(target, key, receiver) {
            let value = Reflect.get(target, key, receiver);
            if (typeof key !== 'string') return value;
            if (value === undefined && isStyleKey(target.type, key)) value = inheritedValue(target, key);
            // For drawing: theme colors and opacity become CSS colors.
            if (resolveColors && COLOR_KEYS.includes(key)) return resolveColor(value);
            return value;
        },
    });
}

/** What an element inherits for `key`: its named style, then the defaults. */
export function inheritedValue(el, key) {
    const style = el.style ? getStyle(el.type, el.style) : null;
    if (style && style[key] !== undefined && style[key] !== '') return style[key];
    return defaultValue(el.type, key);
}

/** Where an inherited value comes from: the style name, or 'default'. */
export function inheritedFrom(el, key) {
    const style = el.style ? getStyle(el.type, el.style) : null;
    return style && style[key] !== undefined && style[key] !== '' ? el.style : 'default';
}

/** Drawing view of an element: defaults + named style + resolved colors. */
export function forDrawing(el) {
    return withDefaults(el, { resolveColors: true });
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
        const style = (el.style && getStyle(el.type, el.style)) || {};
        keys.forEach(k => {
            if (el[k] === undefined) return;
            const same = (v) => v !== undefined && String(v) === String(el[k]);
            if (same(builtin[k]) || same(projectStyle(el.type)[k]) || same(style[k])) {
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
