// ============================================================
// ui/importTalk.js — "Import talk…": a Beamer .tex (or a .zip of it, as
// Overleaf exports), a PowerPoint .pptx or a PDF becomes a new project.
//
// The backend (backend/importers/) converts the file, copies figures into
// the new project folder and returns slides and elements; this module
// builds the project from them, writes the .gl, macros.tex and
// bibliography.bib, and opens it like any other project.
// ============================================================

import { state, whenApiReady, ensureIds, serializeProject, resetProjectState } from '../core/state.js';
import { openProjectByPath } from './project.js';
import { escapeHtml } from '../core/render.js';

const $ = (id) => document.getElementById(id);
let chosen = { source: '', folder: '' };

function baseName(path) {
    return String(path || '').split(/[/\\]/).pop().replace(/\.(tex|zip|pptx|pdf)$/i, '').replace(/[_]+/g, ' ').trim();
}

function refresh() {
    const ext = (chosen.source.match(/\.(\w+)$/) || [, ''])[1].toLowerCase();
    $('import-source').textContent = chosen.source || 'No file chosen';
    $('import-folder').textContent = chosen.folder || 'No folder selected';
    $('import-pdf-options').hidden = ext !== 'pdf';
    const name = $('import-name').value.trim();
    $('import-go').disabled = !(chosen.source && chosen.folder && name);
}

export function showImportModal() {
    chosen = { source: '', folder: '' };
    $('import-name').value = '';
    $('import-error').textContent = '';
    $('import-warnings').innerHTML = '';
    $('import-status').textContent = '';
    refresh();
    $('import-modal').classList.add('show');
}

export async function chooseImportSource() {
    const api = await whenApiReady(3000);
    if (!api) return;
    const res = await api.select_import_file();
    if (res && res.success && res.path) {
        chosen.source = res.path;
        if (!$('import-name').value.trim()) $('import-name').value = baseName(res.path);
        refresh();
    }
}

export async function chooseImportFolder() {
    const api = await whenApiReady(3000);
    if (!api) return;
    const res = await api.select_folder();
    if (res && res.success) {
        chosen.folder = res.path;
        refresh();
    }
}

export function onImportNameInput() {
    refresh();
}

/** Builds and saves the project from an import result; returns the .gl path. */
export async function buildImportedProject(api, result, name) {
    const p = result.project;
    resetProjectState({ name, path: result.path, folder: result.folder });
    state.slideWidth = p.width || state.slideWidth;
    state.slideHeight = p.height || state.slideHeight;
    if (p.author) state.author = p.author;
    if (p.date) state.date = p.date;
    // Masters with nothing on them are dropped (and slides that named them show none).
    const masters = (p.masters || []).filter(m => (m.elements || []).length);
    const names = new Set(masters.map(m => m.name));
    state.masters = masters.map(m => ({ name: m.name, elements: m.elements }));
    state.slides = (p.slides || []).map(s => {
        const slide = { title: s.title || 'Slide', elements: s.elements || [] };
        if (s.section) slide.section = s.section;
        if (s.notes) slide.notes = s.notes;
        if (s.master && s.master !== 'none' && !names.has(s.master)) slide.master = 'none';
        else if (s.master && masters.length && s.master !== masters[0].name) slide.master = s.master;
        else if (s.master === 'none' && masters.length) slide.master = 'none';
        return slide;
    });
    ensureIds();
    if (p.macros) await api.save_text_file(result.folder, 'macros.tex', p.macros);
    await api.save_text_file(result.folder, 'bibliography.bib', p.bib || '');
    const saved = await api.save_project_data(result.path, serializeProject());
    if (!saved || !saved.success) throw new Error((saved && saved.error) || 'Could not save the project');
    return result.path;
}

export async function confirmImport() {
    const api = await whenApiReady(3000);
    if (!api) return;
    const name = $('import-name').value.trim();
    const pdfMode = (document.querySelector('input[name="import-pdf-mode"]:checked') || {}).value || 'editable';
    $('import-error').textContent = '';
    $('import-status').textContent = 'Importing…';
    $('import-go').disabled = true;
    try {
        let res = await api.import_talk(chosen.source, chosen.folder, name, { pdfMode });
        if (res && !res.success && res.needs_extra) {
            // PDF import needs an extra component, downloaded once (asked first).
            $('import-status').textContent = '';
            if (!await askDownloadExtra(api, res)) {
                $('import-error').textContent = 'PDF import needs the extra component; nothing was imported.';
                refresh();
                return;
            }
            $('import-status').textContent = 'Importing…';
            res = await api.import_talk(chosen.source, chosen.folder, name, { pdfMode });
        }
        if (!res || !res.success) throw new Error((res && res.error) || 'Import failed');
        const path = await buildImportedProject(api, res, name);
        const warnings = res.project.warnings || [];
        $('import-status').textContent = '';
        if (warnings.length) {
            // Show what to check, then open on "Open project".
            $('import-warnings').innerHTML = `<p>Imported ${res.project.slides.length} slides. Worth checking:</p><ul>${warnings.slice(0, 12).map(w => `<li>${escapeHtml(w)}</li>`).join('')}${warnings.length > 12 ? `<li>… and ${warnings.length - 12} more</li>` : ''}</ul>`;
            $('import-go').textContent = 'Open project';
            $('import-go').disabled = false;
            $('import-go').onclick = () => { closeImport(); openProjectByPath(path); };
            return;
        }
        closeImport();
        await openProjectByPath(path);
    } catch (e) {
        $('import-status').textContent = '';
        $('import-error').textContent = e.message;
        refresh();
    }
}

function closeImport() {
    $('import-modal').classList.remove('show');
    $('import-go').textContent = 'Import';
    $('import-go').onclick = null;
}

/** Asks before downloading the PDF component; downloads it. */
async function askDownloadExtra(api, res) {
    const box = $('import-extra');
    box.hidden = false;
    box.querySelector('.import-extra-text').textContent = res.extra_message || 'PDF import needs an extra component. Download it now?';
    const answer = await new Promise(resolve => {
        box.querySelector('[data-extra="yes"]').onclick = () => resolve(true);
        box.querySelector('[data-extra="no"]').onclick = () => resolve(false);
    });
    box.hidden = true;
    if (!answer) return false;
    $('import-status').textContent = 'Downloading the PDF component…';
    const got = await api.install_extra(res.needs_extra);
    $('import-status').textContent = '';
    if (!got || !got.success) {
        $('import-error').textContent = (got && got.error) || 'Download failed';
        return false;
    }
    return true;
}
