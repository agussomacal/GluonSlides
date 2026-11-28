// ============================================================
// core/render.js — Shared rendering helpers.
//  - citation resolution is guarded so a bibliography problem can
//    never take down element painting or editing handlers.
// ============================================================

import { state, markDirty } from './state.js';
import { resolveCitations } from './citations.js';
import { resolveFields } from './fields.js';
import { resolveVars } from './variables.js';
import { ElementRegistry } from './registry.js';
import { fontStack } from './fonts.js';
import { forDrawing } from './defaults.js';
import { applyTextCommands } from './textCommands.js';

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

// Math is set aside while Markdown runs, then put back untouched for KaTeX:
// otherwise Markdown eats the \\ row breaks of aligned equations and
// turns *...* inside formulas into italics. Same delimiters as below.
const MATH_RE = /\$\$[\s\S]+?\$\$|\\\[[\s\S]+?\\\]|\\\([\s\S]+?\\\)|(?<![\\$])\$(?![\s$])(?:\\.|[^$\\\n])+?\$/g;
const MATH_TOKEN_RE = /GLMATH(\d+)X/g;
// \$ is a literal dollar: kept apart (its own element) so KaTeX never pairs it.
const DOLLAR_TOKEN = 'GLDOLLARX';

/** Text with math replaced by GLMATH<n>X tokens, and the math pieces. */
export function protectMath(text) {
    const pieces = [];
    const out = String(text ?? '').replace(/\\\$/g, DOLLAR_TOKEN).replace(MATH_RE, (m) => {
        pieces.push(m);
        return `GLMATH${pieces.length - 1}X`;
    });
    return { text: out, pieces };
}

/** HTML from Markdown with the math tokens put back (escaped, as text). */
function restoreMath(html, pieces) {
    return html.split(DOLLAR_TOKEN).join('<span class="gl-dollar">$</span>').replace(MATH_TOKEN_RE, (t, i) => (pieces[Number(i)] !== undefined ? escapeHtml(pieces[Number(i)].split(DOLLAR_TOKEN).join('\\$')) : t));
}

// Markdown images (![](figures/plot.png)): project-relative paths are
// resolved by the figure module (elements/figure/figure.js registers it),
// which returns a data URI, or null while it loads the file (it redraws then).
let imageResolver = null;

export function setImageResolver(fn) {
    imageResolver = fn;
}

function resolveImages(root) {
    if (!imageResolver) return;
    root.querySelectorAll('img[src]').forEach(img => {
        const src = img.getAttribute('src');
        if (/^(data:|https?:|blob:|\/)/i.test(src)) return;
        const resolved = imageResolver(decodeURIComponent(src));
        if (resolved) img.setAttribute('src', resolved);
        else img.removeAttribute('src');
        img.classList.add('md-image');
    });
}

export function renderMarkdownAndKatex(element, rawText) {
    // Citations are resolved at render time only — the stored content
    // keeps the raw \cite{...} markers for round-trip fidelity.
    let processed;
    try {
        // Fields first (\slidenumber ...), variables (\var{x}), then citations.
        processed = resolveCitations(resolveVars(resolveFields(rawText)));
    } catch (e) {
        console.error('Citation resolution error:', e);
        processed = rawText;
    }

    const { text: withoutMath, pieces } = protectMath(processed || '');
    // \textcolor{red}{...}, \textbf{...}, your text macros (core/textCommands.js)
    let source = withoutMath;
    try {
        source = applyTextCommands(withoutMath);
    } catch (e) {
        console.error('Text command error:', e);
    }
    let html = source;
    if (window.marked && typeof window.marked.parse === 'function') {
        try {
            html = window.marked.parse(source, { breaks: true, gfm: true });
        } catch (e) {
            console.error('Markdown parsing error:', e);
        }
    }
    html = restoreMath(html, pieces);
    element.innerHTML = sanitizeHtml(html);
    resolveImages(element);
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
                ignoredClasses: ['gl-dollar'],
                // \htmlData only: the markers of \var{…} values (core/variables.js)
                trust: (ctx) => ctx.command === '\\htmlData',
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
    // Turned about its centre (rotate:30).
    domEl.style.transform = Number(el.rotate) ? `rotate(${Number(el.rotate)}deg)` : '';
    domEl.style.opacity = el.opacity !== undefined && Number(el.opacity) < 1 ? String(Math.max(0, Number(el.opacity))) : '';
    // hidden by its condition (visible:"=…"): faint and dashed in the editor, so it can still be edited
    domEl.classList.toggle('formula-hidden', Boolean(el._hidden));
}

/** The formulas an exported object carries, so sliders move it (core/liveEngine.js liveUpdate). */
function bindAttr(el) {
    if (!el.formulas || !Object.keys(el.formulas).length) return '';
    // a circle: its centre and radius, for those not given by a formula
    const data = el.kind === 'circle' ? { ...el.formulas, __circle: { cx: el.cx, cy: el.cy, r: el.r } } : el.formulas;
    return ` data-glbind="${escapeHtml(JSON.stringify(data))}"`;
}

// ---------- Element DOM / export markup (shared) ----------

/**
 * Non-interactive DOM for an element: used for thumbnails, for the
 * contents of groups that are not being edited, and for elements
 * outside the group being edited.
 */
export function buildStaticElement(raw, className = 'thumb-element') {
    const el = forDrawing(raw); // defaults/style fill unset properties; colors resolved
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
    const el = forDrawing(raw);
    const def = ElementRegistry.get(el.type);
    const geo = `position: absolute; left:${el.x}px; top:${el.y}px;`
        + `width:${el.width}px; height:${el.height}px;`
        + `background-color:${el.bg};`
        + `border: ${el.borderWidth}px ${el.borderStyle} ${el.borderCol};`
        + `box-sizing: border-box;`
        + (Number(el.rotate) ? `transform:rotate(${Number(el.rotate)}deg);` : '')
        + (raw.opacity !== undefined && Number(raw.opacity) < 1 ? `opacity:${Math.max(0, Number(raw.opacity))};` : '')
        + (def && typeof def.exportStyle === 'function' ? def.exportStyle(el) : '');
    const bind = bindAttr(raw);
    // hidden by its condition (a class: the element's own display stays for when it shows)
    const off = raw._hidden ? ' gl-off' : '';
    const hide = '';

    if (!def) return `<div class="el${off}"${bind} style="${geo}${hide}"></div>`;
    if (el.type === 'text') {
        return `<div class="el ${def.className} align-${el.textAlign || 'center'}${off}"${bind} style="${geo} ${textElementSharedStyle(el)}${hide}">${def.exportInner(el)}</div>`;
    }
    // Columns, tables...: their text takes the element's font, size and
    // colour (on the canvas renderDom sets these on the box).
    const font = el.fontSize ? `font-size:${el.fontSize}px;font-family:${fontStack(el.fontFamily).replace(/"/g, "'")};color:${el.fontColor || 'inherit'};` : '';
    return `<div class="el ${def.className}${off}"${bind} style="${geo}${font}${hide}">${def.exportInner(el)}</div>`;
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
    document.documentElement.style.setProperty('--slide-ratio', `${state.slideWidth} / ${state.slideHeight}`);
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