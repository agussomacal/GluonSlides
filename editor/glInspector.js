// ============================================================
// editor/glInspector.js — Editable, bidirectionally synced .gl
// source inspector with slide/element context menu ("Go to Gluon
// file") and jump-to-line.
//
// Sync model:
// - When the inspector is focused or has an unapplied draft, the
//   editor listens for .gl edits (debounced + Ctrl/Cmd+Enter /
//   Apply button) and does not overwrite the user's text/caret.
// - When the editor is active (inspector not focused), state
//   changes refresh the inspector and jump to the target line.
// ============================================================

import { state, serializeProject, markDirty, ensureElementIds } from '../core/state.js';
import { parseGl, looksLikeGl } from '../core/gl/glformat.js';
import { hydrateFigureElements } from '../elements/figure/figure.js';
import {
    bindMarkDirtyAndRender,
    syncSlideSizeSelect,
    syncGridSizeSelect,
    updateDimensionsCSS,
} from '../core/render.js';

const INSPECTOR_ID = 'gl-inspector-drawer';
const MENU_ID = 'gl-context-menu';
const STYLESHEET_HREF = 'editor/glInspector.css';
const APPLY_DEBOUNCE_MS = 350;

const SLIDE_NODE_SELECTOR = '[data-slide-id], [data-slide-index], .slide-thumb, .thumbnail, .slide-item, .slide-card';
const ELEMENT_NODE_SELECTOR = '[data-element-id], [data-el-id], [data-el-index], .element, .element-wrapper, .canvas-element';

let currentTarget = null; // { slideId, elementId }
let isOpen = false;
let initialized = false;
let isInspectorFocused = false;
let hasUnappliedDraft = false;
let isApplyingFromInspector = false;
let debounceTimer = null;
let renderEditorRef = null;

// ---------- Pluggable Editor Adapter (swap for CodeMirror/syntax view later) ----------

function createTextareaAdapter(textarea) {
    return {
        getValue() {
            return textarea.value;
        },
        setValue(text) {
            if (textarea.value !== text) {
                textarea.value = text;
            }
        },
        focus() {
            textarea.focus({ preventScroll: true });
        },
        isFocused() {
            return document.activeElement === textarea;
        },
        jumpToLine(lineIndex, statusText) {
            const text = textarea.value;
            const lines = text.split('\n');
            const clampedLine = Math.max(0, Math.min(lineIndex, Math.max(0, lines.length - 1)));

            let startOffset = 0;
            for (let i = 0; i < clampedLine; i++) {
                startOffset += lines[i].length + 1;
            }
            const endOffset = Math.min(text.length, startOffset + (lines[clampedLine] || '').length);

            textarea.focus({ preventScroll: false });
            textarea.setSelectionRange(startOffset, endOffset);

            const computed = getComputedStyle(textarea);
            const fontSize = parseFloat(computed.fontSize) || 12.5;
            const lineHeight = parseFloat(computed.lineHeight) || fontSize * 1.5;
            textarea.scrollTop = Math.max(0, clampedLine * lineHeight - textarea.clientHeight * 0.35);

            setStatus(statusText);
        },
        onInput(handler) {
            textarea.addEventListener('input', () => handler(textarea.value));
        },
        onFocusChange(handler) {
            textarea.addEventListener('focus', () => handler(true));
            textarea.addEventListener('blur', () => handler(false));
        },
        onKeyDown(handler) {
            textarea.addEventListener('keydown', handler);
        },
    };
}

let adapter = null;

// ---------- DOM & Styles ----------

function ensureStylesheet() {
    const existing = [...document.querySelectorAll('link[rel="stylesheet"]')];
    if (existing.some(link => (link.getAttribute('href') || '').includes(STYLESHEET_HREF))) {
        return;
    }
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = STYLESHEET_HREF;
    document.head.appendChild(link);
}

function setModeBadge(mode, text) {
    const badge = document.getElementById('gl-inspector-badge');
    if (!badge) return;
    badge.classList.remove('listening', 'error');
    if (mode === 'listening') {
        badge.classList.add('listening');
    } else if (mode === 'error') {
        badge.classList.add('error');
    }
    badge.textContent = text;
}

