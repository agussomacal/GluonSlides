// ============================================================
// core/variables.js — Variables: values that text shows (\var{name},
// \var{name}[%.2f]) and plots compute with (elements/plot).
//
// Where a value comes from, the later winning:
//   .vars alpha:0.05                    written in the project
//   .vars {data/summary.json} sync:yes  a JSON / CSV file (backend/variables.py),
//                                       copied into data/ and following the
//                                       original when a script rewrites it
//   a slider (elements/slider)          its value; moved while presenting
//
// In text a value is drawn in a marker (a span, or KaTeX's \htmlData in
// math) so a slider can change it in place, in the editor and in an
// exported HTML (core/liveEngine.js liveUpdate).
// ============================================================

import { linkedCopies } from './projectLinks.js';
import { state, pyApi, forEachElementDeep } from './state.js';
import { protectMath } from './render.js';
import { formatValue, compileFormula, parseTracks, variableValue } from './liveEngine.js';
import { dataTable } from './plotData.js';

const fileState = new Map();   // `${folder}\u0000${file}` -> { values, mtime, error }
const live = {};               // slider positions moved in the editor (not saved)

const keyOf = (file) => `${state.projectFolder || ''}\u0000${file}`;

/** The values of the project's variable files, as last read. */
export function fileValues() {
    const out = {};
    (state.varFiles || []).forEach(f => Object.assign(out, (fileState.get(keyOf(f.file)) || {}).values || {}));
    return out;
}

/** The values one file gave (null: not read yet). */
export function valuesOfFile(file) {
    const st = fileState.get(keyOf(file));
    return st ? st.values || {} : null;
}

/** { file: error } for files that could not be read. */
export function fileErrors() {
    const out = {};
    (state.varFiles || []).forEach(f => {
        const s = fileState.get(keyOf(f.file));
        if (s && s.error) out[f.file] = s.error;
    });
    return out;
}

/** Where a slider starts: its value, kept inside its range (a value outside it can't be shown). */
export function sliderStart(el) {
    const num = (v, d) => (v === '' || v === undefined || v === null || !Number.isFinite(Number(v)) ? d : Number(v));
    const lo = num(el.min, 0);
    const hi = num(el.max, 1);
    const v = num(el.value, lo);
    return Math.min(Math.max(v, Math.min(lo, hi)), Math.max(lo, hi));
}

/**
 * The options a choice takes from a file (source:data/run.csv): { options,
 * error, loading, what }. use: header (a CSV's column names, the default),
 * column:<name> (the values of a column, each once), keys (a JSON's keys,
 * the default for JSON; a list: its items), keys:<path> (the keys of the
 * object at a.b inside it).
 */
export function fileOptions(el) {
    const t = el.source ? dataTable(el.source) : null;
    if (!el.source) return { options: [] };
    if (!t) return { options: [], loading: true };
    if (t.error) return { options: [], error: t.error };
    const use = String(el.use || (t.json !== undefined ? 'keys' : 'header'));
    if (t.json !== undefined) {
        const m = use.match(/^keys(?::(.+))?$/);
        if (!m) return { options: [], error: `use:${use}: a JSON file takes keys or keys:<path>` };
        let node = t.json;
        for (const part of (m[1] || '').split('.').filter(Boolean)) {
            node = node && typeof node === 'object' ? node[part] : undefined;
            if (node === undefined) return { options: [], error: `${el.source}: no “${m[1]}” in it` };
        }
        if (Array.isArray(node)) return { options: node.filter(v => v !== null && typeof v !== 'object').map(String) };
        if (node && typeof node === 'object') return { options: Object.keys(node) };
        return { options: [], error: `${el.source}: “${m[1] || 'the file'}” is not an object or a list` };
    }
    if (use === 'header') {
        if (t.header && t.header.length) return { options: t.header.map(String) };
        // a file of names only: on one row ("Input;Output"), or one per line
        const rows = (t.rows || []).map(r => r.map(c => String(c ?? '').trim()).filter(Boolean)).filter(r => r.length);
        if (rows.length === 1) return { options: rows[0] };
        if (rows.length && rows.every(r => r.length === 1)) return { options: rows.map(r => r[0]) };
        return { options: [], error: `${el.source}: no header row (its first row is numbers)` };
    }
    const c = use.match(/^column:(.+)$/);
    if (!c) return { options: [], error: `use:${use}: a CSV file takes header or column:<name>` };
    const which = c[1].trim();
    let i = t.header ? t.header.indexOf(which) : -1;
    if (i < 0 && /^\d+$/.test(which)) i = Number(which) - 1;
    if (i < 0) return { options: [], error: `${el.source}: no column “${which}”` };
    return { options: [...new Set((t.rows || []).map(r => String(r[i] ?? '').trim()).filter(Boolean))] };
}

