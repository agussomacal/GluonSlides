// ============================================================
// editor/tools.js — Drawing tools for elements created by drawing
// rather than dropped at a default spot (lines, curves, freehand).
// A toolbar variant with `create` starts a tool:
//
//   drag      press, drag, release            (line, arrow)
//   points    click to place each point; double-click (or Enter) to
//             finish; click the first point to close a closed shape
//   freehand  press and draw; release to finish
//
// Shift: 45° angles. Alt: no grid snapping. Esc: cancel.
// A live preview shows the placed points, the segment following the
// mouse and, for closed shapes, the closing edge.
// Points are collected in the coordinates of the active container
// (slide, or the group being edited) and handed to `onCreate`.
// ============================================================

import { state } from '../core/state.js';
import { ElementRegistry } from '../core/registry.js';
import { snapToGridPoint, gridSteps } from '../core/geometry.js';
import { pathData, simplifyPoints } from '../elements/path/path.js';

const SVG_NS = 'http://www.w3.org/2000/svg';
const CLOSE_RADIUS_PX = 10;   // screen px around the first point that closes a shape

const HINTS = {
    drag: 'Drag on the slide to draw · Shift: 45° · Esc: cancel',
    points: 'Click to place points · double-click or Enter to finish · Esc: cancel',
    pointsClosed: 'Click to place points · click the first point or double-click to close · Esc: cancel',
    freehand: 'Hold the mouse button and draw · release to finish · Esc: cancel',
};

let tool = null;        // { type, variant, mode, def, preset }
let draft = null;       // { container, transform, points, cursor, preview }
let options = null;     // { workspace, getContainer, onCreate }
let swallowClickUntil = 0; // swallow the one click a finishing mouse-up produces

export function isToolActive() {
    return tool !== null;
}

/** Starts drawing a `type`/`variant` element (called from the toolbar). */
export function startTool(type, variantId) {
    const def = ElementRegistry.get(type);
    const variant = def && (def.variants || []).find(v => v.id === variantId);
    if (!def || !variant || !variant.create) return false;
    cancelTool();
    const preset = (typeof variant.preset === 'function' ? variant.preset(state.slideWidth / 1920) : variant.preset) || {};
    tool = { type, variant: variantId, mode: variant.create, def, preset, closed: preset.closed === 'yes' };
    options.workspace.classList.add('tool-active');
    showHint(tool.mode === 'points' && tool.closed ? HINTS.pointsClosed : HINTS[tool.mode]);
    return true;
}

export function cancelTool() {
    if (draft && draft.preview) draft.preview.remove();
    draft = null;
    tool = null;
    if (options) options.workspace.classList.remove('tool-active');
    showHint(null);
}

function showHint(text) {
    let hint = document.getElementById('tool-hint');
    if (!text) {
        if (hint) hint.remove();
        return;
    }
    if (!hint) {
        hint = document.createElement('div');
        hint.id = 'tool-hint';
        hint.className = 'tool-hint';
        options.workspace.appendChild(hint);
    }
    hint.textContent = text;
}

// ---------- Coordinates ----------

function containerTransform(container) {
    const r = container.getBoundingClientRect();
    return {
        r,
        sx: r.width / (container.offsetWidth || 1),
        sy: r.height / (container.offsetHeight || 1),
    };
}

/** Client point -> container coordinates, with grid snap or a 45° lock. */
function toLocal(e, { snap = true, from = null } = {}) {
    const { r, sx, sy } = draft.transform;
    let x = (e.clientX - r.left) / sx;
    let y = (e.clientY - r.top) / sy;
    if (from && e.shiftKey) {
        const angle = Math.round(Math.atan2(y - from[1], x - from[0]) / (Math.PI / 4)) * (Math.PI / 4);
        const len = Math.hypot(x - from[0], y - from[1]);
        return [from[0] + Math.cos(angle) * len, from[1] + Math.sin(angle) * len];
    }
    if (snap && !e.altKey && state.gridSize > 0) {
        const { stepX, stepY } = gridSteps();
        x = snapToGridPoint(x, stepX);
        y = snapToGridPoint(y, stepY);
    }
    return [Math.round(x), Math.round(y)]; // whole canvas pixels, whatever the zoom
}

