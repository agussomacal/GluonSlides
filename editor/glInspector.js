// ============================================================
// editor/glInspector.js — Read-only .gl source inspector with
// slide/element context menu ("Go to Gluon file") and jump-to-line.
// Designed so the inner viewer can later be swapped for a syntax
// highlighter without changing context-menu or jump callers.
// ============================================================

import { state, serializeProject } from '../core/state.js';

const INSPECTOR_ID = 'gl-inspector-drawer';
const MENU_ID = 'gl-context-menu';
const STYLESHEET_HREF = 'editor/glInspector.css';

const SLIDE_NODE_SELECTOR = '[data-slide-id], [data-slide-index], .slide-thumb, .thumbnail, .slide-item, .slide-card';
const ELEMENT_NODE_SELECTOR = '[data-element-id], [data-el-id], [data-el-index], .element, .element-wrapper, .canvas-element';

let currentTarget = null; // { slideId, elementId }
let isOpen = false;
let initialized = false;

function ensureStylesheet() {
    const existing = [...document.querySelectorAll('link[rel="stylesheet"]')];
    if (existing.some(link => (link.getAttribute('href') || '').includes(STYLESHEET_HREF))) {
        return;
    }
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = STYLESHEET_HREF;
    document.head.appendChild(link);
}

function ensureDom() {
    ensureStylesheet();

    if (!document.getElementById(MENU_ID)) {
        const menu = document.createElement('div');
        menu.id = MENU_ID;
        menu.innerHTML = `
            <button type="button" id="gl-menu-goto-btn">
                <span>📄</span>
                <span>Go to Gluon file</span>
            </button>
        `;
        document.body.appendChild(menu);
    }

    if (!document.getElementById(INSPECTOR_ID)) {
        const drawer = document.createElement('section');
        drawer.id = INSPECTOR_ID;
        drawer.setAttribute('aria-label', 'Gluon File Inspector');
        drawer.innerHTML = `
            <div class="gl-inspector-header">
                <div class="gl-inspector-meta">
                    <strong>.gl Inspector (Read-only)</strong>
                    <span id="gl-inspector-status">Ready</span>
                </div>
                <div class="gl-inspector-actions">
                    <button type="button" id="gl-inspector-refresh-btn" title="Refresh from project state">Refresh</button>
                    <button type="button" id="gl-inspector-close-btn" title="Close inspector">✕</button>
                </div>
            </div>
            <div class="gl-inspector-body" id="gl-inspector-code-host"></div>
        `;
        document.body.appendChild(drawer);

        document.getElementById('gl-inspector-refresh-btn').onclick = () => {
            refreshGlInspectorText(currentTarget);
        };
        document.getElementById('gl-inspector-close-btn').onclick = () => {
            closeGlInspector();
        };
    }
}

function parseIdValue(raw) {
    if (raw === undefined || raw === null || raw === '') return null;
    const num = Number(raw);
    return Number.isFinite(num) ? num : String(raw);
}

function hasIdParam(line, targetId) {
    if (targetId === undefined || targetId === null || targetId === '') return false;
    const escaped = String(targetId).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return new RegExp(`(?:^|\\s)id:(?:"${escaped}"|${escaped})(?=\\s|$)`).test(line);
}

/**
 * Finds the 0-based line index for a slide or element inside serialized .gl text.
 */
export function findGlTargetLine(glText, { slideId = null, elementId = null } = {}) {
    const lines = String(glText ?? '').split('\n');
    const normSlideId = parseIdValue(slideId);
    const normElementId = parseIdValue(elementId);

    let slideLineIndex = -1;
    let inTargetSlide = normSlideId === null;

    for (let i = 0; i < lines.length; i++) {
        const trimmed = lines[i].trimStart();

        if (trimmed.startsWith('.slide')) {
            if (normSlideId !== null) {
                if (hasIdParam(trimmed, normSlideId)) {
                    slideLineIndex = i;
                    inTargetSlide = true;
                    if (normElementId === null) {
                        return i;
                    }
                } else if (inTargetSlide) {
                    break;
                }
            }
            continue;
        }

        if (normElementId !== null && inTargetSlide) {
            if (trimmed.startsWith('.element.') && hasIdParam(trimmed, normElementId)) {
                return i;
            }
        }
    }

    if (slideLineIndex !== -1) return slideLineIndex;
    return normElementId !== null || normSlideId !== null ? 0 : -1;
}

