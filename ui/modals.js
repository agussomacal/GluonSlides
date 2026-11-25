// ============================================================
// ui/modals.js — The New Project, LaTeX macros and Bibliography
// dialogs. Each modal is a `.modal-backdrop` in index.html.
// ============================================================

import { state, pyApi, whenApiReady } from '../core/state.js';
import { createProject, setMacros, setBibliography } from './project.js';

const $ = (id) => document.getElementById(id);

function showModal(id) {
    $(id).classList.add('show');
}

export function closeModal(id) {
    $(id).classList.remove('show');
}

// ---------- New project ----------

let newProjectFolderChosen = false;

export function showNewProjectModal() {
    $('new-project-name').value = '';
    $('new-project-folder').textContent = 'No folder selected';
    $('new-project-error').textContent = '';
    $('new-project-create-btn').disabled = true;
    newProjectFolderChosen = false;
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
    const res = await api.select_folder();
    if (res && res.success) {
        newProjectFolderChosen = true;
        $('new-project-folder').textContent = res.path;
        validateNewProjectForm();
    }
}

export async function confirmCreateProject() {
    const res = await createProject($('new-project-name').value.trim());
    if (res.success) {
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
    showModal('bib-modal');
}

export async function saveBib() {
    try {
        await setBibliography($('bib-textarea').value);
        closeModal('bib-modal');
    } catch (e) {
        $('bib-error').textContent = `Parsing error: ${e.message}`;
    }
}
