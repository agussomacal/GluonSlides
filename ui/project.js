// ============================================================
// ui/project.js — Project lifecycle: create, open, sample, go
// home; recents list; per-project files (macros.tex, .bib);
// project-level settings (dark mode, citation style).
// ============================================================

import { prepareTabFor, projectLoaded, setTabHooks, renderTabs } from './tabs.js';
import { clearBibPages } from '../core/bibPages.js';
import {
    state, pyApi, whenApiReady, parseTexMacros, markDirty, flushPendingSave,
    serializeProject, deserializeProject, currentSnapshot, resetHistory,
    resetProjectState, DEFAULT_TEX_MACROS, applyProjectData, parseProjectContent,
} from '../core/state.js';
import { escapeHtml, syncProjectChrome, syncThemeToggle } from '../core/render.js';
import { setBibSource, CITATION_STYLES } from '../core/citations.js';
import { clearFigureCache, hydrateFigures } from '../elements/figure/figure.js';
import { renderEditor } from '../editor/editor.js';
import { loadImportedLibraries } from '../core/macros.js';
import { loadProjectFonts } from '../core/fonts.js';
import { tourOnFirstUse } from './tour.js';
import { TUTORIAL_GL } from './tutorial.js';

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

function renderRecents(message = null) {
    const ul = document.getElementById('project-list');
    if (!ul) return;
    ul.innerHTML = '';
    if (message) {
        ul.innerHTML = `<li class="project-item project-item-message">${escapeHtml(message)}</li>`;
        return;
    }

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

const RECENTS_QUICK_WAIT_MS = 3000;   // then show "No recent projects" meanwhile
const RECENTS_LONG_WAIT_MS = 60000;   // keep waiting for a slow bridge this long

/** get_recent_projects, retried a few times if the bridge hiccups. */
async function fetchRecents(api) {
    for (let attempt = 1; attempt <= 4; attempt++) {
        try {
            const res = await api.get_recent_projects();
            if (res && res.success && Array.isArray(res.projects)) return res.projects;
        } catch (e) {
            console.warn(`Could not load recent projects (attempt ${attempt}):`, e);
        }
        await new Promise(r => setTimeout(r, 250 * attempt));
    }
    return null;
}

/**
 * Shows the recent projects. Waits for the Python bridge, which may
 * become ready only after the page has started (see whenApiReady).
 */
export async function initRecents() {
    const hasList = Array.isArray(state.recents) && state.recents.length > 0;
    if (!hasList) renderRecents('Loading recent projects…');

    let api = await whenApiReady(RECENTS_QUICK_WAIT_MS);
    if (!api) {
        renderRecents(); // "No recent projects found" (e.g. browser preview)...
        api = await whenApiReady(RECENTS_LONG_WAIT_MS); // ...but a slow bridge still counts
        if (!api) return;
    }
    const projects = await fetchRecents(api);
    if (projects) state.recents = projects;
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
    projectLoaded();
    tourOnFirstUse(); // the quick tour, the first time in the app
}

// Tabs (ui/tabs.js): a tab's project shown again (its history kept), or the start screen.
setTabHooks({
    enter() {
        clearBibPages();
        loadProjectFonts();
        syncProjectChrome();
        document.dispatchEvent(new CustomEvent('project-switched'));
        showView('editor-view');
        renderEditor();
    },
    start() {
        showView('welcome-view');
        renderRecents();
        renderTabs();
    },
});

/**
 * Creates a project. With the Python API this asks for a parent folder,
 * creates `<folder>/<name>/<name>.gl` plus macros.tex and an empty
 * bibliography. Returns { success, error? }.
 */
export async function createProject(name, parent = null) {
    await prepareTabFor();
    clearFigureCache();
    const api = await whenApiReady(RECENTS_QUICK_WAIT_MS);
    if (!api) {
        resetProjectState({ name: name || 'Untitled Project' });
        enterEditor();
        return { success: true };
    }

    const res = await api.create_project(name, parent);
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
            const api = await whenApiReady();
            if (!api) {
                alert('Could not open project: the app is not ready yet. Please try again.');
                return;
            }
            const res = await api.load_project_at(path);
            if (!res || !res.success) {
                alert(`Could not open project: ${res ? res.error : 'Unknown error'}`);
                return;
            }
            content = res.content;
        }
        // Open already: its tab. Otherwise a new tab if a project is open.
        if (await prepareTabFor(path)) return;
        clearFigureCache();
        resetProjectState({ path, folder: path.replace(/[/\\][^/\\]+$/, '') });
        deserializeProject(content);

        await Promise.all([
            loadTexMacrosFromDisk(),
            loadBibFromDisk(),
            loadImportedLibraries(), // element macros from e.g. macros.gl
        ]);
        await hydrateFigures([...state.slides, ...(state.masters || []), ...macroSlides()], state.projectFolder);

        addRecent(state.projectName, path);
        enterEditor();
    } catch (e) {
        alert(`Could not open project: ${e.message}`);
    }
}

export async function openProjectFromFile() {
    // Pressed right after start: wait for the bridge instead of falling
    // back to the browser-preview sample.
    const api = await whenApiReady(RECENTS_QUICK_WAIT_MS);
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

export async function openSampleProject() {
    await prepareTabFor();
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

/** The tutorial presentation (ui/tutorial.js), in a tab of its own; not saved anywhere. */
export async function openTutorialProject() {
    await prepareTabFor();
    clearFigureCache();
    resetProjectState({ name: 'GluonSlides tutorial' });
    applyProjectData(parseProjectContent(TUTORIAL_GL));
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