function setStatus(text) {
    const statusEl = document.getElementById('gl-inspector-status');
    if (statusEl) statusEl.textContent = text;
}

function ensureDom() {
    ensureStylesheet();

    if (!document.getElementById(MENU_ID)) {
        const menu = document.createElement('div');
        menu.id = MENU_ID;
        menu.innerHTML = `
            <button type="button" id="gl-menu-goto-btn">
                <span>📄</span>
                <span>Go to Gluon file</span>
            </button>
        `;
        document.body.appendChild(menu);
    }

    if (!document.getElementById(INSPECTOR_ID)) {
        const drawer = document.createElement('section');
        drawer.id = INSPECTOR_ID;
        drawer.setAttribute('aria-label', 'Gluon File Inspector');
        drawer.innerHTML = `
            <div class="gl-inspector-header">
                <div class="gl-inspector-meta">
                    <strong>.gl Inspector</strong>
                    <span id="gl-inspector-badge" class="gl-inspector-badge">Editor Sync</span>
                    <span id="gl-inspector-status">Ready</span>
                </div>
                <div class="gl-inspector-actions">
                    <button type="button" id="gl-inspector-apply-btn" class="primary" title="Apply .gl changes to editor (Ctrl/Cmd+Enter)">Apply</button>
                    <button type="button" id="gl-inspector-refresh-btn" title="Discard draft & reload from editor state">Reset from State</button>
                    <button type="button" id="gl-inspector-close-btn" title="Close inspector">✕</button>
                </div>
            </div>
            <div class="gl-inspector-body">
                <textarea id="gl-inspector-textarea" class="gl-inspector-textarea" spellcheck="false"></textarea>
            </div>
        `;
        document.body.appendChild(drawer);

        const textarea = document.getElementById('gl-inspector-textarea');
        adapter = createTextareaAdapter(textarea);

        adapter.onFocusChange((focused) => {
            isInspectorFocused = focused;
            if (focused) {
                setModeBadge('listening', 'Editor Listening');
            } else if (!hasUnappliedDraft) {
                setModeBadge('synced', 'Editor Sync');
                refreshGlInspectorText(currentTarget, { force: true });
            }
        });

        adapter.onInput((val) => {
            hasUnappliedDraft = true;
            setModeBadge('listening', 'Editor Listening');
            clearTimeout(debounceTimer);
            debounceTimer = setTimeout(() => {
                applyInspectorTextToEditor(val, { silentOnError: true });
            }, APPLY_DEBOUNCE_MS);
        });

        adapter.onKeyDown((e) => {
            if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
                e.preventDefault();
                clearTimeout(debounceTimer);
                applyInspectorTextToEditor(adapter.getValue(), { silentOnError: false });
            }
        });

        document.getElementById('gl-inspector-apply-btn').onclick = () => {
            clearTimeout(debounceTimer);
            applyInspectorTextToEditor(adapter.getValue(), { silentOnError: false });
        };

        document.getElementById('gl-inspector-refresh-btn').onclick = () => {
            clearTimeout(debounceTimer);
            hasUnappliedDraft = false;
            setModeBadge('synced', 'Editor Sync');
            refreshGlInspectorText(currentTarget, { force: true });
        };

        document.getElementById('gl-inspector-close-btn').onclick = () => {
            closeGlInspector();
        };
    }
}

// ---------- Target Resolution & Line Lookup ----------

function parseIdValue(raw) {
    if (raw === undefined || raw === null || raw === '') return null;
    const num = Number(raw);
    return Number.isFinite(num) ? num : String(raw);
}

function hasIdParam(line, targetId) {
    if (targetId === undefined || targetId === null || targetId === '') return false;
    const escaped = String(targetId).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return new RegExp(`(?:^|\\s)id:(?:"${escaped}"|${escaped})(?=\\s|$)`).test(line);
}

