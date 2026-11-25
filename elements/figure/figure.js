// ============================================================
// elements/figure/figure.js — Figure/image element.
// Stores only paths in .gl and in state. Image data lives in an
// in-memory cache keyed by path (see figureSrc / hydrateFigures), so
// snapshots and undo history never carry base64 payloads.
// ============================================================

import { state, pyApi, markDirty } from '../../core/state.js';
import { ElementRegistry } from '../../core/registry.js';
import { escapeHtml } from '../../core/render.js';

function notifyFullRender() {
    document.dispatchEvent(new CustomEvent('slide-content-changed'));
}

function notifyThumbnailOnly() {
    document.dispatchEvent(new CustomEvent('slide-thumbnail-changed'));
}

async function processAndAssignFigure(elIndex, filePath) {
    const api = pyApi();
    if (api && state.projectFolder) {
        const res = await api.import_figure(state.projectFolder, filePath);
        if (res && res.success) {
            assignFigureSource(elIndex, res.data_uri, filePath, res.relative_path);
            return;
        }
    }
    assignFigureSource(elIndex, filePath, filePath, filePath);
}

// ---------- Image cache (path -> data URI / URL) ----------

const figureSources = new Map();

function figureKey(el) {
    return el.filePath || el.originalPath || '';
}

/** Displayable src for a figure element ('' if not loaded yet). */
export function figureSrc(el) {
    return figureSources.get(figureKey(el)) || '';
}

function assignFigureSource(elIndex, src, originalPath, storedPath) {
    const slide = state.slides[state.currentSlideIndex];
    if (!slide || !slide.elements[elIndex]) return;

    const el = slide.elements[elIndex];
    el.originalPath = originalPath || '';
    el.filePath = storedPath || '';
    el.borderStyle = 'solid';
    if (src) figureSources.set(figureKey(el), src);
    markDirty();
    notifyFullRender();
}

async function handleFigureDrop(e, elIndex) {
    e.preventDefault();
    e.stopPropagation();
    if (e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files.length > 0) {
        const file = e.dataTransfer.files[0];
        if (file.path) {
            await processAndAssignFigure(elIndex, file.path);
        } else {
            const reader = new FileReader();
            reader.onload = () => {
                assignFigureSource(elIndex, String(reader.result || ''), file.name, file.name);
            };
            reader.readAsDataURL(file);
        }
    }
}

async function browseFigurePath(elIndex) {
    const api = pyApi();
    if (api) {
        const res = await api.select_figure_file();
        if (res && res.success && res.path) {
            await processAndAssignFigure(elIndex, res.path);
        }
    } else {
        const path = prompt('Enter path or URL to figure:');
        if (path) assignFigureSource(elIndex, path, path, path);
    }
}

async function openPathInSystem(fullPath) {
    if (!fullPath) return;
    const folderPath = fullPath.replace(/[/\\][^/\\]*$/, '');
    const api = pyApi();
    if (api) {
        await api.open_file_with_system(folderPath);
    } else {
        alert('Folder Path: ' + folderPath);
    }
}

function absoluteLocalPath(localPath) {
    if (state.projectFolder && localPath
        && !localPath.startsWith('/') && !localPath.match(/^[a-zA-Z]:\\/)) {
        return `${state.projectFolder}/${localPath}`;
    }
    return localPath;
}

/**
 * Loads image data for every figure in `slides` that is not cached yet.
 * Also migrates a legacy in-object `el.src` into the cache.
 */
export async function hydrateFigures(slides, projectFolder) {
    if (!Array.isArray(slides)) return;
    const api = pyApi();
    const pending = new Map();

    for (const slide of slides) {
        for (const el of (slide.elements || [])) {
            if (el.type !== 'figure') continue;
            const key = figureKey(el);
            if (typeof el.src === 'string' && el.src) {
                if (key && !figureSources.has(key)) figureSources.set(key, el.src);
                delete el.src;
            }
            if (key && !figureSources.has(key)) pending.set(key, key);
        }
    }

    await Promise.all([...pending.keys()].map(async (key) => {
        try {
            const res = api && typeof api.load_figure_data_uri === 'function'
                ? await api.load_figure_data_uri(projectFolder || '', key)
                : null;
            // Fall back to the raw path (works for URLs / browser preview).
            figureSources.set(key, res && res.success && res.data_uri ? res.data_uri : key);
        } catch (err) {
            console.warn('Could not load figure:', key, err);
        }
    }));
}

