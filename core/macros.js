// ============================================================
// core/macros.js — Macro library: reusable element combinations.
//
//   .define {card} width:600 height:400      (in the project file or
//   	.element.shape name:frame ...          in an imported file such
//   	.element.text name:title ...           as macros.gl)
//
//   .macro.card id:20 x:100 y:100 width:900 height:600
//   	::title                                override the text body
//   		Results
//   	::frame bg:#fee2e2                     override properties
//   	::badge hidden:yes                     hide one element
//   	.element.text x:10 y:10 ...            extra element, this instance only
//
// state.macros maps name -> { name, width, height, children, source },
// where source is 'project' or the library file it came from.
// state.imports lists the files the project imports.
// ============================================================

import { state, pyApi, allocateId, currentSlide } from './state.js';
import { ElementRegistry } from './registry.js';
import { parseGlLibrary, serializeGlLibrary } from './gl/glformat.js';

export const DEFAULT_LIBRARY = 'macros.gl';
export const MACRO_NAME_RE = /^[A-Za-z][\w-]*$/;

export function getMacro(name) {
    return (state.macros && state.macros[name]) || null;
}

export function macroNames() {
    return Object.keys(state.macros || {}).sort((a, b) => a.localeCompare(b));
}

/** Calls fn(el) for every element of a list, descending into groups. */
function walk(elements, fn) {
    (elements || []).forEach(el => {
        fn(el);
        if (Array.isArray(el.children)) walk(el.children, fn);
    });
}

/** The element named `name` inside a definition (searching into groups). */
function findByName(elements, name) {
    let found = null;
    walk(elements, el => {
        if (!found && el.name === name) found = el;
    });
    return found;
}

/** Converts override values (strings from .gl) to numbers where the type expects it. */
function typedValue(target, key, value) {
    const def = ElementRegistry.get(target.type);
    const numeric = new Set(def && def.gl && def.gl.numericProps ? def.gl.numericProps : ['x', 'y', 'width', 'height', 'fontSize', 'borderWidth']);
    if (!numeric.has(key)) return value;
    const n = Number(value);
    return Number.isFinite(n) ? n : value;
}

/** Removes elements marked hidden (searching into groups). */
function dropHidden(elements) {
    return elements
        .filter(el => !el._hidden)
        .map(el => (Array.isArray(el.children) ? { ...el, children: dropHidden(el.children) } : el));
}

// Macros currently being drawn, outermost first. Nested instances are
// drawn by the renderer after resolveInstance returns, so loop
// detection has to span the whole drawing (see withinMacro).
const drawing = [];

/** Runs fn while drawing the contents of macro `ref` (for loop detection). */
export function withinMacro(ref, fn) {
    drawing.push(ref);
    try {
        return fn();
    } finally {
        drawing.pop();
    }
}

/**
 * The elements an instance shows: a copy of the definition with the
 * instance's overrides applied, plus its extra elements.
 * Returns { macro, children, missingTargets, error }.
 */
export function resolveInstance(inst) {
    const macro = getMacro(inst.ref);
    if (!macro) return { macro: null, children: [], missingTargets: [], error: `Unknown macro "${inst.ref}"` };
    if (drawing.includes(inst.ref)) {
        return { macro, children: [], missingTargets: [], error: `Macro loop: ${[...drawing, inst.ref].join(' → ')}` };
    }

    const children = structuredClone(macro.children || []);
    // Remember which definition element each top-level child came from
    // (used when editing an instance on the canvas).
    children.forEach(c => { if (c.name) c._origin = c.name; });
    const missingTargets = [];
    for (const o of inst.overrides || []) {
        const target = findByName(children, o.target);
        if (!target) {
            missingTargets.push(o.target);
            continue;
        }
        for (const [key, value] of Object.entries(o.props || {})) {
            if (key === 'hidden') target._hidden = value === 'yes';
            else target[key] = typedValue(target, key, value);
        }
        if (o.body !== undefined) {
            const def = ElementRegistry.get(target.type);
            // Only plain text bodies (not a group's children or a path's points).
            const bodyProp = def && def.gl && typeof def.gl.body === 'string' && !def.gl.parseBody ? def.gl.body : null;
            if (bodyProp) target[bodyProp] = o.body;
        }
    }
    return {
        macro,
        children: [...dropHidden(children), ...structuredClone(inst.extras || [])],
        missingTargets,
        error: null,
    };
}

/** Gives every unnamed element in `elements` a unique name (for overrides). */
export function nameElements(elements) {
    const used = new Set();
    walk(elements, el => { if (el.name) used.add(el.name); });
    walk(elements, el => {
        if (el.name) return;
        let i = 1;
        while (used.has(`${el.type}${i}`)) i++;
        el.name = `${el.type}${i}`;
        used.add(el.name);
    });
}

