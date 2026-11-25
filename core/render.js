// ============================================================
// core/render.js — Shared rendering helpers.
//  - citation resolution is guarded so a bibliography problem can
//    never take down element painting or editing handlers.
// ============================================================

import { state, markDirty } from './state.js';
import { resolveCitations } from './citations.js';
import { ElementRegistry } from './registry.js';
import { fontStack } from './fonts.js';
import { withDefaults } from './defaults.js';

// ---------- Markdown + KaTeX ----------

/**
 * Strips scripts/event handlers from user-authored HTML. Text content
 * comes from .gl files that may be shared, and the page can call the
 * Python API (file writes), so raw HTML must never execute.
 * Without DOMPurify loaded we fall back to escaping everything.
 */
function sanitizeHtml(html) {
    if (window.DOMPurify && typeof window.DOMPurify.sanitize === 'function') {
        return window.DOMPurify.sanitize(html);
    }
    console.warn('DOMPurify not loaded; rendering text as plain text.');
    return escapeHtml(html);
}

export function renderMarkdownAndKatex(element, rawText) {
    // Citations are resolved at render time only — the stored content
    // keeps the raw \cite{...} / [@key] markers for round-trip fidelity.
    let processed;
    try {
        processed = resolveCitations(rawText);
    } catch (e) {
        console.error('Citation resolution error:', e);
        processed = rawText;
    }

    let html = processed || '';
    if (window.marked && typeof window.marked.parse === 'function') {
        try {
            html = window.marked.parse(processed || '', { breaks: true, gfm: true });
        } catch (e) {
            console.error('Markdown parsing error:', e);
        }
    }
    element.innerHTML = sanitizeHtml(html);
    if (window.renderMathInElement) {
        try {
            renderMathInElement(element, {
                delimiters: [
                    { left: '$$', right: '$$', display: true },
                    { left: '$', right: '$', display: false },
                    { left: '\\(', right: '\\)', display: false },
                    { left: '\\[', right: '\\]', display: true },
                ],
                macros: state.projectMacros,
                throwOnError: false,
            });
        } catch (e) {
            console.error('KaTeX rendering error:', e);
        }
    }
}

export function renderMarkdownAndKatexToString(el) {
    const tempDiv = document.createElement('div');
    renderMarkdownAndKatex(tempDiv, el.content);
    return tempDiv.innerHTML;
}

export function escapeHtml(s) {
    return String(s)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}

// ---------- Alignment: single source of truth ----------

export function getHAlign(el) {
    return el.textAlign || 'center';
}

export function getVJustify(el) {
    switch (el.verticalAlign || 'center') {
        case 'top': return 'flex-start';
        case 'bottom': return 'flex-end';
        default: return 'center';
    }
}

export function textElementSharedStyle(el) {
    return `font-size:${el.fontSize}px; font-family:${fontStack(el.fontFamily).replace(/"/g, "'")}; color:${el.fontColor};`
        + `display:flex; flex-direction:column;`
        + `justify-content:${getVJustify(el)};`
        + `text-align:${getHAlign(el)};`;
}

export function textElementClass(el) {
    return `element-text align-${getHAlign(el)}`;
}

export function applyAlignmentStyles(domEl, el) {
    domEl.style.textAlign = getHAlign(el);

    domEl.classList.remove('align-left', 'align-center', 'align-right');
    domEl.classList.add('align-' + getHAlign(el));

    domEl.style.display = 'flex';
    domEl.style.flexDirection = 'column';
    domEl.style.justifyContent = getVJustify(el);
}

// ---------- Common element box styles ----------

export function commonGeometryStyle(el) {
    return `position: absolute; left:${el.x}px; top:${el.y}px; width:${el.width}px; height:${el.height}px;`
        + `background-color:${el.bg};`
        + `border: ${el.borderWidth}px ${el.borderStyle} ${el.borderCol};`
        + `box-sizing: border-box;`;
}

export function applyCommonBoxStyles(domEl, el) {
    domEl.style.left = `${el.x}px`;
    domEl.style.top = `${el.y}px`;
    domEl.style.width = `${el.width}px`;
    domEl.style.height = `${el.height}px`;
    domEl.style.backgroundColor = el.bg;
    domEl.style.borderColor = el.borderCol;
    domEl.style.borderWidth = `${el.borderWidth}px`;
    domEl.style.borderStyle = el.borderStyle;
}

// ---------- Element DOM / export markup (shared) ----------

/**
 * Non-interactive DOM for an element: used for thumbnails, for the
 * contents of groups that are not being edited, and for elements
 * outside the group being edited.
 */
export function buildStaticElement(raw, className = 'thumb-element') {
    const el = withDefaults(raw); // project style defaults fill unset properties
    const def = ElementRegistry.get(el.type);
    const domEl = document.createElement('div');
    domEl.className = `${className} ${def ? def.className : 'element-shape'}`;
    domEl.style.position = 'absolute';
    applyCommonBoxStyles(domEl, el);
    if (def) def.renderDom(domEl, el, { context: 'thumb', elIndex: -1 });
    return domEl;
}

