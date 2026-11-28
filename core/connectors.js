// ============================================================
// core/connectors.js — Lines attached to shapes: a path element whose
// ends name an element and a side follows it when it moves or resizes.
//
//   .element.path id:30 from:12@right to:{Model}@left route:elbow end:arrow
//
// An end is `<id>@<side>` or `{<name>}@<side>` (a name when the target has
// a unique one: it reads better and survives copying); the side is top,
// right, bottom, left, center or auto (the side facing the other end).
// Routes: straight, curved (an S leaving each side square), elbow
// (horizontal / vertical segments). The points stay in the file too, so
// it draws as last laid out anywhere. Targets are looked for in the
// connector's own container (slide, group, master, macro), groups
// included; one that is gone leaves the line where it was.
// ============================================================

import { state } from './state.js';

export const SIDES = ['auto', 'top', 'right', 'bottom', 'left', 'center'];
export const ROUTES = ['straight', 'curved', 'elbow'];
const NORMALS = { top: [0, -1], right: [1, 0], bottom: [0, 1], left: [-1, 0], center: [0, 0] };

/** "12@right" / "{Model}@left" / "12" -> { id | name, side } or null. */
export function parseEnd(spec) {
    if (spec === undefined || spec === null || spec === '') return null;
    const m = String(spec).trim().match(/^(?:\{([^}]+)\}|(\d+))(?:@([a-z]+))?$/);
    if (!m) return null;
    const side = SIDES.includes(m[3]) ? m[3] : 'auto';
    return m[1] !== undefined ? { name: m[1], side } : { id: Number(m[2]), side };
}

/** How to write an end attached to `target` among `elements`: by name if unique. */
export function formatEnd(target, side, elements) {
    let count = 0;
    if (target.name) forEachDeep(elements, el => { if (el.name === target.name) count += 1; });
    const ref = target.name && count === 1 && !/[{}@]/.test(target.name) ? `{${target.name}}` : String(target.id);
    return `${ref}@${SIDES.includes(side) ? side : 'auto'}`;
}

function forEachDeep(elements, fn) {
    (elements || []).forEach(el => {
        fn(el);
        if (Array.isArray(el.children)) forEachDeep(el.children, fn);
    });
}

/** The box of the element `end` names, in the coordinates of `elements` (groups' children transformed). */
export function findTarget(elements, end, self = null) {
    if (!end) return null;
    const walk = (list, ox, oy, sx, sy) => {
        for (const el of list || []) {
            if (el === self) continue;
            const hit = end.id !== undefined ? el.id === end.id : el.name === end.name;
            const box = { x: ox + el.x * sx, y: oy + el.y * sy, width: el.width * sx, height: el.height * sy, rotate: Number(el.rotate) || 0, el };
            if (hit) return box;
            if (Array.isArray(el.children) && el.type !== 'macro') {
                const gsx = el.width / (el.frameWidth || el.width || 1);
                const gsy = el.height / (el.frameHeight || el.height || 1);
                const found = walk(el.children, box.x, box.y, sx * gsx, sy * gsy);
                if (found) return found;
            }
        }
        return null;
    };
    return walk(elements, 0, 0, 1, 1);
}

/** A point of a box's side and the direction leaving it (rotated with the box). */
export function anchor(box, side) {
    const cx = box.x + box.width / 2;
    const cy = box.y + box.height / 2;
    const local = {
        top: [0, -box.height / 2], right: [box.width / 2, 0], bottom: [0, box.height / 2],
        left: [-box.width / 2, 0], center: [0, 0],
    }[side] || [0, 0];
    const a = (box.rotate || 0) * Math.PI / 180;
    const turn = ([x, y]) => [x * Math.cos(a) - y * Math.sin(a), x * Math.sin(a) + y * Math.cos(a)];
    const [dx, dy] = turn(local);
    return { point: [cx + dx, cy + dy], normal: turn(NORMALS[side] || [0, 0]) };
}

