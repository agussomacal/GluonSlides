// ============================================================
// core/geometry.js — Drag, resize, and multi-element group drag.
//
// Smart guides: while moving or resizing, the edges and centre of what
// is dragged snap to the edges and centres of the other objects and of
// the slide, and a pink line shows what it lines up with. A guide wins
// over the grid on its axis; Alt turns all snapping off.
// ============================================================

import { state } from './state.js';

const EDGE_THRESHOLD = 12;   // px inside the element that acts as resize handle
const MIN_SIZE = 8;          // smallest width/height a resize can produce
const DRAG_START_PX = 2;     // movement before a click counts as a drag
const GUIDE_SNAP_PX = 6;     // screen distance at which a guide catches

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
    // From the container: a turned element's own rect is its bounding box.
    const parent = domEl.parentElement;
    if (Number(el.rotate) && parent && parent.offsetWidth && parent.offsetHeight) {
        const pr = parent.getBoundingClientRect();
        return { sx: pr.width / parent.offsetWidth || 0.5, sy: pr.height / parent.offsetHeight || 0.5 };
    }
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
/**
 * A client point in the element's own frame (0..width, 0..height), its
 * rotation undone: the resize zones of a turned element follow its sides.
 */
function localPoint(domEl, el, clientX, clientY) {
    const parent = domEl.parentElement;
    const pr = parent ? parent.getBoundingClientRect() : domEl.getBoundingClientRect();
    const k = parent && parent.offsetWidth ? pr.width / parent.offsetWidth : 1;
    const ky = parent && parent.offsetHeight ? pr.height / parent.offsetHeight : k;
    const cx = pr.left + (el.x + el.width / 2) * k;
    const cy = pr.top + (el.y + el.height / 2) * ky;
    const a = -(Number(el.rotate) || 0) * Math.PI / 180;
    const dx = (clientX - cx) / k;
    const dy = (clientY - cy) / ky;
    return [dx * Math.cos(a) - dy * Math.sin(a) + el.width / 2, dx * Math.sin(a) + dy * Math.cos(a) + el.height / 2];
}

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
    const [localX, localY] = localPoint(domEl, el, mouseEvent.clientX, mouseEvent.clientY);

    const { isLeft, isRight, isTop, isBottom } = edgeHits(el, localX, localY);

    if (isTop && isLeft) domEl.style.cursor = 'nwse-resize';
    else if (isTop && isRight) domEl.style.cursor = 'nesw-resize';
    else if (isBottom && isLeft) domEl.style.cursor = 'nesw-resize';
    else if (isBottom && isRight) domEl.style.cursor = 'nwse-resize';
    else if (isLeft || isRight) domEl.style.cursor = 'ew-resize';
    else if (isTop || isBottom) domEl.style.cursor = 'ns-resize';
    else domEl.style.cursor = 'move';
}

// ---------- Smart guides ----------

/**
 * Lines objects can line up with: for each axis, {v, lo, hi} — the
 * position and the extent (on the other axis) of the object it comes
 * from. `targets`: the other objects' boxes; `frame`: the slide (or
 * group) size, or null.
 */
export function guideLines(targets, frame) {
    const xs = [];
    const ys = [];
    const add = (r) => {
        [r.x, r.x + r.width / 2, r.x + r.width].forEach(v => xs.push({ v, lo: r.y, hi: r.y + r.height }));
        [r.y, r.y + r.height / 2, r.y + r.height].forEach(v => ys.push({ v, lo: r.x, hi: r.x + r.width }));
    };
    (targets || []).forEach(add);
    if (frame) add({ x: 0, y: 0, width: frame.width, height: frame.height });
    return { xs, ys };
}

/**
 * The closest line to any of `values` within `threshold`:
 * { delta, v } (delta = how far to move), or null.
 */
export function nearestGuide(values, lines, threshold) {
    let best = null;
    values.forEach(c => {
        lines.forEach(l => {
            const d = l.v - c;
            if (Math.abs(d) <= threshold && (!best || Math.abs(d) < Math.abs(best.delta))) best = { delta: d, v: l.v };
        });
    });
    return best;
}

