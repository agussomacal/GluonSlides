// ============================================================
// core/clipboard.js — Keyboard shortcuts for slide navigation,
// multi-selection, arrow movement, cut/copy/paste, deletion,
// and undo/redo.
// ============================================================

import {
    state,
    markDirty,
    flashSaveIndicator,
    getSelectedElementIndices,
    setSelectedElementIndices,
    getSelectedSlideIndices,
    setSelectedSlideIndices,
    undo,
    redo,
    allocateSlideId,
    activeElements,
    reassignIdsDeep,
    currentSlide,
} from './state.js';
import {
    renderEditor,
    deleteSelectedElements,
    deleteSelectedSlides,
    extendSlideSelectionByArrow,
    navigateSlideByArrow,
    moveSelectedElementsByArrow,
    groupSelected,
    ungroupSelected,
    leaveGroup,
    leaveMaster,
    insertElement,
} from '../editor/editor.js';
import { syncProjectChrome } from './render.js';
import { addImageFile } from '../elements/figure/figure.js';

const PASTE_OFFSET_PX = 40;

function isTypingTarget(activeEl) {
    return activeEl && (
        activeEl.contentEditable === 'true'
        || activeEl.tagName === 'INPUT'
        || activeEl.tagName === 'TEXTAREA'
    );
}

function syncUiAfterHistoryChange() {
    syncProjectChrome();
    renderEditor();
}

function copySelectionToClipboard() {
    const slide = currentSlide();
    const selectedElIndices = getSelectedElementIndices();

    if (selectedElIndices.length > 0 && slide) {
        const copiedEls = selectedElIndices
            .map(idx => activeElements()[idx])
            .filter(Boolean)
            .map(el => JSON.parse(JSON.stringify(el)));
        if (copiedEls.length > 0) {
            state.elementClipboard = copiedEls;
            state.slideClipboard = null;
            return {kind: 'elements', count: copiedEls.length};
        }
        return null;
    }

    const selectedSlideIdxList = state.editingMasterIndex !== null ? [] : getSelectedSlideIndices();
    if (selectedSlideIdxList.length > 0) {
        const copiedSlides = selectedSlideIdxList
            .map(idx => state.slides[idx])
            .filter(Boolean)
            .map(s => JSON.parse(JSON.stringify(s)));
        if (copiedSlides.length > 0) {
            state.slideClipboard = copiedSlides;
            state.elementClipboard = null;
            return {kind: 'slides', count: copiedSlides.length};
        }
    }

    return null;
}

