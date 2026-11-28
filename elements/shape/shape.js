// ============================================================
// elements/shape/shape.js — Box shapes: rectangle, rounded
// rectangle, ellipse, circle and dot. All are the same element
// type; the toolbar variants are presets of these properties:
//
//   kind        rect (default) | ellipse
//   radius      corner radius in px (rect only; 0 / absent = sharp)
//   lockAspect  yes | no (default) — keep proportions when resizing
//
// Default values are not written to .gl, so plain rectangles look
// exactly as they did before these properties existed.
// ============================================================

import { state } from '../../core/state.js';
import { ElementRegistry } from '../../core/registry.js';

/** CSS border-radius for a shape. */
function borderRadius(el) {
    if (el.kind === 'ellipse' || el.kind === 'circle') return '50%';
    const r = Number(el.radius) || 0;
    return r > 0 ? `${r}px` : '';
}

/** Inline CSS for the inner layer that paints the shape. */
function fillStyle(el) {
    const r = borderRadius(el);
    return `position:absolute; inset:0; box-sizing:border-box; pointer-events:none;`
        + `background-color:${el.bg};`
        + `border:${el.borderWidth}px ${el.borderStyle} ${el.borderCol};`
        + (r ? `border-radius:${r};` : '');
}

// ---------- circles: centre and radius ----------

const CIRCLE_BOX = new Set(['x', 'y', 'width', 'height', 'lockAspect', 'radius']);
const NOT_CIRCLE = new Set(['cx', 'cy', 'r']);
const r2 = (v) => Math.round(v * 100) / 100;

/** The box from the centre and radius. */
function deriveBox(el) {
    const r = Math.max(0, Number(el.r) || 0);
    el.x = r2(Number(el.cx) - r);
    el.y = r2(Number(el.cy) - r);
    el.width = el.height = r2(2 * r);
    el._derived = { x: el.x, y: el.y, width: el.width, height: el.height };
}

/** The centre and radius from the box (moved or resized), then the box squared. */
function fromBox(el) {
    const w = Number(el.width) || 0;
    const h = Number(el.height) || 0;
    el.cx = r2(Number(el.x) + w / 2);
    el.cy = r2(Number(el.y) + h / 2);
    el.r = r2(Math.min(w, h) / 2);
    deriveBox(el);
}

/**
 * A circle's two descriptions in step: a box moved or resized since it was
 * last set moves the centre and radius; otherwise (the radius or the
 * centre typed, or given by a formula) the box follows them.
 */
function syncCircle(el) {
    if (el.kind !== 'circle') return;
    const known = [el.cx, el.cy, el.r].every(v => v !== undefined && v !== '' && Number.isFinite(Number(v)));
    const d = el._derived;
    const boxMoved = d && (Math.abs(el.x - d.x) > 0.005 || Math.abs(el.y - d.y) > 0.005 || Math.abs(el.width - d.width) > 0.005 || Math.abs(el.height - d.height) > 0.005);
    if (!known || boxMoved) fromBox(el);
    else deriveBox(el);
}