/** Draws the guides (pink lines) for the snaps found, in `container`. */
function paintGuides(container, snaps, box, lines) {
    clearGuides(container);
    const draw = (vertical, v, list) => {
        const hits = list.filter(l => Math.abs(l.v - v) < 0.5);
        const lo = Math.min(...hits.map(l => l.lo), vertical ? box.top : box.left);
        const hi = Math.max(...hits.map(l => l.hi), vertical ? box.bottom : box.right);
        const g = document.createElement('div');
        g.className = `smart-guide ${vertical ? 'smart-guide-v' : 'smart-guide-h'}`;
        if (vertical) Object.assign(g.style, { left: `${v}px`, top: `${lo}px`, height: `${hi - lo}px` });
        else Object.assign(g.style, { top: `${v}px`, left: `${lo}px`, width: `${hi - lo}px` });
        container.appendChild(g);
    };
    if (snaps.x) draw(true, snaps.x.v, lines.xs);
    if (snaps.y) draw(false, snaps.y.v, lines.ys);
}

function clearGuides(container) {
    if (container) container.querySelectorAll(':scope > .smart-guide').forEach(g => g.remove());
}

/**
 * Full drag/resize interaction for one element or a group of selected elements.
 * `groupItems` is an optional array of `{ el, domEl }` for all selected elements.
 */
