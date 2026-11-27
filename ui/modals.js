// ============================================================
// ui/modals.js — The New Project, LaTeX macros and Bibliography
// dialogs. Each modal is a `.modal-backdrop` in index.html.
// ============================================================

import { state, pyApi, whenApiReady } from '../core/state.js';
import { createProject, setMacros, setBibliography } from './project.js';
import { missingCitationKeys } from '../core/citations.js';
import { escapeHtml } from '../core/render.js';
import { loadPrefs, defaultProjectFolder, rememberProjectFolder } from '../core/prefs.js';

const $ = (id) => document.getElementById(id);

function showModal(id) {
    $(id).classList.add('show');
}

export function closeModal(id) {
    $(id).classList.remove('show');
}

// ---------- New project ----------

let newProjectFolder = '';
let newProjectFolderChosen = false;

function setNewProjectFolder(folder) {
    newProjectFolder = folder || '';
    newProjectFolderChosen = Boolean(folder);
    $('new-project-folder').textContent = folder || 'No folder selected';
}

export function showNewProjectModal() {
    $('new-project-name').value = '';
    $('new-project-error').textContent = '';
    $('new-project-create-btn').disabled = true;
    // Where projects were last created or imported (can be changed).
    setNewProjectFolder(defaultProjectFolder());
    loadPrefs().then(() => {
        if (!newProjectFolderChosen && defaultProjectFolder()) {
            setNewProjectFolder(defaultProjectFolder());
            validateNewProjectForm();
        }
    });
    showModal('new-project-modal');
    $('new-project-name').focus();
}

export function validateNewProjectForm() {
    const name = $('new-project-name').value.trim();
    const err = $('new-project-error');
    // Without the Python API there is no folder dialog (browser preview).
    const folderOk = newProjectFolderChosen || !pyApi();
    err.textContent = name && !folderOk ? 'Pick a folder for the project.' : '';
    $('new-project-create-btn').disabled = !(name && folderOk);
}

export async function chooseNewProjectFolder() {
    const api = await whenApiReady(3000);
    if (!api) {
        $('new-project-folder').textContent = '(dialog unavailable in browser preview)';
        validateNewProjectForm();
        return;
    }
    const res = await api.select_folder(newProjectFolder || null);
    if (res && res.success) {
        setNewProjectFolder(res.path);
        validateNewProjectForm();
    }
}

export async function confirmCreateProject() {
    const res = await createProject($('new-project-name').value.trim(), newProjectFolder || null);
    if (res.success) {
        rememberProjectFolder(newProjectFolder);
        closeModal('new-project-modal');
    } else {
        $('new-project-error').textContent = res.error;
    }
}

// ---------- LaTeX macros ----------

export function openMacrosModal() {
    $('macros-textarea').value = state.rawTexMacros;
    $('macros-error').textContent = '';
    showModal('macros-modal');
}

export async function saveMacros() {
    try {
        await setMacros($('macros-textarea').value);
        closeModal('macros-modal');
    } catch (e) {
        $('macros-error').textContent = `Parsing error: ${e.message}`;
    }
}

// ---------- Bibliography ----------

export function openBibModal() {
    $('bib-textarea').value = state.rawBib || '';
    $('bib-error').textContent = '';
    updateMissingCitations();
    showModal('bib-modal');
}

/**
 * Cited keys that are not in the bibliography: a count on the sidebar
 * button and the list in the dialog. Runs after every editor render.
 */
export function updateMissingCitations() {
    const missing = missingCitationKeys();
    const badge = $('bib-warning');
    if (badge) {
        badge.hidden = missing.length === 0;
        badge.textContent = `⚠ ${missing.length}`;
        badge.title = missing.length ? `Cited but not in bibliography.bib: ${missing.join(', ')}` : '';
    }
    const box = $('bib-missing');
    if (box) {
        box.hidden = missing.length === 0;
        box.innerHTML = missing.length
            ? `⚠ Cited in the slides but not defined here: ${missing.map(k => `<code>${escapeHtml(k)}</code>`).join(', ')}`
            : '';
    }
}
document.addEventListener('editor-rendered', updateMissingCitations);
document.addEventListener('bibliography-changed', updateMissingCitations);

export async function saveBib() {
    try {
        await setBibliography($('bib-textarea').value);
        closeModal('bib-modal');
    } catch (e) {
        $('bib-error').textContent = `Parsing error: ${e.message}`;
    }
}