export function findGlTargetLine(glText, { slideId = null, elementId = null } = {}) {
    const lines = String(glText ?? '').split('\n');
    const normSlideId = parseIdValue(slideId);
    const normElementId = parseIdValue(elementId);

    let slideLineIndex = -1;
    let inTargetSlide = normSlideId === null;

    for (let i = 0; i < lines.length; i++) {
        const trimmed = lines[i].trimStart();

        if (trimmed.startsWith('.slide')) {
            if (normSlideId !== null) {
                if (hasIdParam(trimmed, normSlideId)) {
                    slideLineIndex = i;
                    inTargetSlide = true;
                    if (normElementId === null) {
                        return i;
                    }
                } else if (inTargetSlide) {
                    break;
                }
            }
            continue;
        }

        if (normElementId !== null && inTargetSlide) {
            if (trimmed.startsWith('.element.') && hasIdParam(trimmed, normElementId)) {
                return i;
            }
        }
    }

    if (slideLineIndex !== -1) return slideLineIndex;
    return normElementId !== null || normSlideId !== null ? 0 : -1;
}

function formatTargetLabel(target = {}, lineIdx = -1) {
    const parts = [];
    if (target.slideId !== null && target.slideId !== undefined) parts.push(`slide id:${target.slideId}`);
    if (target.elementId !== null && target.elementId !== undefined) parts.push(`element id:${target.elementId}`);
    const desc = parts.length ? ` (${parts.join(', ')})` : '';
    return lineIdx >= 0 ? `Line ${lineIdx + 1}${desc}` : 'Full file';
}

// ---------- Inspector <-> Editor Sync ----------

function preserveFigureDataUris(oldSlides, newSlides) {
    if (!Array.isArray(oldSlides) || !Array.isArray(newSlides)) return;

    const bySlideAndElId = new Map();
    const byElIdOnly = new Map();

    for (const s of oldSlides) {
        for (const el of (s.elements || [])) {
            if (el.type !== 'figure' || typeof el.src !== 'string' || !el.src.startsWith('data:')) continue;
            if (el.id !== undefined && el.id !== null) {
                bySlideAndElId.set(`${parseIdValue(s.id)}::${parseIdValue(el.id)}`, {
                    src: el.src,
                    filePath: el.filePath || '',
                });
                byElIdOnly.set(parseIdValue(el.id), {
                    src: el.src,
                    filePath: el.filePath || '',
                });
            }
        }
    }

    for (const s of newSlides) {
        for (const el of (s.elements || [])) {
            if (el.type !== 'figure') continue;
            const cached = bySlideAndElId.get(`${parseIdValue(s.id)}::${parseIdValue(el.id)}`)
                || byElIdOnly.get(parseIdValue(el.id));
            if (cached && cached.filePath === (el.filePath || '')) {
                el.src = cached.src;
            }
        }
    }
}

export async function applyInspectorTextToEditor(glText, { silentOnError = true } = {}) {
    if (!adapter) return false;
    const raw = String(glText ?? '');
    if (!raw.trim() || !looksLikeGl(raw)) {
        setModeBadge('error', 'Invalid .gl');
        setStatus('Expected .project / .slide directives');
        if (!silentOnError) alert('Could not apply .gl: Expected a valid .gl project structure.');
        return false;
    }

    let parsed;
    try {
        parsed = parseGl(raw);
    } catch (err) {
        setModeBadge('error', 'Parse Error');
        setStatus(err.message);
        if (!silentOnError) alert(`Could not apply .gl: ${err.message}`);
        return false;
    }

    isApplyingFromInspector = true;
    try {
        const prevSlideIndex = state.currentSlideIndex;
        const oldSlides = state.slides;

        preserveFigureDataUris(oldSlides, parsed.slides);

        state.slides = parsed.slides;
        state.slideWidth = Number.isFinite(Number(parsed.slideWidth)) ? Number(parsed.slideWidth) : 1920;
        state.slideHeight = Number.isFinite(Number(parsed.slideHeight)) ? Number(parsed.slideHeight) : 1080;
        state.gridSize = parsed.gridSize !== undefined && parsed.gridSize !== null ? Number(parsed.gridSize) : 20;
        state.isDarkMode = !!parsed.isDarkMode;
        state.projectName = parsed.name || state.projectName || 'Untitled Project';
        state.nextId = parsed.nextId || 1;
        ensureElementIds();

        state.currentSlideIndex = Math.max(0, Math.min(prevSlideIndex, Math.max(0, state.slides.length - 1)));
        state.selectedSlideIndices = state.slides.length > 0 ? [state.currentSlideIndex] : [];
        state.selectedElementIndex = null;
        state.selectedElementIndices = [];

        await hydrateFigureElements(state.slides, state.projectFolder);

        document.body.classList.toggle('dark-mode', state.isDarkMode);
        syncSlideSizeSelect();
        syncGridSizeSelect();
        updateDimensionsCSS();

        hasUnappliedDraft = false;
        markDirty();

        if (typeof renderEditorRef === 'function') {
            renderEditorRef();
        }

        setModeBadge(isInspectorFocused ? 'listening' : 'synced', isInspectorFocused ? 'Editor Listening' : 'Synced');
        setStatus('Applied to editor');
        return true;
    } finally {
        isApplyingFromInspector = false;
    }
}