const screenPx = () => 1 / draft.transform.sx; // one screen pixel in container units

// ---------- Preview ----------

function svgEl(name, attrs = {}) {
    const node = document.createElementNS(SVG_NS, name);
    for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, v);
    return node;
}

function beginDraft() {
    const container = options.getContainer();
    draft = { container, transform: containerTransform(container), points: [], cursor: null };
    const svg = svgEl('svg', { class: 'tool-preview' });
    svg.append(
        svgEl('path', { class: 'tool-preview-close' }),
        svgEl('path', { class: 'tool-preview-line' }),
        svgEl('g', { class: 'tool-preview-points' }),
    );
    draft.preview = svg;
}

/** True when `p` is close enough to the first point to close the shape. */
function nearFirstPoint(p) {
    const first = draft.points[0];
    return tool.closed && tool.mode === 'points' && draft.points.length >= 3 && first
        && Math.hypot(p[0] - first[0], p[1] - first[1]) < CLOSE_RADIUS_PX * screenPx();
}

/** Redraws the preview from draft.points (+ the cursor position). */
function renderPreview() {
    // If the canvas was redrawn underneath us, re-attach the preview.
    if (!draft.preview.isConnected) {
        const container = options.getContainer();
        container.appendChild(draft.preview);
        draft.container = container;
        draft.transform = containerTransform(container);
    }
    const { container, preview } = draft;
    preview.setAttribute('width', container.offsetWidth);
    preview.setAttribute('height', container.offsetHeight);
    preview.setAttribute('viewBox', `0 0 ${container.offsetWidth} ${container.offsetHeight}`);

    const px = screenPx();
    const smooth = tool.preset.curve === 'smooth';
    const pts = draft.cursor ? [...draft.points, draft.cursor] : draft.points;

    const line = preview.querySelector('.tool-preview-line');
    line.setAttribute('d', pathData(pts, { smooth }));
    line.setAttribute('stroke-width', String(2 * px));
    line.setAttribute('stroke-dasharray', `${6 * px} ${4 * px}`);

    // Closing edge back to the first point, for closed shapes.
    const close = preview.querySelector('.tool-preview-close');
    close.setAttribute('d', tool.closed && pts.length >= 2 ? pathData([pts[pts.length - 1], pts[0]]) : '');
    close.setAttribute('stroke-width', String(1.5 * px));
    close.setAttribute('stroke-dasharray', `${3 * px} ${4 * px}`);

    // Placed points (not for freehand, which has hundreds).
    const dots = preview.querySelector('.tool-preview-points');
    dots.replaceChildren();
    if (tool.mode !== 'freehand') {
        const closing = draft.cursor && nearFirstPoint(draft.cursor);
        draft.points.forEach((p, i) => {
            const big = i === 0 && closing;
            dots.appendChild(svgEl('circle', {
                cx: p[0], cy: p[1], r: (big ? 8 : 4) * px,
                'stroke-width': 2 * px,
                class: big ? 'closing' : '',
            }));
        });
    }
}

// ---------- Finishing ----------

function finish(points, { fromDblClick = false } = {}) {
    const { def, variant } = tool;
    cancelTool();
    // A mouse-up that finishes a drawing is followed by a click on the
    // slide; swallow that one (a dblclick has no click after it).
    swallowClickUntil = fromDblClick ? 0 : performance.now() + 500;
    if (!points || points.length < 2) return;
    options.onCreate(def.type, variant, def.fromPoints(points));
}