export function initKeyboardShortcuts() {
    window.addEventListener('keydown', (e) => {
        const activeEl = document.activeElement;
        if (isTypingTarget(activeEl)) return;

        const slide = currentSlide();
        const hasCtrlOrCmd = e.ctrlKey || e.metaKey;
        // Editing a master slide: no slide-level shortcuts (navigate,
        // delete or paste slides); Esc leaves the master.
        const onMaster = state.editingMasterIndex !== null;

        // Ctrl/Cmd + G — group selection; Ctrl/Cmd + Shift + G — ungroup
        if (hasCtrlOrCmd && !e.altKey && e.key.toLowerCase() === 'g') {
            e.preventDefault();
            if (e.shiftKey) ungroupSelected();
            else groupSelected();
            return;
        }

        // Escape — leave the group being edited
        if (e.key === 'Escape' && (leaveGroup() || leaveMaster())) {
            e.preventDefault();
            return;
        }

        // 0a. Ctrl/Cmd + Shift + Z (or Ctrl/Cmd + Y) — Redo
        if (hasCtrlOrCmd && !e.altKey && ((e.shiftKey && e.key.toLowerCase() === 'z') || (!e.shiftKey && e.key.toLowerCase() === 'y'))) {
            if (redo()) {
                syncUiAfterHistoryChange();
                e.preventDefault();
            }
            return;
        }

        // 0b. Ctrl/Cmd + Z (without Shift) — Undo
        if (hasCtrlOrCmd && !e.shiftKey && !e.altKey && e.key.toLowerCase() === 'z') {
            if (undo()) {
                syncUiAfterHistoryChange();
                e.preventDefault();
            }
            return;
        }

        // 0c. Shift + ArrowUp / ArrowDown — extend multi-selection across slides
        if (e.shiftKey && !hasCtrlOrCmd && !e.altKey && (e.key === 'ArrowUp' || e.key === 'ArrowDown')) {
            if (onMaster) return;
            const delta = e.key === 'ArrowUp' ? -1 : 1;
            if (extendSlideSelectionByArrow(delta)) {
                e.preventDefault();
            }
            return;
        }

        // 0d. Plain Arrow keys — move selected object(s) if any are selected, otherwise navigate slides
        if (!hasCtrlOrCmd && !e.shiftKey && ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.key)) {
            if (getSelectedElementIndices().length > 0) {
                if (moveSelectedElementsByArrow(e.key, e.altKey)) {
                    e.preventDefault();
                }
                return;
            }
            if (!onMaster && !e.altKey && (e.key === 'ArrowUp' || e.key === 'ArrowDown' || e.key === 'ArrowLeft' || e.key === 'ArrowRight')) {
                const delta = (e.key === 'ArrowUp' || e.key === 'ArrowLeft') ? -1 : 1;
                if (navigateSlideByArrow(delta)) {
                    e.preventDefault();
                }
            }
            return;
        }

        // 1. Delete / Backspace — delete selected object(s), or selected slide(s) if no object is active
        if (e.key === 'Delete' || e.key === 'Backspace') {
            if (getSelectedElementIndices().length > 0) {
                if (deleteSelectedElements()) {
                    e.preventDefault();
                }
                return;
            }
            if (!onMaster && deleteSelectedSlides()) {
                e.preventDefault();
            }
            return;
        }

        // 2. Ctrl/Cmd + X — cut selected element(s) or selected slide(s) into clipboard
        if (hasCtrlOrCmd && e.key.toLowerCase() === 'x') {
            const copied = copySelectionToClipboard();
            if (!copied) return;

            if (copied.kind === 'elements') {
                deleteSelectedElements(false);
                flashSaveIndicator(copied.count > 1 ? `${copied.count} objects cut ✓` : 'Object cut ✓');
                markInternalCopy();
                return;
            }

            if (copied.kind === 'slides') {
                deleteSelectedSlides(false);
                flashSaveIndicator(copied.count > 1 ? `${copied.count} slides cut ✓` : 'Slide cut ✓');
                markInternalCopy();
            }
            return;
        }

        // 3. Ctrl/Cmd + C — copy selected element(s), or selected slide(s) if no element is active
        if (hasCtrlOrCmd && e.key.toLowerCase() === 'c') {
            const copied = copySelectionToClipboard();
            if (!copied) return;

            if (copied.kind === 'elements') {
                flashSaveIndicator(copied.count > 1 ? `${copied.count} objects copied ✓` : 'Object copied ✓');
            } else if (copied.kind === 'slides') {
                flashSaveIndicator(copied.count > 1 ? `${copied.count} slides copied ✓` : 'Slide copied ✓');
            }
            markInternalCopy(); // the browser's copy event follows (not prevented)
            return;
        }

        // 4. Ctrl/Cmd + V — paste copied element(s) or copied slide(s)
        if (hasCtrlOrCmd && e.key.toLowerCase() === 'v') {
            // The browser's paste event comes next: an image in the system
            // clipboard wins (see the 'paste' listener); otherwise, a moment
            // later, the objects or slides copied in the app are pasted.
            clearTimeout(pendingPaste);
            pendingPaste = setTimeout(() => { pendingPaste = null; pasteInternal(onMaster, slide); }, PASTE_WAIT_MS);
        }
    });
    initImagePaste();
}

