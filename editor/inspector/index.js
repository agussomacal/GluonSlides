// ============================================================
// editor/inspector/index.js — The .gl inspector drawer: an editable,
// bidirectionally synced view of the project's Gluon source.
//
//   codeEditor.js   CodeMirror wrapper + .gl syntax mode
//   tokenizer.js    pure .gl tokenizer (used by the mode)
//   glNavigation.js line <-> {slideId, elementId} mapping
//   settings.js     settings persistence + popover
//   contextMenu.js  right-click "Go to Gluon file"
//
// Sync model: while the user has no unapplied draft and the editor is
// not focused, the text follows the canvas (on every `editor-rendered`
// event). Edits are applied back to state with Apply / Ctrl+Enter, or
// automatically (debounced) when auto-apply is on.
// ============================================================

import {
    state,
    serializeProject,
    markDirty,
    parseProjectContent,
    applyProjectData,
    setSelectedElementIndices,
    setSelectedSlideIndices,
} from '../../core/state.js';
import { looksLikeGl } from '../../core/gl/glformat.js';
import { syncProjectChrome } from '../../core/render.js';
import { hydrateFigures } from '../../elements/figure/figure.js';
import { renderEditor } from '../editor.js';
import { createGlCodeEditor } from './codeEditor.js';
import { findGlTargetLine, findTargetAtLine, formatTargetLabel, parseIdValue } from './glNavigation.js';
import {
    getSettings,
    loadSettings,
    saveSettings,
    updateSettings,
    applySettingsToDrawer,
    createSettingsPopover,
    maxDrawerHeight,
    MIN_DRAWER_HEIGHT,
} from './settings.js';
import { initContextMenu } from './contextMenu.js';

const DRAWER_ID = 'gl-inspector-drawer';
const SETTINGS_ID = 'gl-inspector-settings-popover';
const STYLESHEETS = ['libs/codemirror/codemirror.min.css', 'editor/inspector/inspector.css'];
const APPLY_DEBOUNCE_MS = 350;

let drawer = null;
let editor = null;
let settingsPopover = null;
let initialized = false;

let currentTarget = {};      // { slideId, elementId } the view is centred on
let isOpen = false;
let isFocused = false;
let hasUnappliedDraft = false;
let syncedText = '';         // text as last loaded from / applied to state
let isApplying = false;      // inspector -> state in progress
let isNavigating = false;    // caret -> canvas selection in progress
let debounceTimer = null;

// ---------- Small DOM helpers ----------

function ensureStylesheets() {
    for (const href of STYLESHEETS) {
        if (document.querySelector(`link[rel="stylesheet"][href="${href}"]`)) continue;
        const link = document.createElement('link');
        link.rel = 'stylesheet';
        link.href = href;
        document.head.appendChild(link);
    }
}

function setBadge(mode, text) {
    const badge = drawer.querySelector('.gl-inspector-badge');
    badge.classList.toggle('listening', mode === 'listening');
    badge.classList.toggle('error', mode === 'error');
    badge.textContent = text;
}

function setStatus(text) {
    drawer.querySelector('.gl-inspector-status').textContent = text;
}

function applySettings() {
    applySettingsToDrawer(drawer);
    editor.setTabSize(getSettings().tabSize);
    editor.refresh();
}

// ---------- Drawer construction ----------

function attachResizeHandle() {
    const handle = document.createElement('div');
    handle.className = 'gl-inspector-resize-handle';
    handle.title = 'Drag up or down to resize inspector';
    drawer.prepend(handle);

    let startY = 0;
    let startHeight = 0;

    const onMove = (e) => {
        const next = Math.max(MIN_DRAWER_HEIGHT, Math.min(maxDrawerHeight(), startHeight + (startY - e.clientY)));
        drawer.style.height = `${next}px`;
        editor.refresh();
    };
    const onUp = () => {
        drawer.classList.remove('resizing');
        window.removeEventListener('mousemove', onMove);
        window.removeEventListener('mouseup', onUp);
        updateSettings({ drawerHeight: drawer.getBoundingClientRect().height });
    };

    handle.addEventListener('mousedown', (e) => {
        if (e.button !== 0) return;
        e.preventDefault();
        startY = e.clientY;
        startHeight = drawer.getBoundingClientRect().height;
        drawer.classList.add('resizing');
        window.addEventListener('mousemove', onMove);
        window.addEventListener('mouseup', onUp);
    });
}

