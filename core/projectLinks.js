// ============================================================
// core/projectLinks.js — The files the project's elements link now, each
// copy with the original it follows: figures, tables, plot layers'
// data, choices' options, variable files. Sent with every "copy this
// file into the project" (backend/projectfiles.py), so a file linked
// again reuses its copy, and a copy that follows one original isn't
// taken for another file that only happens to be equal today.
// ============================================================

import { state, forEachElementDeep } from './state.js';

/** [{ copy, original }] over the slides, the masters and the macros. */
export function linkedCopies() {
    const out = [];
    const add = (copy, original) => { if (copy && original) out.push({ copy: String(copy), original: String(original) }); };
    const visit = (els) => forEachElementDeep(els || [], el => {
        if (el.type === 'figure' && el.filePath && el.originalPath && el.filePath !== el.originalPath) add(el.filePath, el.originalPath);
        if (el.type === 'table' && el.data && el.data.src) add(el.data.src, el.data.original);
        if (el.type === 'choice' && el.source) add(el.source, el.original);
        if (el.type === 'plot') {
            for (const m of String(el.code || '').matchAll(/^\s*\.[a-z]+\b.*?\bdata:(?:"\{?([^"}]+)\}?"|\{([^}]+)\}|(\S+))(?:.*?\boriginal:(?:"([^"]*)"|(\S+)))?/gm)) {
                add(m[1] || m[2] || m[3], m[4] || m[5]);
            }
        }
    });
    (state.slides || []).forEach(s => visit(s.elements));
    (state.masters || []).forEach(m => visit(m.elements));
    Object.values(state.macros || {}).forEach(m => visit(m.children));
    (state.varFiles || []).forEach(f => add(f.file, f.original));
    return out;
}
