// ============================================================
// ui/project.js — Project lifecycle: create, open, sample, go
// home; recents list; per-project files (macros.tex, .bib);
// project-level settings (dark mode, citation style).
// ============================================================

import {
    state, pyApi, parseTexMacros, markDirty, flushPendingSave,
    serializeProject, deserializeProject, currentSnapshot, resetHistory,
    resetProjectState, DEFAULT_TEX_MACROS,
} from '../core/state.js';
import { escapeHtml, syncProjectChrome, syncThemeToggle } from '../core/render.js';
import { setBibSource, CITATION_STYLES } from '../core/citations.js';
import { clearFigureCache, hydrateFigures } from '../elements/figure/figure.js';
import { renderEditor } from '../editor/editor.js';
import { loadImportedLibraries } from '../core/macros.js';
import { loadProjectFonts } from '../core/fonts.js';

/** Macro definitions shaped like slides, so their figures load too. */
function macroSlides() {
    return Object.values(state.macros || {}).map(m => ({ elements: m.children || [] }));
}

// ---------- Views ----------

export function showView(viewId) {
    document.querySelectorAll('.view').forEach(v => {
        const active = v.id === viewId;
        v.classList.toggle('active', active);
        v.style.display = active ? 'flex' : 'none';
    });
}

// ---------- Recents ----------

function renderRecents() {
    const ul = document.getElementById('project-list');
    if (!ul) return;
    ul.innerHTML = '';

    const recents = Array.isArray(state.recents) ? state.recents.filter(r => r && r.path) : [];
    recents.forEach(r => {
        const li = document.createElement('li');
        li.className = 'project-item';
        li.innerHTML = `<span>${escapeHtml(r.name || 'Untitled')}</span>`
            + `<span class="project-item-path">${escapeHtml(r.path)}</span>`;
        li.addEventListener('click', () => openProjectByPath(r.path));
        ul.appendChild(li);
    });
    if (recents.length === 0) {
        ul.innerHTML = '<li class="project-item" style="cursor: default;">No recent projects found</li>';
    }
}

export async function initRecents() {
    const api = pyApi();
    if (api) {
        try {
            const res = await api.get_recent_projects();
            if (res && res.success && Array.isArray(res.projects)) state.recents = res.projects;
        } catch (e) {
            console.error('Could not load recent projects:', e);
        }
    }
    renderRecents();
}

function addRecent(name, path) {
    if (!path) return;
    state.recents = [{ name: name || 'Untitled', path }, ...(state.recents || []).filter(r => r && r.path !== path)]
        .slice(0, 10);
    const api = pyApi();
    if (api) {
        api.add_recent_project(name, path).then(initRecents).catch(renderRecents);
    } else {
        renderRecents();
    }
}

// ---------- Per-project side files ----------

async function saveMacrosFiles() {
    const api = pyApi();
    if (!api || !state.projectFolder) return;
    await api.save_text_file(state.projectFolder, 'macros.tex', state.rawTexMacros);
    await api.save_text_file(state.projectFolder, 'macros.json', JSON.stringify(state.projectMacros, null, 2));
}

async function loadTexMacrosFromDisk() {
    const api = pyApi();
    const res = api && state.projectFolder
        ? await api.load_text_file(state.projectFolder, 'macros.tex').catch(() => null)
        : null;
    state.rawTexMacros = res && res.success ? res.content : DEFAULT_TEX_MACROS;
    state.projectMacros = parseTexMacros(state.rawTexMacros);
    if (api && state.projectFolder && !(res && res.success)) await saveMacrosFiles();
}

async function loadBibFromDisk() {
    const api = pyApi();
    const res = api && state.projectFolder
        ? await api.load_text_file(state.projectFolder, 'bibliography.bib').catch(() => null)
        : null;
    setBibSource(res && res.success ? res.content : '');
}

/** Applies new macros text and writes macros.tex/.json. */
export async function setMacros(text) {
    state.rawTexMacros = text;
    state.projectMacros = parseTexMacros(text);
    markDirty();
    await saveMacrosFiles();
    renderEditor();
}