function buildDrawer() {
    ensureStylesheets();

    drawer = document.createElement('section');
    drawer.id = DRAWER_ID;
    drawer.setAttribute('aria-label', 'Gluon File Inspector');
    drawer.innerHTML = `
        <div class="gl-inspector-header">
            <div class="gl-inspector-meta">
                <strong>.gl Inspector</strong>
                <span class="gl-inspector-badge">Editor Sync</span>
                <span class="gl-inspector-status" id="gl-inspector-status">Ready</span>
            </div>
            <div class="gl-inspector-actions">
                <button type="button" data-action="apply" class="primary" title="Apply .gl changes to editor (Ctrl/Cmd+Enter)">Apply</button>
                <button type="button" data-action="reset" title="Discard draft & reload from editor state">Reset from State</button>
                <button type="button" data-action="settings" title="Editor & syntax highlight settings">⚙ Settings</button>
                <button type="button" data-action="close" title="Close inspector">✕</button>
            </div>
        </div>
        <div class="gl-inspector-body">
            <div class="gl-code-editor"></div>
        </div>`;
    document.body.appendChild(drawer);

    editor = createGlCodeEditor(drawer.querySelector('.gl-code-editor'), {
        tabSize: getSettings().tabSize,
        onApplyShortcut: () => applyNow({ silentOnError: false }),
    });
    attachResizeHandle();

    settingsPopover = createSettingsPopover(SETTINGS_ID, { onChange: applySettings });

    editor.onCursorLineChange((lineIdx) => {
        const target = findTargetAtLine(editor.getValue(), lineIdx);
        if (!target) return;
        setStatus(formatTargetLabel(target, lineIdx));
        if (!hasUnappliedDraft) selectOnCanvas(target);
    });

    editor.onFocusChange((focused) => {
        isFocused = focused;
        if (focused) {
            setBadge('listening', 'Editor Listening');
        } else if (!hasUnappliedDraft) {
            setBadge('synced', 'Editor Sync');
            refreshFromState({ force: true });
        }
    });

    editor.onInput((text) => {
        clearTimeout(debounceTimer);
        // Undoing back to the synced text is not a draft.
        hasUnappliedDraft = text !== syncedText;
        if (!hasUnappliedDraft) return;
        setBadge('listening', 'Editor Listening');
        if (getSettings().autoApply) {
            debounceTimer = setTimeout(() => applyInspectorText(text, { silentOnError: true }), APPLY_DEBOUNCE_MS);
        }
    });

    const actions = {
        apply: () => applyNow({ silentOnError: false }),
        reset: () => {
            clearTimeout(debounceTimer);
            hasUnappliedDraft = false;
            refreshFromState({ force: true });
        },
        settings: () => settingsPopover.setOpen(!settingsPopover.isOpen(), {
            anchorBottom: drawer.getBoundingClientRect().height,
        }),
        close: () => closeGlInspector(),
    };
    drawer.querySelector('.gl-inspector-actions').addEventListener('click', (e) => {
        const btn = e.target.closest('button[data-action]');
        if (!btn) return;
        e.stopPropagation();
        actions[btn.dataset.action]();
    });

    applySettings();
}

// ---------- Inspector -> canvas ----------

/** Selects the slide/element the caret is on, without touching the text. */
function selectOnCanvas(target) {
    if (!state.slides.length) return;

    let slideIdx = state.slides.findIndex(s => parseIdValue(s.id) === parseIdValue(target.slideId));
    if (slideIdx === -1) slideIdx = Math.max(0, Math.min(state.currentSlideIndex, state.slides.length - 1));
    const slide = state.slides[slideIdx];

    const elIdx = target.elementId === null || target.elementId === undefined
        ? -1
        : slide.elements.findIndex(el => parseIdValue(el.id) === parseIdValue(target.elementId));

    const wanted = elIdx >= 0 ? [elIdx] : [];
    const current = state.selectedElementIndices || [];
    const unchanged = state.currentSlideIndex === slideIdx
        && current.length === wanted.length && current.every((v, i) => v === wanted[i]);
    if (unchanged) return;

    currentTarget = { slideId: slide.id, elementId: elIdx >= 0 ? slide.elements[elIdx].id : null };
    state.currentSlideIndex = slideIdx;
    setSelectedSlideIndices([slideIdx]);
    setSelectedElementIndices(wanted, elIdx >= 0 ? elIdx : null);

    isNavigating = true;
    try {
        renderEditor();
    } finally {
        isNavigating = false;
    }
}