export function jumpToGlTarget(target = {}, { focusEditor = true } = {}) {
    ensureDom();
    if (!adapter) return;

    const glText = serializeProject();
    if (!hasUnappliedDraft) {
        adapter.setValue(glText);
    }

    const lineIdx = findGlTargetLine(adapter.getValue(), target);
    const label = formatTargetLabel(target, lineIdx);

    if (focusEditor) {
        adapter.jumpToLine(lineIdx, label);
    } else {
        setStatus(label);
    }
}

export function refreshGlInspectorText(target = currentTarget, { force = false, jump = false } = {}) {
    if (!isOpen || isApplyingFromInspector) return;
    if (!force && (isInspectorFocused || hasUnappliedDraft)) return;

    ensureDom();
    currentTarget = target || currentTarget || {};
    const glText = serializeProject();
    adapter.setValue(glText);
    setModeBadge('synced', 'Editor Sync');

    if (jump) {
        const lineIdx = findGlTargetLine(glText, currentTarget);
        adapter.jumpToLine(lineIdx, formatTargetLabel(currentTarget, lineIdx));
    } else {
        const lineIdx = findGlTargetLine(glText, currentTarget);
        setStatus(formatTargetLabel(currentTarget, lineIdx));
    }
}

export function openGlInspector(target = {}) {
    ensureDom();
    currentTarget = target || {};
    isOpen = true;
    hasUnappliedDraft = false;

    const drawer = document.getElementById(INSPECTOR_ID);
    if (drawer) drawer.classList.add('open');

    jumpToGlTarget(currentTarget, { focusEditor: true });
}

export function closeGlInspector() {
    clearTimeout(debounceTimer);
    isOpen = false;
    isInspectorFocused = false;
    hasUnappliedDraft = false;
    const drawer = document.getElementById(INSPECTOR_ID);
    if (drawer) drawer.classList.remove('open');
}

// ---------- Context Menu & DOM Target Resolution ----------

function hideContextMenu() {
    const menu = document.getElementById(MENU_ID);
    if (menu) {
        menu.classList.remove('open');
        delete menu._pendingTarget;
    }
}

function extractSlideIndexFromOnclick(node) {
    let curr = node;
    for (let depth = 0; curr && depth < 4; depth++, curr = curr.parentElement) {
        const onclickAttr = curr.getAttribute && curr.getAttribute('onclick');
        if (!onclickAttr) continue;
        const m = onclickAttr.match(/selectSlide\(\s*(\d+)\s*\)/);
        if (m) return Number(m[1]);
    }
    return null;
}

function resolveSlideFromNode(slideNode) {
    if (!slideNode) return null;
    const ds = slideNode.dataset || {};

    if (ds.slideId !== undefined) {
        const id = parseIdValue(ds.slideId);
        const found = state.slides.find(s => parseIdValue(s.id) === id);
        if (found) return found;
    }

    const idxRaw = ds.slideIndex ?? ds.index;
    if (idxRaw !== undefined && Number.isFinite(Number(idxRaw))) {
        const idx = Number(idxRaw);
        if (state.slides[idx]) return state.slides[idx];
    }

    const onclickIdx = extractSlideIndexFromOnclick(slideNode);
    if (onclickIdx !== null && state.slides[onclickIdx]) {
        return state.slides[onclickIdx];
    }

    let container = slideNode.parentElement;
    while (container && container !== document.body) {
        const allInContainer = [...container.querySelectorAll(SLIDE_NODE_SELECTOR)];
        if (allInContainer.length > 1) {
            const targetItem = allInContainer.find(
                item => item === slideNode || item.contains(slideNode)
            ) || slideNode;
            const pos = allInContainer.indexOf(targetItem);
            if (pos >= 0 && state.slides[pos]) {
                return state.slides[pos];
            }
            break;
        }
        container = container.parentElement;
    }

    return null;
}