const ShapeElement = {
    type: 'shape',
    label: 'Add Shape',
    icon: '⬛',
    className: 'element-shape',
    category: 'shapes',

    // Toolbar entries: each is a preset applied on top of defaults().
    variants: [
        { id: 'rect', label: 'Rectangle', icon: '⬛', preset: () => ({}) },
        { id: 'rounded', label: 'Rounded rectangle', icon: '▢', preset: (s) => ({ radius: Math.round(32 * s) }) },
        { id: 'ellipse', label: 'Ellipse', icon: '⬭', preset: () => ({ kind: 'ellipse' }) },
        {
            id: 'circle', label: 'Circle', icon: '⚪',
            preset: (s) => ({ kind: 'circle', lockAspect: 'yes', width: Math.round(300 * s), height: Math.round(300 * s) }),
        },
        {
            // A dot is a small, filled, borderless circle.
            id: 'dot', label: 'Dot', icon: '•',
            preset: (s) => ({
                kind: 'ellipse', lockAspect: 'yes',
                width: Math.round(24 * s), height: Math.round(24 * s),
                bg: state.isDarkMode ? '#f8fafc' : '#0f172a', borderWidth: 0,
            }),
        },
    ],

    gl: {
        props: ['x', 'y', 'width', 'height', 'kind', 'cx', 'cy', 'r', 'radius', 'lockAspect', 'bg', 'borderCol', 'borderWidth', 'borderStyle'],
        numericProps: ['x', 'y', 'width', 'height', 'cx', 'cy', 'r', 'radius', 'borderWidth'],
        body: null,
        // A circle is written by its centre and radius; its box comes from them.
        omit: (el) => (el.kind === 'circle' ? CIRCLE_BOX : NOT_CIRCLE),
        afterParse(el) {
            if (el.kind !== 'circle') return;
            el.lockAspect = 'yes';
            if ([el.cx, el.cy, el.r].every(v => Number.isFinite(Number(v)))) deriveBox(el);
        },
    },

    /** Keeps a circle's centre and radius and its box in step (core/bindings.js syncDerived). */
    syncGeometry: syncCircle,

    // Switching to or from a circle.
    propChanged(el, prop, before) {
        if (prop !== 'kind' || el.kind === before) return;
        if (el.kind === 'circle') {
            const d = Math.min(Number(el.width) || 0, Number(el.height) || 0);
            el.x += (el.width - d) / 2;
            el.y += (el.height - d) / 2;
            el.width = el.height = d;
            el.lockAspect = 'yes';
            delete el.cx; delete el.cy; delete el.r; delete el._derived;
            syncCircle(el);
        } else if (before === 'circle') {
            delete el.cx; delete el.cy; delete el.r; delete el._derived;
            if (el.formulas) ['cx', 'cy', 'r'].forEach(k => delete el.formulas[k]);
        }
    },

    defaults(ctx) {
        const scale = state.slideWidth / 1920;
        return {
            type: 'shape',
            x: 0, y: 0,
            width: Math.round(400 * scale),
            height: Math.round(300 * scale),
            bg: state.isDarkMode ? '#334155' : '#cbd5e1',
            borderCol: state.isDarkMode ? '#64748b' : '#475569',
            borderWidth: 2,
            borderStyle: 'solid',
        };
    },

    // The fill and border are drawn on an inner layer with the rounding,
    // while the element box itself stays rectangular: browsers ignore
    // clicks on the parts border-radius cuts away, so rounding the box
    // would make the resize corners of a circle unreachable.
    renderDom(domEl, el) {
        domEl.style.backgroundColor = 'transparent';
        domEl.style.borderWidth = '0px';
        const fill = document.createElement('div');
        fill.className = 'shape-fill';
        fill.style.cssText = fillStyle(el);
        domEl.appendChild(fill);
    },

    exportStyle() {
        return 'background-color:transparent; border:none;';
    },

    exportInner(el) {
        return `<div style="${fillStyle(el)}"></div>`;
    },

    properties(el) {
        const kind = el.kind === 'ellipse' || el.kind === 'circle' ? el.kind : 'rect';
        if (kind === 'circle') {
            const num = (key, label) => `<div class="prop-group"><label>${label}</label><input type="number" class="prop-control" step="any" value="${Number(el[key]) || 0}" data-prop="${key}"></div>`;
            return `
            <div class="prop-divider"></div>
            <div class="prop-group">
                <label>Shape</label>
                <select class="prop-control" data-prop="kind">
                    <option value="rect">Rectangle</option>
                    <option value="ellipse">Ellipse</option>
                    <option value="circle" selected>Circle</option>
                </select>
            </div>
            <div class="prop-row">${num('r', 'Radius')}${num('cx', 'Centre x')}</div>
            <div class="prop-row"><div class="prop-group"></div>${num('cy', 'Centre y')}</div>`;
        }
        return `
            <div class="prop-divider"></div>
            <div class="prop-row">
                <div class="prop-group">
                    <label>Shape</label>
                    <select class="prop-control" data-prop="kind">
                        <option value="rect" ${kind === 'rect' ? 'selected' : ''}>Rectangle</option>
                        <option value="ellipse" ${kind === 'ellipse' ? 'selected' : ''}>Ellipse</option>
                        <option value="circle">Circle</option>
                    </select>
                </div>
                <div class="prop-group">
                    <label>Corner Radius</label>
                    <input type="number" class="prop-control" min="0" value="${Number(el.radius) || 0}"
                           data-prop="radius" ${kind === 'ellipse' ? 'disabled' : ''}>
                </div>
            </div>
            <label class="prop-check">
                <input type="checkbox" data-prop="lockAspect" ${el.lockAspect === 'yes' ? 'checked' : ''}>
                Keep proportions when resizing
            </label>
        `;
    },
};

ElementRegistry.register(ShapeElement);
