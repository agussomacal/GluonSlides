// ============================================================
// core/shortcuts.js — The editor's keyboard shortcuts, changeable.
//
// COMMANDS lists each command with its default keys; the user's own
// keys (Help → Keyboard shortcuts, ui/help.js) are kept in the interface
// preferences (core/prefs.js, 'shortcuts': { id: ['Ctrl+K', ...] }).
// Handlers ask `matches(e, 'group')` instead of testing keys themselves.
//
// Keys are written 'Ctrl+Shift+G': modifiers Ctrl (Cmd on macOS), Alt,
// Shift, in that order, then the key: a letter or digit, a named key
// (F5, Tab, Delete, ArrowUp...) or a symbol (], [, /). Letters follow
// the keyboard's layout (Ctrl+Z is the key marked Z on AZERTY too);
// digits and brackets the key's place, so Shift doesn't change them.
//
// FIXED lists keys that can't be changed (arrows, Esc...), for the
// shortcuts list only.
// ============================================================

import { pref, setPref, loadPrefs } from './prefs.js';

export const COMMANDS = [
    { id: 'undo', label: 'Undo', group: 'Editing', keys: ['Ctrl+Z'] },
    { id: 'redo', label: 'Redo', group: 'Editing', keys: ['Ctrl+Shift+Z', 'Ctrl+Y'] },
    { id: 'cut', label: 'Cut', group: 'Editing', keys: ['Ctrl+X'] },
    { id: 'copy', label: 'Copy', group: 'Editing', keys: ['Ctrl+C'] },
    { id: 'paste', label: 'Paste', group: 'Editing', keys: ['Ctrl+V'] },
    { id: 'delete', label: 'Delete the selection (objects or slides)', group: 'Editing', keys: ['Delete', 'Backspace'] },
    { id: 'group', label: 'Group', group: 'Arranging', keys: ['Ctrl+G'] },
    { id: 'ungroup', label: 'Ungroup', group: 'Arranging', keys: ['Ctrl+Shift+G'] },
    { id: 'lock', label: 'Lock / unlock', group: 'Arranging', keys: ['Ctrl+Shift+L'] },
    { id: 'forward', label: 'Bring forward', group: 'Arranging', keys: ['Ctrl+]'] },
    { id: 'backward', label: 'Send backward', group: 'Arranging', keys: ['Ctrl+['] },
    { id: 'front', label: 'Bring to front', group: 'Arranging', keys: ['Ctrl+Shift+]'] },
    { id: 'back', label: 'Send to back', group: 'Arranging', keys: ['Ctrl+Shift+['] },
    { id: 'toggleSlides', label: 'Hide / show the slides pane', group: 'Window', keys: ['Ctrl+Alt+1'] },
    { id: 'toggleProperties', label: 'Hide / show the properties pane', group: 'Window', keys: ['Ctrl+Alt+2'] },
    { id: 'nextTab', label: 'Next project tab', group: 'Window', keys: ['Ctrl+Tab'] },
    { id: 'prevTab', label: 'Previous project tab', group: 'Window', keys: ['Ctrl+Shift+Tab'] },
    { id: 'closeTab', label: 'Close the project tab', group: 'Window', keys: ['Ctrl+W'] },
    { id: 'presentStart', label: 'Present from the first slide', group: 'Presenting', keys: ['F5'] },
    { id: 'presentHere', label: 'Present from the current slide', group: 'Presenting', keys: ['Shift+F5'] },
    { id: 'glFile', label: 'Show / hide the .gl file (source)', group: 'Window', keys: ['Ctrl+E'] },
    { id: 'shortcuts', label: 'Keyboard shortcuts', group: 'Help', keys: ['Ctrl+/', 'F1'] },
];

export const FIXED = [
    ['← → ↑ ↓', 'Move the selection (Alt: finely, without snapping); with nothing selected, change slide'],
    ['Shift+↑ / ↓', 'Select more slides'],
    ['Esc', 'Stop editing text, leave a group or master slide, cancel drawing'],
    ['Double-click', 'Edit a text, a cell or a column; enter a group or macro'],
    ['Ctrl+click', 'Add to the selection'],
    ['Shift (resizing, drawing)', 'Keep proportions; 45° lines; 15° turns'],
    ['Alt (dragging)', 'Place freely, without guides or grid'],
    ['Tab / Shift+Tab, Enter', 'In tables and columns: next / previous cell or column, the cell below'],
    ['Enter / double-click', 'Finish a curve or polygon'],
    ['While presenting', '→ Space: next · ←: back · Home/End · B/W: black/white · S: presenter view · Esc: stop'],
];

