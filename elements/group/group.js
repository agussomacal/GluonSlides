// ============================================================
// elements/group/group.js — Group element: a box holding child
// elements in its own coordinate frame.
//
//   .element.group id:10 x:200 y:100 width:800 height:400 frameWidth:400 frameHeight:200
//   	.element.text id:11 x:0 y:0 width:400 height:100 fontSize:32 ...
//   		Body text of the child (one more tab)
//   	.element.shape id:12 x:0 y:120 width:400 height:80 ...
//
// Children are positioned in a frameWidth x frameHeight space. The
// group draws that frame scaled to its width x height, so resizing a
// group scales everything inside (positions, sizes, fonts, borders)
// while only the group's own line changes in the .gl file.
//
// Editing: Ctrl+G groups the selection, Ctrl+Shift+G ungroups,
// double-click enters a group to edit its children (see editor.js).
// ============================================================

import { ElementRegistry } from '../../core/registry.js';
import { buildStaticElement, exportElementMarkup } from '../../core/render.js';
import { serializeGlElements, parseGlElements, indentGlBlock } from '../../core/gl/glformat.js';

/** Horizontal / vertical scale from frame space to the group's box. */
export function groupScale(group) {
    return {
        sx: group.width / (group.frameWidth || group.width || 1),
        sy: group.height / (group.frameHeight || group.height || 1),
    };
}

/** The scaled inner frame div that holds the children. */
export function createGroupFrame(group) {
    const { sx, sy } = groupScale(group);
    const frame = document.createElement('div');
    frame.className = 'group-frame';
    frame.style.width = `${group.frameWidth}px`;
    frame.style.height = `${group.frameHeight}px`;
    frame.style.transform = `scale(${sx}, ${sy})`;
    return frame;
}

const GroupElement = {
    type: 'group',
    label: 'Group',
    icon: '🗂️',
    className: 'element-group',
    toolbar: false, // created with Ctrl+G, not from the toolbar

    gl: {
        props: [
            'x', 'y', 'width', 'height', 'frameWidth', 'frameHeight',
            'bg', 'borderCol', 'borderWidth', 'borderStyle',
        ],
        numericProps: ['x', 'y', 'width', 'height', 'frameWidth', 'frameHeight', 'borderWidth'],
        body: 'children',
        serializeBody(el) {
            const lines = serializeGlElements(el.children || []);
            return lines.length ? indentGlBlock(lines) : null;
        },
        parseBody(text, el, { lineOffset = 0 } = {}) {
            el.children = parseGlElements(text, lineOffset);
        },
    },

    defaults() {
        return {
            type: 'group',
            x: 0, y: 0, width: 100, height: 100,
            frameWidth: 100, frameHeight: 100,
            bg: 'transparent',
            borderCol: 'transparent',
            borderWidth: 0,
            borderStyle: 'solid',
            children: [],
        };
    },

    renderDom(domEl, el, ctx) {
        el.children = el.children || [];
        if (!el.frameWidth) el.frameWidth = el.width;
        if (!el.frameHeight) el.frameHeight = el.height;

        const frame = createGroupFrame(el);
        el.children.forEach(child => frame.appendChild(buildStaticElement(child, 'group-child')));
        domEl.appendChild(frame);

        if (ctx.context === 'canvas') {
            domEl.ondblclick = (e) => {
                e.stopPropagation();
                document.dispatchEvent(new CustomEvent('enter-group', { detail: { id: el.id } }));
            };
        }
    },

    exportInner(el) {
        const { sx, sy } = groupScale(el);
        const children = (el.children || []).map(exportElementMarkup).join('');
        return `<div style="position:absolute; left:0; top:0; width:${el.frameWidth}px; height:${el.frameHeight}px;`
            + ` transform:scale(${sx}, ${sy}); transform-origin:0 0;">${children}</div>`;
    },

    properties(el) {
        const { sx, sy } = groupScale(el);
        const count = (el.children || []).length;
        return `
            <div class="prop-divider"></div>
            <div class="prop-group">
                <label>Group</label>
                <input type="text" class="prop-control prop-readonly" disabled
                       value="${count} object${count === 1 ? '' : 's'} · scale ${sx.toFixed(2)} × ${sy.toFixed(2)}">
            </div>
            <p class="prop-hint">Double-click the group to edit its contents. Resizing scales everything inside.</p>
            <div class="prop-row">
                <button class="btn btn-secondary" data-action="enter-group">✏️ Edit contents</button>
                <button class="btn btn-secondary" data-action="ungroup">Ungroup</button>
            </div>
        `;
    },
};

ElementRegistry.register(GroupElement);
