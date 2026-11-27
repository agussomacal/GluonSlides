// ============================================================
// core/clipboard.js — Keyboard shortcuts for slide navigation,
// multi-selection, arrow movement, cut/copy/paste, deletion,
// and undo/redo.
// ============================================================

import { remapConnectors } from './connectors.js';
import { clipboardSourceNow, fromAnotherProject, bringAlong } from './projectTransfer.js';
import { busy } from '../ui/busy.js';
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
    pyApi,
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
    reorderSelected,
    toggleLockSelected,
} from '../editor/editor.js';
import { syncProjectChrome } from './render.js';
import { withDefaults } from './defaults.js';
import { addImageFile, addImageData, addImagePath } from '../elements/figure/figure.js';
import { rowsFromClipboardText } from '../elements/table/table.js';

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
            state.clipboardSource = clipboardSourceNow(); // pasted in another tab: files come along
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
            state.clipboardSource = clipboardSourceNow();
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

        // Ctrl/Cmd + ] / [ — bring forward / send backward; with Shift: to front / back
        if (hasCtrlOrCmd && !e.altKey && (e.code === 'BracketRight' || e.code === 'BracketLeft')) {
            if (getSelectedElementIndices().length === 0) return;
            e.preventDefault();
            const up = e.code === 'BracketRight';
            reorderSelected(e.shiftKey ? (up ? 'front' : 'back') : (up ? 'forward' : 'backward'));
            return;
        }

        // Ctrl/Cmd + Shift + L — lock / unlock the selection
        if (hasCtrlOrCmd && e.shiftKey && !e.altKey && e.key.toLowerCase() === 'l') {
            if (getSelectedElementIndices().length === 0) return;
            e.preventDefault();
            toggleLockSelected();
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

        // 4. Ctrl/Cmd + V — an image from the system clipboard, else the
        // object(s) or slide(s) copied in the app.
        if (hasCtrlOrCmd && e.key.toLowerCase() === 'v') {
            clearTimeout(pendingPaste);
            pendingPaste = null;
            const api = pyApi();
            if (api && typeof api.read_clipboard === 'function') {
                // In the app the page gets no paste event without a focused
                // text field: the backend reads the clipboard.
                systemPasteAt = Date.now();
                pasteFromSystem(api, onMaster, slide);
                return;
            }
            // In a browser the paste event comes next: an image in it wins
            // (see the 'paste' listener); otherwise, a moment later, what
            // was copied in the app is pasted.
            pendingPaste = setTimeout(() => { pendingPaste = null; pasteInternal(onMaster, slide); }, PASTE_WAIT_MS);
        }
    });
    initImagePaste();
}

