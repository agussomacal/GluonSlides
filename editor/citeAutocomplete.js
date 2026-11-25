// ============================================================
// editor/citeAutocomplete.js — Bibliography keys while typing in a
// text box on the canvas: after \cite{ (or \citet{, \fullcite{ ...,
// or a comma inside one) a list of matching entries appears under the
// cursor. ↑/↓ choose, Enter or Tab inserts the key (and the closing
// brace when it is missing), Esc closes the list, typing filters it.
// The .gl inspector has the same suggestions (inspector/completions.js).
// ============================================================

import { citationCandidates, OPEN_CITE_RE } from '../core/citations.js';
import { escapeHtml } from '../core/render.js';

const MAX_ITEMS = 8;

let menu = null;
let items = [];
let activeIndex = 0;
let editing = null;   // the text box being typed in
let typed = '';

function editingBox(node) {
    return node && node.closest ? node.closest('.canvas-element.editing-mode') : null;
}

/** Text of `box` from its start (or end) to the cursor. */
function textAround(box) {
    const sel = window.getSelection();
    if (!sel || !sel.rangeCount || !box.contains(sel.anchorNode)) return null;
    const caret = sel.getRangeAt(0);
    const before = document.createRange();
    before.setStart(box, 0);
    before.setEnd(caret.startContainer, caret.startOffset);
    const after = document.createRange();
    after.setStart(caret.endContainer, caret.endOffset);
    after.setEnd(box, box.childNodes.length);
    return { before: before.toString(), after: after.toString(), caret };
}

function close() {
    if (menu) menu.remove();
    menu = null;
    items = [];
    editing = null;
}

function render(caretRect) {
    if (!menu) {
        menu = document.createElement('div');
        menu.className = 'cite-menu';
        menu.setAttribute('role', 'listbox');
        // Keep the focus (and the cursor) in the text box.
        menu.addEventListener('mousedown', (e) => {
            e.preventDefault();
            const row = e.target.closest('[data-index]');
            if (row) accept(Number(row.dataset.index));
        });
        document.body.appendChild(menu);
    }
    menu.innerHTML = items.map((c, i) => `
        <div class="cite-menu-item${i === activeIndex ? ' active' : ''}" role="option" data-index="${i}">
            <span class="cite-menu-key">${escapeHtml(c.key)}</span>
            <span class="cite-menu-label">${escapeHtml(c.label)}</span>
        </div>`).join('');
    menu.style.left = `${Math.max(4, Math.min(caretRect.left, window.innerWidth - 380))}px`;
    const below = caretRect.bottom + 4;
    menu.style.top = `${below + 260 > window.innerHeight ? Math.max(4, caretRect.top - 4 - menu.offsetHeight) : below}px`;
}

function update(box) {
    const around = textAround(box);
    const m = around && around.before.match(OPEN_CITE_RE);
    if (!m) { close(); return; }
    typed = m[1];
    items = citationCandidates(typed).filter(c => c.key !== typed).slice(0, MAX_ITEMS);
    if (!items.length) { close(); return; }
    editing = box;
    activeIndex = Math.min(activeIndex, items.length - 1);
    render(caretRect(box, around.caret));
}

/** Where the cursor is on screen (the box itself if the browser can't say). */
function caretRect(box, caret = textAround(box)?.caret) {
    const rect = caret && caret.getBoundingClientRect();
    return rect && (rect.width || rect.height) ? rect : box.getBoundingClientRect();
}

function accept(index) {
    const item = items[index];
    const box = editing;
    if (!item || !box) return;
    const around = textAround(box);
    const sel = window.getSelection();
    for (let i = 0; i < typed.length; i++) sel.modify('extend', 'backward', 'character');
    const closeBrace = around && /^\s*[},]/.test(around.after) ? '' : '}';
    // insertText keeps undo working and fires `input` (saves the text).
    document.execCommand('insertText', false, item.key + closeBrace);
    close();
}

document.addEventListener('input', (e) => {
    const box = editingBox(e.target);
    if (!box) { close(); return; }
    activeIndex = 0;
    update(box);
}, true);

// Captured before the text box's own keys (Esc would end editing).
document.addEventListener('keydown', (e) => {
    if (!menu || !editing) return;
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        activeIndex = (activeIndex + (e.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length;
        render(caretRect(editing));
    } else if (e.key === 'Enter' || e.key === 'Tab') {
        accept(activeIndex);
    } else if (e.key === 'Escape') {
        close();
    } else {
        return;
    }
    e.preventDefault();
    e.stopImmediatePropagation();
}, true);

document.addEventListener('focusout', (e) => {
    if (editing && e.target === editing) close();
}, true);
window.addEventListener('resize', close);
document.addEventListener('scroll', close, true);