/**
 * Renders lines into the inspector view.
 * Later, you can replace this renderer with a syntax-highlighted view
 * while keeping `jumpToGlTarget` working via line numbers.
 */
function renderLinesView(glText, targetLineIndex) {
    const host = document.getElementById('gl-inspector-code-host');
    if (!host) return;

    const lines = String(glText ?? '').split('\n');
    const frag = document.createDocumentFragment();

    lines.forEach((lineText, idx) => {
        const row = document.createElement('div');
        row.className = 'gl-line' + (idx === targetLineIndex ? ' highlighted' : '');
        row.dataset.line = String(idx);

        const num = document.createElement('span');
        num.className = 'gl-line-num';
        num.textContent = String(idx + 1);

        const code = document.createElement('span');
        code.className = 'gl-line-code';
        code.textContent = lineText;

        row.appendChild(num);
        row.appendChild(code);
        frag.appendChild(row);
    });

    host.innerHTML = '';
    host.appendChild(frag);
}

export function jumpToGlTarget(target = {}) {
    const host = document.getElementById('gl-inspector-code-host');
    const statusEl = document.getElementById('gl-inspector-status');
    if (!host) return;

    const glText = serializeProject();
    const lineIdx = findGlTargetLine(glText, target);
    renderLinesView(glText, lineIdx);

    if (statusEl) {
        const labelParts = [];
        if (target.slideId !== null && target.slideId !== undefined) labelParts.push(`slide id:${target.slideId}`);
        if (target.elementId !== null && target.elementId !== undefined) labelParts.push(`element id:${target.elementId}`);
        const targetDesc = labelParts.length ? ` (${labelParts.join(', ')})` : '';
        statusEl.textContent = lineIdx >= 0
            ? `Line ${lineIdx + 1}${targetDesc}`
            : 'Full file';
    }

    if (lineIdx >= 0) {
        const targetRow = host.querySelector(`.gl-line[data-line="${lineIdx}"]`);
        if (targetRow) {
            const desiredTop = Math.max(0, targetRow.offsetTop - host.clientHeight * 0.35);
            host.scrollTop = desiredTop;
        }
    }
}

export function refreshGlInspectorText(target = currentTarget) {
    ensureDom();
    currentTarget = target || null;
    jumpToGlTarget(currentTarget || {});
}

export function openGlInspector(target = {}) {
    ensureDom();
    currentTarget = target || {};
    isOpen = true;
    const drawer = document.getElementById(INSPECTOR_ID);
    if (drawer) drawer.classList.add('open');
    jumpToGlTarget(currentTarget);
}

export function closeGlInspector() {
    isOpen = false;
    const drawer = document.getElementById(INSPECTOR_ID);
    if (drawer) drawer.classList.remove('open');
}

function hideContextMenu() {
    const menu = document.getElementById(MENU_ID);
    if (menu) {
        menu.classList.remove('open');
        delete menu._pendingTarget;
    }
}

function extractSlideIndexFromOnclick(node) {
    let curr = node;
    for (let depth = 0; curr && depth < 4; depth++, curr = curr.parentElement) {
        const onclickAttr = curr.getAttribute && curr.getAttribute('onclick');
        if (!onclickAttr) continue;
        const m = onclickAttr.match(/selectSlide\(\s*(\d+)\s*\)/);
        if (m) return Number(m[1]);
    }
    return null;
}