/** Positioned HTML for one element in HTML/PDF exports. */
export function exportElementMarkup(raw) {
    const el = withDefaults(raw);
    const def = ElementRegistry.get(el.type);
    const geo = `position: absolute; left:${el.x}px; top:${el.y}px;`
        + `width:${el.width}px; height:${el.height}px;`
        + `background-color:${el.bg};`
        + `border: ${el.borderWidth}px ${el.borderStyle} ${el.borderCol};`
        + `box-sizing: border-box;`
        + (def && typeof def.exportStyle === 'function' ? def.exportStyle(el) : '');

    if (!def) return `<div class="el" style="${geo}"></div>`;
    if (el.type === 'text') {
        return `<div class="el ${def.className} align-${el.textAlign || 'center'}" style="${geo} ${textElementSharedStyle(el)}">${def.exportInner(el)}</div>`;
    }
    return `<div class="el" style="${geo}">${def.exportInner(el)}</div>`;
}

// ---------- Grid + dimensions ----------

export function getGridSvgDataUri(width, height, gridSize, isDarkMode) {
    if (!gridSize || gridSize <= 0) return 'none';
    const cols = Math.max(1, Math.round(width / gridSize));
    const rows = Math.max(1, Math.round(height / gridSize));
    const stepX = width / cols;
    const stepY = height / rows;
    const dotRadius = Math.max(1.5, Math.min(4, Math.min(stepX, stepY) * 0.08));
    const dotColor = isDarkMode ? '#94a3b8' : '#64748b';

    let svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">`;
    for (let x = 0; x <= width + 0.1; x += stepX) {
        for (let y = 0; y <= height + 0.1; y += stepY) {
            svg += `<circle cx="${x}" cy="${y}" r="${dotRadius}" fill="${dotColor}"/>`;
        }
    }
    svg += `</svg>`;
    return `url("data:image/svg+xml;utf8,${encodeURIComponent(svg)}")`;
}

export function updateDimensionsCSS() {
    document.documentElement.style.setProperty('--slide-width', `${state.slideWidth}px`);
    document.documentElement.style.setProperty('--slide-height', `${state.slideHeight}px`);
}

export function syncSlideSizeSelect() {
    const sel = document.getElementById('global-slide-size');
    if (!sel) return;
    const key = `${state.slideWidth}x${state.slideHeight}`;
    sel.value = ['1920x1080', '960x540', '1280x960'].includes(key) ? key : 'custom';
}

export function syncGridSizeSelect() {
    const sel = document.getElementById('grid-size-select');
    if (sel) sel.value = state.gridSize;
}

export function syncThemeToggle() {
    document.body.classList.toggle('dark-mode', state.isDarkMode);
    const btn = document.getElementById('theme-toggle-btn');
    if (btn) {
        btn.innerHTML = state.isDarkMode ? '<span>☀️</span> Day Mode' : '<span>🌙</span> Night Mode';
    }
}

export function syncCitestyleSelect() {
    const sel = document.getElementById('citestyle-select');
    if (sel) sel.value = state.citestyle;
}

/**
 * Syncs every project-level control (theme, size, grid, citation
 * style, canvas dimensions) from state. Call after state was replaced
 * wholesale: project open, undo/redo, inspector apply.
 */
export function syncProjectChrome() {
    syncThemeToggle();
    syncSlideSizeSelect();
    syncGridSizeSelect();
    syncCitestyleSelect();
    updateDimensionsCSS();
}

// Late-bound render callback to avoid a circular static import
// with editor/editor.js. main.js binds it at startup.
let _renderAfterSettingsChange = () => {};
export function bindMarkDirtyAndRender(fn) {
    _renderAfterSettingsChange = fn;
}

export function changeSlideSizePreset(val) {
    if (val === '1920x1080') {
        state.slideWidth = 1920; state.slideHeight = 1080;
    } else if (val === '960x540') {
        state.slideWidth = 960; state.slideHeight = 540;
    } else if (val === '1280x960') {
        state.slideWidth = 1280; state.slideHeight = 960;
    } else if (val === 'custom') {
        const w = prompt('Enter slide width in pixels:', state.slideWidth);
        const h = prompt('Enter slide height in pixels:', state.slideHeight);
        if (w && h && !isNaN(w) && !isNaN(h)) {
            state.slideWidth = parseInt(w);
            state.slideHeight = parseInt(h);
        } else {
            syncSlideSizeSelect();
            return;
        }
    }
    updateDimensionsCSS();
    markDirty();
    _renderAfterSettingsChange();
}

export function changeGridSize(val) {
    state.gridSize = parseInt(val, 10);
    markDirty();
    _renderAfterSettingsChange();
}