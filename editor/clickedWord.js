// ============================================================
// editor/clickedWord.js — Double-clicking a word of a text shown on the
// canvas opens it for editing with that word selected in the source
// (where the click was: the source has Markdown and LaTeX around it, so
// the word is looked for near the same relative place).
//
//   const word = clickedWord(domEl, e); // in the dblclick handler, before the source replaces the shown text
//   ... the editable box gets the source ...
//   selectWord(box, word);             // that word selected (else the caret at the end)
// ============================================================

/** The word under the double-click `e` in `container` (the shown text), and where it is (0–1). */
export function clickedWord(container, e) {
    let node = null;
    let offset = 0;
    if (e && document.caretRangeFromPoint) {
        const r = document.caretRangeFromPoint(e.clientX, e.clientY);
        if (r) [node, offset] = [r.startContainer, r.startOffset];
    } else if (e && document.caretPositionFromPoint) {
        const p = document.caretPositionFromPoint(e.clientX, e.clientY);
        if (p) [node, offset] = [p.offsetNode, p.offset];
    }
    if (!node || node.nodeType !== 3 || !container.contains(node)) {
        // the browser's own word selection, when it made one
        const sel = window.getSelection();
        if (!sel || !sel.rangeCount || sel.isCollapsed || !container.contains(sel.anchorNode)) return null;
        node = sel.anchorNode;
        offset = sel.anchorOffset;
        if (node.nodeType !== 3) return null;
    }
    const text = node.textContent;
    const isWord = (ch) => /[\p{L}\p{N}_'’-]/u.test(ch);
    let a = Math.min(offset, text.length);
    let b = a;
    if (!isWord(text[a] || '') && a > 0 && isWord(text[a - 1])) a -= 1, b = a; // just after a word
    while (a > 0 && isWord(text[a - 1])) a -= 1;
    while (b < text.length && isWord(text[b])) b += 1;
    const word = text.slice(a, b);
    if (!word) return null;
    const before = document.createRange();
    before.selectNodeContents(container);
    before.setEnd(node, a);
    const total = (container.textContent || '').length || 1;
    return { word, at: before.toString().length / total };
}

/** The text node and offset at character `n` of `box`'s text (<br> counts as one). */
function pointAt(box, n) {
    const walker = document.createTreeWalker(box, NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT);
    let left = n;
    let last = null;
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
        if (node.nodeType === 3) {
            if (left <= node.length) return [node, left];
            left -= node.length;
            last = node;
        } else if (node.nodeName === 'BR') {
            left -= 1;
        }
    }
    return last ? [last, last.length] : [box, box.childNodes.length];
}

/** Selects `clicked.word` in the editable `box` (the occurrence nearest its place), else puts the caret at the end. */
export function selectWord(box, clicked) {
    const sel = window.getSelection();
    const range = document.createRange();
    const text = box.innerText || '';
    let best = -1;
    if (clicked && clicked.word) {
        const target = clicked.at * text.length;
        for (let i = text.indexOf(clicked.word); i >= 0; i = text.indexOf(clicked.word, i + 1)) {
            if (best < 0 || Math.abs(i - target) < Math.abs(best - target)) best = i;
        }
    }
    if (best >= 0) {
        range.setStart(...pointAt(box, best));
        range.setEnd(...pointAt(box, best + clicked.word.length));
    } else {
        range.selectNodeContents(box);
        range.collapse(false);
    }
    sel.removeAllRanges();
    sel.addRange(range);
}
