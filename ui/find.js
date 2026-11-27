// ============================================================
// ui/find.js — Find (Ctrl+F): searches the project's .gl text (what
// the source view shows: text, formulas, settings, file names…) and goes
// to each match: the element on its slide (selected and flashed), or the
// line in the source view for what isn't on a slide (project settings,
// macro definitions). With the source view open, it follows there too.
//   Enter / Shift+Enter: next / previous · Esc: close
// ============================================================

import { serializeProject } from '../core/state.js';
import { matches as shortcutMatches } from '../core/shortcuts.js';
import { revealElement, revealSlide } from '../editor/navigate.js';
import { showGlLine, isGlInspectorOpen } from '../editor/inspector/index.js';

let bar = null;
let found = [];        // [{ line, ch, len }]
let at = -1;
let text = '';
let timer = null;

const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Where a line of the .gl is: { elementId, slideId, label } (nulls when not on a slide). */
function placeOf(lines, lineIdx) {
    let slide = null;
    let element = null;
    let elementDepth = -1;
    for (let i = 0; i <= lineIdx; i++) {
        const raw = lines[i];
        const t = raw.trimStart();
        const depth = raw.length - t.length;
        const id = (t.match(/(?:^|\s)id:(\d+)/) || [])[1];
        if (/^\.(slide|master)\b/.test(t) && depth === 0) {
            slide = { id: id ? Number(id) : null, title: (t.match(/\{([^}]*)\}/) || [])[1] || '', master: t.startsWith('.master') };
            element = null;
        } else if (/^\.(project|palette|style|defaults|vars|import|define|section)\b/.test(t) && depth === 0) {
            slide = null;
            element = null;
        } else if (/^\.(element|macro)\./.test(t)) {
            if (id) { element = { id: Number(id), type: (t.match(/^\.(?:element|macro)\.([\w-]+)/) || [])[1] }; elementDepth = depth; }
        } else if (element && depth <= elementDepth && t && !t.startsWith('.') && !t.startsWith('#')) {
            element = null;
        }
    }
    return {
        elementId: element ? element.id : null,
        slideId: slide ? slide.id : null,
        label: slide ? `${slide.master ? 'master' : 'slide'} “${slide.title}”${element ? ` · ${element.type}` : ''}` : 'project settings / definitions',
    };
}

function search(query, caseSensitive) {
    text = serializeProject();
    found = [];
    if (!query) return;
    const re = new RegExp(escapeRe(query), caseSensitive ? 'g' : 'gi');
    text.split('\n').forEach((line, i) => {
        for (const m of line.matchAll(re)) found.push({ line: i, ch: m.index, len: m[0].length });
    });
}

function show(k) {
    if (!found.length) { at = -1; update(); return; }
    at = ((k % found.length) + found.length) % found.length;
    const hit = found[at];
    const lines = text.split('\n');
    const place = placeOf(lines, hit.line);
    hit.label = place.label;
    let shown = false;
    if (place.elementId !== null) shown = revealElement(place.elementId);
    else if (place.slideId !== null) shown = revealSlide(place.slideId);
    // not on a slide (or the source view is open): the line in the .gl
    if (!shown || isGlInspectorOpen()) showGlLine(hit.line, hit.ch, hit.len, { focus: false });
    update();
    bar.querySelector('input').focus();
}

function update() {
    const count = bar.querySelector('.find-count');
    const where = bar.querySelector('.find-where');
    const q = bar.querySelector('input').value;
    count.textContent = !q ? '' : found.length ? `${at + 1} / ${found.length}` : 'none';
    count.classList.toggle('none', Boolean(q) && !found.length);
    where.textContent = at >= 0 && found[at] ? found[at].label || '' : '';
}

function build() {
    bar = document.createElement('div');
    bar.className = 'find-bar';
    bar.hidden = true;
    bar.innerHTML = `
        <input type="text" placeholder="Find in the project (.gl)" spellcheck="false" aria-label="Find">
        <span class="find-count"></span>
        <button type="button" data-find="prev" title="Previous (Shift+Enter)">↑</button>
        <button type="button" data-find="next" title="Next (Enter)">↓</button>
        <label class="find-case" title="Match case"><input type="checkbox"> Aa</label>
        <button type="button" data-find="gl" title="Show it in the .gl file">{ }</button>
        <button type="button" data-find="close" title="Close (Esc)">✕</button>
        <div class="find-where"></div>`;
    document.body.appendChild(bar);
    const input = bar.querySelector('input[type=text]');
    const caseBox = bar.querySelector('.find-case input');
    const run = () => { search(input.value, caseBox.checked); at = -1; if (found.length) show(0); else update(); };
    input.addEventListener('input', () => { clearTimeout(timer); timer = setTimeout(run, 150); });
    caseBox.addEventListener('change', run);
    input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') { e.preventDefault(); clearTimeout(timer); if (at < 0 || text !== serializeProject()) { run(); if (e.shiftKey && found.length) show(found.length - 1); } else show(at + (e.shiftKey ? -1 : 1)); }
        else if (e.key === 'Escape') { e.preventDefault(); closeFind(); }
        e.stopPropagation();
    });
    bar.addEventListener('click', (e) => {
        const b = e.target.closest('[data-find]');
        if (!b) return;
        const what = b.dataset.find;
        if (what === 'close') closeFind();
        else if (what === 'gl') { if (found[at]) showGlLine(found[at].line, found[at].ch, found[at].len, { focus: true }); }
        else if (!found.length || text !== serializeProject()) run();
        else show(at + (what === 'next' ? 1 : -1));
    });
}

export function openFind(initial = '') {
    if (!bar) build();
    bar.hidden = false;
    const input = bar.querySelector('input[type=text]');
    if (initial) input.value = initial;
    input.focus();
    input.select();
    if (input.value) { search(input.value, bar.querySelector('.find-case input').checked); at = -1; if (found.length) show(0); else update(); }
}

export function closeFind() {
    if (bar) bar.hidden = true;
    found = [];
    at = -1;
}

// Ctrl+F (changeable: Help → Keyboard shortcuts), in the editor
window.addEventListener('keydown', (e) => {
    if (!shortcutMatches(e, 'find')) return;
    if (!document.getElementById('editor-view')?.classList.contains('active')) return;
    e.preventDefault();
    e.stopPropagation();
    const sel = String(window.getSelection ? window.getSelection() : '').trim();
    openFind(sel && !sel.includes('\n') && sel.length < 80 ? sel : '');
}, true);

