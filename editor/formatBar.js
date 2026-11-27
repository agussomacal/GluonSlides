// ============================================================
// editor/formatBar.js — A small bar over the selected words while
// editing text on the canvas (text boxes, columns, table cells): bold,
// italic, underline, a text colour (the project's theme colours and a
// few others), a highlight, and ✕ to remove them. Markdown first: bold is
// **…** and italic *…*; what Markdown can't say uses the text commands of
// core/textCommands.js (\underline{…}, \textcolor{@accent}{…}, …). It is
// typed into the text like any edit (Ctrl+Z undoes it).
// ============================================================

import { palette } from '../core/colors.js';
import { escapeHtml } from '../core/render.js';

const EXTRA_COLORS = ['red', 'blue', 'ForestGreen', 'orange', 'gray'];
const HIGHLIGHTS = ['yellow', 'lime!40', 'cyan!30', 'pink'];
const WRAPPERS = /^\\(textcolor|highlight|colorbox)\{[^{}]*\}\{([\s\S]*)\}$|^\\(textbf|textit|emph|underline|texttt)\{([\s\S]*)\}$|^(\*\*|__|\*|_)(?=\S)([\s\S]*\S)\5$/;
// Markdown marks for the buttons that have one.
const MARKDOWN = { bold: '**', italic: '*' };

let bar = null;

/** The canvas text being edited that holds the selection, or null. */
function editableOf(node) {
    const el = node && (node.nodeType === 1 ? node : node.parentElement);
    const box = el && el.closest('[contenteditable="true"]');
    return box && box.closest('#slide-canvas') ? box : null;
}

function selection() {
    const sel = window.getSelection();
    if (!sel || !sel.rangeCount || sel.isCollapsed) return null;
    const box = editableOf(sel.anchorNode);
    if (!box || editableOf(sel.focusNode) !== box) return null;
    return { sel, box, text: sel.toString() };
}

function chip(color, kind, title) {
    return `<button type="button" class="format-chip ${kind}" data-${kind}="${escapeHtml(color)}" title="${escapeHtml(title)}"><span></span></button>`;
}

function build() {
    bar = document.createElement('div');
    bar.className = 'format-bar';
    bar.setAttribute('role', 'toolbar');
    // Keep the selection in the text: nothing here takes the focus.
    bar.addEventListener('mousedown', (e) => e.preventDefault());
    bar.addEventListener('click', onClick);
    document.body.appendChild(bar);
}

function fill() {
    const themed = palette().map(p => chip(`@${p.name}`, 'color', `${p.name} (theme colour)`));
    bar.innerHTML = `
        <button type="button" data-md="bold" title="Bold: **…**"><b>B</b></button>
        <button type="button" data-md="italic" title="Italic: *…*"><i>I</i></button>
        <button type="button" data-cmd="underline" title="Underlined: \\underline{…}"><u>U</u></button>
        <span class="format-sep"></span>
        ${themed.join('')}${EXTRA_COLORS.map(c => chip(c, 'color', c)).join('')}
        <span class="format-sep"></span>
        ${HIGHLIGHTS.map(c => chip(c, 'highlight', `Highlight: ${c}`)).join('')}
        <span class="format-sep"></span>
        <button type="button" data-cmd="plain" title="Remove the formatting around the selection">✕</button>`;
    // Swatches show the colour they apply.
    import('../core/textCommands.js').then(({ textColor }) => {
        bar.querySelectorAll('.format-chip').forEach(b => {
            b.firstElementChild.style.background = textColor(b.dataset.color || b.dataset.highlight) || 'transparent';
        });
    });
}

function hide() {
    if (bar) bar.hidden = true;
}

function show(rect) {
    if (!bar) build();
    if (bar.hidden !== false || !bar.childElementCount) fill();
    bar.hidden = false;
    const w = bar.offsetWidth || 320;
    bar.style.left = `${Math.max(8, Math.min(window.innerWidth - w - 8, rect.left + rect.width / 2 - w / 2))}px`;
    bar.style.top = `${Math.max(8, rect.top - bar.offsetHeight - 8)}px`;
}

/** Wraps each line of the selection (formatting does not cross paragraphs). */
function wrapLines(text, open, close = '}') {
    return text.split('\n').map(line => {
        if (!line.trim()) return line;
        // Spaces stay outside the marks (**word ** is not bold in Markdown).
        const [, lead, core, trail] = line.match(/^(\s*)([\s\S]*?)(\s*)$/);
        return `${lead}${open}${core}${close}${trail}`;
    }).join('\n');
}

function onClick(e) {
    const b = e.target.closest('button');
    const cur = selection();
    if (!b || !cur) return;
    let text = cur.text;
    if (b.dataset.cmd === 'plain') {
        // peel the commands wrapped around the selection
        let m;
        while ((m = WRAPPERS.exec(text.trim()))) text = m[2] ?? m[4] ?? m[6];
    } else if (b.dataset.md) {
        text = wrapLines(text, MARKDOWN[b.dataset.md], MARKDOWN[b.dataset.md]);
    } else if (b.dataset.cmd) {
        text = wrapLines(text, `\\${b.dataset.cmd}{`);
    } else if (b.dataset.color) {
        text = wrapLines(text, `\\textcolor{${b.dataset.color}}{`);
    } else if (b.dataset.highlight) {
        text = wrapLines(text, `\\highlight{${b.dataset.highlight}}{`);
    }
    // As typed: the text box's own undo and input handling apply.
    const range = cur.sel.getRangeAt(0).cloneRange();
    cur.box.focus({ preventScroll: true });
    cur.sel.removeAllRanges();
    cur.sel.addRange(range);
    const usedCommand = document.execCommand('insertText', false, text);
    if (!usedCommand) {
        range.deleteContents();
        const node = document.createTextNode(text);
        range.insertNode(node);
        range.setStartAfter(node);
        range.collapse(true);
        cur.sel.removeAllRanges();
        cur.sel.addRange(range);
    }
    if (!usedCommand) cur.box.dispatchEvent(new Event('input', { bubbles: true }));
    hide();
}

document.addEventListener('selectionchange', () => {
    const cur = selection();
    if (!cur || !cur.text.trim()) {
        hide();
        return;
    }
    const rect = cur.sel.getRangeAt(0).getBoundingClientRect();
    if (rect.width || rect.height) show(rect);
});
window.addEventListener('scroll', hide, true);
