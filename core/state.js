// ============================================================
// core/state.js — Application state + persistence (.gl format
// with legacy-JSON fallback) + macros + undo/redo history.
// No DOM manipulation here except the save indicator.
// ============================================================

import {serializeGl, parseGl, looksLikeGl, GL_FORMAT_VERSION} from './gl/glformat.js';
import {saveChangedLibraries, syncOpenSessions, closeSessionsExcept} from './macros.js';

export const AUTOSAVE_INTERVAL_MS = 5000;   // safety-net interval
export const AUTOSAVE_DEBOUNCE_MS = 800;    // save this long after the last change
export const PROJECT_SCHEMA_VERSION = GL_FORMAT_VERSION;
export const MAX_HISTORY_ENTRIES = 100;

export const DEFAULT_TEX_MACROS = `\\usepackage{amssymb}
\\usepackage{amsfonts}
\\newcommand{\\R}{\\mathbb{R}}
\\newcommand{\\N}{\\mathbb{N}}
\\newcommand{\\eps}{\\varepsilon}
\\newcommand{\\vec}[1]{\\mathbf{#1}}`;

export const state = {
    slides: [],
    currentSlideIndex: 0,
    selectedSlideIndices: [0],
    selectedElementIndex: null,
    selectedElementIndices: [],
    editingGroupId: null,   // group entered by double-click (UI only)
    slideWidth: 1920,
    slideHeight: 1080,
    gridSize: 20,
    isDarkMode: false,

    // Monotonic element-ID counter. IDs are never reused; the
    // counter travels with the project (.gl header param `nextid`).
    nextId: 1,

    elementClipboard: null, // Array of cloned element objects
    slideClipboard: null,   // Array of cloned slide objects

    undoStack: [],
    redoStack: [],
    _isApplyingHistory: false,
    _historyAnchorSnapshot: '',

    // Element macros (core/macros.js): name -> { name, width, height,
    // children, source } and the library files the project imports.
    macros: {},
    imports: [],
    // Project-wide style defaults per element type (core/defaults.js),
    // named styles per type, and the theme colors (core/colors.js;
    // null = the starter palette).
    defaults: {},
    styles: {},
    palette: null,
    _loadedLibraries: {},   // file -> text as last loaded/saved

    rawTexMacros: DEFAULT_TEX_MACROS,
    projectMacros: {},

    // Citations
    rawBib: '',
    bibEntries: {},
    citestyle: 'numeric',
    _citationOrder: [],

    projectPath: null,
    projectFolder: null,
    projectName: '',

    // Master slides (core/masters.js); the one being edited (UI only).
    masters: [],
    editingMasterIndex: null,

    isDirty: false,
    lastSnapshot: '',
    recents: [],
};

/** Returns the pywebview API object or null in browser preview. */
export function pyApi() {
    const api = window.pywebview && window.pywebview.api;
    // pywebview first creates `window.pywebview` with an EMPTY `api`
    // object and only later adds the functions (then fires
    // `pywebviewready`): an api without functions is not ready yet.
    return api && Object.values(api).some(v => typeof v === 'function') ? api : null;
}

/**
 * Resolves with the Python API once it is ready, or with null after
 * `timeoutMs` (e.g. in a plain browser, where there is no bridge).
 * Listens for `pywebviewready` and also checks regularly, so a ready
 * event fired before anyone listened is not missed.
 */
export function whenApiReady(timeoutMs = 10000) {
    const ready = pyApi();
    if (ready) return Promise.resolve(ready);
    return new Promise((resolve) => {
        let finished = false;
        const finish = (api) => {
            if (finished) return;
            finished = true;
            clearInterval(poll);
            clearTimeout(timer);
            window.removeEventListener('pywebviewready', onEvent);
            resolve(api);
        };
        const check = () => { const api = pyApi(); if (api) finish(api); };
        const onEvent = () => check();
        window.addEventListener('pywebviewready', onEvent);
        const poll = setInterval(check, 100);
        const timer = setTimeout(() => finish(null), timeoutMs);
    });
}

// ---------- IDs ----------

/**
 * Allocate the next ID (monotonic, never reused). Slides and elements
 * share one counter, so every ID is unique project-wide; the counter
 * travels with the project (.gl header param `nextid`).
 */
