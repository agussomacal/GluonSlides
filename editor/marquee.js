// ============================================================
// editor/marquee.js — Rubber-band selection: press on the empty
// canvas (or the grey area around it), drag, release. Every element
// the rectangle touches gets selected. Ctrl/Cmd or Shift adds to the
// current selection instead of replacing it.
// ============================================================

import { activeElements, getSelectedElementIndices } from '../core/state.js';

const DRAG_START_PX = 4;

/**
 * Rectangle in the container's own coordinates (slide space, or a
 * group's frame space) from two client points. Containers can be
 * CSS-scaled; offsetWidth/Height give their unscaled size.
 */
function toLocalRect(container, x1, y1, x2, y2) {
    const r = container.getBoundingClientRect();
    const scaleX = r.width / (container.offsetWidth || 1);
    const scaleY = r.height / (container.offsetHeight || 1);
    const sx = (x) => (x - r.left) / scaleX;
    const sy = (y) => (y - r.top) / scaleY;
    return {
        left: Math.min(sx(x1), sx(x2)),
        right: Math.max(sx(x1), sx(x2)),
        top: Math.min(sy(y1), sy(y2)),
        bottom: Math.max(sy(y1), sy(y2)),
    };
}

/** Indices of active elements (slide or entered group) that intersect `rect`. */
function elementsTouching(rect) {
    const hits = [];
    activeElements().forEach((el, idx) => {
        const touches = el.x <= rect.right && el.x + el.width >= rect.left
            && el.y <= rect.bottom && el.y + el.height >= rect.top;
        if (touches) hits.push(idx);
    });
    return hits;
}

/**
 * Installs marquee selection on `workspace` (which contains `canvas`).
 * `getContainer()` returns the element holding the selectable elements
 * (the canvas, or the frame of the group being edited).
 * `onSelect(indices)` receives the final element indices.
 */
export function initMarqueeSelection({ workspace, canvas, getContainer, onSelect }) {
    workspace.addEventListener('mousedown', (e) => {
        if (e.button !== 0) return;
        // Elements stop propagation on mousedown, so reaching here means
        // the press started on empty space (or empty space inside the
        // group being edited).
        const onEmpty = e.target === workspace || e.target === canvas
            || (e.target.closest('.group-entered') && !e.target.closest('[data-element-id]'));
        if (!onEmpty) return;
        if (document.querySelector('.canvas-element.editing-mode')) return;
        const container = getContainer();

        const additive = e.ctrlKey || e.metaKey || e.shiftKey;
        const base = additive ? getSelectedElementIndices() : [];
        const startX = e.clientX;
        const startY = e.clientY;
        let box = null;
        let hits = [];

        const paintHits = () => {
            const hitSet = new Set([...base, ...hits]);
            [...container.children].forEach((node, idx) => node.classList.toggle('marquee-hit', hitSet.has(idx)));
        };

        const onMove = (m) => {
            if (!box) {
                if (Math.hypot(m.clientX - startX, m.clientY - startY) < DRAG_START_PX) return;
                box = document.createElement('div');
                box.className = 'marquee-rect';
                document.body.appendChild(box);
            }
            box.style.left = `${Math.min(startX, m.clientX)}px`;
            box.style.top = `${Math.min(startY, m.clientY)}px`;
            box.style.width = `${Math.abs(m.clientX - startX)}px`;
            box.style.height = `${Math.abs(m.clientY - startY)}px`;
            hits = elementsTouching(toLocalRect(container, startX, startY, m.clientX, m.clientY));
            paintHits();
        };

        const onUp = () => {
            window.removeEventListener('mousemove', onMove);
            window.removeEventListener('mouseup', onUp);
            if (!box) return; // plain click: the canvas click handler deals with it
            box.remove();
            [...container.children].forEach(node => node.classList.remove('marquee-hit'));

            // The release also fires a click on the canvas, which would
            // clear the selection we are about to set: swallow it.
            const swallow = (c) => c.stopPropagation();
            window.addEventListener('click', swallow, { capture: true, once: true });
            setTimeout(() => window.removeEventListener('click', swallow, { capture: true }), 0);

            onSelect([...new Set([...base, ...hits])]);
        };

        e.preventDefault(); // no text selection while dragging
        window.addEventListener('mousemove', onMove);
        window.addEventListener('mouseup', onUp);
    });
}
