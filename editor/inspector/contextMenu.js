// ============================================================
// editor/inspector/contextMenu.js — The right-click menu: "Go to Gluon
// file", plus what the element's own type offers (its definition's
// `contextMenu: [{ icon, label, when(el), run(el) }]`, e.g. a picture's
// "Convert to LaTeX"). Targets are read from data-slide-id /
// data-element-id attributes that editor/editor.js puts on thumbnails
// and canvas elements.
// ============================================================

import { state, currentSlide, findElementPath } from '../../core/state.js';
import { ElementRegistry } from '../../core/registry.js';
import { openFollow, pickFollower } from '../../ui/followVariable.js';

const FOLLOWED = new Set(['slider', 'checkbox', 'numberbox', 'textbox', 'choice', 'animation']);
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

/** The element a target names, on the slide being edited (groups included). */
function targetElement(target) {
    if (!target || target.elementId === null || target.elementId === undefined) return null;
    const slide = currentSlide();
    const path = findElementPath(slide, target.elementId);
    if (!path) return null;
    const container = path.length ? path[path.length - 1].children : slide.elements;
    return container.find(el => el.id === target.elementId) || null;
}

/** The element type's own entries that apply to `el`, then those every object has. */
function elementItems(el) {
    if (!el) return [];
    const def = ElementRegistry.get(el.type);
    const own = ((def && def.contextMenu) || []).filter(item => !item.when || item.when(el));
    const all = [{ icon: 'ƒ', label: 'Follow a variable…', run: (e, at) => openFollow(e, at) }];
    if (FOLLOWED.has(el.type)) all.push({ icon: '🎯', label: 'Make something follow this…', run: (e) => pickFollower(e) });
    return [...own, ...all];
}

/** Installs the menu; `onGoTo(target)` opens the inspector at a target. */
export function initContextMenu({ onGoTo }) {
    const menu = document.createElement('div');
    menu.id = MENU_ID;
    document.body.appendChild(menu);

    const hide = () => menu.classList.remove('open');

    const button = (icon, label, run) => {
        const b = document.createElement('button');
        b.type = 'button';
        b.innerHTML = '<span></span><span></span>';
        b.children[0].textContent = icon;
        b.children[1].textContent = label;
        b.addEventListener('click', () => { hide(); run(); });
        return b;
    };

    document.addEventListener('contextmenu', (e) => {
        const target = targetFromEvent(e);
        if (!target) {
            hide();
            return;
        }
        e.preventDefault();
        menu.replaceChildren(button('📄', 'Go to Gluon file', () => onGoTo(target)));
        const el = targetElement(target);
        const at = { x: e.clientX, y: e.clientY };
        elementItems(el).forEach(item => menu.appendChild(button(item.icon || '', item.label, () => item.run(el, at))));
        menu.classList.add('open');
        const h = menu.offsetHeight || 60;
        menu.style.left = `${Math.min(e.clientX, window.innerWidth - 205)}px`;
        menu.style.top = `${Math.min(e.clientY, window.innerHeight - h - 4)}px`;
    });

    document.addEventListener('click', (e) => {
        if (!menu.contains(e.target)) hide();
    });
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') hide();
    });
}