export function allocateId() {
    const id = state.nextId;
    state.nextId += 1;
    return id;
}

export const allocateElementId = allocateId;
export const allocateSlideId = allocateId;

/**
 * Assigns IDs to slides/elements that lack one or carry a duplicate
 * (legacy JSON, hand-edited files), and lifts nextId above every ID
 * seen. Safe to call repeatedly.
 */
export function ensureIds() {
    let maxSeen = 0;
    const isId = v => Number.isInteger(v) && v > 0;
    const all = [...(state.masters || []), ...state.slides]; // shared ID space
    all.forEach(s => {
        if (isId(s.id)) maxSeen = Math.max(maxSeen, s.id);
        forEachElementDeep(s.elements || [], el => {
            if (isId(el.id)) maxSeen = Math.max(maxSeen, el.id);
        });
    });
    if (state.nextId <= maxSeen) state.nextId = maxSeen + 1;

    const seenSlides = new Set();
    const seenElements = new Set();
    all.forEach(s => {
        if (!isId(s.id) || seenSlides.has(s.id)) s.id = allocateId();
        seenSlides.add(s.id);
        s.elements = s.elements || [];
        forEachElementDeep(s.elements, el => {
            if (!isId(el.id) || seenElements.has(el.id)) el.id = allocateId();
            seenElements.add(el.id);
        });
    });
}

/** Gives `el` (and, for groups, every descendant) fresh IDs. */
export function reassignIdsDeep(el) {
    forEachElementDeep([el], e => { e.id = allocateId(); });
    return el;
}

// ---------- Element tree (groups) ----------

/** Calls fn(el, parentGroup) for every element, descending into groups. */
export function forEachElementDeep(elements, fn, parent = null) {
    (elements || []).forEach(el => {
        fn(el, parent);
        if (Array.isArray(el.children)) forEachElementDeep(el.children, fn, el);
    });
}

/**
 * Chain of groups from the slide down to the element with `id`
 * (excluding the element itself), or null if not found.
 * [] means the element is top-level.
 */
export function findElementPath(slide, id) {
    const walk = (elements, path) => {
        for (const el of elements || []) {
            if (el.id === id) return path;
            if (Array.isArray(el.children)) {
                const found = walk(el.children, [...path, el]);
                if (found) return found;
            }
        }
        return null;
    };
    return slide ? walk(slide.elements, []) : null;
}

/** The slide being edited: a slide, or the master slide being edited. */
export function currentSlide() {
    if (state.editingMasterIndex !== null && state.editingMasterIndex !== undefined) {
        const m = (state.masters || [])[state.editingMasterIndex];
        if (m) return m;
        state.editingMasterIndex = null;
    }
    return state.slides[state.currentSlideIndex] || null;
}

/**
 * The group the user has entered (double-clicked into), or null.
 * Transient UI state: never saved, cleared when it no longer exists.
 */
export function activeGroup() {
    if (state.editingGroupId === null) return null;
    const slide = currentSlide();
    let found = null;
    forEachElementDeep(slide ? slide.elements : [], el => {
        // A group, or a macro instance with an open editing session.
        const editable = el.type === 'group' || (el.type === 'macro' && Array.isArray(el.children));
        if (el.id === state.editingGroupId && editable) found = el;
    });
    if (!found) state.editingGroupId = null;
    return found;
}

/** Groups from the slide down to the active group ([] at slide level). */
export function activeGroupPath() {
    const group = activeGroup();
    if (!group) return [];
    return [...findElementPath(currentSlide(), group.id), group];
}

/**
 * The element list that selection, dragging, arrow keys, delete,
 * copy/paste and the properties panel act on: the active group's
 * children, or the current slide's elements.
 */
export function activeElements() {
    const group = activeGroup();
    if (group) return group.children;
    const slide = currentSlide();
    return slide ? slide.elements : [];
}

/** Enters a group (id) or leaves group editing (null). Clears selection. */
export function setEditingGroup(id) {
    // Close macro editing sessions that are not on the way to `id`.
    const keep = new Set();
    if (id !== null) {
        keep.add(id);
        (findElementPath(currentSlide(), id) || []).forEach(g => keep.add(g.id));
    }
    closeSessionsExcept(keep);
    state.editingGroupId = id;
    state.selectedElementIndices = [];
    state.selectedElementIndex = null;
}

