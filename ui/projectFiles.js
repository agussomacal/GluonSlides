// ============================================================
// ui/projectFiles.js — 🗂 Project files (the sidebar): every file of the
// project's figures/ and data/ folders, what uses each (a click goes to
// it), the ones nothing uses, and the same file twice (same content:
// backend/projectfiles.py). Open a file or its folder with the system;
// merge a duplicate (what uses it then uses the other copy, and it is
// deleted); delete the ticked files (asks once more). The sidebar button
// shows how many could be cleaned up.
// ============================================================

import { state, pyApi, markDirty, flashSaveIndicator, forEachElementDeep, serializeProject } from '../core/state.js';
import { escapeHtml } from '../core/render.js';
import { linkedCopies } from '../core/projectLinks.js';

const MODAL_ID = 'project-files-modal';
const ui = { files: null, ticked: new Set(), confirm: false, error: '' };

const size = (n) => (n < 1024 ? `${n} B` : n < 1048576 ? `${(n / 1024).toFixed(0)} KB` : `${(n / 1048576).toFixed(1)} MB`);
const LABELS = { figure: 'figure', table: 'table', plot: 'plot', choice: 'choice', text: 'text', columns: 'columns', shape: 'shape', group: 'group' };

/** The project's text: a file named there is used. */
export function projectText() {
    let text = '';
    try { text += serializeProject(); } catch (e) { /* the rest still tells */ }
    try { text += JSON.stringify(state.macros || {}) + JSON.stringify(state.varFiles || []); } catch (e) { /* idem */ }
    return text;
}

const pathRe = (path) => new RegExp(`${path.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?![\\w.-])`);

/** What uses `path`: [{ where, id }] (id: an element to go to). */
function usesOf(path) {
    const re = pathRe(path);
    const out = [];
    const visit = (els, where) => forEachElementDeep(els || [], el => {
        let json = '';
        try { json = JSON.stringify(el, (k, v) => (k === 'children' ? undefined : v)); } catch (e) { return; }
        if (re.test(json)) out.push({ where: `${where} · ${LABELS[el.type] || el.type}`, id: el.id, slide: where });
    });
    (state.slides || []).forEach((s, i) => visit(s.elements, `slide ${i + 1}`));
    (state.masters || []).forEach(m => visit(m.elements, `master ${m.name || ''}`.trim()));
    Object.entries(state.macros || {}).forEach(([name, m]) => visit(m.children, `macro ${name}`));
    if ((state.varFiles || []).some(f => f.file === path)) out.push({ where: 'variables (Project settings)', id: null });
    return out;
}

/** What could be cleaned up: files nothing uses, and duplicates. */
function cleanable(files) {
    return files.filter(f => !f.used || f.same_as).length;
}

// ---------- the sidebar button's count ----------

export async function refreshFilesBadge() {
    const btn = document.querySelector('[data-action="open-project-files"]');
    const badge = btn && btn.querySelector('.files-badge');
    const api = pyApi();
    if (!badge) return;
    if (!api || typeof api.list_project_files !== 'function' || !state.projectFolder) { badge.hidden = true; return; }
    try {
        const res = await api.list_project_files(state.projectFolder, projectText());
        const files = (res && res.files || []).map(f => ({ ...f, used: f.named || usesOf(f.path).length > 0 }));
        const n = cleanable(files);
        badge.hidden = !n;
        badge.textContent = `${n} to clean`;
        badge.title = `${n} file${n === 1 ? '' : 's'} in figures/ and data/ nothing uses, or the same file twice`;
    } catch (e) { badge.hidden = true; }
}

// ---------- the dialog ----------

function modal() {
    let m = document.getElementById(MODAL_ID);
    if (!m) {
        m = document.createElement('div');
        m.id = MODAL_ID;
        m.className = 'modal-backdrop';
        m.innerHTML = '<div class="modal project-files"></div>';
        document.body.appendChild(m);
        wire(m);
    }
    return m;
}

