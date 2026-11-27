// ============================================================
// ui/panes.js — Show / hide the side panes (to make room for the slide,
// e.g. next to another window): the slides pane (Ctrl+Alt+1) and the
// properties pane (Ctrl+Alt+2), also from the toolbar's ◧ / ◨ buttons.
// Remembered on this computer. The canvas refits itself (editor.js).
// Their widths: drag the inner edge of a pane (nearly shut hides it;
// a double-click gives the usual width back).
// ============================================================

const PANES = {
    slides: { cls: 'hide-slides-pane', key: '1', label: 'slides pane' },
    properties: { cls: 'hide-properties-pane', key: '2', label: 'properties pane' },
};
import { loadPrefs, pref, setPref } from '../core/prefs.js';

function sync() {
    Object.entries(PANES).forEach(([name, p]) => {
        const hidden = document.body.classList.contains(p.cls);
        const btn = document.querySelector(`[data-action="toggle-pane"][data-arg="${name}"]`);
        if (btn) {
            btn.classList.toggle('active', !hidden);
            btn.title = `${hidden ? 'Show' : 'Hide'} the ${p.label} (Ctrl+Alt+${p.key}; drag its edge to resize)`;
        }
    });
}

export function togglePane(name) {
    const p = PANES[name];
    if (!p) return;
    document.body.classList.toggle(p.cls);
    const hidden = Object.entries(PANES).filter(([, q]) => document.body.classList.contains(q.cls)).map(([n]) => n);
    setPref('hiddenPanes', hidden);
    sync();
}

// ---------- Widths ----------

const SIZES = {
    slides: { selector: '#editor-view .slides-sidebar', cssVar: '--slides-w', usual: 260, side: 'left' },
    properties: { selector: '#editor-view .properties-sidebar', cssVar: '--props-w', usual: 280, side: 'right' },
};
const MIN_W = 150;
const HIDE_BELOW = 90;
let widths = {};

function applyWidths() {
    Object.entries(SIZES).forEach(([name, z]) => {
        if (widths[name]) document.documentElement.style.setProperty(z.cssVar, `${widths[name]}px`);
        else document.documentElement.style.removeProperty(z.cssVar);
    });
}

function setWidth(name, w, save = true) {
    if (w === null) delete widths[name];
    else widths[name] = Math.round(w);
    applyWidths();
    if (save) setPref('paneWidths', { ...widths });
}

function startResize(e, name) {
    if (e.button !== 0) return;
    e.preventDefault();
    const z = SIZES[name];
    const pane = document.querySelector(z.selector);
    const handle = e.currentTarget;
    const start = pane.getBoundingClientRect();
    const max = () => Math.max(MIN_W, window.innerWidth * 0.45);
    handle.classList.add('dragging');
    document.body.classList.add('resizing-pane');
    let wanted = start.width;
    const onMove = (m) => {
        wanted = z.side === 'left' ? m.clientX - start.left : start.right - m.clientX;
        setWidth(name, Math.max(MIN_W, Math.min(max(), wanted)), false);
    };
    const onUp = () => {
        window.removeEventListener('mousemove', onMove);
        window.removeEventListener('mouseup', onUp);
        handle.classList.remove('dragging');
        document.body.classList.remove('resizing-pane');
        if (wanted < HIDE_BELOW) {
            setWidth(name, start.width, false); // shown again later at the width it had
            togglePane(name);
        }
        setPref('paneWidths', { ...widths });
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
}

function addResizers() {
    Object.entries(SIZES).forEach(([name, z]) => {
        const pane = document.querySelector(z.selector);
        if (!pane || pane.querySelector(':scope > .pane-resizer')) return;
        const handle = document.createElement('div');
        handle.className = 'pane-resizer';
        handle.dataset.pane = name;
        handle.title = 'Drag to resize (nearly shut: hide it) · double-click: usual width';
        handle.addEventListener('mousedown', (e) => startResize(e, name));
        handle.addEventListener('dblclick', () => setWidth(name, null));
        pane.appendChild(handle);
    });
}

export function initPanes() {
    addResizers();
    loadPrefs().then(() => {
        widths = { ...(pref('paneWidths', {}) || {}) };
        applyWidths();
    });
    loadPrefs().then(() => {
        (pref('hiddenPanes', []) || []).forEach(name => PANES[name] && document.body.classList.add(PANES[name].cls));
        sync();
    });
    sync();
    window.addEventListener('keydown', (e) => {
        if (!(e.ctrlKey || e.metaKey) || !e.altKey) return;
        const name = Object.keys(PANES).find(n => e.code === `Digit${PANES[n].key}`);
        if (name) {
            e.preventDefault();
            togglePane(name);
        }
    });
}