/** Drops cached image data (e.g. when switching projects). */
export function clearFigureCache() {
    figureSources.clear();
}

window.SlideStudioFigure = { browseFigurePath, handleFigureDrop, openPathInSystem };

const FigureElement = {
    type: 'figure',
    label: 'Add Figure',
    icon: '🖼️',
    className: 'element-shape',

    gl: {
        props: [
            'x', 'y', 'width', 'height', 'filePath', 'originalPath',
            'bg', 'borderCol', 'borderWidth', 'borderStyle',
        ],
        numericProps: ['x', 'y', 'width', 'height', 'borderWidth'],
        body: null,
        serializeBody: () => null,
        parseBody: () => {},
    },

    defaults(ctx) {
        const scale = state.slideWidth / 1920;
        return {
            type: 'figure',
            x: 0, y: 0,
            width: Math.round(400 * scale),
            height: Math.round(300 * scale),
            originalPath: '',
            filePath: '',
            bg: state.isDarkMode ? '#1e293b' : '#f1f5f9',
            borderCol: state.isDarkMode ? '#475569' : '#cbd5e1',
            borderWidth: 2,
            borderStyle: 'dashed',
        };
    },

    renderDom(domEl, el, ctx) {
        domEl.style.display = 'flex';
        domEl.style.flexDirection = 'column';
        domEl.style.alignItems = 'center';
        domEl.style.justifyContent = 'center';
        domEl.style.overflow = 'hidden';

        const src = figureSrc(el);
        if (src) {
            domEl.innerHTML = `<img src="${escapeHtml(src)}" style="width: 100%; height: 100%; object-fit: contain; pointer-events: none;" />`;
        } else {
            domEl.innerHTML = `
                <div style="text-align: center; pointer-events: none; padding: 10px;">
                    <span style="font-size: 28px; display: block; margin-bottom: 6px;">🖼️</span>
                    <span style="font-size: 13px; font-weight: 500; color: var(--text-muted);">Drop / Browse Figure</span>
                </div>`;
            if (ctx.context === 'canvas') {
                domEl.onclick = () => browseFigurePath(ctx.elIndex);
            }
        }

        if (ctx.context === 'canvas') {
            domEl.ondragover = (e) => { e.preventDefault(); e.stopPropagation(); };
            domEl.ondrop = (e) => handleFigureDrop(e, ctx.elIndex);
        }
    },

    exportInner(el) {
        const src = figureSrc(el);
        if (src) {
            return `<img src="${escapeHtml(src)}" style="width:100%; height:100%; object-fit:contain;" />`;
        }
        return `<div style="width:100%; height:100%; display:flex; align-items:center; justify-content:center; color:#94a3b8; font-family:sans-serif;">[Figure Placeholder]</div>`;
    },

    properties(el, elIndex) {
        const origPath = el.originalPath || '';
        const localPath = el.filePath || '';
        const absLocalPath = absoluteLocalPath(localPath);

        return `
            <div class="prop-group">
                <label>Original Path</label>
                <div style="display: flex; gap: 6px;">
                    <input type="text" class="prop-control" readonly value="${escapeHtml(origPath)}" placeholder="No original path">
                    <button class="btn btn-secondary" style="width: auto; padding: 6px 10px; margin-bottom: 0;"
                            onclick="SlideStudioFigure.openPathInSystem('${escapeHtml(origPath).replace(/'/g, "\\'")}')"
                            title="Open in File Manager">📂</button>
                </div>
            </div>
            <div class="prop-group" style="margin-top: 8px;">
                <label>Local Copy Path</label>
                <div style="display: flex; gap: 6px;">
                    <input type="text" class="prop-control" readonly value="${escapeHtml(localPath)}" placeholder="No local copy">
                    <button class="btn btn-secondary" style="width: auto; padding: 6px 10px; margin-bottom: 0;"
                            onclick="SlideStudioFigure.openPathInSystem('${escapeHtml(absLocalPath || origPath).replace(/'/g, "\\'")}')"
                            title="Open in File Manager">📂</button>
                </div>
            </div>
            <div class="prop-group" style="margin-top: 12px;">
                <button class="btn btn-secondary" style="width: 100%;"
                        onclick="SlideStudioFigure.browseFigurePath(${elIndex})">📁 Browse New File...</button>
            </div>
        `;
    },
};

ElementRegistry.register(FigureElement);