/** The side of `box` facing `toward` (a point). */
export function facingSide(box, toward) {
    const cx = box.x + box.width / 2;
    const cy = box.y + box.height / 2;
    const a = -(box.rotate || 0) * Math.PI / 180;
    const vx = toward[0] - cx;
    const vy = toward[1] - cy;
    const lx = vx * Math.cos(a) - vy * Math.sin(a);
    const ly = vx * Math.sin(a) + vy * Math.cos(a);
    // compared in the box's proportions, so a wide box is left / right more often
    return Math.abs(lx) / (box.width || 1) >= Math.abs(ly) / (box.height || 1)
        ? (lx >= 0 ? 'right' : 'left') : (ly >= 0 ? 'bottom' : 'top');
}

/** Points (and curve mode) of a route from a to b leaving along na, arriving along nb. */
export function route(a, na, b, nb, kind) {
    const dist = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
    if (kind === 'curved') {
        const k = Math.max(30, dist * 0.4);
        const dir = (n, from, to) => (n[0] || n[1] ? n : [(to[0] - from[0]) / dist, (to[1] - from[1]) / dist]);
        const da = dir(na, a, b);
        const db = dir(nb, b, a);
        return { points: [a, [a[0] + da[0] * k, a[1] + da[1] * k], [b[0] + db[0] * k, b[1] + db[1] * k], b], curve: 'bezier' };
    }
    if (kind === 'elbow') {
        const horizontal = (n) => Math.abs(n[0]) >= Math.abs(n[1]) && (n[0] || n[1]);
        const ha = na[0] || na[1] ? horizontal(na) : Math.abs(b[0] - a[0]) >= Math.abs(b[1] - a[1]);
        const hb = nb[0] || nb[1] ? horizontal(nb) : ha;
        let pts;
        if (ha && hb) {
            const mx = (a[0] + b[0]) / 2;
            pts = [a, [mx, a[1]], [mx, b[1]], b];
        } else if (!ha && !hb) {
            const my = (a[1] + b[1]) / 2;
            pts = [a, [a[0], my], [b[0], my], b];
        } else if (ha) {
            pts = [a, [b[0], a[1]], b];
        } else {
            pts = [a, [a[0], b[1]], b];
        }
        // no zero-length steps
        pts = pts.filter((p, i) => i === 0 || Math.hypot(p[0] - pts[i - 1][0], p[1] - pts[i - 1][1]) > 0.01);
        return { points: pts, curve: 'straight' };
    }
    return { points: [a, b], curve: 'straight' };
}

/** Whether a path element is attached at either end. */
export function isConnector(el) {
    return Boolean(el && el.type === 'path' && (parseEnd(el.from) || parseEnd(el.to)));
}

const MIN_BOX = 1;
const r2 = (v) => Math.round(v * 100) / 100;
const r4 = (v) => Math.round(v * 10000) / 10000;

/** Box + fractional points for absolute points (as path.js stores them). */
function storePoints(el, pts) {
    const xs = pts.map(p => p[0]);
    const ys = pts.map(p => p[1]);
    let x = Math.min(...xs);
    let y = Math.min(...ys);
    let w = Math.max(...xs) - x;
    let h = Math.max(...ys) - y;
    if (w < MIN_BOX) { x -= (MIN_BOX - w) / 2; w = MIN_BOX; }
    if (h < MIN_BOX) { y -= (MIN_BOX - h) / 2; h = MIN_BOX; }
    el.x = r2(x);
    el.y = r2(y);
    el.width = r2(w);
    el.height = r2(h);
    el.points = pts.map(([px, py]) => [r4((px - x) / w), r4((py - y) / h)]);
}

