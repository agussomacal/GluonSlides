// ============================================================
// core/colors.js — The project's theme colors (palette) and color
// values with opacity.
//
//   .palette primary:#0c4a6e accent:#f59e0b dark:#0f172a light:#f8fafc
//
// A color value is one of:
//   #rrggbb            a specific color
//   @name              a theme color (follows the palette)
//   transparent / none
// optionally followed by /NN for opacity in percent:
//   bg:@accent/40      accent at 40% opacity
//
// Changing a theme color updates everything that uses it; opacity is
// kept separately, so no extra "semi-transparent" colors are needed.
// ============================================================

import { state } from './state.js';

/** Color properties of elements (shown with the color picker). */
export const COLOR_KEYS = ['bg', 'borderCol', 'fontColor', 'stroke', 'fill'];

/** Palette used until a project defines its own. */
export const STARTER_PALETTE = [
    { name: 'primary', color: '#1d4ed8' },
    { name: 'secondary', color: '#0f766e' },
    { name: 'accent', color: '#f59e0b' },
    { name: 'dark', color: '#0f172a' },
    { name: 'muted', color: '#64748b' },
    { name: 'light', color: '#f1f5f9' },
];

export const COLOR_NAME_RE = /^[A-Za-z][\w-]*$/;

/** The project's theme colors: [{ name, color }]. */
export function palette() {
    return Array.isArray(state.palette) ? state.palette : STARTER_PALETTE;
}

/** Replaces the palette (the project then stores its own). */
export function setPalette(entries) {
    state.palette = entries.map(e => ({ name: e.name, color: e.color }));
}

/** { base, alpha } of a color value; alpha 0–100 (100 = opaque). */
export function parseColor(value) {
    const s = String(value ?? '').trim();
    const m = s.match(/^(.*?)\/(\d{1,3})$/);
    const base = (m ? m[1] : s) || '';
    const alpha = m ? Math.max(0, Math.min(100, Number(m[2]))) : 100;
    return { base, alpha };
}

/** Color value from base + alpha (no suffix when opaque). */
export function formatColor(base, alpha = 100) {
    if (!base || base === 'transparent' || base === 'none') return base || 'transparent';
    return alpha >= 100 ? base : `${base}/${Math.round(alpha)}`;
}

function hexToRgb(hex) {
    let h = hex.replace('#', '');
    if (h.length === 3) h = h.split('').map(c => c + c).join('');
    if (!/^[0-9a-fA-F]{6}$/.test(h)) return null;
    return [0, 2, 4].map(i => parseInt(h.slice(i, i + 2), 16));
}

/** The hex color a base refers to (theme colors looked up), or null. */
export function baseToHex(base) {
    if (typeof base !== 'string') return null;
    if (base.startsWith('@')) {
        const entry = palette().find(p => p.name === base.slice(1));
        return entry ? entry.color : null;
    }
    return /^#[0-9a-fA-F]{3,6}$/.test(base) ? base : null;
}

/** CSS color for a color value (theme colors and opacity resolved). */
export function resolveColor(value) {
    if (value === undefined || value === null || value === '') return value;
    const { base, alpha } = parseColor(value);
    if (base === 'transparent' || base === 'none') return base;
    if (!base.startsWith('@') && alpha >= 100) return base; // plain color (or other CSS)
    const hex = baseToHex(base);
    if (!hex) return base.startsWith('@') ? '#ff00ff' : base; // unknown theme color: visible
    if (alpha >= 100) return hex;
    const rgb = hexToRgb(hex);
    return rgb ? `rgba(${rgb[0]}, ${rgb[1]}, ${rgb[2]}, ${(alpha / 100).toFixed(2)})` : hex;
}

/** Short human label: "accent · 40%", "#ff0000", "None". */
export function colorLabel(value) {
    const { base, alpha } = parseColor(value);
    if (!base || base === 'transparent' || base === 'none') return 'None';
    const name = base.startsWith('@') ? base.slice(1) : base.toLowerCase();
    return alpha < 100 ? `${name} · ${alpha}%` : name;
}

// ---------- Theme color references across the project ----------

/** Calls fn(obj, key) for every color property in the project. */
function forEachColorRef(fn) {
    const visitProps = (obj) => {
        if (!obj) return;
        COLOR_KEYS.forEach(k => { if (typeof obj[k] === 'string') fn(obj, k); });
    };
    const visitElements = (elements) => (elements || []).forEach(el => {
        visitProps(el);
        (el.overrides || []).forEach(o => visitProps(o.props));
        visitElements(el.children);
        visitElements(el.extras);
    });
    state.slides.forEach(s => visitElements(s.elements));
    Object.values(state.macros || {}).forEach(m => visitElements(m.children));
    Object.values(state.defaults || {}).forEach(visitProps);
    Object.values(state.styles || {}).forEach(byName => Object.values(byName || {}).forEach(visitProps));
}

/** How many color properties use theme color `name`. */
export function paletteUsage(name) {
    let n = 0;
    forEachColorRef((obj, k) => { if (parseColor(obj[k]).base === `@${name}`) n++; });
    return n;
}

/** Renames a theme color and every reference to it. */
export function renamePaletteColor(oldName, newName) {
    setPalette(palette().map(p => (p.name === oldName ? { ...p, name: newName } : p)));
    forEachColorRef((obj, k) => {
        const { base, alpha } = parseColor(obj[k]);
        if (base === `@${oldName}`) obj[k] = formatColor(`@${newName}`, alpha);
    });
}

/** Removes a theme color; uses of it keep its color as a specific value. */
export function removePaletteColor(name) {
    const entry = palette().find(p => p.name === name);
    setPalette(palette().filter(p => p.name !== name));
    if (!entry) return;
    forEachColorRef((obj, k) => {
        const { base, alpha } = parseColor(obj[k]);
        if (base === `@${name}`) obj[k] = formatColor(entry.color, alpha);
    });
}