/** Strips project ids from definition elements (they are addressed by name). */
export function stripIds(elements) {
    walk(elements, el => { delete el.id; });
}

// ---------- Editing on the canvas (sessions) ----------
//
// Double-clicking an instance opens a session: the instance gets a
// working copy of its contents as `children` (plus frameWidth/Height),
// so the group-editing machinery (selection, drag, add, delete, paste)
// works on it unchanged. After every change, syncSession() turns the
// working copy back into overrides + extras ('instance' mode) or into
// the macro's definition ('definition' mode: all instances follow).

const INTERNAL_KEYS = new Set(['id', 'name', '_origin', 'type', 'children', 'points', 'overrides', 'extras']);

function textBodyKey(type) {
    const def = ElementRegistry.get(type);
    return def && def.gl && typeof def.gl.body === 'string' && !def.gl.parseBody ? def.gl.body : null;
}

/** Copy of an element for storing in a definition / as an extra. */
function cleanCopy(el) {
    const copy = structuredClone(el);
    walk([copy], e => { delete e.id; delete e._origin; });
    return copy;
}

/** Gives the working copy temporary project ids (canvas machinery needs them). */
function giveIds(elements) {
    walk(elements, e => { if (!Number.isInteger(e.id)) e.id = allocateId(); });
}

/**
 * Starts editing `inst` on the canvas. mode 'instance': changes become
 * overrides of this instance; 'definition': they change the macro.
 */
export function openSession(inst, mode = 'instance') {
    const macro = getMacro(inst.ref);
    if (!macro) return false;
    let children;
    if (mode === 'definition') {
        children = structuredClone(macro.children || []);
        children.forEach(c => { c._origin = c.name; });
    } else {
        children = resolveInstance(inst).children;
    }
    giveIds(children);
    inst.children = children;
    inst.frameWidth = macro.width;
    inst.frameHeight = macro.height;
    inst._session = mode;
    return true;
}

/** How working element `w` differs from definition element `d`. */
function diffElement(d, w) {
    // Changes a property override cannot express (a path's points, a
    // group's contents): replace the element by an extra instead.
    if (JSON.stringify(d.points || null) !== JSON.stringify(w.points || null)
        || JSON.stringify(cleanCopy(d).children || null) !== JSON.stringify(cleanCopy(w).children || null)) {
        return { replace: true };
    }
    const bodyKey = textBodyKey(w.type);
    const props = {};
    const keys = new Set([...Object.keys(d), ...Object.keys(w)]);
    keys.forEach(k => {
        if (INTERNAL_KEYS.has(k) || k === bodyKey || k.startsWith('_')) return;
        if (String(d[k] ?? '') !== String(w[k] ?? '')) props[k] = w[k] ?? '';
    });
    const body = bodyKey && String(d[bodyKey] ?? '') !== String(w[bodyKey] ?? '') ? String(w[bodyKey] ?? '') : undefined;
    return { props, body };
}

/** Writes the working copy of an open session back (see above). */
export function syncSession(inst) {
    const macro = getMacro(inst.ref);
    if (!macro || !Array.isArray(inst.children)) return;

    if (inst._session === 'definition') {
        const children = inst.children.map(cleanCopy);
        nameElements(children);
        macro.children = children;
        // Keep the working copy's names/origins in step (new elements got names).
        inst.children.forEach((w, i) => { w.name = children[i].name; w._origin = children[i].name; });
        return;
    }

    const byOrigin = new Map(inst.children.filter(w => w._origin).map(w => [w._origin, w]));
    const known = new Set((macro.children || []).map(d => d.name));
    const overrides = [];
    const extras = [];
    for (const d of macro.children || []) {
        const w = byOrigin.get(d.name);
        if (!w) {
            overrides.push({ target: d.name, props: { hidden: 'yes' } });
            continue;
        }
        const diff = diffElement(d, w);
        if (diff.replace) {
            overrides.push({ target: d.name, props: { hidden: 'yes' } });
            extras.push(cleanCopy(w));
            continue;
        }
        if (Object.keys(diff.props).length || diff.body !== undefined) {
            const o = { target: d.name, props: diff.props };
            if (diff.body !== undefined) o.body = diff.body;
            overrides.push(o);
        }
    }
    inst.children.forEach(w => {
        if (!w._origin || !known.has(w._origin)) extras.push(cleanCopy(w));
    });
    // Keep overrides for names the definition no longer has (still flagged).
    const stale = (inst.overrides || []).filter(o => !known.has(o.target));
    inst.overrides = [...overrides, ...stale];
    inst.extras = extras;
}

/**
 * Puts working element `name` back to its definition (dropping this
 * instance's override of it); the next sync removes the override.
 */