/** Recomputes one connector from its targets in `elements` (its container). Returns true if it changed. */
export function updateConnector(el, elements) {
    const fromEnd = parseEnd(el.from);
    const toEnd = parseEnd(el.to);
    if (!fromEnd && !toEnd) return false;
    const pts = (el.points || []).map(([fx, fy]) => [el.x + fx * el.width, el.y + fy * el.height]);
    const freeA = pts[0] || [el.x, el.y];
    const freeB = pts[pts.length - 1] || [el.x + el.width, el.y + el.height];
    const boxA = fromEnd && findTarget(elements, fromEnd, el);
    const boxB = toEnd && findTarget(elements, toEnd, el);
    if (!boxA && !boxB) return false;
    const centre = (b) => [b.x + b.width / 2, b.y + b.height / 2];
    const otherA = boxB ? centre(boxB) : freeB;
    const otherB = boxA ? centre(boxA) : freeA;
    const end = (box, spec, other, free) => {
        if (!box) return { point: free, normal: [0, 0] };
        const side = spec.side === 'auto' ? facingSide(box, other) : spec.side;
        return anchor(box, side);
    };
    const A = end(boxA, fromEnd, otherA, freeA);
    const B = end(boxB, toEnd, otherB, freeB);
    const { points, curve } = route(A.point, A.normal, B.point, B.normal, el.route || 'straight');
    const before = JSON.stringify([el.x, el.y, el.width, el.height, el.points, el.curve]);
    storePoints(el, points);
    if (curve === 'bezier') el.curve = 'bezier';
    else if (el.curve === 'bezier') delete el.curve;
    return before !== JSON.stringify([el.x, el.y, el.width, el.height, el.points, el.curve]);
}

/** All connectors of a container (and inside its groups, each in its own frame). */
export function updateConnectors(elements) {
    let changed = [];
    (elements || []).forEach(el => {
        if (isConnector(el) && updateConnector(el, elements)) changed.push(el);
        if (Array.isArray(el.children) && el.type === 'group') changed = changed.concat(updateConnectors(el.children));
    });
    return changed;
}

/** Every connector of the project (slides, masters, macro definitions). */
export function updateAllConnectors() {
    (state.slides || []).forEach(s => updateConnectors(s.elements));
    (state.masters || []).forEach(m => updateConnectors(m.elements));
    Object.values(state.macros || {}).forEach(m => updateConnectors(m.children));
}

/**
 * After pasting / duplicating `pasted` (elements whose ids were renumbered:
 * `idMap` old -> new): connectors among them attach to the pasted copies;
 * ends whose target wasn't pasted stay attached only if it is still in
 * `container` (pasted on the same slide), else they come loose.
 */
export function remapConnectors(pasted, idMap, container) {
    const pastedByName = new Map();
    forEachDeep(pasted, el => { if (el.name) pastedByName.set(el.name, el); });
    forEachDeep(pasted, el => {
        if (el.type !== 'path') return;
        for (const key of ['from', 'to']) {
            const end = parseEnd(el[key]);
            if (!end) continue;
            if (end.name !== undefined) {
                // the name is now on the copy too: point at the copy
                if (pastedByName.has(end.name)) el[key] = `${pastedByName.get(end.name).id}@${end.side}`;
                else if (!findTarget(container, end)) delete el[key];
            } else if (idMap.has(end.id)) el[key] = `${idMap.get(end.id)}@${end.side}`;
            else if (!findTarget(container, end)) delete el[key];
        }
    });
}

/**
 * For the exported HTML: a connector whose shapes follow the variables
 * (formulas) is redrawn there as they move (core/liveEngine.js
 * liveConnectors). Its ends as ids and sides, its route and its free ends
 * (absolute points); null when nothing it is attached to moves.
 */
export function connectorExportSpec(el) {
    if (!isConnector(el)) return null;
    let container = null;
    const lists = [...(state.slides || []).map(s => s.elements), ...(state.masters || []).map(m => m.elements)];
    for (const list of lists) if ((list || []).includes(el)) { container = list; break; }
    if (!container) return null;
    const moves = (t) => Boolean(t && t.el && t.el.formulas && Object.keys(t.el.formulas).length);
    const ends = {};
    let any = false;
    for (const key of ['from', 'to']) {
        const end = parseEnd(el[key]);
        const t = end && findTarget(container, end, el);
        // only top-level shapes (a group's children are in its frame)
        if (t && container.includes(t.el)) { ends[key] = { id: t.el.id, side: end.side }; any = any || moves(t); }
    }
    if (!any) return null;
    const pts = (el.points || []).map(([fx, fy]) => [el.x + fx * el.width, el.y + fy * el.height]);
    return { ...ends, route: el.route || 'straight', free: [pts[0], pts[pts.length - 1]] };
}