const MAC = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform || '');
const CODE_KEYS = { BracketRight: ']', BracketLeft: '[', Slash: '/', Backslash: '\\', Minus: '-', Equal: '=', Comma: ',', Period: '.', Semicolon: ';', Quote: "'", Backquote: '`' };

/** The key of an event as written in a shortcut ('Ctrl+Shift+G'), or '' for a lone modifier. */
export function keyOf(e) {
    if (['Control', 'Shift', 'Alt', 'Meta', 'AltGraph', 'OS'].includes(e.key)) return '';
    let key;
    if (/^Digit\d$/.test(e.code || '')) key = e.code.slice(5);
    else if (CODE_KEYS[e.code]) key = CODE_KEYS[e.code];
    else if (e.key && e.key.length === 1) key = e.key === ' ' ? 'Space' : e.key.toUpperCase();
    else key = e.key || '';
    if (key === 'Esc') key = 'Escape';
    const mods = [];
    if (e.ctrlKey || e.metaKey) mods.push('Ctrl');
    if (e.altKey) mods.push('Alt');
    if (e.shiftKey) mods.push('Shift');
    return [...mods, key].join('+');
}

/** A shortcut written by hand, tidied ('shift+ctrl+g' -> 'Ctrl+Shift+G'). */
export function normalise(spec) {
    const parts = String(spec || '').split('+').map(p => p.trim()).filter(Boolean);
    if (!parts.length) return '';
    const key = parts.pop();
    const low = parts.map(p => p.toLowerCase());
    const mods = [];
    if (low.some(p => ['ctrl', 'control', 'cmd', 'meta', 'command'].includes(p))) mods.push('Ctrl');
    if (low.includes('alt') || low.includes('option')) mods.push('Alt');
    if (low.includes('shift')) mods.push('Shift');
    return [...mods, key.length === 1 ? key.toUpperCase() : key].join('+');
}

/** How a shortcut is shown (Cmd on macOS). */
export function display(spec) {
    return MAC ? spec.replace(/\bCtrl\b/, '⌘').replace(/\bAlt\b/, '⌥').replace(/\bShift\b/, '⇧').replace(/\+/g, '') : spec;
}

function custom() {
    const all = pref('shortcuts', {});
    return all && typeof all === 'object' ? all : {};
}

/** The keys of a command now (the user's own, else the defaults). */
export function keysFor(id) {
    const own = custom()[id];
    if (Array.isArray(own)) return own;
    const cmd = COMMANDS.find(c => c.id === id);
    return cmd ? cmd.keys : [];
}

/** Whether `e` is one of `id`'s keys. */
export function matches(e, id) {
    const key = keyOf(e);
    return Boolean(key) && keysFor(id).includes(key);
}

/** The command `e` is a shortcut of, or null. */
export function commandOf(e) {
    const key = keyOf(e);
    if (!key) return null;
    const cmd = COMMANDS.find(c => keysFor(c.id).includes(key));
    return cmd ? cmd.id : null;
}

/** Commands other than `id` that use `key`. */
export function conflicts(key, id) {
    return COMMANDS.filter(c => c.id !== id && keysFor(c.id).includes(key)).map(c => c.label);
}

/** Sets a command's keys ([] for none); the defaults again with null. */
export function setKeys(id, keys) {
    const all = { ...custom() };
    const cmd = COMMANDS.find(c => c.id === id);
    if (keys === null || (cmd && JSON.stringify(keys) === JSON.stringify(cmd.keys))) delete all[id];
    else all[id] = keys.map(normalise).filter(Boolean);
    setPref('shortcuts', all);
}

/** Every command back to its default keys. */
export function resetAll() {
    setPref('shortcuts', {});
}

export function isCustomised(id) {
    return Array.isArray(custom()[id]);
}

loadPrefs();