/** Applies new BibTeX text and writes bibliography.bib. */
export async function setBibliography(text) {
    setBibSource(text);
    markDirty();
    const api = pyApi();
    if (api && state.projectFolder) {
        await api.save_text_file(state.projectFolder, 'bibliography.bib', state.rawBib);
    }
    renderEditor();
}

// ---------- Lifecycle ----------

/** Shows the editor for the project now in state, as "clean". */
function enterEditor() {
    loadProjectFonts(); // <project>/fonts/ (none for new/sample projects)
    state.lastSnapshot = currentSnapshot();
    state.isDirty = false;
    resetHistory();
    syncProjectChrome();
    showView('editor-view');
    renderEditor();
}

/**
 * Creates a project. With the Python API this asks for a parent folder,
 * creates `<folder>/<name>/<name>.gl` plus macros.tex and an empty
 * bibliography. Returns { success, error? }.
 */
export async function createProject(name) {
    clearFigureCache();
    const api = pyApi();
    if (!api) {
        resetProjectState({ name: name || 'Untitled Project' });
        enterEditor();
        return { success: true };
    }

    const res = await api.create_project(name);
    if (!res || !res.success) return { success: false, error: res ? res.error : 'Creation failed' };

    // Reset *before* the first save so the new file never contains the
    // previously opened project.
    resetProjectState({ name: name || 'Untitled Project', path: res.path, folder: res.folder });
    await saveMacrosFiles();
    await api.save_text_file(state.projectFolder, 'bibliography.bib', '');

    const saveRes = await api.save_project_data(state.projectPath, serializeProject());
    if (!saveRes || !saveRes.success) return { success: false, error: saveRes ? saveRes.error : 'Save failed' };

    addRecent(state.projectName, state.projectPath);
    enterEditor();
    return { success: true };
}

export async function openProjectByPath(path, content) {
    try {
        if (!content) {
            const res = await pyApi().load_project_at(path);
            if (!res || !res.success) {
                alert(`Could not open project: ${res ? res.error : 'Unknown error'}`);
                return;
            }
            content = res.content;
        }
        await flushPendingSave();
        clearFigureCache();
        resetProjectState({ path, folder: path.replace(/[/\\][^/\\]+$/, '') });
        deserializeProject(content);

        await Promise.all([
            loadTexMacrosFromDisk(),
            loadBibFromDisk(),
            loadImportedLibraries(), // element macros from e.g. macros.gl
        ]);
        await hydrateFigures([...state.slides, ...macroSlides()], state.projectFolder);

        addRecent(state.projectName, path);
        enterEditor();
    } catch (e) {
        alert(`Could not open project: ${e.message}`);
    }
}

export async function openProjectFromFile() {
    const api = pyApi();
    if (!api) {
        openSampleProject();
        return;
    }
    const res = await api.load_project();
    if (!res || !res.success) {
        if (res && res.error !== 'Cancelled') alert(`Could not open project: ${res.error}`);
        return;
    }
    await openProjectByPath(res.path, res.content);
}

export function openSampleProject() {
    clearFigureCache();
    resetProjectState({ name: 'Sample Presentation' });
    state.slides[0].title = 'Introduction';
    state.slides[0].elements.push({
        id: state.nextId++,
        type: 'text',
        x: 200, y: 200, width: 800, height: 160,
        content: 'Welcome to GluonSlides with **Markdown** and LaTeX: $E = mc^2$',
        fontSize: 42,
        fontFamily: 'sans-serif',
        fontColor: '#0f172a',
        textAlign: 'center',
        verticalAlign: 'center',
        bg: 'transparent',
        borderCol: 'transparent',
        borderWidth: 0,
        borderStyle: 'solid',
    });
    enterEditor();
}

export async function goToHome() {
    await flushPendingSave();
    showView('welcome-view');
    initRecents();
}

// ---------- Project-level settings ----------

export function toggleDarkMode() {
    state.isDarkMode = !state.isDarkMode;
    syncThemeToggle();
    markDirty();
    renderEditor();
}

export function changeCitestyle(value) {
    state.citestyle = CITATION_STYLES.includes(value) ? value : 'numeric';
    markDirty();
    renderEditor();
}