export function resetWorkingElement(inst, name) {
    const macro = getMacro(inst.ref);
    const original = macro && (macro.children || []).find(d => d.name === name);
    const idx = (inst.children || []).findIndex(w => w._origin === name);
    if (!original || idx < 0) return false;
    const fresh = structuredClone(original);
    fresh._origin = name;
    fresh.id = inst.children[idx].id;
    giveIds([fresh]);
    inst.children[idx] = fresh;
    return true;
}

/** Ends a session: final sync, then drop the working copy. */
export function closeSession(inst) {
    syncSession(inst);
    delete inst.children;
    delete inst.frameWidth;
    delete inst.frameHeight;
    delete inst._session;
}

/** Instances with an open session on the current slide. */
function openSessions() {
    const found = [];
    const visit = (elements) => (elements || []).forEach(el => {
        if (el.type === 'macro' && el._session) found.push(el);
        if (Array.isArray(el.children)) visit(el.children);
    });
    const slide = currentSlide();
    visit(slide ? slide.elements : []);
    return found;
}

/** Syncs every open session, innermost first (called on each change). */
export function syncOpenSessions() {
    openSessions().reverse().forEach(syncSession);
}

/** Closes open sessions except those whose ids are in `keepIds`. */
export function closeSessionsExcept(keepIds) {
    openSessions().reverse().forEach(inst => {
        if (!keepIds.has(inst.id)) closeSession(inst);
    });
}

/** Drops a session's bookkeeping from an element copy (e.g. on detach). */
export function stripSessionKeys(elements) {
    walk(elements, e => { delete e._origin; });
}

// ---------- Library files ----------

/** Text of a library file from the macros whose source is `file`. */
export function libraryText(file) {
    const macros = Object.values(state.macros || {})
        .filter(m => m.source === file)
        .sort((a, b) => a.name.localeCompare(b.name));
    const imports = (state._libraryImports || {})[file] || [];
    return serializeGlLibrary({ imports, macros });
}

/** Library files in use: the project's imports plus any file holding macros. */
export function libraryFiles() {
    const files = new Set(state.imports || []);
    Object.values(state.macros || {}).forEach(m => { if (m.source && m.source !== 'project') files.add(m.source); });
    return [...files];
}

/**
 * Replaces the macros of library `file` with those defined in `text`
 * (e.g. edited in the .gl inspector). Throws on a parse error.
 */
export function applyLibraryText(file, text) {
    const lib = parseGlLibrary(text);
    const next = Object.fromEntries(Object.entries(state.macros || {}).filter(([, m]) => m.source !== file));
    for (const m of lib.macros) {
        if (next[m.name] && next[m.name].source === 'project') continue; // project definitions win
        next[m.name] = { ...m, source: file };
    }
    state.macros = next;
    (state._libraryImports || (state._libraryImports = {}))[file] = lib.imports;
    return lib;
}

/**
 * Loads every file the project imports (and what those import), adding
 * their macros to state.macros. Missing files are skipped with a
 * warning; macros already defined in the project file take precedence.
 */
export async function loadImportedLibraries() {
    const api = pyApi();
    const loaded = state._loadedLibraries || (state._loadedLibraries = {});
    const queue = [...(state.imports || [])];
    const seen = new Set();
    while (queue.length) {
        const file = queue.shift();
        if (seen.has(file)) continue;
        seen.add(file);
        if (!api || !state.projectFolder) continue;
        let res;
        try {
            res = await api.load_text_file(state.projectFolder, file);
        } catch (e) {
            res = null;
        }
        if (!res || !res.success) {
            console.warn(`Macro library not found: ${file}`);
            loaded[file] = null;
            continue;
        }
        try {
            const lib = parseGlLibrary(res.content);
            (state._libraryImports || (state._libraryImports = {}))[file] = lib.imports;
            lib.macros.forEach(m => {
                const existing = state.macros[m.name];
                if (!existing || existing.source !== 'project') state.macros[m.name] = { ...m, source: file };
            });
            queue.push(...lib.imports);
            loaded[file] = libraryText(file);
        } catch (e) {
            console.error(`Could not read ${file}: ${e.message}`);
        }
    }
}

/** Writes library files whose macros changed since the last load/save. */
export async function saveChangedLibraries() {
    const api = pyApi();
    if (!api || !state.projectFolder) return;
    const loaded = state._loadedLibraries || (state._loadedLibraries = {});
    // Files that still hold macros, plus loaded ones that may now be empty.
    const files = new Set([
        ...Object.values(state.macros || {}).map(m => m.source),
        ...Object.keys(loaded).filter(f => loaded[f] !== null),
    ].filter(f => f && f !== 'project'));
    for (const file of files) {
        const text = libraryText(file);
        if (loaded[file] === text) continue;
        const res = await api.save_text_file(state.projectFolder, file, text);
        if (res && res.success) loaded[file] = text;
        else console.error(`Could not save ${file}:`, res && res.error);
    }
}
