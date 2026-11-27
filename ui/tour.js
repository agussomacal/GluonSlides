// ============================================================
// ui/tour.js — The quick tour: a spotlight on each part of the editor
// window in turn, with a few words on what it does (Next / Back, Esc
// to stop). Help → Quick tour starts it; in the app it starts by itself
// the first time the editor opens (preference 'tourSeen').
// ============================================================

import { pref, setPref, loadPrefs, prefsFromApp } from '../core/prefs.js';
import { keysFor, display } from '../core/shortcuts.js';

const key = (id) => (keysFor(id)[0] ? display(keysFor(id)[0]) : 'no shortcut');

/** The steps: what to light up (a selector; none: the middle of the window) and what to say. */
function steps() {
    return [
        { title: 'Welcome to GluonSlides', text: 'A quick look around the window: about a minute. Esc stops the tour at any time; Help (?) at the top right starts it again.' },
        { target: '#slides-thumb-list', title: 'Your slides', text: 'Click a slide to edit it, drag to reorder, right-click for more. ↑ / ↓ change slide when nothing is selected. With nothing selected, the panel on the right shows the slide: its section, master slide and speaker notes.' },
        { target: '#editor-toolbar', title: 'Adding things', text: 'Text (its ▾: columns and tables), fields such as the slide number, shapes, lines and arrows, pictures and your macros. Pictures can also be dropped on the window or pasted with Ctrl+V.' },
        { target: '#slide-canvas', title: 'The slide', text: 'Drag to move, handles to resize, the round handle to turn. Double-click a text to write in it: Markdown, $math$ and LaTeX commands such as \\textcolor; selecting words shows a small format bar. Drag a line\'s end onto a shape to attach it.' },
        { target: '.properties-sidebar', title: 'Properties', text: 'Everything about the selected object: position, style, colours, at which step it appears when presenting (builds), and aligning, layers and locking.' },
        { target: '.present-btn', title: 'Presenting', text: `▶ Present (or ${key('presentStart')} from the start) shows the slides full screen; the presenter view adds your notes, the next slide and a timer. HTML and PDF exports are at the bottom left.` },
        { target: '.sidebar-footer', title: 'The project', text: 'Project settings (default fonts and colours, theme colours, styles, slide size), the bibliography, LaTeX macros, night mode.' },
        { target: '#help-menu', title: 'Text underneath', text: `Every project is a readable text file, the .gl file: ${key('glFile')} shows it next to the slide, and editing it changes the slide. Help (?) has the tutorial presentation, the keyboard shortcuts (${key('shortcuts')}, all changeable) and the format's reference.` },
    ];
}

let layer = null;
let index = 0;

function place() {
    const list = steps();
    const step = list[index];
    const spot = layer.querySelector('.tour-spot');
    const card = layer.querySelector('.tour-card');
    const target = step.target && document.querySelector(step.target);
    const r = target && target.getBoundingClientRect();
    const visible = r && r.width > 0 && r.height > 0;
    if (visible) {
        const pad = 6;
        Object.assign(spot.style, { left: `${r.left - pad}px`, top: `${r.top - pad}px`, width: `${r.width + 2 * pad}px`, height: `${r.height + 2 * pad}px` });
    } else {
        Object.assign(spot.style, { left: '50%', top: '40%', width: '0px', height: '0px' });
    }
    card.querySelector('.tour-title').textContent = step.title;
    card.querySelector('.tour-text').textContent = step.text;
    card.querySelector('.tour-count').textContent = `${index + 1} / ${list.length}`;
    card.querySelector('[data-tour="back"]').disabled = index === 0;
    card.querySelector('[data-tour="next"]').textContent = index === list.length - 1 ? 'Done' : 'Next';
    // The card next to the spotlight, where there is room.
    const cw = card.offsetWidth || 340;
    const ch = card.offsetHeight || 160;
    let left = window.innerWidth / 2 - cw / 2;
    let top = window.innerHeight / 2 - ch / 2;
    if (visible) {
        if (r.right + 16 + cw < window.innerWidth) [left, top] = [r.right + 16, r.top];
        else if (r.left - 16 - cw > 0) [left, top] = [r.left - 16 - cw, r.top];
        else if (r.bottom + 16 + ch < window.innerHeight) [left, top] = [r.left + r.width / 2 - cw / 2, r.bottom + 16];
        else [left, top] = [r.left + r.width / 2 - cw / 2, r.top - 16 - ch];
    }
    card.style.left = `${Math.max(8, Math.min(window.innerWidth - cw - 8, left))}px`;
    card.style.top = `${Math.max(8, Math.min(window.innerHeight - ch - 8, top))}px`;
}

export function stopTour() {
    if (!layer) return;
    layer.remove();
    layer = null;
    window.removeEventListener('resize', place);
    setPref('tourSeen', true);
}

function go(delta) {
    const n = steps().length;
    if (index + delta >= n) return stopTour();
    index = Math.max(0, index + delta);
    place();
}

export function startTour() {
    if (layer) stopTour();
    index = 0;
    layer = document.createElement('div');
    layer.className = 'tour-layer';
    layer.innerHTML = `
        <div class="tour-spot"></div>
        <div class="tour-card" role="dialog" aria-live="polite">
            <div class="tour-count"></div>
            <h3 class="tour-title"></h3>
            <p class="tour-text"></p>
            <div class="tour-actions">
                <button type="button" class="btn btn-secondary" data-tour="stop">Skip</button>
                <button type="button" class="btn btn-secondary" data-tour="back">Back</button>
                <button type="button" class="btn btn-primary" data-tour="next">Next</button>
            </div>
        </div>`;
    document.body.appendChild(layer);
    layer.addEventListener('click', (e) => {
        const b = e.target.closest('[data-tour]');
        if (!b) return;
        if (b.dataset.tour === 'stop') stopTour();
        else go(b.dataset.tour === 'next' ? 1 : -1);
    });
    window.addEventListener('resize', place);
    place();
}

// Keys while the tour shows: → / Enter next, ← back, Esc stop (the editor behind doesn't react).
window.addEventListener('keydown', (e) => {
    if (!layer) return;
    if (['Escape', 'ArrowRight', 'ArrowLeft', 'Enter'].includes(e.key)) {
        e.preventDefault();
        e.stopImmediatePropagation();
        if (e.key === 'Escape') stopTour();
        else go(e.key === 'ArrowLeft' ? -1 : 1);
    }
}, true);

/** The first time the editor opens in the app: the tour, once. */
export async function tourOnFirstUse() {
    await loadPrefs();
    if (!prefsFromApp() || pref('tourSeen', false) || layer) return;
    setTimeout(() => {
        if (document.getElementById('editor-view')?.classList.contains('active')) startTour();
    }, 400);
}
