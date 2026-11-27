// ============================================================
// core/textCommands.js — LaTeX-style commands in text (text boxes,
// columns, table cells), the same you write in math:
//
//   \textcolor{red}{important}      colour: a CSS / xcolor name (red,
//   \textcolor{@accent}{theme}        ForestGreen), #hex, a theme colour
//   \textcolor{red!60}{lighter}       (@name), or an xcolor mix (red!60 =
//                                     60% red + white, red!50!blue)
//   \highlight{yellow}{marked}      a background colour
//   \textbf{..} \textit{..} \emph{..} \underline{..} \texttt{..}
//
// Your own macros from macros.tex work in text too when they use these
// commands (\newcommand{\important}[1]{\textcolor{red}{\textbf{#1}}});
// macros for math only (\R, \argmin) are left to KaTeX in $...$.
// Arguments may hold Markdown, math and other commands. Runs on the text
// with its math already set aside (core/render.js), before Markdown.
// ============================================================

import { state } from './state.js';
import { resolveColor } from './colors.js';

const BUILTIN = {
    textcolor: { args: 2, html: (c, t) => wrapColor('color', c, t) },
    highlight: { args: 2, html: (c, t) => wrapColor('background-color', c, t, ';padding:0 0.15em;border-radius:0.15em') },
    colorbox: { args: 2, html: (c, t) => wrapColor('background-color', c, t, ';padding:0 0.15em') },
    textbf: { args: 1, html: (t) => `<strong>${t}</strong>` },
    textit: { args: 1, html: (t) => `<em>${t}</em>` },
    emph: { args: 1, html: (t) => `<em>${t}</em>` },
    underline: { args: 1, html: (t) => `<u>${t}</u>` },
    texttt: { args: 1, html: (t) => `<code>${t}</code>` },
};

/** The text commands, for the suggestions after "\" (core/fields.js). */
export const TEXT_COMMANDS = [
    { name: 'textcolor', label: 'Coloured text: \\textcolor{red}{…}', insert: 'textcolor{' },
    { name: 'highlight', label: 'Highlighted text: \\highlight{yellow}{…}', insert: 'highlight{' },
    { name: 'textbf', label: 'Bold', insert: 'textbf{' },
    { name: 'emph', label: 'Emphasis (italic)', insert: 'emph{' },
    { name: 'underline', label: 'Underlined', insert: 'underline{' },
    { name: 'texttt', label: 'Typewriter (code)', insert: 'texttt{' },
];

const SAFE_COLOR = /^[#@A-Za-z0-9!.\/ -]+$/;
const MAX_DEPTH = 20;

// ---------- colours ----------

let probe = null;

/** Any CSS colour as [r, g, b], or null. */
function cssRgb(name) {
    if (!probe) probe = document.createElement('canvas').getContext('2d');
    if (!probe) return null;
    probe.fillStyle = '#010203';
    probe.fillStyle = name;
    const v = probe.fillStyle;
    if (v === '#010203' && name.toLowerCase() !== '#010203') return null; // not a colour
    const m = /^#([0-9a-f]{6})$/i.exec(v);
    if (m) return [0, 2, 4].map(i => parseInt(m[1].slice(i, i + 2), 16));
    const r = /rgba?\(([^)]+)\)/.exec(v);
    return r ? r[1].split(',').slice(0, 3).map(Number) : null;
}

const hex = (rgb) => '#' + rgb.map(v => Math.round(Math.max(0, Math.min(255, v))).toString(16).padStart(2, '0')).join('');

