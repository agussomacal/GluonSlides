// ============================================================
// elements/path/path.js — Lines, arrows, curves, polygons and
// freehand strokes: one element type drawn as SVG.
//
//   .element.path id:9 x:200 y:200 width:500 height:300 curve:smooth end:arrow stroke:#0f172a strokeWidth:4
//   	0 0.8
//   	0.3 0.1
//   	1 0.2
//
// Body lines are the points, as fractions (0..1) of the element box,
// so resizing the box reshapes the path. Parameters:
//   curve     straight (polyline, default) | smooth (Catmull-Rom spline
//             through every point)
//   closed    yes | no (default)
//   fill      none (default) | color — for closed paths
//   stroke, strokeWidth, dash (solid | dashed | dotted)
//   start, end   none (default) | arrow | dot — markers on open paths
//   from, to  attached ends: <id>@<side> or {<name>}@<side>, with
//             route straight | curved | elbow (core/connectors.js); the
//             points then follow the shapes (curve:bezier for curved)
//
// Editing: drag point handles; drag corner handles to scale (Shift
// keeps proportions); double-click the stroke to add a point and a
// point handle to remove it. Toolbar variants are drawn with
// editor/tools.js (create: 'drag' | 'points' | 'freehand').
// ============================================================

import { state, markDirty } from '../../core/state.js';
import { ElementRegistry } from '../../core/registry.js';
import { escapeHtml } from '../../core/render.js';
import { colorField } from '../../ui/colorPicker.js';
import { parseEnd } from '../../core/connectors.js';

const MIN_BOX = 1;              // a horizontal line still gets a 1px-tall box
const round = (v, d = 4) => Math.round(v * 10 ** d) / 10 ** d;
const fmt = (v) => String(round(v, 2));

let markerSeq = 0;              // unique SVG marker ids across the page

// ---------- Geometry helpers (exported for the drawing tools) ----------

/**
 * Box + fractional points from absolute points (parent coordinates).
 * Degenerate dimensions are padded to MIN_BOX around the points.
 */
export function normalizePoints(absPoints) {
    const xs = absPoints.map(p => p[0]);
    const ys = absPoints.map(p => p[1]);
    let x = Math.min(...xs);
    let y = Math.min(...ys);
    let width = Math.max(...xs) - x;
    let height = Math.max(...ys) - y;
    if (width < MIN_BOX) { x -= (MIN_BOX - width) / 2; width = MIN_BOX; }
    if (height < MIN_BOX) { y -= (MIN_BOX - height) / 2; height = MIN_BOX; }
    return {
        x: round(x, 2), y: round(y, 2), width: round(width, 2), height: round(height, 2),
        points: absPoints.map(([px, py]) => [round((px - x) / width), round((py - y) / height)]),
    };
}

/** Absolute points (parent coordinates) of a path element. */
function absolutePoints(el) {
    return (el.points || []).map(([fx, fy]) => [el.x + fx * el.width, el.y + fy * el.height]);
}

/** SVG path data through `pts` ([[x, y], ...] in drawing units). */
export function pathData(pts, { smooth = false, closed = false, bezier = false } = {}) {
    if (pts.length === 0) return '';
    const P = (p) => `${fmt(p[0])},${fmt(p[1])}`;
    // Cubic Bézier: start, then (control, control, end) triples (curved connectors).
    if (bezier && pts.length >= 4 && (pts.length - 1) % 3 === 0) {
        let d = `M${P(pts[0])}`;
        for (let i = 1; i + 2 < pts.length; i += 3) d += ` C${P(pts[i])} ${P(pts[i + 1])} ${P(pts[i + 2])}`;
        return d;
    }
    if (!smooth || pts.length < 3) {
        return `M${pts.map(P).join(' L')}${closed && pts.length > 2 ? ' Z' : ''}`;
    }
    // Catmull-Rom spline through every point, as cubic Béziers.
    const n = pts.length;
    const at = (i) => (closed ? pts[(i + n) % n] : pts[Math.max(0, Math.min(n - 1, i))]);
    let d = `M${P(pts[0])}`;
    const segments = closed ? n : n - 1;
    for (let i = 0; i < segments; i++) {
        const [p0, p1, p2, p3] = [at(i - 1), at(i), at(i + 1), at(i + 2)];
        const c1 = [p1[0] + (p2[0] - p0[0]) / 6, p1[1] + (p2[1] - p0[1]) / 6];
        const c2 = [p2[0] - (p3[0] - p1[0]) / 6, p2[1] - (p3[1] - p1[1]) / 6];
        d += ` C${P(c1)} ${P(c2)} ${P(p2)}`;
    }
    return closed ? `${d} Z` : d;
}