export function getSelectedElementIndices() {
    const elements = activeElements();
    const valid = (state.selectedElementIndices || [])
        .filter(idx => Number.isInteger(idx) && idx >= 0 && idx < elements.length);
    if (valid.length > 0) return [...new Set(valid)].sort((a, b) => a - b);
    if (state.selectedElementIndex !== null && elements[state.selectedElementIndex]) {
        return [state.selectedElementIndex];
    }
    return [];
}

export function setSelectedElementIndices(indices, primaryIndex = null) {
    const maxLen = activeElements().length;
    const cleaned = [...new Set(
        (indices || []).filter(idx => Number.isInteger(idx) && idx >= 0 && idx < maxLen)
    )].sort((a, b) => a - b);

    state.selectedElementIndices = cleaned;
    if (cleaned.length === 0) {
        state.selectedElementIndex = null;
    } else if (primaryIndex !== null && cleaned.includes(primaryIndex)) {
        state.selectedElementIndex = primaryIndex;
    } else {
        state.selectedElementIndex = cleaned[cleaned.length - 1];
    }
}

export function getSelectedSlideIndices() {
    const valid = (state.selectedSlideIndices || [])
        .filter(idx => Number.isInteger(idx) && idx >= 0 && idx < state.slides.length);
    if (valid.length > 0) return [...new Set(valid)].sort((a, b) => a - b);
    if (state.slides[state.currentSlideIndex]) return [state.currentSlideIndex];
    return [];
}

export function setSelectedSlideIndices(indices) {
    const cleaned = [...new Set(
        (indices || []).filter(idx => Number.isInteger(idx) && idx >= 0 && idx < state.slides.length)
    )].sort((a, b) => a - b);
    state.selectedSlideIndices = cleaned.length > 0
        ? cleaned
        : (state.slides.length > 0 ? [Math.max(0, Math.min(state.currentSlideIndex, state.slides.length - 1))] : []);
}

export function selectedElement() {
    const indices = getSelectedElementIndices();
    if (indices.length === 0) return null;
    const idx = (state.selectedElementIndex !== null && indices.includes(state.selectedElementIndex))
        ? state.selectedElementIndex
        : indices[indices.length - 1];
    return activeElements()[idx] || null;
}

// ---------- Undo / Redo history ----------

function buildHistoryEntry() {
    return {
        snapshot: currentSnapshot(),
        currentSlideIndex: state.currentSlideIndex,
        selectedSlideIndices: [...getSelectedSlideIndices()],
        selectedElementIndex: state.selectedElementIndex,
        selectedElementIndices: [...getSelectedElementIndices()],
    };
}

export function resetHistory() {
    state.undoStack = [];
    state.redoStack = [];
    state._isApplyingHistory = false;
    state._historyAnchorSnapshot = currentSnapshot();
}

export function recordUndoCheckpoint() {
    if (state._isApplyingHistory) return;
    const currentSnap = currentSnapshot();
    if (!state._historyAnchorSnapshot) {
        state._historyAnchorSnapshot = currentSnap;
    }
    if (currentSnap === state._historyAnchorSnapshot) return;

    const prevEntry = {
        snapshot: state._historyAnchorSnapshot,
        currentSlideIndex: state.currentSlideIndex,
        selectedSlideIndices: [...getSelectedSlideIndices()],
        selectedElementIndex: state.selectedElementIndex,
        selectedElementIndices: [...getSelectedElementIndices()],
    };

    state.undoStack.push(prevEntry);
    if (state.undoStack.length > MAX_HISTORY_ENTRIES) {
        state.undoStack.shift();
    }
    state.redoStack = [];
    state._historyAnchorSnapshot = currentSnap;
}