/** CSS colour for a colour written in text, or null when it isn't one. */
export function textColor(value) {
    const v = String(value || '').trim();
    if (!v || !SAFE_COLOR.test(v)) return null;
    if (!v.includes('!')) {
        if (v.startsWith('@') || /^#[0-9a-fA-F]{3,8}(\/\d+)?$/.test(v)) return resolveColor(v);
        return cssRgb(v) ? v : null;
    }
    // xcolor mixes: c1!p!c2!q!c3 ... (a missing last colour is white)
    const parts = v.split('!');
    const rgbOf = (c) => {
        const css = c.startsWith('@') ? resolveColor(c) : c;
        return cssRgb(css);
    };
    let acc = rgbOf(parts[0]);
    if (!acc) return null;
    for (let i = 1; i < parts.length; i += 2) {
        const p = Math.max(0, Math.min(100, Number(parts[i]))) / 100;
        const other = parts[i + 1] !== undefined ? rgbOf(parts[i + 1]) : [255, 255, 255];
        if (!Number.isFinite(p) || !other) return null;
        acc = acc.map((a, k) => a * p + other[k] * (1 - p));
    }
    return hex(acc);
}

function wrapColor(prop, color, text, extra = '') {
    const css = textColor(color);
    return css ? `<span style="${prop}:${css}${extra}">${text}</span>` : text;
}

// ---------- your macros ----------

let macroCache = { raw: null, macros: {} };

/** The macros.tex macros usable in text: those whose body uses a text command
 *  (or another such macro). { name: { body, args } } */
function textMacros() {
    const raw = state.rawTexMacros || '';
    if (macroCache.raw === raw) return macroCache.macros;
    const all = {};
    const re = /\\(?:re)?newcommand\*?\s*\{?\s*\\([A-Za-z]+)\s*\}?\s*(?:\[(\d)\])?\s*\{/g;
    let m;
    while ((m = re.exec(raw))) {
        const start = re.lastIndex - 1;
        const arg = readGroup(raw, start);
        if (arg) all[m[1]] = { args: Number(m[2] || 0), body: arg.text };
    }
    const builtin = Object.keys(BUILTIN);
    const isText = {};
    const uses = (body, names) => names.some(n => new RegExp(`\\\\${n}(?![A-Za-z])`).test(body));
    let changed = true;
    while (changed) {
        changed = false;
        for (const [name, def] of Object.entries(all)) {
            if (!isText[name] && uses(def.body, [...builtin, ...Object.keys(isText)])) {
                isText[name] = true;
                changed = true;
            }
        }
    }
    const macros = {};
    Object.keys(isText).forEach(n => { if (!BUILTIN[n]) macros[n] = all[n]; });
    macroCache = { raw, macros };
    return macros;
}

// ---------- parsing ----------

/** The {...} group starting at text[i] (balanced, \{ \} skipped): { text, end } or null. */
function readGroup(text, i) {
    while (text[i] === ' ' || text[i] === '\t') i++;
    if (text[i] !== '{') return null;
    let depth = 0;
    for (let j = i; j < text.length; j++) {
        const ch = text[j];
        if (ch === '\\') { j++; continue; }
        if (ch === '{') depth++;
        else if (ch === '}' && --depth === 0) return { text: text.slice(i + 1, j), end: j + 1 };
    }
    return null;
}

/** Text with the text commands (and text macros) turned into HTML. */
export function applyTextCommands(text, depth = 0) {
    const src = String(text ?? '');
    if (depth > MAX_DEPTH || !src.includes('\\')) return src;
    const macros = textMacros();
    let out = '';
    let i = 0;
    const re = /\\([A-Za-z]+)/g;
    let m;
    while ((m = re.exec(src))) {
        const name = m[1];
        if (m.index > 0 && src[m.index - 1] === '\\') continue; // \\textbf: literal
        const builtin = BUILTIN[name];
        const macro = !builtin && macros[name];
        if (!builtin && !macro) continue;
        const n = builtin ? builtin.args : macro.args;
        const args = [];
        let end = re.lastIndex;
        for (let k = 0; k < n; k++) {
            const g = readGroup(src, end);
            if (!g) break;
            args.push(g.text);
            end = g.end;
        }
        if (args.length < n) continue; // incomplete: left as typed
        out += src.slice(i, m.index);
        if (builtin) {
            // the colour argument is a name, not text
            const done = args.map((a, k) => (builtin.args === 2 && k === 0 ? a : applyTextCommands(a, depth + 1)));
            out += builtin.html(...done);
        } else {
            const body = macro.body.replace(/#([1-9])/g, (_, d) => args[Number(d) - 1] ?? '');
            out += applyTextCommands(body, depth + 1);
        }
        i = end;
        re.lastIndex = end;
    }
    return out + src.slice(i);
}