/** Ramer–Douglas–Peucker simplification (for freehand strokes). */
export function simplifyPoints(pts, epsilon) {
    if (pts.length < 3) return pts.slice();
    const [ax, ay] = pts[0];
    const [bx, by] = pts[pts.length - 1];
    const len = Math.hypot(bx - ax, by - ay) || 1;
    let maxDist = -1;
    let index = 0;
    for (let i = 1; i < pts.length - 1; i++) {
        const [px, py] = pts[i];
        const dist = Math.abs((bx - ax) * (ay - py) - (ax - px) * (by - ay)) / len;
        if (dist > maxDist) { maxDist = dist; index = i; }
    }
    if (maxDist <= epsilon) return [pts[0], pts[pts.length - 1]];
    const left = simplifyPoints(pts.slice(0, index + 1), epsilon);
    const right = simplifyPoints(pts.slice(index), epsilon);
    return left.slice(0, -1).concat(right);
}

function distanceToSegment([px, py], [ax, ay], [bx, by]) {
    const dx = bx - ax;
    const dy = by - ay;
    const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy || 1)));
    return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}

function applyNormalized(el, absPoints) {
    Object.assign(el, normalizePoints(absPoints));
}

// ---------- Rendering ----------

function dashArray(el) {
    const w = Number(el.strokeWidth) || 1;
    if (el.dash === 'dashed') return `${fmt(w * 3)} ${fmt(w * 2)}`;
    if (el.dash === 'dotted') return `0 ${fmt(w * 2)}`;
    return '';
}

function markerDef(id, kind, color) {
    if (kind === 'arrow') {
        return `<marker id="${id}" viewBox="0 0 10 10" refX="7" refY="5" markerWidth="4" markerHeight="4"`
            + ` orient="auto-start-reverse" markerUnits="strokeWidth">`
            + `<path d="M0,0 L10,5 L0,10 z" fill="${escapeHtml(color)}"/></marker>`;
    }
    if (kind === 'dot') {
        return `<marker id="${id}" viewBox="0 0 10 10" refX="5" refY="5" markerWidth="3" markerHeight="3"`
            + ` markerUnits="strokeWidth"><circle cx="5" cy="5" r="5" fill="${escapeHtml(color)}"/></marker>`;
    }
    return '';
}

/** Complete <svg> markup for a path element. */
function svgMarkup(el, { interactive = false } = {}) {
    const w = el.width || MIN_BOX;
    const h = el.height || MIN_BOX;
    const pts = (el.points || []).map(([fx, fy]) => [fx * w, fy * h]);
    const closed = el.closed === 'yes';
    const d = pathData(pts, { smooth: el.curve === 'smooth', bezier: el.curve === 'bezier', closed });
    const stroke = el.stroke || '#0f172a';
    const sw = Number(el.strokeWidth) || 1;
    // "None" in the color picker is stored as transparent: same as no fill.
    const fill = closed && el.fill && el.fill !== 'none' && el.fill !== 'transparent' ? el.fill : 'none';

    let defs = '';
    let markers = '';
    if (!closed) {
        const seq = ++markerSeq;
        for (const [end, kind] of [['start', el.start], ['end', el.end]]) {
            if (kind !== 'arrow' && kind !== 'dot') continue;
            const id = `gl-m${seq}-${end}`;
            defs += markerDef(id, kind, stroke);
            markers += ` marker-${end}="url(#${id})"`;
        }
    }
    const dash = dashArray(el);
    const visible = `<path d="${d}" fill="${escapeHtml(fill)}" stroke="${escapeHtml(stroke)}" stroke-width="${fmt(sw)}"`
        + ` stroke-linecap="round" stroke-linejoin="round"${dash ? ` stroke-dasharray="${dash}"` : ''}${markers}/>`;
    // A wide invisible copy of the stroke makes thin lines easy to click.
    const hit = interactive
        ? `<path class="path-hit" d="${d}" fill="${fill === 'none' ? 'none' : 'transparent'}" stroke="transparent"`
            + ` stroke-width="${fmt(Math.max(16, sw + 12))}" pointer-events="${fill === 'none' ? 'stroke' : 'all'}"/>`
        : '';
    return `<svg class="path-svg" xmlns="http://www.w3.org/2000/svg" width="100%" height="100%"`
        + ` viewBox="0 0 ${fmt(w)} ${fmt(h)}" preserveAspectRatio="none"`
        + ` style="position:absolute; left:0; top:0; overflow:visible; pointer-events:none;">`
        + `${defs ? `<defs>${defs}</defs>` : ''}${visible}${hit}</svg>`;
}