function applyNow({ silentOnError }) {
    clearTimeout(debounceTimer);
    return applyInspectorText(editor.getValue(), { silentOnError });
}

function reportError(badge, message, silentOnError) {
    setBadge('error', badge);
    setStatus(message);
    if (!silentOnError) alert(`Could not apply .gl: ${message}`);
    return false;
}

/** Parses `glText` and, if valid, replaces the project in state with it. */
export async function applyInspectorText(glText, { silentOnError = true } = {}) {
    const raw = String(glText ?? '');
    if (!raw.trim() || !looksLikeGl(raw)) {
        return reportError('Invalid .gl', 'Expected .project / .slide directives', silentOnError);
    }

    let parsed;
    try {
        parsed = parseProjectContent(raw);
    } catch (err) {
        return reportError('Parse Error', err.message, silentOnError);
    }

    isApplying = true;
    try {
        await hydrateFigures(parsed.slides, state.projectFolder);
        applyProjectData(parsed, { resetSelection: false });
        hasUnappliedDraft = false;
        syncedText = raw;
        markDirty(); // also records an undo checkpoint
        syncProjectChrome();
        renderEditor();
        setBadge(isFocused ? 'listening' : 'synced', isFocused ? 'Editor Listening' : 'Synced');
        setStatus('Applied to editor');
        return true;
    } finally {
        isApplying = false;
    }
}

// ---------- Canvas -> inspector ----------

/**
 * Re-serializes the project into the editor. Skipped while the user is
 * typing or has a draft, unless `force` is set.
 */
function refreshFromState({ force = false, jump = false } = {}) {
    if (!isOpen || isApplying || isNavigating) return;
    if (!force && (isFocused || hasUnappliedDraft)) return;

    const glText = serializeProject();
    editor.setValue(glText);
    syncedText = glText;
    hasUnappliedDraft = false;
    const lineIdx = findGlTargetLine(glText, currentTarget);
    setBadge('synced', 'Editor Sync');
    setStatus(formatTargetLabel(currentTarget, lineIdx));
    if (jump) editor.jumpToLine(lineIdx);
    else editor.setHighlightLine(lineIdx);
}

function followSelection() {
    const slide = state.slides[state.currentSlideIndex];
    if (!slide) return;
    const el = state.selectedElementIndex !== null ? slide.elements[state.selectedElementIndex] : null;
    currentTarget = { slideId: slide.id, elementId: el ? el.id : null };
}

// ---------- Public API ----------

export function openGlInspector(target = {}) {
    currentTarget = target || {};
    isOpen = true;
    hasUnappliedDraft = false;
    drawer.classList.add('open');
    applySettings();
    refreshFromState({ force: true, jump: true });
}

export function closeGlInspector() {
    clearTimeout(debounceTimer);
    settingsPopover.setOpen(false);
    isOpen = false;
    isFocused = false;
    hasUnappliedDraft = false;
    drawer.classList.remove('open');
}

export function initGlInspector() {
    if (initialized) return;
    initialized = true;

    buildDrawer();
    initContextMenu({ onGoTo: openGlInspector });
    loadSettings().then(applySettings);

    document.addEventListener('click', (e) => {
        const popover = settingsPopover.element;
        const settingsBtn = drawer.querySelector('[data-action="settings"]');
        if (settingsPopover.isOpen() && !popover.contains(e.target) && !settingsBtn.contains(e.target)) {
            settingsPopover.setOpen(false);
        }
    });

    document.addEventListener('keydown', (e) => {
        if (e.key !== 'Escape') return;
        if (settingsPopover.isOpen()) {
            settingsPopover.setOpen(false);
        } else if (isOpen && !isFocused) {
            closeGlInspector();
        }
    });

    window.addEventListener('beforeunload', saveSettings);

    // Follow the canvas: every full render, plus element-level edits.
    const onCanvasChanged = () => {
        if (!isOpen || isApplying || isNavigating) return;
        followSelection();
        refreshFromState();
    };
    document.addEventListener('editor-rendered', onCanvasChanged);
    document.addEventListener('slide-content-changed', onCanvasChanged);
    document.addEventListener('slide-thumbnail-changed', onCanvasChanged);
}