/** Pastes the objects or slides copied in the app (Ctrl+V without an image). */
function pasteInternal(onMaster, slide) {
    if (Array.isArray(state.elementClipboard) && state.elementClipboard.length > 0 && slide) {
        const pastedIndices = [];
        state.elementClipboard.forEach(templateEl => {
            const newEl = JSON.parse(JSON.stringify(templateEl));
            // Paste mints a fresh ID: copy keeps the original's identity,
            // paste creates a distinct element so IDs stay unique.
            reassignIdsDeep(newEl);
            newEl.x += PASTE_OFFSET_PX;
            newEl.y += PASTE_OFFSET_PX;
            activeElements().push(newEl);
            pastedIndices.push(activeElements().length - 1);
        });
        setSelectedElementIndices(pastedIndices, pastedIndices[pastedIndices.length - 1]);
        markDirty();
        renderEditor();
        flashSaveIndicator(pastedIndices.length > 1 ? `${pastedIndices.length} objects pasted ✓` : 'Object pasted ✓');
        return;
    }

    if (!onMaster && Array.isArray(state.slideClipboard) && state.slideClipboard.length > 0) {
        const insertAfter = Math.max(0, Math.min(state.currentSlideIndex, state.slides.length - 1));
        const pastedSlideIndices = [];
        state.slideClipboard.forEach((templateSlide, offset) => {
            const newSlide = JSON.parse(JSON.stringify(templateSlide));
            newSlide.id = allocateSlideId();
            newSlide.title = `${templateSlide.title || 'Slide'} (Copy)`;
            // Pasted slides carry their elements with their original
            // IDs; those are remapped below to stay unique.
            newSlide.elements = (newSlide.elements || []).map(el => reassignIdsDeep(el));
            const targetIdx = insertAfter + 1 + offset;
            state.slides.splice(targetIdx, 0, newSlide);
            pastedSlideIndices.push(targetIdx);
        });

        state.currentSlideIndex = pastedSlideIndices[0];
        setSelectedSlideIndices(pastedSlideIndices);
        setSelectedElementIndices([], null);
        markDirty();
        renderEditor();
        flashSaveIndicator(pastedSlideIndices.length > 1 ? `${pastedSlideIndices.length} slides pasted ✓` : 'Slide pasted ✓');
    }
}

// ---------- System clipboard: images in, a marker out ----------

const PASTE_WAIT_MS = 60;
const INTERNAL_MARKER = 'GluonSlides objects';
let pendingPaste = null;
let internalCopyAt = 0;

/** Ctrl+C/X in the app: the copy event (right after) replaces the system clipboard. */
function markInternalCopy() {
    internalCopyAt = Date.now();
}

/** An image file in a paste event's data, or null. */
function clipboardImage(data) {
    if (!data) return null;
    const files = [...(data.files || [])].filter(f => f.type.startsWith('image/'));
    if (files.length) return files[0];
    const item = [...(data.items || [])].find(i => i.kind === 'file' && i.type.startsWith('image/'));
    return item ? item.getAsFile() : null;
}

function initImagePaste() {
    // Objects copied in the app replace what the system clipboard held,
    // so an older screenshot is not pasted instead of them.
    const writeMarker = (e) => {
        if (Date.now() - internalCopyAt > 500 || isTypingTarget(document.activeElement)) return;
        internalCopyAt = 0;
        if (e.clipboardData) {
            e.clipboardData.setData('text/plain', INTERNAL_MARKER);
            e.preventDefault();
        }
    };
    document.addEventListener('copy', writeMarker);
    document.addEventListener('cut', writeMarker);

    document.addEventListener('paste', async (e) => {
        if (isTypingTarget(document.activeElement)) return;
        const editor = document.getElementById('editor-view');
        if (!editor || !editor.classList.contains('active')) return;
        const file = clipboardImage(e.clipboardData);
        if (!file) return; // the app's own clipboard is pasted (pendingPaste)
        e.preventDefault();
        clearTimeout(pendingPaste);
        pendingPaste = null;
        try {
            await addImageFile(file, props => insertElement('figure', props));
            flashSaveIndicator('Image pasted ✓');
        } catch (err) {
            flashSaveIndicator(`Could not paste the image: ${err.message}`);
        }
    });
}