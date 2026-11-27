// ============================================================
// core/prefs.js — Small choices of the interface kept between runs
// (hidden panes...), and where new projects go by default (the folder
// last used to create or import one). In the app they live in a file
// (backend/user_settings.py: the page's own storage is not kept); in a
// browser, in localStorage.
// ============================================================

import { whenApiReady } from './state.js';

const LOCAL = 'gluonslides.prefs';
let prefs = {};
let defaultParent = null;
let loaded = null;
let fromApp = false;

/** Whether the preferences are the app's own file (not a browser's storage). */
export function prefsFromApp() {
    return fromApp;
}

function local() {
    try {
        return JSON.parse(localStorage.getItem(LOCAL) || '{}') || {};
    } catch (e) {
        return {};
    }
}

/** Loads them (once); resolves when known. */
export function loadPrefs() {
    if (!loaded) {
        loaded = (async () => {
            const api = await whenApiReady(3000);
            if (api && typeof api.get_ui_prefs === 'function') {
                try {
                    const res = await api.get_ui_prefs();
                    prefs = (res && res.prefs) || {};
                    defaultParent = (res && res.defaultParent) || null;
                    fromApp = true;
                    return;
                } catch (e) { /* the browser's storage, then */ }
            }
            prefs = local();
            defaultParent = prefs.lastParent || null;
        })();
    }
    return loaded;
}

export function pref(key, fallback = null) {
    return prefs[key] !== undefined ? prefs[key] : fallback;
}

export function setPref(key, value) {
    prefs[key] = value;
    whenApiReady(0).then(api => {
        if (api && typeof api.set_ui_pref === 'function') api.set_ui_pref(key, value);
    }).catch(() => {});
    try {
        localStorage.setItem(LOCAL, JSON.stringify(prefs));
    } catch (e) { /* not kept */ }
}

/** The folder new and imported projects go in by default (or null). */
export function defaultProjectFolder() {
    return defaultParent;
}

/** A project was created / imported in `folder`: the next one goes there too. */
export function rememberProjectFolder(folder) {
    if (!folder) return;
    defaultParent = folder;
    prefs.lastParent = folder;
    try {
        localStorage.setItem(LOCAL, JSON.stringify(prefs));
    } catch (e) { /* not kept */ }
}
