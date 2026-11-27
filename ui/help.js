// ============================================================
// ui/help.js — The ? menu at the right of the toolbar: the quick tour
// (ui/tour.js), the tutorial presentation (ui/tutorial.js), the
// keyboard shortcuts (a dialog where each can be changed:
// core/shortcuts.js), the project's .gl file, and the documentation.
// Also the keys of these: Ctrl+/ (or F1) for the shortcuts, Ctrl+E for
// the .gl file.
// ============================================================

import { pyApi } from '../core/state.js';
import { escapeHtml } from '../core/render.js';
import {
    COMMANDS, FIXED, keysFor, keyOf, conflicts, setKeys, resetAll, isCustomised, display, matches,
} from '../core/shortcuts.js';
import { startTour } from './tour.js';
import { openTutorialProject } from './project.js';
import { toggleGlInspector } from '../editor/inspector/index.js';

const DOCS = 'https://github.com/agussomacal/GluonSlides/blob/main/docs/';

function openLink(url) {
    const api = pyApi();
    if (api && typeof api.open_url === 'function') return api.open_url(url);
    window.open(url, '_blank', 'noopener');
}

const ACTIONS = {
    tour: () => startTour(),
    tutorial: () => openTutorialProject(),
    shortcuts: () => openShortcuts(),
    glfile: () => toggleGlInspector(),
    format: () => openLink(`${DOCS}gluon-format.md`),
    guide: () => openLink(`${DOCS}user-guide.md`),
};

/** Runs a help entry by name (the menu, the welcome screen's Tutorial button). */
export function runHelp(name) {
    if (ACTIONS[name]) ACTIONS[name]();
}

// ---------- the keyboard shortcuts dialog ----------

let dialog = null;
let recording = null; // the command whose keys are being typed

const chip = (k) => `<kbd>${escapeHtml(display(k))}</kbd>`;

function rows() {
    const groups = [...new Set(COMMANDS.map(c => c.group))];
    return groups.map(g => `
        <h4>${escapeHtml(g)}</h4>
        ${COMMANDS.filter(c => c.group === g).map(c => {
            const keys = keysFor(c.id);
            const now = recording === c.id
                ? '<span class="shortcut-recording">Press the new keys… <small>(Esc: cancel · Backspace: none)</small></span>'
                : (keys.length ? keys.map(chip).join(' ') : '<span class="shortcut-none">none</span>');
            return `<div class="shortcut-row${recording === c.id ? ' recording' : ''}" data-command="${c.id}">
                <span class="shortcut-label">${escapeHtml(c.label)}</span>
                <button type="button" class="shortcut-keys" data-record="${c.id}" title="Click, then press the new keys">${now}</button>
                <button type="button" class="shortcut-reset" data-reset="${c.id}" title="Back to ${escapeHtml(c.keys.map(display).join(', '))}" ${isCustomised(c.id) ? '' : 'hidden'}>↺</button>
            </div>`;
        }).join('')}`).join('');
}

function fixedRows() {
    return FIXED.map(([k, what]) => `<div class="shortcut-row fixed"><span class="shortcut-label">${escapeHtml(what)}</span><span class="shortcut-keys">${escapeHtml(k)}</span></div>`).join('');
}

function render(note = '') {
    dialog.querySelector('.shortcuts-list').innerHTML = rows();
    dialog.querySelector('.shortcuts-note').textContent = note;
}

export function openShortcuts() {
    if (!dialog) {
        dialog = document.createElement('div');
        dialog.className = 'modal-backdrop';
        dialog.id = 'shortcuts-modal';
        dialog.innerHTML = `
            <div class="modal shortcuts-modal">
                <h3>Keyboard shortcuts</h3>
                <p class="prop-hint">Click a shortcut and press the keys you want. On macOS Ctrl is ⌘.</p>
                <div class="shortcuts-list"></div>
                <p class="shortcuts-note" role="status"></p>
                <h4>Always</h4>
                <div class="shortcuts-fixed">${fixedRows()}</div>
                <div class="modal-actions">
                    <button type="button" class="btn btn-secondary" data-reset-all>Reset all</button>
                    <button type="button" class="btn btn-primary" data-close>Close</button>
                </div>
            </div>`;
        document.body.appendChild(dialog);
        dialog.addEventListener('click', (e) => {
            if (e.target === dialog || e.target.closest('[data-close]')) return closeShortcuts();
            const rec = e.target.closest('[data-record]');
            if (rec) {
                recording = recording === rec.dataset.record ? null : rec.dataset.record;
                return render();
            }
            const reset = e.target.closest('[data-reset]');
            if (reset) {
                setKeys(reset.dataset.reset, null);
                recording = null;
                return render();
            }
            if (e.target.closest('[data-reset-all]')) {
                resetAll();
                recording = null;
                render('Every shortcut is back to its default.');
            }
        });
    }
    recording = null;
    render();
    dialog.classList.add('show');
}