function resolveElementFromNode(elNode, slide) {
    if (!elNode || !slide) return null;
    const elements = slide.elements || [];
    const ds = elNode.dataset || {};

    if (ds.elementId !== undefined || ds.elId !== undefined) {
        const id = parseIdValue(ds.elementId ?? ds.elId);
        return elements.find(el => parseIdValue(el.id) === id) || null;
    }

    const idxRaw = ds.elIndex ?? ds.elementIndex ?? ds.index;
    if (idxRaw !== undefined && Number.isFinite(Number(idxRaw))) {
        return elements[Number(idxRaw)] || null;
    }

    if (elNode.parentElement) {
        const siblings = [...elNode.parentElement.children].filter(
            node => node.matches(ELEMENT_NODE_SELECTOR)
        );
        const pos = siblings.indexOf(elNode);
        if (pos >= 0 && elements[pos]) return elements[pos];
    }

    return null;
}

function resolveContextTargetFromEvent(e) {
    if (!e || !e.target || typeof e.target.closest !== 'function') return null;

    const slideNode = e.target.closest(SLIDE_NODE_SELECTOR);
    if (slideNode) {
        const matchedSlide = resolveSlideFromNode(slideNode);
        if (matchedSlide) {
            return { slideId: matchedSlide.id, elementId: null };
        }
    }

    const elNode = e.target.closest(ELEMENT_NODE_SELECTOR);
    if (elNode) {
        const activeSlide = state.slides[state.currentSlideIndex] || null;
        if (activeSlide) {
            const matchedEl = resolveElementFromNode(elNode, activeSlide);
            return {
                slideId: activeSlide.id,
                elementId: matchedEl ? matchedEl.id : null,
            };
        }
    }

    return null;
}

export function initGlInspector() {
    if (initialized) return;
    initialized = true;
    ensureDom();

    const menu = document.getElementById(MENU_ID);
    const gotoBtn = document.getElementById('gl-menu-goto-btn');

    gotoBtn.onclick = () => {
        const target = menu._pendingTarget || {};
        hideContextMenu();
        openGlInspector(target);
    };

    document.addEventListener('contextmenu', (e) => {
        const target = resolveContextTargetFromEvent(e);
        if (!target) {
            hideContextMenu();
            return;
        }
        e.preventDefault();
        menu._pendingTarget = target;
        menu.style.left = `${Math.min(e.clientX, window.innerWidth - 205)}px`;
        menu.style.top = `${Math.min(e.clientY, window.innerHeight - 60)}px`;
        menu.classList.add('open');
    });

    document.addEventListener('click', (e) => {
        if (!menu.contains(e.target)) {
            hideContextMenu();
        }
    });

    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') {
            hideContextMenu();
            if (isOpen && !isInspectorFocused) {
                closeGlInspector();
            }
        }
    });

    // Editor -> Inspector sync when not actively typing in the inspector
    document.addEventListener('slide-content-changed', () => {
        refreshGlInspectorText(currentTarget);
    });
    document.addEventListener('slide-thumbnail-changed', () => {
        refreshGlInspectorText(currentTarget);
    });
}

// Wrap bindMarkDirtyAndRender so any editor render pass also updates
// the inspector when the inspector is not actively being edited.
export function attachGlInspectorToRender(originalRenderFn) {
    renderEditorRef = originalRenderFn;
    return function wrappedRenderEditor(...args) {
        const result = originalRenderFn.apply(this, args);
        if (isOpen && !isApplyingFromInspector && !isInspectorFocused && !hasUnappliedDraft) {
            refreshGlInspectorText(currentTarget);
        }
        return result;
    };
}

export { bindMarkDirtyAndRender };