export function startDragOrResize(domEl, el, e, callbacks, groupItems = null, { allowResize = true, guides = null } = {}) {
    const { sx, sy } = computeScale(domEl, el);
    const { stepX, stepY } = gridSteps();
    // `guides`: { targets, frame } (see guideLines), from the editor.
    const lines = guides ? guideLines(guides.targets, guides.frame) : null;
    const container = domEl.parentElement;
    const thresholdX = GUIDE_SNAP_PX / (sx || 1);
    const thresholdY = GUIDE_SNAP_PX / (sy || 1);

    const startX = e.clientX;
    const startY = e.clientY;
    const orig = { x: el.x, y: el.y, w: el.width, h: el.height };
    let hasDragged = false;

    const [localX, localY] = localPoint(domEl, el, e.clientX, e.clientY);
    const { isLeft, isRight, isTop, isBottom } = edgeHits(el, localX, localY);
    const turned = Number(el.rotate) || 0; // resized in its own frame (no grid / guides)
    const isResizing = allowResize && (isLeft || isRight || isTop || isBottom);

    const activeGroup = (!isResizing && Array.isArray(groupItems) && groupItems.length > 1)
        ? groupItems.map(item => ({
            el: item.el,
            domEl: item.domEl,
            origX: item.el.x,
            origY: item.el.y,
        }))
        : null;

    // useSnap: true/false, or { x, y } to grid-snap one axis only.
    function applyGeometry(newX, newY, newW, newH, useSnap) {
        const snapX = typeof useSnap === 'object' ? useSnap.x : useSnap;
        const snapY = typeof useSnap === 'object' ? useSnap.y : useSnap;
        if (snapX) {
            newX = snapToGridPoint(newX, stepX);
            newW = snapToGridPoint(newW, stepX);
        }
        if (snapY) {
            newY = snapToGridPoint(newY, stepY);
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
        let gridX = useSnap;
        let gridY = useSnap;
        if (useSnap && lines) {
            const b = {
                left: Math.min(...activeGroup.map(i => i.origX)) + rawDx,
                top: Math.min(...activeGroup.map(i => i.origY)) + rawDy,
                right: Math.max(...activeGroup.map(i => i.origX + i.el.width)) + rawDx,
                bottom: Math.max(...activeGroup.map(i => i.origY + i.el.height)) + rawDy,
            };
            const snaps = boxSnaps(b);
            if (snaps.x) { dx += snaps.x.delta; gridX = false; }
            if (snaps.y) { dy += snaps.y.delta; gridY = false; }
            paintGuides(container, snaps, shift(b, dx - rawDx, dy - rawDy), lines);
        } else clearGuides(container);
        if (gridX && state.gridSize > 0) dx = snapToGridPoint(rawDx, stepX);
        if (gridY && state.gridSize > 0) dy = snapToGridPoint(rawDy, stepY);
        activeGroup.forEach(item => {
            item.el.x = item.origX + dx;
            item.el.y = item.origY + dy;
            item.domEl.style.left = `${item.el.x}px`;
            item.domEl.style.top = `${item.el.y}px`;
            item.domEl.style.cursor = 'grabbing';
        });
    }

    /** Guides for a moved box: its left/centre/right and top/middle/bottom. */
    function boxSnaps(b) {
        return {
            x: nearestGuide([b.left, (b.left + b.right) / 2, b.right], lines.xs, thresholdX),
            y: nearestGuide([b.top, (b.top + b.bottom) / 2, b.bottom], lines.ys, thresholdY),
        };
    }

    const shift = (b, dx, dy) => ({ left: b.left + dx, right: b.right + dx, top: b.top + dy, bottom: b.bottom + dy });

    function onMouseMove(moveEvent) {
        // Whole canvas pixels, whatever the zoom (no 999.9999 positions).
        const dx = Math.round((moveEvent.clientX - startX) / sx);
        const dy = Math.round((moveEvent.clientY - startY) / sy);
        if (Math.abs(dx) > DRAG_START_PX || Math.abs(dy) > DRAG_START_PX) hasDragged = true;

        const freeform = moveEvent.altKey;

        if (!isResizing && hasDragged) {
            if (activeGroup) {
                applyGroupMove(dx, dy, !freeform);
            } else {
                let x = orig.x + dx;
                let y = orig.y + dy;
                const grid = { x: !freeform, y: !freeform };
                if (!freeform && lines) {
                    const b = { left: x, top: y, right: x + orig.w, bottom: y + orig.h };
                    const snaps = boxSnaps(b);
                    if (snaps.x) { x += snaps.x.delta; grid.x = false; }
                    if (snaps.y) { y += snaps.y.delta; grid.y = false; }
                    paintGuides(container, snaps, { left: x, top: y, right: x + orig.w, bottom: y + orig.h }, lines);
                } else clearGuides(container);
                applyGeometry(x, y, orig.w, orig.h, grid);
                domEl.style.cursor = 'grabbing';
            }
            callbacks.onGeometryChanged();
        } else if (isResizing) {
            // A turned element: the mouse's movement in its own frame.
            const ar = turned * Math.PI / 180;
            const ldx = turned ? dx * Math.cos(ar) + dy * Math.sin(ar) : dx;
            const ldy = turned ? -dx * Math.sin(ar) + dy * Math.cos(ar) : dy;
            let newW = orig.w;
            let newH = orig.h;
            if (isRight) newW = orig.w + ldx;
            if (isLeft) newW = orig.w - ldx;
            if (isBottom) newH = orig.h + ldy;
            if (isTop) newH = orig.h - ldy;
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
            let newX = isLeft ? orig.x + orig.w - newW : orig.x;
            let newY = isTop ? orig.y + orig.h - newH : orig.y;

            if (turned) {
                // The opposite side stays put in the turned frame: the centre moves
                // by the frame's change, turned.
                const mx = newX + newW / 2 - (orig.x + orig.w / 2);
                const my = newY + newH / 2 - (orig.y + orig.h / 2);
                const cx = orig.x + orig.w / 2 + mx * Math.cos(ar) - my * Math.sin(ar);
                const cy = orig.y + orig.h / 2 + mx * Math.sin(ar) + my * Math.cos(ar);
                applyGeometry(Math.round(cx - newW / 2), Math.round(cy - newH / 2), Math.round(newW), Math.round(newH), false);
                callbacks.onGeometryChanged();
                return;
            }

            // The moving edges snap to guides (not with fixed proportions:
            // snapping each side independently would break the ratio).
            const grid = { x: !freeform && !keepAspect, y: !freeform && !keepAspect };
            if (grid.x && lines) {
                const snaps = {
                    x: (isLeft || isRight) ? nearestGuide([isLeft ? newX : newX + newW], lines.xs, thresholdX) : null,
                    y: (isTop || isBottom) ? nearestGuide([isTop ? newY : newY + newH], lines.ys, thresholdY) : null,
                };
                if (snaps.x && newW - (isLeft ? snaps.x.delta : -snaps.x.delta) >= MIN_SIZE) {
                    if (isLeft) { newX += snaps.x.delta; newW -= snaps.x.delta; } else newW += snaps.x.delta;
                    grid.x = false;
                } else snaps.x = null;
                if (snaps.y && newH - (isTop ? snaps.y.delta : -snaps.y.delta) >= MIN_SIZE) {
                    if (isTop) { newY += snaps.y.delta; newH -= snaps.y.delta; } else newH += snaps.y.delta;
                    grid.y = false;
                } else snaps.y = null;
                paintGuides(container, snaps, { left: newX, top: newY, right: newX + newW, bottom: newY + newH }, lines);
            } else clearGuides(container);
            applyGeometry(newX, newY, newW, newH, grid);
            callbacks.onGeometryChanged();
        }
    }

    function onMouseUp() {
        clearGuides(container);
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