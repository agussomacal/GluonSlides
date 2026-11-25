// ============================================================
// elements/macro/macro.js — Macro instances (see core/macros.js).
//
//   .macro.card id:20 x:100 y:100 width:900 height:600
//   	::title                 overrides come first, one per element,
//   		Results             addressed by the element's name
//   	::frame bg:#fee2e2
//   	::badge hidden:yes
//   	.element.text x:10 ...  then extra elements (this instance only)
//
// The definition's elements are laid out in its width x height frame
// and drawn scaled to the instance's size, exactly like a group.
// ============================================================

import { ElementRegistry } from '../../core/registry.js';
import { buildStaticElement, exportElementMarkup, escapeHtml } from '../../core/render.js';
import {
    formatGlParams, parseGlParams, indentGlBody, unindentGlBodyLine,
    serializeGlElements, parseGlElements, indentGlBlock,
} from '../../core/gl/glformat.js';
import { getMacro, macroNames, resolveInstance, withinMacro } from '../../core/macros.js';
import { createGroupFrame } from '../group/group.js';

const OVERRIDE_RE = /^::([A-Za-z][\w-]*)\s*(.*)$/;

/**
 * A small picture of macro `name` (its definition drawn scaled into a
 * size x size box), used as its icon in the Macros menu.
 */
export function macroThumbnail(name, size = 22) {
    const macro = getMacro(name);
    const box = document.createElement('span');
    box.className = 'macro-thumb';
    box.style.width = `${size}px`;
    box.style.height = `${size}px`;
    if (!macro) return box;
    const k = Math.min(size / (macro.width || 1), size / (macro.height || 1));
    const frame = createGroupFrame({
        width: macro.width * k, height: macro.height * k,
        frameWidth: macro.width, frameHeight: macro.height,
    });
    frame.style.left = `${(size - macro.width * k) / 2}px`;
    frame.style.top = `${(size - macro.height * k) / 2}px`;
    withinMacro(name, () => {
        (macro.children || []).forEach(child => frame.appendChild(buildStaticElement(child, 'group-child')));
    });
    box.appendChild(frame);
    return box;
}

function frameFor(el, macro) {
    return createGroupFrame({
        width: el.width, height: el.height,
        frameWidth: macro.width, frameHeight: macro.height,
    });
}

