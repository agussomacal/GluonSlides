// ============================================================
// elements/text/text.js — Text element (Markdown + LaTeX).
// Editing handlers are bound BEFORE content rendering, so a
// render failure can never leave the element without edit mode.
// ============================================================

import { state, markDirty } from '../../core/state.js';
import { ElementRegistry } from '../../core/registry.js';
import {
    renderMarkdownAndKatex,
    renderMarkdownAndKatexToString,
    applyAlignmentStyles,
} from '../../core/render.js';

let liveUpdateTimer = null;

function notifyContentChanged() {
    document.dispatchEvent(new CustomEvent('slide-content-changed'));
}

function scheduleLiveUpdate(el, text) {
    el.content = text;
    markDirty();
    clearTimeout(liveUpdateTimer);
    liveUpdateTimer = setTimeout(notifyContentChanged, 250);
}

export function saveAndExitTextEditing(domEl, el) {
    el.content = domEl.innerText;
    domEl.contentEditable = 'false';
    domEl.classList.remove('editing-mode');
    markDirty();
    notifyContentChanged();
}

function renderContentSafely(domEl, rawText) {
    try {
        renderMarkdownAndKatex(domEl, rawText);
    } catch (e) {
        console.error('Text element render failed:', e);
        domEl.textContent = rawText; // graceful degradation
    }
}

const TextElement = {
    type: 'text',
    label: 'Add Text Box',
    icon: '📝',
    className: 'element-text',
    category: 'text',

    gl: {
        props: [
            'x', 'y', 'width', 'height', 'fontSize', 'fontFamily', 'fontColor',
            'textAlign', 'verticalAlign', 'bg', 'borderCol', 'borderWidth', 'borderStyle',
        ],
        numericProps: ['x', 'y', 'width', 'height', 'fontSize', 'borderWidth'],
        body: 'content',
    },

    defaults(ctx) {
        const scale = state.slideWidth / 1920;
        return {
            type: 'text',
            x: 0, y: 0,
            width: Math.round(600 * scale),
            height: Math.round(150 * scale),
            content: 'Type **markdown** or math like $x^2 + y^2 = r^2$',
            fontSize: Math.round(32 * scale),
            fontFamily: 'sans-serif',
            fontColor: state.isDarkMode ? '#f8fafc' : '#0f172a',
            textAlign: 'center',
            verticalAlign: 'center',
            bg: 'transparent',
            borderCol: 'transparent',
            borderWidth: 0,
            borderStyle: 'solid',
        };
    },

    renderDom(domEl, el, ctx) {
        domEl.style.fontSize = `${el.fontSize}px`;
        domEl.style.fontFamily = el.fontFamily;
        domEl.style.color = el.fontColor;
        applyAlignmentStyles(domEl, el);

        // Bind editing handlers FIRST — a later render failure can
        // never detach the editing lifecycle from a canvas element.
        if (ctx.context === 'canvas') {
            domEl.ondblclick = (e) => {
                e.stopPropagation();
                domEl.classList.add('editing-mode');
                domEl.contentEditable = 'true';
                domEl.innerText = el.content;
                domEl.focus();
            };

            domEl.oninput = (e) => {
                el.content = e.target.innerText;
                markDirty();
            };

            domEl.onblur = () => {
                if (domEl.classList.contains('editing-mode')) {
                    saveAndExitTextEditing(domEl, el);
                }
            };

            domEl.onkeydown = (e) => {
                if (e.key === 'Escape' || e.code === 'Escape') {
                    e.preventDefault();
                    e.stopPropagation();
                    saveAndExitTextEditing(domEl, el);
                }
            };
        }

        if (ctx.context === 'thumb') {
            renderContentSafely(domEl, el.content);
            return;
        }

        const isEditing = state.selectedElementIndex === ctx.elIndex && domEl.classList.contains('editing-mode');

        if (isEditing) {
            domEl.contentEditable = 'true';
            if (domEl.innerText !== el.content) {
                domEl.innerText = el.content;
            }
        } else {
            domEl.contentEditable = 'false';
            renderContentSafely(domEl, el.content);
        }
    },

    exportInner(el) {
        return renderMarkdownAndKatexToString(el);
    },

    properties(el, elIndex) {
        return `
            <div style="border-top: 1px solid var(--border-color); padding-top: 12px; margin-top: 4px;"></div>
            <div class="prop-group">
                <label>Font Family</label>
                <select class="prop-control" data-prop="fontFamily">
                    <option value="sans-serif" ${el.fontFamily === 'sans-serif' ? 'selected' : ''}>Sans-Serif</option>
                    <option value="serif" ${el.fontFamily === 'serif' ? 'selected' : ''}>Serif</option>
                    <option value="monospace" ${el.fontFamily === 'monospace' ? 'selected' : ''}>Monospace</option>
                </select>
            </div>
            <div class="prop-row">
                <div class="prop-group">
                    <label>Font Size (px)</label>
                    <input type="number" class="prop-control" value="${el.fontSize}" data-prop="fontSize">
                </div>
                <div class="prop-group">
                    <label>Text Color</label>
                    <input type="color" class="prop-control prop-color" value="${el.fontColor}" style="height: 34px; padding: 2px;" data-prop="fontColor">
                </div>
            </div>
            <div class="prop-row">
                <div class="prop-group">
                    <label>H-Alignment</label>
                    <select class="prop-control" data-prop="textAlign">
                        <option value="left" ${(el.textAlign || 'center') === 'left' ? 'selected' : ''}>Left</option>
                        <option value="center" ${(el.textAlign || 'center') === 'center' ? 'selected' : ''}>Center</option>
                        <option value="right" ${(el.textAlign || 'center') === 'right' ? 'selected' : ''}>Right</option>
                    </select>
                </div>
                <div class="prop-group">
                    <label>V-Alignment</label>
                    <select class="prop-control" data-prop="verticalAlign">
                        <option value="top" ${(el.verticalAlign || 'center') === 'top' ? 'selected' : ''}>Top</option>
                        <option value="center" ${(el.verticalAlign || 'center') === 'center' ? 'selected' : ''}>Center</option>
                        <option value="bottom" ${(el.verticalAlign || 'center') === 'bottom' ? 'selected' : ''}>Bottom</option>
                    </select>
                </div>
            </div>
        `;
    },
};

ElementRegistry.register(TextElement);