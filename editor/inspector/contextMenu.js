// ============================================================
// editor/inspector/contextMenu.js — Right-click "Go to Gluon file"
// menu. Targets are read from data-slide-id / data-element-id
// attributes that editor/editor.js puts on thumbnails and canvas
// elements.
// ============================================================

import { state } from '../../core/state.js';
import { parseIdValue } from './glNavigation.js';

const MENU_ID = 'gl-context-menu';

/** { slideId, elementId } for a right-click, or null if not on a slide/element. */
function targetFromEvent(e) {
    const node = e.target && e.target.closest ? e.target : null;
    if (!node) return null;

    const elNode = node.closest('[data-element-id]');
    if (elNode) {
        const slide = state.slides[state.currentSlideIndex];
        if (!slide) return null;
        return { slideId: slide.id, elementId: parseIdValue(elNode.dataset.elementId) };
    }

    const slideNode = node.closest('[data-slide-id]');
    if (slideNode) {
        return { slideId: parseIdValue(slideNode.dataset.slideId), elementId: null };
    }

    if (node.closest('#slide-canvas')) {
        const slide = state.slides[state.currentSlideIndex];
        return slide ? { slideId: slide.id, elementId: null } : null;
    }
    return null;
}

/** Installs the menu; `onGoTo(target)` opens the inspector at a target. */
export function initContextMenu({ onGoTo }) {
    const menu = document.createElement('div');
    menu.id = MENU_ID;
    menu.innerHTML = `
        <button type="button">
            <span>📄</span>
            <span>Go to Gluon file</span>
        </button>`;
    document.body.appendChild(menu);

    let pendingTarget = null;
    const hide = () => {
        menu.classList.remove('open');
        pendingTarget = null;
    };

    menu.querySelector('button').addEventListener('click', () => {
        const target = pendingTarget || {};
        hide();
        onGoTo(target);
    });

    document.addEventListener('contextmenu', (e) => {
        const target = targetFromEvent(e);
        if (!target) {
            hide();
            return;
        }
        e.preventDefault();
        pendingTarget = target;
        menu.style.left = `${Math.min(e.clientX, window.innerWidth - 205)}px`;
        menu.style.top = `${Math.min(e.clientY, window.innerHeight - 60)}px`;
        menu.classList.add('open');
    });

    document.addEventListener('click', (e) => {
        if (!menu.contains(e.target)) hide();
    });
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') hide();
    });
}