const MacroElement = {
    type: 'macro',
    label: 'Macro',
    icon: '🧩',
    className: 'element-macro',
    category: 'macros',
    boxStyle: false,

    // One toolbar entry per macro in the library (rebuilt on every render).
    get variants() {
        return macroNames().map(name => ({
            id: name,
            label: name,
            icon: '🧩',
            iconNode: () => macroThumbnail(name),
            preset: () => {
                const m = getMacro(name);
                return { ref: name, width: m.width, height: m.height, overrides: [], extras: [] };
            },
        }));
    },

    gl: {
        props: ['x', 'y', 'width', 'height'],
        numericProps: ['x', 'y', 'width', 'height'],
        body: 'overrides',
        directive: (el) => `macro.${el.ref}`,

        serializeBody(el) {
            const lines = [];
            for (const o of el.overrides || []) {
                const params = formatGlParams(o.props || {});
                lines.push(`::${o.target}${params ? ' ' + params : ''}`);
                if (o.body !== undefined) lines.push(indentGlBody(o.body));
            }
            lines.push(...serializeGlElements(el.extras || []));
            return lines.length ? indentGlBlock(lines) : null;
        },

        parseBody(text, el, { lineOffset = 0 } = {}) {
            const lines = String(text).split('\n');
            const overrides = [];
            let current = null;
            let i = 0;
            for (; i < lines.length; i++) {
                const line = lines[i];
                const m = line.match(OVERRIDE_RE);
                if (m) {
                    current = { target: m[1], props: parseGlParams(m[2]), bodyLines: [] };
                    overrides.push(current);
                    continue;
                }
                if (line.startsWith('.')) break; // extra elements follow
                if (line.trim() === '') {
                    if (current) current.bodyLines.push('');
                    continue;
                }
                if (/^[ \t]/.test(line)) {
                    if (!current) throw new Error(`Line ${lineOffset + i + 1}: indented text before any ::override`);
                    current.bodyLines.push(unindentGlBodyLine(line));
                    continue;
                }
                throw new Error(`Line ${lineOffset + i + 1}: expected ::name or an element inside .macro.${el.ref}`);
            }
            el.overrides = overrides.map(({ target, props, bodyLines }) => {
                while (bodyLines.length && bodyLines[bodyLines.length - 1] === '') bodyLines.pop();
                const o = { target, props };
                if (bodyLines.length) o.body = bodyLines.join('\n');
                return o;
            });
            el.extras = i < lines.length ? parseGlElements(lines.slice(i).join('\n'), lineOffset + i) : [];
        },
    },

    defaults() {
        return { type: 'macro', ref: '', x: 0, y: 0, width: 100, height: 100, overrides: [], extras: [] };
    },

    typeLabel(el) {
        return `Macro: ${el.ref}`;
    },

    renderDom(domEl, el, ctx) {
        domEl.style.backgroundColor = 'transparent';
        domEl.style.borderWidth = '0px';
        const { macro, children, missingTargets, error } = resolveInstance(el);
        if (error) {
            domEl.classList.add('macro-missing');
            domEl.innerHTML = `<div class="macro-placeholder">⚠ ${escapeHtml(error)}</div>`;
            return;
        }
        if (ctx.context === 'canvas') {
            // Double-click: edit this instance (changes become overrides).
            domEl.ondblclick = (e) => {
                e.stopPropagation();
                document.dispatchEvent(new CustomEvent('enter-group', { detail: { id: el.id, mode: 'instance' } }));
            };
        }
        const frame = frameFor(el, macro);
        withinMacro(el.ref, () => {
            children.forEach(child => frame.appendChild(buildStaticElement(child, 'group-child')));
        });
        domEl.appendChild(frame);
        if (missingTargets.length && ctx.context === 'canvas') {
            const badge = document.createElement('div');
            badge.className = 'macro-warning';
            badge.title = `Overrides for elements that no longer exist in "${el.ref}": ${missingTargets.join(', ')}`;
            badge.textContent = '⚠';
            domEl.appendChild(badge);
        }
    },

    exportInner(el) {
        const { macro, children, error } = resolveInstance(el);
        if (error) return '';
        const sx = el.width / (macro.width || 1);
        const sy = el.height / (macro.height || 1);
        return `<div style="position:absolute; left:0; top:0; width:${macro.width}px; height:${macro.height}px;`
            + ` transform:scale(${sx}, ${sy}); transform-origin:0 0;">${withinMacro(el.ref, () => children.map(exportElementMarkup).join(''))}</div>`;
    },

    properties(el) {
        const { macro, error, missingTargets } = resolveInstance(el);
        const names = macro ? (macro.children || []).map(c => c.name).filter(Boolean) : [];
        const overrides = (el.overrides || []).length;
        const extras = (el.extras || []).length;
        const summary = [
            `${overrides} override${overrides === 1 ? '' : 's'}`,
            extras ? `${extras} extra element${extras === 1 ? '' : 's'}` : '',
        ].filter(Boolean).join(' · ');
        return `
            <div class="prop-divider"></div>
            <div class="prop-group">
                <label>Macro</label>
                <input type="text" class="prop-control prop-readonly" disabled value="${escapeHtml(el.ref)} — ${summary}">
            </div>
            ${error ? `<p class="prop-warning">⚠ ${escapeHtml(error)}</p>` : ''}
            ${missingTargets.length ? `<p class="prop-warning">⚠ Overrides for elements no longer in the macro: ${missingTargets.map(escapeHtml).join(', ')}</p>` : ''}
            ${names.length ? `<p class="prop-hint">Elements: ${names.map(n => `<code>${escapeHtml(n)}</code>`).join(' ')}</p>` : ''}
            <div class="prop-stack">
                <button class="btn btn-secondary" data-action="enter-group" ${error ? 'disabled' : ''}
                        title="Move, restyle, add or delete elements of this instance only (double-click)">✏️ Edit this instance</button>
                <button class="btn btn-secondary" data-action="edit-macro-definition" ${error ? 'disabled' : ''}
                        title="Change the macro itself: every instance follows">🧩 Edit definition (all instances)</button>
                <button class="btn btn-secondary" data-action="goto-macro-definition" ${error ? 'disabled' : ''}>📄 Go to definition (.gl)</button>
                <button class="btn btn-secondary" data-action="reset-instance" ${overrides + extras === 0 ? 'disabled' : ''}>↺ Reset all overrides</button>
                <button class="btn btn-secondary" data-action="detach-macro" ${error ? 'disabled' : ''}>Detach (make a group)</button>
            </div>
        `;
    },
};

ElementRegistry.register(MacroElement);