/** The options of a choice: written ("Adam, SGD, NGD"), or from a file (while it is read: the written ones). */
export function choiceOptions(el) {
    if (el.source) {
        const r = fileOptions(el);
        if (!r.loading && !r.error) return r.options;
    }
    return String(el.options ?? '').split(',').map(o => o.trim()).filter(Boolean);
}

/** Where an input starts: a slider's number, a checkbox's true / false, a box's number or text, a choice's option(s). */
export function inputStart(el) {
    const num = (v, d) => (v === '' || v === undefined || v === null || !Number.isFinite(Number(v)) ? d : Number(v));
    switch (el.type) {
        case 'slider': return sliderStart(el);
        case 'checkbox': return el.value === 'yes' || el.value === true;
        case 'numberbox': {
            let v = num(el.value, num(el.min, 0));
            if (el.min !== undefined && el.min !== '') v = Math.max(v, num(el.min, v));
            if (el.max !== undefined && el.max !== '') v = Math.min(v, num(el.max, v));
            return v;
        }
        case 'textbox': return String(el.value ?? '');
        case 'choice': {
            const opts = choiceOptions(el);
            const picked = String(el.value ?? '').split(',').map(o => o.trim()).filter(o => opts.includes(o));
            return el.multiple === 'yes' ? picked : (picked[0] ?? opts[0] ?? '');
        }
        default: return undefined;
    }
}

export const INPUT_TYPES = ['slider', 'checkbox', 'numberbox', 'textbox', 'choice'];

/** Each input's variable and its starting value, over the whole project. */
export function sliderValues() {
    const out = {};
    const visit = (els) => forEachElementDeep(els || [], el => {
        if (INPUT_TYPES.includes(el.type) && el.var) out[el.var] = inputStart(el);
    });
    (state.slides || []).forEach(s => visit(s.elements));
    (state.masters || []).forEach(m => visit(m.elements));
    return out;
}
export const inputValues = sliderValues;

/** Starting values of variables only animations set (their value at the start). */
export function animationValues() {
    const out = {};
    const visit = (els) => forEachElementDeep(els || [], el => {
        if (el.type !== 'animation') return;
        parseTracks(el.tracks).forEach(t => {
            if (t.name in out) return;
            if (t.from !== undefined && Number.isFinite(Number(t.from))) out[t.name] = Number(t.from);
            else if (t.formula !== undefined) {
                const f = compileFormula(t.formula, 'python');
                try { if (!f.error) out[t.name] = Number(f.exec(Object.assign(Object.create(null), { t: 0, p: 0 }))); } catch (e) { /* needs other variables */ }
            }
        });
    });
    (state.slides || []).forEach(s => visit(s.elements));
    (state.masters || []).forEach(m => visit(m.elements));
    return out;
}

/** Every variable now: written values, then files, then sliders (then where sliders were moved). */
export function allVariables() {
    return { ...(state.vars || {}), ...fileValues(), ...animationValues(), ...sliderValues(), ...live };
}

/** Starting values (no slider moved): what an export starts with. */
export function startingVariables() {
    return { ...(state.vars || {}), ...fileValues(), ...animationValues(), ...sliderValues() };
}

export function setLiveValue(name, value) {
    live[name] = value;
}

export function resetLiveValues() {
    Object.keys(live).forEach(k => delete live[k]);
}

// ---------- \var{name} in text ----------

// \var{name}, \var{name}[%.2f] (a number format) or \var{name}[on|off] (words for true / false);
// the name may pick by others: \var{results[opt].acc} (results.<opt's value>.acc)
const VAR_RE = /\\var\{([A-Za-z_][A-Za-z0-9_.]*(?:\[[^\]\n{}]*\](?:\.[A-Za-z_][A-Za-z0-9_.]*)?)*)\}(?:\[([^\]\n]*)\])?/g;
const escapeHtml = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

function mathValue(v, fmt) {
    if (typeof v !== 'number') return `\\text{${formatValue(v, fmt).replace(/[\\{}$%#&_^~]/g, ' ')}}`;
    const s = formatValue(v, fmt).replace(/−/g, '-').replace(/%$/, '\\%').replace(/∞/g, '\\infty');
    const m = s.match(/^(-?[\d.]+)e([-+])(\d+)$/);
    return m ? `${m[1]}\\times 10^{${m[2] === '-' ? '-' : ''}${Number(m[3])}}` : s;
}

