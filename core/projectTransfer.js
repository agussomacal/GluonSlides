// ============================================================
// core/projectTransfer.js — Objects and slides pasted from another
// project (another tab, ui/tabs.js) bring what they need with them:
//
//   figures (and images in text: ![](figures/x.png))  copied into this
//                     project's figures/ (still linked to their original)
//   linked tables     the CSV copied into data/ (same original)
//   macro instances   the macro's definition, if this project has none
//   named styles      the style, if this project has none of that name
//   theme colours     @name colours this palette lacks
//
// The clipboard notes where it was copied (clipboardSource) when copying.
// ============================================================

import { linkedCopies } from './projectLinks.js';
import { state, pyApi, forEachElementDeep } from './state.js';
import { palette, setPalette } from './colors.js';
import { rememberFigureSource } from '../elements/figure/figure.js';

const clone = (v) => (v === undefined ? v : JSON.parse(JSON.stringify(v)));

/** What a copy remembers about its project. */
export function clipboardSourceNow() {
    return {
        path: state.projectPath,
        folder: state.projectFolder,
        macros: clone(state.macros || {}),
        styles: clone(state.styles || {}),
        palette: clone(palette()),
    };
}

/** True when the clipboard comes from another project than the one open. */
export function fromAnotherProject(source) {
    return Boolean(source) && (source.path || null) !== (state.projectPath || null);
}

const isRelative = (p) => typeof p === 'string' && p && !/^([a-z]+:|\/|[A-Za-z]:[\\/])/i.test(p);
const joinPath = (folder, rel) => `${folder.replace(/[\\/]+$/, '')}/${rel}`;
const MD_IMAGE_RE = /(!\[[^\]]*\]\()([^)\s]+)(\))/g;

/**
 * Makes pasted `elements` (cloned, about to be added; changed in place)
 * work in this project. Returns a list of what could not be brought.
 */
export async function bringAlong(elements, source) {
    const problems = [];
    if (!fromAnotherProject(source)) return problems;
    const api = pyApi();
    const canCopy = Boolean(api && source.folder && state.projectFolder);
    const copiedFigures = new Map(); // source relative path -> this project's

    async function figure(rel) {
        if (!isRelative(rel) || !canCopy) return rel;
        if (copiedFigures.has(rel)) return copiedFigures.get(rel);
        const res = await api.import_figure(state.projectFolder, joinPath(source.folder, rel), linkedCopies());
        if (!res || !res.success) {
            problems.push(rel);
            copiedFigures.set(rel, rel);
            return rel;
        }
        rememberFigureSource(res.relative_path, res.data_uri);
        copiedFigures.set(rel, res.relative_path);
        return res.relative_path;
    }

    async function markdownImages(text) {
        if (typeof text !== 'string' || !text.includes('](')) return text;
        let out = text;
        for (const m of [...text.matchAll(MD_IMAGE_RE)]) {
            const now = await figure(m[2]);
            if (now !== m[2]) out = out.split(`${m[1]}${m[2]}${m[3]}`).join(`${m[1]}${now}${m[3]}`);
        }
        return out;
    }

    const neededMacros = new Set();
    const neededColours = new Set();
    const all = [];
    forEachElementDeep(elements, el => all.push(el));
    for (const el of all) {
        if (el.type === 'figure' && isRelative(el.filePath)) {
            const before = el.filePath;
            el.filePath = await figure(before);
            // A figure that only lived in the other project now follows that copy.
            if (el.filePath !== before && !el.originalPath && canCopy) el.originalPath = joinPath(source.folder, before);
        }
        if (el.type === 'table' && el.data && isRelative(el.data.src) && canCopy) {
            const res = await api.link_table_file(state.projectFolder, joinPath(source.folder, el.data.src), el.data.rows || null, linkedCopies());
            if (res && res.success) {
                el.data.src = res.relative_path;
                el.data.original = el.data.original || res.original;
            } else problems.push(el.data.src);
        }
        if (typeof el.content === 'string') el.content = await markdownImages(el.content);
        if (Array.isArray(el.columns)) for (const c of el.columns) c.content = await markdownImages(c.content);
        if (el.type === 'macro' && el.ref) neededMacros.add(el.ref);
        Object.values(el).forEach(v => {
            if (typeof v === 'string') for (const m of v.matchAll(/@([A-Za-z][\w-]*)/g)) neededColours.add(m[1]);
        });
        // named styles this project doesn't have
        if (el.style && source.styles && source.styles[el.type] && source.styles[el.type][el.style]) {
            state.styles = state.styles || {};
            const mine = state.styles[el.type] || {};
            if (!mine[el.style]) state.styles[el.type] = { ...mine, [el.style]: clone(source.styles[el.type][el.style]) };
        }
    }

    // macro definitions (and the macros they use), with their own figures
    const queue = [...neededMacros];
    while (queue.length) {
        const name = queue.shift();
        if ((state.macros || {})[name] || !source.macros || !source.macros[name]) continue;
        const def = clone(source.macros[name]);
        def.source = 'project';
        state.macros[name] = def;
        const inner = [];
        forEachElementDeep(def.children || [], el => inner.push(el));
        for (const el of inner) {
            if (el.type === 'figure' && isRelative(el.filePath)) el.filePath = await figure(el.filePath);
            if (typeof el.content === 'string') el.content = await markdownImages(el.content);
            if (el.type === 'macro' && el.ref) queue.push(el.ref);
        }
    }

    // theme colours this palette lacks
    const mine = palette();
    const missing = [...neededColours].filter(n => !mine.some(p => p.name === n));
    const theirs = (source.palette || []).filter(p => missing.includes(p.name));
    if (theirs.length) setPalette([...mine, ...theirs]);
    return problems;
}
