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
    if (el.kind === 'ellipse') return '50%';
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
            preset: (s) => ({ kind: 'ellipse', lockAspect: 'yes', width: Math.round(300 * s), height: Math.round(300 * s) }),
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
        props: ['x', 'y', 'width', 'height', 'kind', 'radius', 'lockAspect', 'bg', 'borderCol', 'borderWidth', 'borderStyle'],
        numericProps: ['x', 'y', 'width', 'height', 'radius', 'borderWidth'],
        body: null,
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
        const kind = el.kind === 'ellipse' ? 'ellipse' : 'rect';
        return `
            <div class="prop-divider"></div>
            <div class="prop-row">
                <div class="prop-group">
                    <label>Shape</label>
                    <select class="prop-control" data-prop="kind">
                        <option value="rect" ${kind === 'rect' ? 'selected' : ''}>Rectangle</option>
                        <option value="ellipse" ${kind === 'ellipse' ? 'selected' : ''}>Ellipse</option>
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