function closeShortcuts() {
    recording = null;
    if (dialog) dialog.classList.remove('show');
}

const dialogOpen = () => Boolean(dialog && dialog.classList.contains('show'));

/** Keys typed while the dialog is open: a new shortcut, or nothing (the editor behind doesn't react). */
function onDialogKey(e) {
    if (!dialogOpen()) return false;
    if (e.key === 'Tab' && !recording) return false; // moving between the buttons
    e.preventDefault();
    e.stopImmediatePropagation();
    if (!recording) {
        if (e.key === 'Escape') closeShortcuts();
        return true;
    }
    if (e.key === 'Escape' && !e.ctrlKey && !e.altKey && !e.shiftKey && !e.metaKey) {
        recording = null;
        render();
        return true;
    }
    if (e.key === 'Backspace' && !e.ctrlKey && !e.altKey && !e.shiftKey && !e.metaKey) {
        const id = recording;
        setKeys(id, []);
        recording = null;
        render(`${COMMANDS.find(c => c.id === id).label}: no shortcut.`);
        return true;
    }
    const key = keyOf(e);
    if (!key) return true; // a modifier alone: wait for the key
    const id = recording;
    // the key moves here from any command that had it
    const taken = conflicts(key, id);
    COMMANDS.filter(c => c.id !== id && keysFor(c.id).includes(key))
        .forEach(c => setKeys(c.id, keysFor(c.id).filter(k => k !== key)));
    setKeys(id, [key]);
    recording = null;
    render(taken.length ? `${display(key)} was used by ${taken.join(', ')}: it now does this instead.` : '');
    return true;
}

function isTyping(el) {
    return el && (el.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName) || el.closest('.CodeMirror'));
}

// Before the editor's own handlers (capture), so the dialog can take every key.
window.addEventListener('keydown', (e) => {
    if (onDialogKey(e)) return;
    const editorOn = document.getElementById('editor-view')?.classList.contains('active');
    if (matches(e, 'shortcuts')) {
        e.preventDefault();
        openShortcuts();
    } else if (editorOn && matches(e, 'glFile') && !isTyping(document.activeElement)) {
        e.preventDefault();
        toggleGlInspector();
    }
}, true);

// ---------- the ? menu ----------

export function initHelpMenu() {
    const menu = document.getElementById('help-menu');
    if (!menu) return;
    const toggle = menu.querySelector('[data-help-toggle]');
    toggle.addEventListener('click', () => {
        const willOpen = !menu.classList.contains('open');
        document.querySelectorAll('.toolbar-dropdown.open').forEach(d => d.classList.remove('open'));
        menu.classList.toggle('open', willOpen);
        if (willOpen) {
            // Under the button, kept inside the window (the button is at its right end).
            const r = toggle.getBoundingClientRect();
            const list = menu.querySelector('.toolbar-menu');
            list.style.left = `${Math.max(8, Math.min(r.left, window.innerWidth - list.offsetWidth - 8))}px`;
            list.style.top = `${r.bottom + 4}px`;
        }
    });
    menu.querySelector('.toolbar-menu').addEventListener('click', (e) => {
        const item = e.target.closest('[data-help]');
        if (!item) return;
        menu.classList.remove('open');
        runHelp(item.dataset.help);
    });
    // The keys shown in the menu follow the user's shortcuts.
    menu.addEventListener('mouseenter', () => {
        menu.querySelectorAll('[data-help-keys]').forEach(span => {
            const k = keysFor(span.dataset.helpKeys)[0];
            span.textContent = k ? display(k) : '';
        });
    });
}
