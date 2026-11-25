// ============================================================
// core/geometry.js — Drag, resize, and multi-element group drag.
// ============================================================

import { state } from './state.js';

const EDGE_THRESHOLD = 12;   // px inside the element that acts as resize handle
const MIN_SIZE = 8;          // smallest width/height a resize can produce
const DRAG_START_PX = 2;     // movement before a click counts as a drag

export function snapToGridPoint(val, step) {
    if (!state.gridSize || state.gridSize <= 0) return val;
    return Math.round(val / step) * step;
}

/** Compute stepX/stepY accounting for grid rounding. */
export function gridSteps() {
    if (state.gridSize > 0) {
        const cols = Math.max(1, Math.round(state.slideWidth / state.gridSize));
        const rows = Math.max(1, Math.round(state.slideHeight / state.gridSize));
        return { stepX: state.slideWidth / cols, stepY: state.slideHeight / rows };
    }
    return { stepX: 1, stepY: 1 };
}

/**
 * Screen pixels per slide unit, per axis. Differs between axes inside
 * a group that was resized non-proportionally.
 */
function computeScale(domEl, el) {
    const rect = domEl.getBoundingClientRect();
    return {
        sx: rect.width / (el.width || 1) || 0.5,
        sy: rect.height / (el.height || 1) || 0.5,
    };
}

/**
 * Which edges a local point is on. The edge zone shrinks on small
 * elements (e.g. dots) so their middle still moves instead of resizing.
 */
function edgeHits(el, localX, localY) {
    const t = Math.min(EDGE_THRESHOLD, el.width / 4, el.height / 4);
    return {
        isLeft: localX < t,
        isRight: localX > el.width - t,
        isTop: localY < t,
        isBottom: localY > el.height - t,
    };
}

/** Cursor feedback while hovering near edges of an element. */
export function updateResizeCursor(domEl, el, mouseEvent) {
    const rect = domEl.getBoundingClientRect();
    const { sx, sy } = computeScale(domEl, el);
    const localX = (mouseEvent.clientX - rect.left) / sx;
    const localY = (mouseEvent.clientY - rect.top) / sy;

    const { isLeft, isRight, isTop, isBottom } = edgeHits(el, localX, localY);

    if (isTop && isLeft) domEl.style.cursor = 'nwse-resize';
    else if (isTop && isRight) domEl.style.cursor = 'nesw-resize';
    else if (isBottom && isLeft) domEl.style.cursor = 'nesw-resize';
    else if (isBottom && isRight) domEl.style.cursor = 'nwse-resize';
    else if (isLeft || isRight) domEl.style.cursor = 'ew-resize';
    else if (isTop || isBottom) domEl.style.cursor = 'ns-resize';
    else domEl.style.cursor = 'move';
}

/**
 * Full drag/resize interaction for one element or a group of selected elements.
 * `groupItems` is an optional array of `{ el, domEl }` for all selected elements.
 */
export function startDragOrResize(domEl, el, e, callbacks, groupItems = null, { allowResize = true } = {}) {
    const { sx, sy } = computeScale(domEl, el);
    const { stepX, stepY } = gridSteps();

    const startX = e.clientX;
    const startY = e.clientY;
    const orig = { x: el.x, y: el.y, w: el.width, h: el.height };
    let hasDragged = false;

    const rect = domEl.getBoundingClientRect();
    const localX = (e.clientX - rect.left) / sx;
    const localY = (e.clientY - rect.top) / sy;
    const { isLeft, isRight, isTop, isBottom } = edgeHits(el, localX, localY);
    const isResizing = allowResize && (isLeft || isRight || isTop || isBottom);

    const activeGroup = (!isResizing && Array.isArray(groupItems) && groupItems.length > 1)
        ? groupItems.map(item => ({
            el: item.el,
            domEl: item.domEl,
            origX: item.el.x,
            origY: item.el.y,
        }))
        : null;

    function applyGeometry(newX, newY, newW, newH, useSnap) {
        if (useSnap) {
            newX = snapToGridPoint(newX, stepX);
            newY = snapToGridPoint(newY, stepY);
            newW = snapToGridPoint(newW, stepX);
            newH = snapToGridPoint(newH, stepY);
        }
        el.x = newX; el.y = newY; el.width = newW; el.height = newH;
        domEl.style.left = `${el.x}px`;
        domEl.style.top = `${el.y}px`;
        domEl.style.width = `${el.width}px`;
        domEl.style.height = `${el.height}px`;
    }

    function applyGroupMove(rawDx, rawDy, useSnap) {
        let dx = rawDx;
        let dy = rawDy;
        if (useSnap && state.gridSize > 0) {
            dx = snapToGridPoint(rawDx, stepX);
            dy = snapToGridPoint(rawDy, stepY);
        }
        activeGroup.forEach(item => {
            item.el.x = item.origX + dx;
            item.el.y = item.origY + dy;
            item.domEl.style.left = `${item.el.x}px`;
            item.domEl.style.top = `${item.el.y}px`;
            item.domEl.style.cursor = 'grabbing';
        });
    }

    function onMouseMove(moveEvent) {
        const dx = (moveEvent.clientX - startX) / sx;
        const dy = (moveEvent.clientY - startY) / sy;
        if (Math.abs(dx) > DRAG_START_PX || Math.abs(dy) > DRAG_START_PX) hasDragged = true;

        const freeform = moveEvent.altKey;

        if (!isResizing && hasDragged) {
            if (activeGroup) {
                applyGroupMove(dx, dy, !freeform);
            } else {
                applyGeometry(orig.x + dx, orig.y + dy, orig.w, orig.h, !freeform);
                domEl.style.cursor = 'grabbing';
            }
            callbacks.onGeometryChanged();
        } else if (isResizing) {
            let newW = orig.w;
            let newH = orig.h;
            if (isRight) newW = orig.w + dx;
            if (isLeft) newW = orig.w - dx;
            if (isBottom) newH = orig.h + dy;
            if (isTop) newH = orig.h - dy;
            newW = Math.max(MIN_SIZE, newW);
            newH = Math.max(MIN_SIZE, newH);

            // Keep proportions for locked elements (circles, dots) or Shift.
            const keepAspect = el.lockAspect === 'yes' || moveEvent.shiftKey;
            if (keepAspect && orig.w > 0 && orig.h > 0) {
                const horizontal = isLeft || isRight;
                const vertical = isTop || isBottom;
                let k;
                if (horizontal && vertical) k = Math.max(newW / orig.w, newH / orig.h);
                else if (horizontal) k = newW / orig.w;
                else k = newH / orig.h;
                k = Math.max(k, MIN_SIZE / Math.min(orig.w, orig.h));
                newW = Math.round(orig.w * k * 100) / 100;
                newH = Math.round(orig.h * k * 100) / 100;
            }

            // The opposite edge stays put.
            const newX = isLeft ? orig.x + orig.w - newW : orig.x;
            const newY = isTop ? orig.y + orig.h - newH : orig.y;

            // Snapping each side independently would break the ratio.
            applyGeometry(newX, newY, newW, newH, !freeform && !keepAspect);
            callbacks.onGeometryChanged();
        }
    }

    function onMouseUp() {
        window.removeEventListener('mousemove', onMouseMove);
        window.removeEventListener('mouseup', onMouseUp);
        domEl.style.cursor = '';
        if (activeGroup) {
            activeGroup.forEach(item => {
                item.domEl.style.cursor = '';
            });
        }
        callbacks.onFinish(hasDragged, isResizing);
    }

    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup', onMouseUp);
}