/** Pastes the objects or slides copied in the app (Ctrl+V without an image). */
async function pasteInternal(onMaster, slide) {
    if (Array.isArray(state.elementClipboard) && state.elementClipboard.length > 0 && slide) {
        const pastedIndices = [];
        const copies = state.elementClipboard.map(el => JSON.parse(JSON.stringify(el)));
        // From another project (tab): its figures, tables, macros and styles come along,
        // and the objects keep their place (a duplicate here would be offset).
        const other = fromAnotherProject(state.clipboardSource);
        const missing = other ? await busy('Copying the files they use…', bringAlong(copies, state.clipboardSource)) : [];
        // Paste mints fresh IDs (copy keeps the original's identity); connectors
        // among the pasted objects attach to the pasted copies (core/connectors.js).
        const idMap = new Map();
        copies.forEach(newEl => reassignIdsDeep(newEl, idMap));
        remapConnectors(copies, idMap, other ? [] : activeElements());
        copies.forEach(newEl => {
            if (!other) {
                newEl.x += PASTE_OFFSET_PX;
                newEl.y += PASTE_OFFSET_PX;
            }
            activeElements().push(newEl);
            pastedIndices.push(activeElements().length - 1);
        });
        setSelectedElementIndices(pastedIndices, pastedIndices[pastedIndices.length - 1]);
        markDirty();
        renderEditor();
        flashSaveIndicator(missing.length ? `Pasted; not found in the other project: ${missing.join(', ')}`
            : pastedIndices.length > 1 ? `${pastedIndices.length} objects pasted ✓` : 'Object pasted ✓');
        return;
    }

    if (!onMaster && Array.isArray(state.slideClipboard) && state.slideClipboard.length > 0) {
        const insertAfter = Math.max(0, Math.min(state.currentSlideIndex, state.slides.length - 1));
        const pastedSlideIndices = [];
        const slideCopies = state.slideClipboard.map(s => JSON.parse(JSON.stringify(s)));
        const otherProject = fromAnotherProject(state.clipboardSource);
        if (otherProject) {
            await busy('Copying the files they use…', bringAlong(slideCopies.flatMap(s => s.elements || []), state.clipboardSource));
        }
        slideCopies.forEach((newSlide, offset) => {
            const templateSlide = state.slideClipboard[offset];
            newSlide.id = allocateSlideId();
            if (!otherProject) newSlide.title = `${templateSlide.title || 'Slide'} (Copy)`;
            // Pasted slides carry their elements with their original
            // IDs; those are remapped below to stay unique.
            const idMap = new Map();
            newSlide.elements = (newSlide.elements || []).map(el => reassignIdsDeep(el, idMap));
            remapConnectors(newSlide.elements, idMap, []);
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

// ---------- System clipboard: images and text in, a marker out ----------

const PASTE_WAIT_MS = 60;
const INTERNAL_MARKER = 'GluonSlides objects';
let pendingPaste = null;
let internalCopyAt = 0;

let systemPasteAt = 0;

/**
 * Ctrl+C/X in the app: the system clipboard is replaced (by the backend,
 * or by the copy event that follows in a browser), so an older
 * screenshot is not pasted instead of the objects.
 */
function markInternalCopy() {
    internalCopyAt = Date.now();
    const api = pyApi();
    if (api && typeof api.set_clipboard_text === 'function') {
        Promise.resolve(api.set_clipboard_text(INTERNAL_MARKER)).catch(() => {});
    }
}

/** Text from outside the app (not the marker of an in-app copy). */
function outsideText(text) {
    const t = String(text ?? '').replace(/\r\n?/g, '\n');
    return t.trim() && t.trim() !== INTERNAL_MARKER ? t.replace(/^\n+|\s+$/g, '') : '';
}

/**
 * Pasted text: a new text box holding it, centred on the slide, wide
 * enough for its lines (up to 70% of the slide) and tall enough for them.
 */
/** Cells copied from a spreadsheet: a table sized for them, centred. */
function addTableFromRows(rows) {
    const scale = state.slideWidth / 1920;
    const fontSize = Math.round(28 * scale);
    const width = Math.round(Math.min(state.slideWidth * 0.85, rows[0].length * 260 * scale));
    const height = Math.round(Math.min(state.slideHeight * 0.85, rows.length * fontSize * 1.9));
    insertElement('table', {
        rows, x: Math.round((state.slideWidth - width) / 2), y: Math.round((state.slideHeight - height) / 2), width, height,
    });
}

/** Pasted text: a table for spreadsheet cells, else a text box. */
function pasteOutsideText(text) {
    const rows = rowsFromClipboardText(text);
    if (rows) {
        addTableFromRows(rows);
        flashSaveIndicator(`Table pasted (${rows.length} × ${rows[0].length}) ✓`);
    } else {
        addTextBox(text);
        flashSaveIndicator('Text pasted ✓');
    }
}

export function addTextBox(text) {
    const slideW = state.slideWidth;
    const fontSize = withDefaults({ type: 'text' }).fontSize || Math.round(32 * slideW / 1920);
    const charW = fontSize * 0.55;
    const lines = text.split('\n');
    const longest = Math.max(...lines.map(l => l.length));
    const width = Math.round(Math.min(slideW * 0.7, Math.max(slideW * 0.2, longest * charW + fontSize)));
    const perLine = Math.max(1, Math.floor((width - fontSize) / charW));
    const rows = lines.reduce((n, l) => n + Math.max(1, Math.ceil(l.length / perLine)), 0);
    const height = Math.round(Math.min(state.slideHeight * 0.9, rows * fontSize * 1.5 + fontSize));
    insertElement('text', {
        content: text,
        x: Math.round((slideW - width) / 2),
        y: Math.round(Math.max(0, (state.slideHeight - height) / 2)),
        width, height,
        ...(lines.length > 1 ? { textAlign: 'left', verticalAlign: 'top' } : {}),
    });
}

/**
 * Ctrl+V in the app: the clipboard's image (or copied image files), or
 * its text as a new text box, else what was copied in the app.
 */
async function pasteFromSystem(api, onMaster, slide) {
    let res = null;
    try {
        res = await api.read_clipboard();
    } catch (err) {
        res = null;
    }
    const insert = props => insertElement('figure', props);
    try {
        if (res && res.data_uri) {
            await addImageData(res.data_uri, insert);
            flashSaveIndicator('Image pasted ✓');
            return;
        }
        if (res && Array.isArray(res.paths) && res.paths.length) {
            for (const [i, path] of res.paths.entries()) {
                await addImagePath(path, insert, { x: state.slideWidth / 2 + i * 40, y: state.slideHeight / 2 + i * 40 });
            }
            flashSaveIndicator(res.paths.length > 1 ? `${res.paths.length} images pasted ✓` : 'Image pasted ✓');
            return;
        }
        if (res && outsideText(res.text) && slide) {
            pasteOutsideText(res.text.replace(/\r\n?/g, '\n').replace(/\n+$/, ''));
            return;
        }
    } catch (err) {
        flashSaveIndicator(`Could not paste the image: ${err.message}`);
        return;
    }
    pasteInternal(onMaster, slide);
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
        // Already handled from the keydown, through the backend.
        if (Date.now() - systemPasteAt < 1500) {
            e.preventDefault();
            return;
        }
        const file = clipboardImage(e.clipboardData);
        if (!file) {
            const text = outsideText(e.clipboardData && e.clipboardData.getData('text/plain'));
            if (!text || !currentSlide()) return; // the app's own clipboard is pasted (pendingPaste)
            e.preventDefault();
            clearTimeout(pendingPaste);
            pendingPaste = null;
            pasteOutsideText((e.clipboardData.getData('text/plain') || '').replace(/\r\n?/g, '\n').replace(/\n+$/, ''));
            return;
        }
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