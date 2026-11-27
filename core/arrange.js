// ============================================================
// core/arrange.js — Arranging objects: align, distribute, layer order
// and locking. Pure functions on an element list (a slide's, a
// master's or an entered group's) and the selected indices.
//
//   align       one object: to the slide (or the group being edited);
//               several: to the box around them
//   distribute  three or more: equal gaps, the outer two stay put
//   order       front / forward / backward / back: the list order is
//               the drawing order (later = on top), as in the .gl file
//   locked:yes  can't be moved or resized by dragging, arrows, align or
//               distribute; dragging on it selects with a rectangle, so a
//               locked background never gets in the way
// ============================================================

export const isLocked = (el) => Boolean(el) && el.locked === 'yes';

/** The box an element covers on screen: a turned one's outer bounding box. */
export function visualBox(el) {
    const a = (Number(el.rotate) || 0) * Math.PI / 180;
    if (!a) return { x: el.x, y: el.y, width: el.width, height: el.height };
    const c = Math.abs(Math.cos(a));
    const s = Math.abs(Math.sin(a));
    const w = el.width * c + el.height * s;
    const h = el.width * s + el.height * c;
    return { x: el.x + el.width / 2 - w / 2, y: el.y + el.height / 2 - h / 2, width: w, height: h };
}

function bounds(els) {
    const boxes = els.map(visualBox);
    const left = Math.min(...boxes.map(e => e.x));
    const top = Math.min(...boxes.map(e => e.y));
    const right = Math.max(...boxes.map(e => e.x + e.width));
    const bottom = Math.max(...boxes.map(e => e.y + e.height));
    return { left, top, right, bottom };
}

/**
 * Aligns the selected objects. `mode`: left | center | right | top |
 * middle | bottom. `frame` ({width, height}) is the area a single object
 * is aligned in. Returns how many objects moved.
 */
export function alignElements(elements, indices, mode, frame) {
    const sel = indices.map(i => elements[i]).filter(Boolean);
    const movable = sel.filter(e => !isLocked(e));
    if (!movable.length) return 0;
    // Several objects: their box (locked ones count, as anchors).
    const b = sel.length > 1 ? bounds(sel) : { left: 0, top: 0, right: frame.width, bottom: frame.height };
    let moved = 0;
    movable.forEach(el => {
        const before = [el.x, el.y];
        // what is placed is the box it covers (turned elements: their bounding box)
        const v = visualBox(el);
        const ox = v.x - el.x;
        const oy = v.y - el.y;
        if (mode === 'left') el.x = b.left - ox;
        else if (mode === 'center') el.x = (b.left + b.right) / 2 - v.width / 2 - ox;
        else if (mode === 'right') el.x = b.right - v.width - ox;
        else if (mode === 'top') el.y = b.top - oy;
        else if (mode === 'middle') el.y = (b.top + b.bottom) / 2 - v.height / 2 - oy;
        else if (mode === 'bottom') el.y = b.bottom - v.height - oy;
        el.x = Math.round(el.x * 100) / 100;
        el.y = Math.round(el.y * 100) / 100;
        if (el.x !== before[0] || el.y !== before[1]) moved++;
    });
    return moved;
}

/**
 * Spreads three or more objects with equal gaps between them along
 * `axis` ('x' | 'y'), in their current order; the first and last stay
 * (locked ones in between stay too and are spaced around).
 */
export function distributeElements(elements, indices, axis) {
    const sel = indices.map(i => elements[i]).filter(Boolean);
    if (sel.length < 3) return 0;
    const pos = axis === 'x' ? 'x' : 'y';
    const size = axis === 'x' ? 'width' : 'height';
    // spaced by the boxes they cover (turned elements: their bounding box)
    const items = sel.map(el => ({ el, v: visualBox(el) }));
    const sorted = items.sort((a, b) => (a.v[pos] + a.v[size] / 2) - (b.v[pos] + b.v[size] / 2));
    const first = sorted[0].v;
    const last = sorted[sorted.length - 1].v;
    const span = last[pos] + last[size] - first[pos];
    const total = sorted.reduce((sum, e) => sum + e.v[size], 0);
    const gap = (span - total) / (sorted.length - 1);
    let cursor = first[pos] + first[size] + gap;
    let moved = 0;
    sorted.slice(1, -1).forEach(({ el, v }) => {
        let at = v[pos];
        if (!isLocked(el)) {
            const next = Math.round((cursor - (v[pos] - el[pos])) * 100) / 100;
            if (next !== el[pos]) moved++;
            at += next - el[pos];
            el[pos] = next;
        }
        cursor = at + v[size] + gap;
    });
    return moved;
}

/**
 * Changes the drawing order of the selected objects. `op`: front |
 * forward | backward | back. Reorders `elements` in place (keeping the
 * array, which may be a group's children) and returns the new indices
 * of the selected objects, in the order given.
 */
export function reorderElements(elements, indices, op) {
    const chosen = new Set(indices.filter(i => elements[i]).map(i => elements[i]));
    if (!chosen.size) return indices;
    let list = [...elements];
    if (op === 'front') {
        list = [...list.filter(e => !chosen.has(e)), ...list.filter(e => chosen.has(e))];
    } else if (op === 'back') {
        list = [...list.filter(e => chosen.has(e)), ...list.filter(e => !chosen.has(e))];
    } else if (op === 'forward') {
        // From the top down: each selected object hops over the next unselected one.
        for (let i = list.length - 2; i >= 0; i--) {
            if (chosen.has(list[i]) && !chosen.has(list[i + 1])) [list[i], list[i + 1]] = [list[i + 1], list[i]];
        }
    } else if (op === 'backward') {
        for (let i = 1; i < list.length; i++) {
            if (chosen.has(list[i]) && !chosen.has(list[i - 1])) [list[i], list[i - 1]] = [list[i - 1], list[i]];
        }
    }
    const old = indices.map(i => elements[i]);
    elements.splice(0, elements.length, ...list);
    return old.map(el => elements.indexOf(el));
}

/** Whether `op` would change anything (to grey out the buttons). */
export function canReorder(elements, indices, op) {
    if (!indices.length) return false;
    const n = elements.length;
    const set = new Set(indices);
    if (op === 'front' || op === 'forward') return [...set].some(i => [...Array(n - i - 1)].some((_, k) => !set.has(i + k + 1)));
    return [...set].some(i => [...Array(i)].some((_, k) => !set.has(k)));
}

/** Locks (or unlocks) the selected objects. */
export function setLocked(elements, indices, locked) {
    indices.forEach(i => {
        const el = elements[i];
        if (!el) return;
        if (locked) el.locked = 'yes';
        else delete el.locked;
    });
}