async function load() {
    const api = pyApi();
    if (!api || typeof api.list_project_files !== 'function') { ui.error = 'Needs the app (not a browser).'; ui.files = []; return; }
    if (!state.projectFolder) { ui.error = 'Save the project first: it has no folder yet.'; ui.files = []; return; }
    const res = await api.list_project_files(state.projectFolder, projectText());
    if (!res || !res.success) { ui.error = (res && res.error) || 'Could not look.'; ui.files = []; return; }
    ui.error = '';
    ui.files = (res.files || []).map(f => {
        const uses = usesOf(f.path);
        return { ...f, uses, used: uses.length > 0 || f.named };
    });
    ui.ticked = new Set(ui.files.filter(f => !f.used).map(f => f.path));
    ui.confirm = false;
}

function originalOf(path) {
    const link = linkedCopies().find(l => l.copy === path);
    return link ? link.original : '';
}

function row(f) {
    const uses = f.uses.length
        ? f.uses.map(u => (u.id !== null ? `<button type="button" class="pf-use" data-pf-goto="${u.id}" title="Go to it">${escapeHtml(u.where)}</button>` : `<span class="pf-use">${escapeHtml(u.where)}</span>`)).join('')
        : f.named ? '<span class="pf-use">named in the project</span>' : '<span class="pf-unused">unused</span>';
    let dup = '';
    if (f.same_as) {
        const ok = !f.used || (originalOf(f.path) || '') === (originalOf(f.same_as) || '');
        dup = `<span class="pf-dup">⚠ same content as <code>${escapeHtml(f.same_as)}</code></span>${f.used
            ? `<button type="button" class="btn btn-secondary pf-merge" data-pf-merge="${escapeHtml(f.path)}" ${ok ? '' : 'disabled title="They follow different originals: merging would make one follow the other\'s file"'} title="What uses it then uses ${escapeHtml(f.same_as)}, and this copy is deleted">Merge</button>` : ''}`;
    }
    return `<div class="pf-row${f.used ? '' : ' unused'}">
        <label class="pf-tick">${f.used ? '' : `<input type="checkbox" data-pf-tick="${escapeHtml(f.path)}" ${ui.ticked.has(f.path) ? 'checked' : ''}>`}</label>
        <div class="pf-main"><div><code>${escapeHtml(f.path.split('/').slice(1).join('/'))}</code> <span class="prop-hint">${size(f.size)}</span></div>
            <div class="pf-uses">${uses}${dup}</div></div>
        <div class="pf-ops"><button type="button" class="prop-reset" data-pf-open="${escapeHtml(f.path)}" title="Open it">↗</button><button type="button" class="prop-reset" data-pf-folder="${escapeHtml(f.path)}" title="Show in its folder">📁</button></div>
    </div>`;
}

function render() {
    const box = modal().querySelector('.project-files');
    const scroll = box.querySelector('.pf-list')?.scrollTop || 0;
    const files = ui.files || [];
    const section = (sub, title) => {
        const list = files.filter(f => f.path.startsWith(`${sub}/`));
        return `<div class="pf-section"><div class="pf-head"><b>${title}</b> <span class="prop-hint">${list.length} file${list.length === 1 ? '' : 's'}</span>
            <button type="button" class="btn btn-secondary" data-pf-folder="${sub}" title="Open the folder">📁 Open ${sub}/</button></div>
            ${list.map(row).join('') || '<p class="prop-hint">Empty.</p>'}</div>`;
    };
    const n = cleanable(files);
    const total = files.filter(f => ui.ticked.has(f.path)).reduce((a, f) => a + f.size, 0);
    box.innerHTML = `
        <h2>🗂 Project files</h2>
        <p class="prop-hint">The project's <code>figures/</code> and <code>data/</code>: what uses each file, those nothing uses, and the same file twice.${n ? ` <b>${n}</b> could be cleaned up.` : ' Nothing to clean up.'}</p>
        ${ui.error ? `<p class="prop-error">${escapeHtml(ui.error)}</p>` : ''}
        <div class="pf-list">${ui.files === null ? '<p class="prop-hint">Looking…</p>' : `${section('figures', 'Figures')}${section('data', 'Data')}`}</div>
        <div class="modal-actions">
            <button type="button" class="btn ${ui.confirm ? 'btn-danger' : 'btn-secondary'}" data-pf-delete ${ui.ticked.size ? '' : 'disabled'}>${ui.confirm ? `Click again: delete ${ui.ticked.size} file${ui.ticked.size === 1 ? '' : 's'}` : `🗑 Delete the ticked (${ui.ticked.size}, ${size(total)})`}</button>
            <button type="button" class="btn btn-secondary" data-pf-refresh>↻ Look again</button>
            <button type="button" class="btn btn-primary" data-pf-close>Done</button>
        </div>`;
    const list = box.querySelector('.pf-list');
    if (list) list.scrollTop = scroll;
}