/** Text with \var{…} replaced by markers showing the values (math gets KaTeX's \htmlData). */
export function resolveVars(text) {
    const raw = String(text ?? '');
    if (!raw.includes('\\var{')) return raw;
    const vars = allVariables();
    const { text: outside, pieces } = protectMath(raw);
    const fmtKey = (fmt) => (fmt ? fmt.replace(/^%/, '') : '');
    // `inline code` shows \var{…} as written
    const inText = outside.split(/(`+[^`]*`+)/).map((part, i) => (i % 2 ? part : part.replace(VAR_RE, (_, name, fmt) => {
        const value = variableValue(name, vars);
        if (value === undefined) return `<span class="cite-missing" title="No variable named ${escapeHtml(name)}">[? ${escapeHtml(name)}]</span>`;
        return `<span class="gl-var" data-glvar="${escapeHtml(name)}"${fmt ? ` data-glfmt="${escapeHtml(fmt)}"` : ''}>${escapeHtml(formatValue(value, fmt))}</span>`;
    }))).join('');
    const inMath = pieces.map(p => p.replace(VAR_RE, (_, name, fmt) => {
        const value = variableValue(name, vars);
        if (value === undefined) return `\\textcolor{red}{?\\text{${name.replace(/_/g, '\\_').replace(/[[\]]/g, ' ')}}}`;
        const attrs = `glvar=${name}${fmt ? `, glfmt=${fmtKey(fmt)}` : ''}`;
        return `\\htmlData{${attrs}}{${mathValue(value, fmt)}}`;
    }));
    return inText.replace(/GLMATH(\d+)X/g, (t, i) => (inMath[Number(i)] !== undefined ? inMath[Number(i)] : t)).replace(/GLDOLLARX/g, '\\$');
}

/** Text before the cursor inside \var{…: group 1 = the name typed so far. */
export const OPEN_VAR_RE = /\\var\{([A-Za-z0-9_.]*)$/;

/** Names offered after \var{ (autocomplete): [{ name, label }]. */
export function variableCandidates(typed = '') {
    const vars = allVariables();
    return Object.keys(vars).sort()
        .filter(n => n.toLowerCase().startsWith(typed.toLowerCase()))
        .map(n => ({ name: n, label: formatValue(vars[n]) }));
}

// ---------- files: read at opening, followed while editing ----------

let busy = false;

/** Reads the variable files that changed (all of them with `force`). True if a value changed. */
export async function syncVarFiles({ force = false } = {}) {
    const api = pyApi();
    if (busy || !api || typeof api.refresh_vars !== 'function' || !state.projectFolder) return false;
    const files = (state.varFiles || []).filter(f => force || f.sync !== false || !fileState.has(keyOf(f.file)));
    if (!files.length) return false;
    busy = true;
    try {
        const items = files.map(f => ({ src: f.file, original: f.sync === false ? '' : (f.original || ''), mtime: force ? 0 : ((fileState.get(keyOf(f.file)) || {}).mtime || 0) }));
        const res = await api.refresh_vars(state.projectFolder, items);
        let changed = false;
        (res && res.updated || []).forEach(u => {
            const before = JSON.stringify(fileState.get(keyOf(u.src)) || null);
            fileState.set(keyOf(u.src), u.success ? { values: u.values || {}, mtime: u.mtime } : { values: {}, mtime: -1, error: u.error });
            if (JSON.stringify(fileState.get(keyOf(u.src))) !== before) changed = true;
        });
        if (changed) document.dispatchEvent(new CustomEvent('slide-content-changed'));
        return changed;
    } catch (e) {
        return false;
    } finally {
        busy = false;
    }
}

/** Links a file of variables: copied into data/, read, added to the project. */
export async function linkVarFile(path) {
    const api = pyApi();
    if (!api || !state.projectFolder) return { success: false, error: 'Save the project first: the file is copied into its folder.' };
    const res = await api.link_vars_file(state.projectFolder, path, linkedCopies());
    if (!res || !res.success) return res || { success: false, error: 'Could not read the file' };
    state.varFiles = (state.varFiles || []).filter(f => f.file !== res.relative_path);
    state.varFiles.push({ file: res.relative_path, original: res.original, sync: true });
    fileState.set(keyOf(res.relative_path), { values: res.values || {}, mtime: res.mtime });
    return res;
}

let timer = null;
export function startVarSync(intervalMs = 3000) {
    if (timer) return;
    const tick = () => {
        const editor = document.getElementById('editor-view');
        if (editor && editor.classList.contains('active') && !document.hidden) syncVarFiles();
    };
    timer = setInterval(tick, intervalMs);
    window.addEventListener('focus', tick);
    document.addEventListener('project-switched', () => { resetLiveValues(); syncVarFiles(); });
}
