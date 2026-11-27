// ============================================================
// ui/panes.js — Show / hide the side panes (to make room for the slide,
// e.g. next to another window): the slides pane (Ctrl+Alt+1) and the
// properties pane (Ctrl+Alt+2), also from the toolbar's ◧ / ◨ buttons.
// Remembered on this computer. The canvas refits itself (editor.js).
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
            btn.title = `${hidden ? 'Show' : 'Hide'} the ${p.label} (Ctrl+Alt+${p.key})`;
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

export function initPanes() {
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
