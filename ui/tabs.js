// ============================================================
// ui/tabs.js — Several projects open at once, one tab each.
//
// The editor works on one project: `state` (core/state.js) and the
// figure images (elements/figure/figure.js). Switching tabs saves the
// project being left, keeps its state and images aside, and puts the
// other tab's back. The clipboards and the recent projects are shared,
// so objects and slides copied in one tab paste into another
// (core/projectTransfer.js brings their files, macros and styles along).
//
//   Opening a project while one is open      a new tab (or the tab where
//                                            it is open already)
//   + in the tab strip                       the start screen, for a new tab
//   × on a tab (or Ctrl+W)                   saved, then closed
//   Ctrl+Tab / Ctrl+Shift+Tab                next / previous tab
// ============================================================

import { state, flushPendingSave } from '../core/state.js';
import { takeFigureCache, putFigureCache } from '../elements/figure/figure.js';
import { escapeHtml } from '../core/render.js';

// Shared by every tab (not part of a project).
const SHARED_KEYS = new Set(['elementClipboard', 'slideClipboard', 'clipboardSource', 'recents']);
// A new tab starts from these (nothing shared with the tab set aside).
const INITIAL = structuredClone(Object.fromEntries(Object.entries(state).filter(([k]) => !SHARED_KEYS.has(k))));

/** [{ id, fields, figures, empty }]: `fields` and `figures` are kept for tabs not shown. */
const tabs = [];
let active = -1;
let nextId = 1;
let hooks = { enter: () => {}, start: () => {} };

/** How the app shows a project (enterEditor) and the start screen (ui/project.js). */
export function setTabHooks(h) {
    hooks = { ...hooks, ...h };
}

function takeState() {
    const fields = {};
    Object.keys(state).forEach(k => { if (!SHARED_KEYS.has(k)) fields[k] = state[k]; });
    return fields;
}

function putState(fields) {
    Object.keys(state).forEach(k => { if (!SHARED_KEYS.has(k)) delete state[k]; });
    Object.assign(state, fields);
}

const nameOf = (t, i) => (i === active ? (state.projectName || 'Untitled') : (t.fields && t.fields.projectName) || 'Untitled');
const pathOf = (t, i) => (i === active ? state.projectPath : t.fields && t.fields.projectPath);

/** The open tabs, for tests: [{ name, path, active }]. */
export function tabList() {
    return tabs.map((t, i) => ({ name: t.empty ? 'New tab' : nameOf(t, i), path: pathOf(t, i) || null, active: i === active }));
}

/** Keeps the active tab's project aside (saved first). */
async function stashActive() {
    if (active < 0 || !tabs[active] || tabs[active].empty) return;
    await flushPendingSave();
    tabs[active].fields = takeState();
    tabs[active].figures = takeFigureCache();
    putState(structuredClone(INITIAL));
}

/**
 * Before a project is opened, created or imported: where it goes. Returns
 * true when it is open already (its tab is shown: nothing to load).
 * Otherwise the current tab is kept aside and a new one is active.
 */
export async function prepareTabFor(path = null) {
    if (path) {
        const found = tabs.findIndex((t, i) => !t.empty && pathOf(t, i) === path);
        if (found >= 0 && found === active) return false; // (re)loaded into its own tab
        if (found >= 0) {
            await switchTab(found);
            return true;
        }
    }
    if (active >= 0 && tabs[active] && !tabs[active].empty) {
        await stashActive();
        tabs.push({ id: nextId++ });
        active = tabs.length - 1;
    } else if (active < 0) {
        tabs.push({ id: nextId++ });
        active = 0;
    }
    tabs[active].empty = false;
    return false;
}

/** The project now loaded in `state` belongs to the active tab (call after loading). */
export function projectLoaded() {
    if (active < 0) {
        tabs.push({ id: nextId++ });
        active = 0;
    }
    tabs[active].empty = false;
    renderTabs();
}

