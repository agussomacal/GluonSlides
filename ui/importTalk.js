// ============================================================
// ui/importTalk.js — "Import talk…": a Beamer .tex, a Slidev slides.md (or a
// .zip of either), a PowerPoint .pptx or a PDF becomes a new project.
// Files can be chosen (several at once: a talk split over many files),
// a folder, or dropped on the dialog; a compiled PDF among them (or next
// to the main file) is used to check the layout (groundtruth.py).
//
// The backend (backend/importers/) converts the file, copies figures into
// the new project folder and returns slides and elements; this module
// builds the project from them, writes the .gl, macros.tex and
// bibliography.bib, and opens it like any other project.
// ============================================================

import { state, whenApiReady, ensureIds, serializeProject, resetProjectState, flashSaveIndicator } from '../core/state.js';
import { openProjectByPath } from './project.js';
import { escapeHtml } from '../core/render.js';
import { registerDropZone } from '../editor/fileDrop.js';
import { progressBar } from './busy.js';

/** import_talk with a progress bar in the dialog (the backend reports how far it is). */
async function importWithProgress(api, source, folder, name, options) {
    const status = $('import-status');
    progressBar(status, { stage: 'Importing' });
    const poll = setInterval(async () => {
        if (typeof api.import_progress !== 'function') return;
        try {
            const p = await api.import_progress();
            if (p && p.success && p.stage) progressBar(status, p);
        } catch (e) { /* the bar just stays */ }
    }, 250);
    try {
        return await api.import_talk(source, folder, name, options);
    } finally {
        clearInterval(poll);
    }
}

const $ = (id) => document.getElementById(id);
let chosen = { sources: [], folder: '' };

const fileName = (path) => String(path || '').split(/[/\\]/).filter(Boolean).pop() || '';
const extOf = (path) => (fileName(path).match(/\.(\w+)$/) || [, ''])[1].toLowerCase();

function baseName(path) {
    return fileName(path).replace(/\.(tex|zip|pptx|pdf|md)$/i, '').replace(/[_]+/g, ' ').trim();
}

/** A name for the project: the main-looking file (or the folder / zip). */
function suggestedName(paths) {
    const pick = paths.find(p => /\.(zip|pptx)$/i.test(p)) || paths.find(p => !/\.\w+$/.test(fileName(p)))
        || paths.find(p => /^(main|slides|talk|presentation)\.(tex|md)$/i.test(fileName(p)))
        || paths.find(p => /\.(tex|md)$/i.test(p)) || paths[0];
    const name = baseName(pick);
    return /^(main|slides|talk|presentation)$/i.test(name) && pick.split(/[/\\]/).length > 1
        ? fileName(pick.slice(0, pick.length - fileName(pick).length)) || name  // its folder's name
        : name;
}

function setSources(paths) {
    const fresh = paths.filter(p => p && !chosen.sources.includes(p));
    if (!fresh.length) return;
    chosen.sources = [...chosen.sources, ...fresh];
    if (!$('import-name').value.trim()) $('import-name').value = suggestedName(chosen.sources);
    $('import-error').textContent = '';
    refresh();
}

function refresh() {
    const list = $('import-source');
    list.innerHTML = chosen.sources.map((p, i) => `
        <li><span class="import-source-name" title="${escapeHtml(p)}">${/\.\w+$/.test(fileName(p)) ? '📄' : '📁'} ${escapeHtml(fileName(p))}</span>
        <button class="import-source-remove" data-remove-source="${i}" title="Remove">×</button></li>`).join('');
    const exts = chosen.sources.map(extOf);
    const onlyPdf = exts.length > 0 && exts.every(e => e === 'pdf');
    const source = exts.some(e => ['tex', 'md', 'zip', ''].includes(e));
    $('import-folder').textContent = chosen.folder || 'No folder selected';
    $('import-pdf-options').hidden = !onlyPdf;
    $('import-use-pdf-row').hidden = !source;
    const name = $('import-name').value.trim();
    $('import-go').disabled = !(chosen.sources.length && chosen.folder && name);
}

export function showImportModal() {
    chosen = { sources: [], folder: '' };
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
    const res = typeof api.select_import_files === 'function' ? await api.select_import_files() : await api.select_import_file();
    if (res && res.success) setSources(res.paths || (res.path ? [res.path] : []));
}

export async function chooseImportSourceFolder() {
    const api = await whenApiReady(3000);
    if (!api || typeof api.select_import_folder !== 'function') return;
    const res = await api.select_import_folder();
    if (res && res.success) setSources(res.paths || []);
}

const importOpen = () => Boolean($('import-modal') && $('import-modal').classList.contains('show'));

// Files dropped on the window while this dialog is open are the talk to import.
registerDropZone(importOpen, (items) => {
    const paths = items.map(it => it.path).filter(Boolean);
    if (!paths.length) {
        $('import-error').textContent = 'Their location is unknown here: use “Choose Files...”.';
        return;
    }
    setSources(paths);
});

document.addEventListener('click', (e) => {
    const b = e.target.closest && e.target.closest('[data-remove-source]');
    if (!b) return;
    chosen.sources.splice(Number(b.dataset.removeSource), 1);
    refresh();
});

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
    const usePdf = $('import-use-pdf').checked;
    const source = chosen.sources.length === 1 ? chosen.sources[0] : chosen.sources;
    $('import-error').textContent = '';
    $('import-status').textContent = 'Importing…';
    $('import-go').disabled = true;
    try {
        let res = await importWithProgress(api, source, chosen.folder, name, { pdfMode, usePdf });
        if (res && !res.success && res.needs_extra) {
            // PDF import needs an extra component, downloaded once (asked first).
            $('import-status').textContent = '';
            if (!await askDownloadExtra(api, res)) {
                $('import-error').textContent = 'PDF import needs the extra component; nothing was imported.';
                refresh();
                return;
            }
            $('import-status').textContent = 'Importing…';
            res = await importWithProgress(api, source, chosen.folder, name, { pdfMode, usePdf });
        }
        if (!res || !res.success) throw new Error((res && res.error) || 'Import failed');
        const path = await buildImportedProject(api, res, name);
        const warnings = res.project.warnings || [];
        $('import-status').textContent = '';
        const gt = res.project.groundTruth;
        const opened = async () => {
            await openProjectByPath(path);
            if (gt) flashSaveIndicator(`Layout checked against ${gt.pdf} ✓ (${gt.slides} slides)`);
        };
        if (warnings.length) {
            // Show what to check, then open on "Open project".
            $('import-warnings').innerHTML = `<p>Imported ${res.project.slides.length} slides. Worth checking:</p><ul>${warnings.slice(0, 12).map(w => `<li>${escapeHtml(w)}</li>`).join('')}${warnings.length > 12 ? `<li>… and ${warnings.length - 12} more</li>` : ''}</ul>`;
            $('import-go').textContent = 'Open project';
            $('import-go').disabled = false;
            $('import-go').onclick = () => { closeImport(); opened(); };
            return;
        }
        closeImport();
        await opened();
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