function resolveSlideFromNode(slideNode) {
    if (!slideNode) return null;
    const ds = slideNode.dataset || {};

    if (ds.slideId !== undefined) {
        const id = parseIdValue(ds.slideId);
        const found = state.slides.find(s => parseIdValue(s.id) === id);
        if (found) return found;
    }

    const idxRaw = ds.slideIndex ?? ds.index;
    if (idxRaw !== undefined && Number.isFinite(Number(idxRaw))) {
        const idx = Number(idxRaw);
        if (state.slides[idx]) return state.slides[idx];
    }

    const onclickIdx = extractSlideIndexFromOnclick(slideNode);
    if (onclickIdx !== null && state.slides[onclickIdx]) {
        return state.slides[onclickIdx];
    }

    // Walk up to the nearest container holding multiple slide nodes so wrapper
    // elements (like <li> around .slide-thumb) still resolve their true slide index.
    let container = slideNode.parentElement;
    while (container && container !== document.body) {
        const matches = [...container.querySelectorAll(SLIDE_NODE_SELECTOR)].filter(
            candidate => candidate === slideNode || candidate.contains(slideNode) || slideNode.contains(candidate)
        );
        const allInContainer = [...container.querySelectorAll(SLIDE_NODE_SELECTOR)];
        if (allInContainer.length > 1) {
            const targetItem = allInContainer.find(
                item => item === slideNode || item.contains(slideNode)
            ) || slideNode;
            const pos = allInContainer.indexOf(targetItem);
            if (pos >= 0 && state.slides[pos]) {
                return state.slides[pos];
            }
            break;
        }
        if (matches.length === 0) break;
        container = container.parentElement;
    }

    return null;
}

function resolveElementFromNode(elNode, slide) {
    if (!elNode || !slide) return null;
    const elements = slide.elements || [];
    const ds = elNode.dataset || {};

    if (ds.elementId !== undefined || ds.elId !== undefined) {
        const id = parseIdValue(ds.elementId ?? ds.elId);
        return elements.find(el => parseIdValue(el.id) === id) || null;
    }

    const idxRaw = ds.elIndex ?? ds.elementIndex ?? ds.index;
    if (idxRaw !== undefined && Number.isFinite(Number(idxRaw))) {
        return elements[Number(idxRaw)] || null;
    }

    if (elNode.parentElement) {
        const siblings = [...elNode.parentElement.children].filter(
            node => node.matches(ELEMENT_NODE_SELECTOR)
        );
        const pos = siblings.indexOf(elNode);
        if (pos >= 0 && elements[pos]) return elements[pos];
    }

    return null;
}

function resolveContextTargetFromEvent(e) {
    if (!e || !e.target || typeof e.target.closest !== 'function') return null;

    const slideNode = e.target.closest(SLIDE_NODE_SELECTOR);
    if (slideNode) {
        const matchedSlide = resolveSlideFromNode(slideNode);
        if (matchedSlide) {
            return { slideId: matchedSlide.id, elementId: null };
        }
    }

    const elNode = e.target.closest(ELEMENT_NODE_SELECTOR);
    if (elNode) {
        const activeSlide = state.slides[state.currentSlideIndex] || null;
        if (activeSlide) {
            const matchedEl = resolveElementFromNode(elNode, activeSlide);
            return {
                slideId: activeSlide.id,
                elementId: matchedEl ? matchedEl.id : null,
            };
        }
    }

    return null;
}

export function initGlInspector() {
    if (initialized) return;
    initialized = true;
    ensureDom();

    const menu = document.getElementById(MENU_ID);
    const gotoBtn = document.getElementById('gl-menu-goto-btn');

    gotoBtn.onclick = () => {
        const target = menu._pendingTarget || {};
        hideContextMenu();
        openGlInspector(target);
    };

    document.addEventListener('contextmenu', (e) => {
        const target = resolveContextTargetFromEvent(e);
        if (!target) {
            hideContextMenu();
            return;
        }
        e.preventDefault();
        menu._pendingTarget = target;
        menu.style.left = `${Math.min(e.clientX, window.innerWidth - 200)}px`;
        menu.style.top = `${Math.min(e.clientY, window.innerHeight - 60)}px`;
        menu.classList.add('open');
    });

    document.addEventListener('click', (e) => {
        if (!menu.contains(e.target)) {
            hideContextMenu();
        }
    });

    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') {
            hideContextMenu();
            if (isOpen) closeGlInspector();
        }
    });

    document.addEventListener('slide-content-changed', () => {
        if (isOpen) refreshGlInspectorText(currentTarget);
    });
    document.addEventListener('slide-thumbnail-changed', () => {
        if (isOpen) refreshGlInspectorText(currentTarget);
    });
}