// ---------- Element ----------

const solid = () => (state.isDarkMode ? '#f8fafc' : '#0f172a');

const PathElement = {
    type: 'path',
    label: 'Add Line',
    icon: '╱',
    className: 'element-path',
    category: 'lines',
    boxResize: false,   // resized with corner handles instead of box edges
    boxStyle: false,    // no background/border section in the properties panel

    // `create` tells editor/tools.js how the variant is drawn. Closed
    // variants are listed under Shapes (variant-level `category`); they
    // differ from the open ones only by their closed/fill defaults.
    variants: [
        { id: 'line', label: 'Line', icon: '╱', create: 'drag', preset: () => ({}) },
        { id: 'arrow', label: 'Arrow', icon: '→', create: 'drag', preset: () => ({ end: 'arrow' }) },
        { id: 'double-arrow', label: 'Double arrow', icon: '↔', create: 'drag', preset: () => ({ start: 'arrow', end: 'arrow' }) },
        { id: 'curve', label: 'Curve', icon: '∿', create: 'points', preset: () => ({ curve: 'smooth' }) },
        { id: 'curved-arrow', label: 'Curved arrow', icon: '⤳', create: 'points', preset: () => ({ curve: 'smooth', end: 'arrow' }) },
        { id: 'freehand', label: 'Freehand', icon: '✎', create: 'freehand', preset: () => ({ curve: 'smooth' }) },
        { id: 'polygon', label: 'Polygon', icon: '⬠', category: 'shapes', create: 'points', preset: () => ({ closed: 'yes', fill: '#93c5fd' }) },
        { id: 'blob', label: 'Closed curve', icon: '⬯', category: 'shapes', create: 'points', preset: () => ({ curve: 'smooth', closed: 'yes', fill: '#f9a8d4' }) },
        { id: 'freehand-shape', label: 'Freehand shape', icon: '✍', category: 'shapes', create: 'freehand', preset: () => ({ curve: 'smooth', closed: 'yes', fill: '#bbf7d0' }) },
    ],

    gl: {
        props: ['x', 'y', 'width', 'height', 'curve', 'closed', 'fill', 'stroke', 'strokeWidth', 'dash', 'start', 'end',
            'from', 'to', 'route'], // attached ends (core/connectors.js)
        numericProps: ['x', 'y', 'width', 'height', 'strokeWidth'],
        body: 'points',
        serializeBody(el) {
            const pts = el.points || [];
            return pts.length ? pts.map(([x, y]) => `\t${round(x)} ${round(y)}`).join('\n') : null;
        },
        parseBody(text, el) {
            el.points = text.split('\n')
                .map(l => l.trim().split(/[\s,]+/).map(Number))
                .filter(p => p.length >= 2 && p.every(Number.isFinite))
                .map(([x, y]) => [x, y]);
        },
    },

    defaults() {
        const scale = state.slideWidth / 1920;
        return {
            type: 'path',
            x: 0, y: 0, width: Math.round(300 * scale), height: MIN_BOX,
            stroke: solid(),
            strokeWidth: Math.max(1, Math.round(4 * scale)),
            points: [[0, 0.5], [1, 0.5]],
        };
    },

    /** Name shown as "Object Type" in the properties panel. */
    typeLabel(el) {
        const smooth = el.curve === 'smooth';
        if (el.closed === 'yes') return smooth ? 'Closed curve' : 'Polygon';
        if (smooth) return el.end === 'arrow' || el.start === 'arrow' ? 'Curved arrow' : 'Curve';
        if ((el.points || []).length > 2) return 'Polyline';
        return el.end === 'arrow' || el.start === 'arrow' ? 'Arrow' : 'Line';
    },

    /** Builds the element from points drawn by a tool (parent coordinates). */
    fromPoints(absPoints) {
        return normalizePoints(absPoints);
    },

    renderDom(domEl, el, ctx) {
        const interactive = ctx.context === 'canvas';
        domEl.style.backgroundColor = 'transparent';
        domEl.style.borderWidth = '0px';
        // Only the stroke (or fill) is clickable, not the empty box.
        if (interactive) domEl.style.pointerEvents = 'none';
        domEl.innerHTML = svgMarkup(el, { interactive });

        if (interactive) {
            domEl.ondblclick = (e) => {
                if (e.target.closest('.el-handle')) return;
                e.stopPropagation();
                const r = domEl.getBoundingClientRect();
                const px = el.x + (e.clientX - r.left) / (r.width / (el.width || 1));
                const py = el.y + (e.clientY - r.top) / (r.height / (el.height || 1));
                PathElement.insertPoint(el, px, py);
                markDirty();
                document.dispatchEvent(new CustomEvent('slide-content-changed'));
            };
        }
    },

    exportStyle() {
        return 'background-color:transparent; border:none; overflow:visible;';
    },

    exportInner(el) {
        return svgMarkup(el);
    },

    // ---------- Handles (drawn by the editor when selected) ----------

    /** Handle positions in box-local units. */
    handles(el) {
        const pts = (el.points || []).map(([fx, fy], i) => ({ id: `p${i}`, kind: 'point', x: fx * el.width, y: fy * el.height }));
        if (pts.length <= 2 && el.closed !== 'yes') return pts; // a line: just its ends
        const corners = [['nw', 0, 0], ['ne', 1, 0], ['sw', 0, 1], ['se', 1, 1]]
            .map(([id, fx, fy]) => ({ id, kind: 'corner', x: fx * el.width, y: fy * el.height }));
        return [...corners, ...pts];
    },

    /** Moves handle `id` to (px, py) in parent coordinates. */
    dragHandle(el, id, px, py, { shiftKey = false, start = null } = {}) {
        if (id.startsWith('p')) {
            const abs = absolutePoints(el);
            const i = Number(id.slice(1));
            let [nx, ny] = [px, py];
            // Shift on a line end: snap the angle to 45° steps.
            if (shiftKey && abs.length === 2) {
                const [ox, oy] = abs[1 - i];
                const angle = Math.round(Math.atan2(py - oy, px - ox) / (Math.PI / 4)) * (Math.PI / 4);
                const len = Math.hypot(px - ox, py - oy);
                [nx, ny] = [ox + Math.cos(angle) * len, oy + Math.sin(angle) * len];
            }
            abs[i] = [nx, ny];
            applyNormalized(el, abs);
            return;
        }
        // Corner: scale the box; fractional points follow. `start` is the
        // box when the drag began, so the opposite corner stays put.
        const b = start || { x: el.x, y: el.y, width: el.width, height: el.height };
        const fixedX = id.includes('w') ? b.x + b.width : b.x;
        const fixedY = id.includes('n') ? b.y + b.height : b.y;
        let w = Math.max(MIN_BOX, Math.abs(px - fixedX));
        let h = Math.max(MIN_BOX, Math.abs(py - fixedY));
        if (shiftKey && b.width > 0 && b.height > 0) {
            const k = Math.max(w / b.width, h / b.height);
            w = b.width * k;
            h = b.height * k;
        }
        el.width = round(w, 2);
        el.height = round(h, 2);
        el.x = round(id.includes('w') ? fixedX - w : fixedX, 2);
        el.y = round(id.includes('n') ? fixedY - h : fixedY, 2);
    },

    /** Adds a point on the segment nearest to (px, py). */
    insertPoint(el, px, py) {
        const abs = absolutePoints(el);
        const closed = el.closed === 'yes';
        const segments = closed ? abs.length : abs.length - 1;
        let best = 0;
        let bestDist = Infinity;
        for (let i = 0; i < segments; i++) {
            const dist = distanceToSegment([px, py], abs[i], abs[(i + 1) % abs.length]);
            if (dist < bestDist) { bestDist = dist; best = i; }
        }
        abs.splice(best + 1, 0, [px, py]);
        applyNormalized(el, abs);
    },

    /** Removes point `index` (paths keep at least two points). */
    removePoint(el, index) {
        const abs = absolutePoints(el);
        if (abs.length <= 2) return false;
        abs.splice(index, 1);
        applyNormalized(el, abs);
        return true;
    },

    properties(el) {
        const closed = el.closed === 'yes';
        const opt = (value, current, label) => `<option value="${value}" ${current === value ? 'selected' : ''}>${label}</option>`;
        const markerSelect = (prop) => `
            <select class="prop-control" data-prop="${prop}">
                ${opt('none', el[prop] || 'none', 'None')}${opt('arrow', el[prop], 'Arrow')}${opt('dot', el[prop], 'Dot')}
            </select>`;
        return `
            <div class="prop-divider"></div>
            <div class="prop-row">
                <div class="prop-group">
                    <label>Stroke</label>
                    ${colorField({ 'data-prop': 'stroke' }, el.stroke, { allowNone: false })}
                </div>
                <div class="prop-group">
                    <label>Width (px)</label>
                    <input type="number" class="prop-control" min="0.5" step="0.5" value="${Number(el.strokeWidth) || 1}" data-prop="strokeWidth">
                </div>
            </div>
            <div class="prop-row">
                <div class="prop-group">
                    <label>Line Style</label>
                    <select class="prop-control" data-prop="dash">
                        ${opt('solid', el.dash || 'solid', 'Solid')}${opt('dashed', el.dash, 'Dashed')}${opt('dotted', el.dash, 'Dotted')}
                    </select>
                </div>
                <div class="prop-group">
                    <label>Curve</label>
                    <select class="prop-control" data-prop="curve">
                        ${opt('straight', el.curve || 'straight', 'Straight')}${opt('smooth', el.curve, 'Smooth')}
                    </select>
                </div>
            </div>
            ${closed ? `
            <div class="prop-group">
                <label>Fill</label>
                ${colorField({ 'data-prop': 'fill' }, el.fill || 'none')}
            </div>` : `
            <div class="prop-row">
                <div class="prop-group"><label>Start</label>${markerSelect('start')}</div>
                <div class="prop-group"><label>End</label>${markerSelect('end')}</div>
            </div>`}
            <label class="prop-check">
                <input type="checkbox" data-prop="closed" ${closed ? 'checked' : ''}>
                Closed shape
            </label>
            ${closed ? '' : connectorSection(el)}
            <p class="prop-hint">Drag the points to reshape. Double-click the line to add a point, double-click a point to remove it. Shift: 45° angles / keep proportions.</p>
        `;
    },

    actions: {
        detach(elIndex, which, el) {
            if (which === 'from' || which === 'both') delete el.from;
            if (which === 'to' || which === 'both') delete el.to;
            if (!el.from && !el.to) delete el.route;
        },
    },
};

