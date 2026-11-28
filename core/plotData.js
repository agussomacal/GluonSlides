// ============================================================
// core/plotData.js — CSV files that plots draw (.points, .line, .hist,
// .bar with data:{data/run.csv}), and the CSV / JSON files choices take
// their options from (source:data/run.csv): read when needed, kept,
// and followed like linked tables (a layer's original:"…" is copied
// again when a script rewrites it). The rows go into the plot's spec, so
// an exported HTML has them.
// ============================================================

import { linkedCopies } from './projectLinks.js';
import { state, pyApi, forEachElementDeep } from './state.js';

const cache = new Map();     // `${folder}\u0000${file}` -> { header, rows, total, mtime, error } | 'loading'
const keyOf = (file) => `${state.projectFolder || ''}\u0000${file}`;
const changed = () => document.dispatchEvent(new CustomEvent('slide-content-changed'));

// what is kept of a file: a CSV's rows, a JSON's content
const kept = (res) => (res.json !== undefined ? { json: res.json, mtime: res.mtime } : { header: res.header, rows: res.rows, total: res.total, mtime: res.mtime });

/** The rows of a data file ({ header, rows }; a .json: { json }), or null while it is read (the plot is redrawn then). */
export function dataTable(file) {
    const key = keyOf(file);
    const got = cache.get(key);
    if (got && got !== 'loading') return got;
    if (!got) load(file);
    return null;
}

async function load(file) {
    const api = pyApi();
    const key = keyOf(file);
    if (!api || typeof api.read_plot_data !== 'function') {
        cache.set(key, { error: `${file}: data files need the app` });
        return;
    }
    cache.set(key, 'loading');
    try {
        const res = await api.read_plot_data(state.projectFolder || '', file);
        cache.set(key, res && res.success ? kept(res) : { error: (res && res.error) || `${file}: can't be read`, mtime: -1 });
    } catch (e) {
        cache.set(key, { error: `${file}: ${e.message}`, mtime: -1 });
    }
    changed();
}

/** Copies a file into data/ for a plot: { success, relative_path, original, header }. */
export async function linkDataFile(path) {
    const api = pyApi();
    if (!api || !state.projectFolder) return { success: false, error: 'Save the project first: the file is copied into its folder.' };
    const res = await api.link_plot_data(state.projectFolder, path, linkedCopies());
    if (res && res.success) cache.set(keyOf(res.relative_path), kept(res));
    return res;
}

/** The data files the project's plots use: [{ file, original }]. */
function usedFiles() {
    const files = new Map();
    const visit = (els) => forEachElementDeep(els || [], el => {
        // a choice whose options come from a file
        if (el.type === 'choice' && el.source) { if (!files.has(el.source)) files.set(el.source, el.original || ''); return; }
        if (el.type !== 'plot') return;
        for (const m of String(el.code || '').matchAll(/^\s*\.[a-z]+\b.*?\bdata:(?:"\{?([^"}]+)\}?"|\{([^}]+)\}|(\S+))(?:.*?\boriginal:"([^"]*)")?/gm)) {
            const file = m[1] || m[2] || m[3];
            if (file && !files.has(file)) files.set(file, m[4] || '');
        }
    });
    (state.slides || []).forEach(s => visit(s.elements));
    (state.masters || []).forEach(s => visit(s.elements));
    return [...files].map(([file, original]) => ({ file, original }));
}

let busy = false;
async function sync() {
    const api = pyApi();
    if (busy || !api || typeof api.refresh_plot_data !== 'function' || !state.projectFolder) return;
    const files = usedFiles().filter(f => cache.has(keyOf(f.file)) && cache.get(keyOf(f.file)) !== 'loading');
    if (!files.length) return;
    busy = true;
    try {
        const res = await api.refresh_plot_data(state.projectFolder, files.map(f => ({ src: f.file, original: f.original, mtime: cache.get(keyOf(f.file)).mtime || 0 })));
        const updated = (res && res.updated) || [];
        updated.forEach(u => cache.set(keyOf(u.src), u.success ? kept(u) : { error: u.error, mtime: -1 }));
        if (updated.length) changed();
    } catch (e) { /* tried again later */ } finally {
        busy = false;
    }
}

let timer = null;
export function startPlotDataSync(intervalMs = 3000) {
    if (timer) return;
    const tick = () => {
        const editor = document.getElementById('editor-view');
        if (editor && editor.classList.contains('active') && !document.hidden) sync();
    };
    timer = setInterval(tick, intervalMs);
    window.addEventListener('focus', tick);
}