function applyHistoryEntry(entry) {
    if (!entry) return false;
    state._isApplyingHistory = true;
    try {
        const parsed = JSON.parse(entry.snapshot);
        applyProjectData(parsed, { resetSelection: false });
        if (typeof parsed.rawTexMacros === 'string') {
            state.rawTexMacros = parsed.rawTexMacros;
            state.projectMacros = parseTexMacros(state.rawTexMacros);
        }

        if (state.slides.length === 0) {
            state.currentSlideIndex = 0;
            state.selectedSlideIndices = [];
            state.selectedElementIndex = null;
            state.selectedElementIndices = [];
        } else {
            const clampedSlideIdx = Math.max(0, Math.min(entry.currentSlideIndex ?? 0, state.slides.length - 1));
            state.currentSlideIndex = clampedSlideIdx;

            const validSlides = (entry.selectedSlideIndices || [])
                .filter(i => Number.isInteger(i) && i >= 0 && i < state.slides.length);
            state.selectedSlideIndices = validSlides.length > 0 ? [...new Set(validSlides)].sort((a, b) => a - b) : [clampedSlideIdx];

            activeGroup(); // drops editingGroupId if the group no longer exists
            const elCount = activeElements().length;
            const validEls = (entry.selectedElementIndices || [])
                .filter(i => Number.isInteger(i) && i >= 0 && i < elCount);
            state.selectedElementIndices = [...new Set(validEls)].sort((a, b) => a - b);

            if (Number.isInteger(entry.selectedElementIndex) && state.selectedElementIndices.includes(entry.selectedElementIndex)) {
                state.selectedElementIndex = entry.selectedElementIndex;
            } else {
                state.selectedElementIndex = state.selectedElementIndices.length > 0
                    ? state.selectedElementIndices[state.selectedElementIndices.length - 1]
                    : null;
            }
        }

        state._historyAnchorSnapshot = entry.snapshot;
        state.isDirty = currentSnapshot() !== state.lastSnapshot;
        return true;
    } finally {
        state._isApplyingHistory = false;
    }
}

export function canUndo() {
    return state.undoStack.length > 0;
}

export function canRedo() {
    return state.redoStack.length > 0;
}

export function undo() {
    if (!canUndo()) return false;
    const currentEntry = buildHistoryEntry();
    const targetEntry = state.undoStack.pop();
    state.redoStack.push(currentEntry);
    const applied = applyHistoryEntry(targetEntry);
    if (applied) {
        flashSaveIndicator('Undo ✓');
    }
    return applied;
}

export function redo() {
    if (!canRedo()) return false;
    const currentEntry = buildHistoryEntry();
    const targetEntry = state.redoStack.pop();
    state.undoStack.push(currentEntry);
    const applied = applyHistoryEntry(targetEntry);
    if (applied) {
        flashSaveIndicator('Redo ✓');
    }
    return applied;
}

// ---------- LaTeX macros ----------

export function parseTexMacros(texText) {
    const macros = {};
    const lines = (texText || '').split('\n');
    for (let line of lines) {
        line = line.trim();
        if (!line || line.startsWith('%') || line.startsWith('\\usepackage')) continue;

        const ncMatch = line.match(/\\newcommand\{\s*(\\[a-zA-Z]+)\s*\}(?:\[(\d+)\])?\s*\{([\s\S]*)\}/);
        if (ncMatch) {
            macros[ncMatch[1]] = ncMatch[3].trim();
            continue;
        }
        const defMatch = line.match(/\\def\s*(\\[a-zA-Z]+)\s*\{([\s\S]*)\}/);
        if (defMatch) {
            macros[defMatch[1]] = defMatch[2].trim();
        }
    }
    return macros;
}

export function resetMacros() {
    state.rawTexMacros = DEFAULT_TEX_MACROS;
    state.projectMacros = parseTexMacros(state.rawTexMacros);
}

// ---------- Dirty tracking / autosave ----------

export function markDirty() {
    state.isDirty = true;
    syncOpenSessions(); // canvas edits inside a macro -> overrides / definition
    recordUndoCheckpoint();
    scheduleAutosave();
}

let autosaveTimer = null;
function scheduleAutosave() {
    clearTimeout(autosaveTimer);
    autosaveTimer = setTimeout(autoSaveTick, AUTOSAVE_DEBOUNCE_MS);
}