/** Drops consecutive points closer than `minDist`. */
function dedupe(points, minDist) {
    return points.filter((p, i) => i === 0 || Math.hypot(p[0] - points[i - 1][0], p[1] - points[i - 1][1]) >= minDist);
}

function finishPoints(opts) {
    if (!draft) {
        cancelTool();
        return;
    }
    finish(dedupe(draft.points, 2 * screenPx()), opts);
}

// ---------- Event handling ----------

function onMouseDown(e) {
    if (!tool || e.button !== 0) return;
    // Capture phase: the tool wins over element dragging and marquee.
    e.preventDefault();
    e.stopPropagation();

    if (!draft) {
        beginDraft();
        draft.container.appendChild(draft.preview);
    }

    if (tool.mode === 'drag' || tool.mode === 'freehand') {
        const start = toLocal(e, { snap: tool.mode === 'drag' });
        draft.points = [start];
        draft.cursor = null;
        renderPreview();
        const onMove = (m) => {
            if (tool.mode === 'drag') draft.points = [start, toLocal(m, { from: start })];
            else draft.points.push(toLocal(m, { snap: false }));
            renderPreview();
        };
        const onUp = (u) => {
            window.removeEventListener('mousemove', onMove);
            window.removeEventListener('mouseup', onUp);
            if (tool.mode === 'drag') {
                const end = toLocal(u, { from: start });
                // A click without dragging draws a default-length line.
                const tooShort = Math.hypot(end[0] - start[0], end[1] - start[1]) < 4 * screenPx();
                finish([start, tooShort ? [start[0] + 300, start[1]] : end]);
            } else {
                // Simplify the raw stroke; the smooth curve rounds it again.
                finish(simplifyPoints(dedupe(draft.points, screenPx()), 1.5 * screenPx()));
            }
        };
        window.addEventListener('mousemove', onMove);
        window.addEventListener('mouseup', onUp);
        return;
    }

    // Points mode. The second press of a double-click is not a new point:
    // the dblclick event that follows finishes the shape.
    if (e.detail >= 2) return;
    const last = draft.points[draft.points.length - 1];
    const p = toLocal(e, { from: last || null });
    if (nearFirstPoint(p)) {
        finish(draft.points);
        return;
    }
    draft.points.push(p);
    draft.cursor = null;
    renderPreview();
}

function onMouseMove(e) {
    if (!tool || !draft || tool.mode !== 'points' || draft.points.length === 0) return;
    const last = draft.points[draft.points.length - 1];
    draft.cursor = toLocal(e, { from: last });
    renderPreview();
}

/**
 * Installs the tools. `getContainer()` returns the element whose
 * coordinates new elements use; `onCreate(type, variantId, props)`
 * adds the element (props: x, y, width, height, points).
 */
export function initDrawingTools(opts) {
    options = opts;
    const { workspace } = opts;
    workspace.addEventListener('mousedown', onMouseDown, true);
    window.addEventListener('mousemove', onMouseMove);

    // While drawing (and just after), clicks on the slide must not reach
    // the editor: they would change the selection and redraw the canvas.
    window.addEventListener('click', (e) => {
        if (!workspace.contains(e.target)) return;
        if (tool || performance.now() < swallowClickUntil) {
            swallowClickUntil = 0;
            e.stopPropagation();
            e.preventDefault();
        }
    }, true);
    window.addEventListener('dblclick', (e) => {
        if (!tool || !workspace.contains(e.target)) return;
        e.preventDefault();
        e.stopPropagation();
        if (tool.mode === 'points') finishPoints({ fromDblClick: true });
    }, true);

    window.addEventListener('keydown', (e) => {
        if (!tool) return;
        if (e.key === 'Escape') {
            e.preventDefault();
            e.stopImmediatePropagation();
            cancelTool();
        } else if (e.key === 'Enter' && tool.mode === 'points') {
            e.preventDefault();
            e.stopImmediatePropagation();
            finishPoints();
        }
    }, true);
}