/** Panel: what the line's ends are attached to, the route, and detaching. */
function connectorSection(el) {
    const describe = (spec) => {
        const end = parseEnd(spec);
        if (!end) return '<span class="prop-hint">not attached</span>';
        const who = end.name !== undefined ? `“${escapeHtml(end.name)}”` : `#${end.id}`;
        return `${who} · ${end.side}`;
    };
    const attached = parseEnd(el.from) || parseEnd(el.to);
    const opt = (v, label) => `<option value="${v}" ${(el.route || 'straight') === v ? 'selected' : ''}>${label}</option>`;
    return `
        <div class="prop-divider"></div>
        <div class="prop-group">
            <label title="Drag an end of the line onto a shape to attach it: the line then follows the shape">Attached ends</label>
            <div class="prop-hint">Start: ${describe(el.from)}${parseEnd(el.from) ? ` <button type="button" class="link-btn" data-element-action="detach" data-arg="from">detach</button>` : ''}</div>
            <div class="prop-hint">End: ${describe(el.to)}${parseEnd(el.to) ? ` <button type="button" class="link-btn" data-element-action="detach" data-arg="to">detach</button>` : ''}</div>
        </div>
        ${attached ? `
        <div class="prop-group">
            <label>Route</label>
            <select class="prop-control" data-prop="route">${opt('straight', 'Straight')}${opt('curved', 'Curved')}${opt('elbow', 'Elbow')}</select>
        </div>` : '<p class="prop-hint">Drag an end onto a shape to attach the line to it.</p>'}`;
}

ElementRegistry.register(PathElement);