export function currentSnapshot() {
    // Internal-only representation (never user-facing): stays JSON.
    return JSON.stringify({
        slideWidth: state.slideWidth,
        slideHeight: state.slideHeight,
        gridSize: state.gridSize,
        isDarkMode: state.isDarkMode,
        nextId: state.nextId,
        citestyle: state.citestyle,
        rawTexMacros: state.rawTexMacros,
        imports: state.imports,
        macros: state.macros,
        macrosComplete: true,
        defaults: state.defaults,
        styles: state.styles,
        palette: state.palette,
        author: state.author,
        date: state.date,
        equations: state.equations,
        masters: state.masters,
        slides: state.slides,
    });
}

/** User-facing serialization: the Gluon (.gl) text format. */
export function serializeProject() {
    return serializeGl({
        projectName: state.projectName,
        citestyle: state.citestyle,
        imports: state.imports,
        macros: Object.values(state.macros).filter(m => m.source === 'project'),
        defaults: state.defaults,
        styles: state.styles,
        palette: state.palette,
        slideWidth: state.slideWidth,
        slideHeight: state.slideHeight,
        gridSize: state.gridSize,
        isDarkMode: state.isDarkMode,
        nextId: state.nextId,
        citestyle: state.citestyle,
        author: state.author,
        date: state.date,
        equations: state.equations,
        masters: state.masters,
        slides: state.slides,
    });
}

/** Legacy JSON serialization, kept for explicit JSON export if needed. */
export function serializeProjectJson() {
    return JSON.stringify({
        version: 1,
        name: state.projectName,
        slideWidth: state.slideWidth,
        slideHeight: state.slideHeight,
        gridSize: state.gridSize,
        isDarkMode: state.isDarkMode,
        slides: state.slides,
    });
}

// ---------- Loading project data into state ----------

const DEFAULT_SLIDE_WIDTH = 1920;
const DEFAULT_SLIDE_HEIGHT = 1080;
const DEFAULT_GRID_SIZE = 20;

/**
 * Resets every project-scoped field to a fresh, empty project.
 * Use before starting a new project (or the sample) so nothing leaks
 * over from a previously opened one.
 */
export function resetProjectState({ name = 'Untitled Project', path = null, folder = null } = {}) {
    state.projectName = name;
    state.projectPath = path;
    state.projectFolder = folder;
    state.nextId = 1;
    state.macros = {};
    state.imports = [];
    state.defaults = {};
    state.styles = {};
    state.palette = null;
    state._loadedLibraries = {};
    state._libraryImports = {};
    applyProjectData({
        slides: [{ title: 'Title Slide', elements: [] }],
        slideWidth: DEFAULT_SLIDE_WIDTH,
        slideHeight: DEFAULT_SLIDE_HEIGHT,
        gridSize: DEFAULT_GRID_SIZE,
        isDarkMode: false,
        citestyle: 'numeric',
        nextId: 1,
    });
    resetMacros();
    state.rawBib = '';
    state.bibEntries = {};
    state._citationOrder = [];
    state.elementClipboard = null;
    state.slideClipboard = null;
}

/**
 * The single place that copies parsed project data (from .gl, legacy
 * JSON, an undo snapshot or the inspector) into `state`.
 * With resetSelection=false the current slide index is clamped instead
 * of reset (the caller restores selection itself).
 */