export async function switchTab(index) {
    if (index === active || !tabs[index]) return;
    await stashActive();
    // a "+" tab left without opening anything goes away
    if (active >= 0 && tabs[active] && tabs[active].empty) {
        tabs.splice(active, 1);
        if (index > active) index -= 1;
    }
    active = index;
    const t = tabs[active];
    putState(t.fields);
    putFigureCache(t.figures);
    t.fields = null;
    t.figures = null;
    hooks.enter({ switched: true });
    renderTabs();
}

/** "+": the start screen, for a project in a new tab. */
export async function newTab() {
    if (active >= 0 && tabs[active] && tabs[active].empty) return;
    await stashActive();
    tabs.push({ id: nextId++, empty: true });
    active = tabs.length - 1;
    hooks.start();
    renderTabs();
}

export async function closeTab(index = active) {
    const t = tabs[index];
    if (!t) return;
    if (index === active) {
        if (!t.empty) await flushPendingSave();
    }
    tabs.splice(index, 1);
    if (index < active) {
        active -= 1;
    } else if (index === active) {
        active = -1;
        if (tabs.length) {
            const next = Math.min(index, tabs.length - 1);
            active = next;
            const n = tabs[next];
            if (n.empty) hooks.start();
            else {
                putState(n.fields);
                putFigureCache(n.figures);
                n.fields = null;
                n.figures = null;
                hooks.enter({ switched: true });
            }
        } else {
            hooks.start();
        }
    }
    renderTabs();
}

// ---------- The strip ----------

function strip() {
    let el = document.getElementById('project-tabs');
    if (!el) {
        el = document.createElement('div');
        el.id = 'project-tabs';
        el.className = 'project-tabs';
        el.setAttribute('role', 'tablist');
        document.body.prepend(el);
        el.addEventListener('mousedown', (e) => {
            if (e.button === 1) { // middle click closes, as in browsers
                const tab = e.target.closest('[data-tab]');
                if (tab) { e.preventDefault(); closeTab(Number(tab.dataset.tab)); }
            }
        });
        el.addEventListener('click', (e) => {
            const close = e.target.closest('[data-tab-close]');
            if (close) { closeTab(Number(close.dataset.tabClose)); return; }
            if (e.target.closest('[data-tab-new]')) { newTab(); return; }
            const tab = e.target.closest('[data-tab]');
            if (tab) switchTab(Number(tab.dataset.tab));
        });
    }
    return el;
}

export function renderTabs() {
    const el = strip();
    const show = tabs.some(t => !t.empty) || tabs.length > 1;
    el.hidden = !show;
    document.body.classList.toggle('has-tabs', show);
    if (!show) return;
    el.innerHTML = tabs.map((t, i) => {
        const name = t.empty ? 'New tab' : nameOf(t, i);
        const path = pathOf(t, i) || '';
        const dirty = i === active && !t.empty && state.isDirty;
        return `<div class="project-tab${i === active ? ' active' : ''}" role="tab" aria-selected="${i === active}" data-tab="${i}" title="${escapeHtml(path || name)}">
            <span class="project-tab-name">${escapeHtml(name)}${dirty ? ' •' : ''}</span>
            <button type="button" class="project-tab-close" data-tab-close="${i}" title="Close (Ctrl+W)">×</button>
        </div>`;
    }).join('') + '<button type="button" class="project-tab-new" data-tab-new="1" title="Open or create another project in a new tab">+</button>';
}

window.addEventListener('keydown', (e) => {
    if (!(e.ctrlKey || e.metaKey) || !tabs.length) return;
    if (e.key === 'Tab') {
        e.preventDefault();
        const n = tabs.length;
        switchTab(((active + (e.shiftKey ? -1 : 1)) % n + n) % n);
    } else if (e.key.toLowerCase() === 'w' && !e.shiftKey && !e.altKey && tabs.length > 1) {
        e.preventDefault();
        closeTab(active);
    }
});