/** What uses `from` uses `to` instead (every place the project names it). */
function replaceReferences(from, to) {
    const re = new RegExp(pathRe(from).source, 'g');
    const swap = (v) => {
        if (typeof v === 'string') return v.replace(re, to);
        if (Array.isArray(v)) return v.map(swap);
        if (v && typeof v === 'object') { Object.keys(v).forEach(k => { v[k] = swap(v[k]); }); return v; }
        return v;
    };
    swap(state.slides);
    swap(state.masters);
    swap(state.macros);
    state.varFiles = (state.varFiles || []).filter(f => f.file !== from || !(state.varFiles || []).some(g => g.file === to));
    swap(state.varFiles);
}

async function refresh() {
    ui.files = null;
    render();
    await load();
    render();
    refreshFilesBadge();
}

function wire(m) {
    m.addEventListener('change', (e) => {
        const t = e.target.closest('[data-pf-tick]');
        if (!t) return;
        if (t.checked) ui.ticked.add(t.dataset.pfTick); else ui.ticked.delete(t.dataset.pfTick);
        ui.confirm = false;
        render();
    });
    m.addEventListener('click', async (e) => {
        const api = pyApi();
        const at = (sel) => e.target.closest(sel);
        if (e.target === m || at('[data-pf-close]')) { closeProjectFiles(); return; }
        if (at('[data-pf-refresh]')) { refresh(); return; }
        const go = at('[data-pf-goto]');
        if (go) {
            closeProjectFiles();
            (await import('../editor/navigate.js')).revealElement(Number(go.dataset.pfGoto));
            return;
        }
        const open = at('[data-pf-open]') || at('[data-pf-folder]');
        if (open) {
            const rel = open.dataset.pfOpen || open.dataset.pfFolder;
            const res = await api.open_project_file(state.projectFolder, rel, Boolean(open.dataset.pfFolder));
            if (!res || !res.success) flashSaveIndicator((res && res.error) || 'Could not open it');
            return;
        }
        const merge = at('[data-pf-merge]');
        if (merge) {
            const from = merge.dataset.pfMerge;
            const f = ui.files.find(x => x.path === from);
            if (!f || !f.same_as) return;
            replaceReferences(from, f.same_as);
            markDirty();
            (await import('../editor/editor.js')).renderEditor();
            const res = await api.delete_project_files(state.projectFolder, [from]);
            flashSaveIndicator(res && res.deleted && res.deleted.length ? `${from} merged into ${f.same_as} ✓` : `Now using ${f.same_as}; ${from} could not be deleted`);
            refresh();
            return;
        }
        if (at('[data-pf-delete]')) {
            if (!ui.confirm) { ui.confirm = true; render(); return; }
            const res = await api.delete_project_files(state.projectFolder, [...ui.ticked]);
            const n = res && res.deleted ? res.deleted.length : 0;
            flashSaveIndicator(`${n} file${n === 1 ? '' : 's'} deleted${res && res.errors && res.errors.length ? ` (${res.errors.length} not: ${res.errors[0]})` : ''}`);
            refresh();
        }
    });
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && m.classList.contains('show')) closeProjectFiles();
    });
}

export async function openProjectFiles() {
    modal().classList.add('show');
    await refresh();
}

export function closeProjectFiles() {
    modal().classList.remove('show');
}

// the button's count: now and then while editing, and when a project opens
let timer = null;
export function startFilesBadge(intervalMs = 20000) {
    if (timer) return;
    const tick = () => {
        const editor = document.getElementById('editor-view');
        if (editor && editor.classList.contains('active') && !document.hidden) refreshFilesBadge();
    };
    timer = setInterval(tick, intervalMs);
    document.addEventListener('project-switched', () => setTimeout(refreshFilesBadge, 500));
    setTimeout(tick, 1500);
}