export function applyProjectData(data, { resetSelection = true } = {}) {
    const num = (v, fallback) => (Number.isFinite(Number(v)) && v !== null && v !== '' ? Number(v) : fallback);

    state.slides = Array.isArray(data.slides) ? data.slides : [];
    state.masters = Array.isArray(data.masters) ? data.masters : [];
    state.slideWidth = num(data.slideWidth, DEFAULT_SLIDE_WIDTH);
    state.slideHeight = num(data.slideHeight, DEFAULT_SLIDE_HEIGHT);
    state.gridSize = num(data.gridSize, DEFAULT_GRID_SIZE);
    state.isDarkMode = !!data.isDarkMode;
    state.citestyle = data.citestyle === 'authoryear' ? 'authoryear' : 'numeric';
    state.nextId = Math.max(1, num(data.nextId, 1));
    state.author = data.author || '';
    state.date = data.date || '';
    // Display equations: 'center' (as in LaTeX) or 'text' (follow the text's alignment).
    state.equations = data.equations === 'text' ? 'text' : 'center';
    document.documentElement.dataset.equations = state.equations;
    const name = data.name || data.projectName;
    if (name) state.projectName = name;
    applyMacroData(data);
    if (data.defaults !== undefined) state.defaults = structuredClone(data.defaults || {});
    if (data.styles !== undefined) state.styles = structuredClone(data.styles || {});
    if (data.palette !== undefined) state.palette = data.palette ? structuredClone(data.palette) : null;
    ensureIds();

    const lastIdx = Math.max(0, state.slides.length - 1);
    state.currentSlideIndex = resetSelection ? 0 : Math.max(0, Math.min(state.currentSlideIndex, lastIdx));
    state.selectedSlideIndices = state.slides.length > 0 ? [state.currentSlideIndex] : [];
    state.selectedElementIndex = null;
    state.selectedElementIndices = [];
    if (resetSelection) state.editingGroupId = null;
    if (resetSelection || !state.masters[state.editingMasterIndex]) state.editingMasterIndex = null;
}

/**
 * Macros/imports from parsed data. An undo snapshot carries the whole
 * library; a parsed .gl only its own definitions (source 'project'),
 * so macros loaded from imported files are kept.
 */
function applyMacroData(data) {
    if (data.macrosComplete) {
        state.macros = structuredClone(data.macros || {});
        state.imports = [...(data.imports || [])];
        return;
    }
    if (data.macros === undefined && data.imports === undefined) return;
    const kept = Object.fromEntries(Object.entries(state.macros || {}).filter(([, m]) => m.source !== 'project'));
    (data.macros || []).forEach(m => { kept[m.name] = { ...m, source: 'project' }; });
    state.macros = kept;
    state.imports = [...(data.imports || [])];
}

/**
 * Parses project file content (.gl or legacy JSON). Throws on invalid
 * content. Pure: does not touch state.
 */
export function parseProjectContent(content) {
    if (looksLikeGl(content)) return parseGl(content);
    const data = JSON.parse(content); // legacy .ssproj JSON
    if (!Array.isArray(data.slides)) throw new Error("Missing 'slides' array");
    return data;
}

/** Loads project file content into state. Throws on invalid content. */
export function deserializeProject(content) {
    const data = parseProjectContent(content);
    if (!data.name && !data.projectName) data.name = 'Untitled Project';
    applyProjectData(data);
}

export function flashSaveIndicator(text) {
    const el = document.getElementById('save-indicator');
    if (!el) return;
    el.textContent = text;
    el.classList.add('visible');
    clearTimeout(flashSaveIndicator._t);
    flashSaveIndicator._t = setTimeout(() => el.classList.remove('visible'), 1600);
}

/**
 * Writes the project if it changed since the last save. The snapshot
 * and text are captured *before* awaiting, so edits made while the
 * write is in flight stay marked dirty and are saved next time.
 */
async function saveIfChanged({ flash = null, force = false } = {}) {
    const api = pyApi();
    if (!state.projectPath || !api) return false;
    const snap = currentSnapshot();
    if (!force && snap === state.lastSnapshot) {
        state.isDirty = false;
        return false;
    }
    const res = await api.save_project_data(state.projectPath, serializeProject());
    if (!res || !res.success) {
        console.error('Save failed:', res && res.error);
        return false;
    }
    state.lastSnapshot = snap;
    state.isDirty = currentSnapshot() !== snap;
    await saveChangedLibraries(); // e.g. macros.gl, when a definition changed
    if (flash) flashSaveIndicator(flash);
    return true;
}

async function autoSaveTick() {
    if (!state.isDirty) return;
    await saveIfChanged({ flash: 'Autosaved ✓' });
}

export function startAutosave() {
    setInterval(autoSaveTick, AUTOSAVE_INTERVAL_MS);
}

export async function flushPendingSave() {
    if (!state.isDirty) return;
    await saveIfChanged();
}

export async function renameProject(value) {
    state.projectName = (value || '').trim() || 'Untitled Project';
    markDirty();
    // The name is not part of the snapshot, so force the write.
    await saveIfChanged({ flash: 'Saved ✓', force: true });
}
