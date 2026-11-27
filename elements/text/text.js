// ============================================================
// elements/text/text.js — Text element (Markdown + LaTeX).
// Editing handlers are bound BEFORE content rendering, so a
// render failure can never leave the element without edit mode.
// ============================================================

import { state, markDirty, flashSaveIndicator, pyApi } from '../../core/state.js';
import { clickedWord, selectWord } from '../../editor/clickedWord.js';
import { fontStack, fontGroups, importProjectFonts, fontLicense } from '../../core/fonts.js';
import { colorField } from '../../ui/colorPicker.js';
import { ElementRegistry } from '../../core/registry.js';
import {
    renderMarkdownAndKatex,
    renderMarkdownAndKatexToString,
    applyAlignmentStyles,
    escapeHtml,
} from '../../core/render.js';
import { hasAutoBibliography, bibliographyPages, bibliographyPageContent } from '../../core/bibPages.js';

/**
 * Fills the licence notice under the font list (looked up async):
 * a quiet line for open licences, a warning otherwise, and a clear
 * notice when the licence forbids embedding in exports.
 */
export async function showFontLicense(family, box = document.querySelector('#properties-body .font-license')) {
    if (!box || box.dataset.family !== family) return;
    const lic = await fontLicense(family);
    if (!box.isConnected || box.dataset.family !== family) return;
    if (!lic) {
        box.innerHTML = '';
        return;
    }
    const link = lic.url
        ? ` <button class="link-btn" data-element-action="openFontLicense" data-arg="${escapeHtml(lic.url)}">View licence</button>`
        : '';
    const name = lic.name ? escapeHtml(lic.name.length > 90 ? `${lic.name.slice(0, 90)}…` : lic.name) : '';
    let level = 'ok';
    let text;
    if (lic.embeddable === false) {
        level = 'blocked';
        text = `⛔ This font's licence forbids embedding: exports will not include it and viewers will see a fallback font.`;
    } else if (lic.open) {
        text = `Licence: ${name || 'open licence'}`;
    } else if (lic.unknown || !lic.name) {
        level = 'warn';
        text = '⚠ No licence information found in the font file. Check its licence before sharing exports (the font is embedded in them).';
    } else {
        level = 'warn';
        text = `⚠ Not an open licence (${name}). Check it allows you to share this font before distributing exports.`;
    }
    box.className = `font-license font-license-${level}`;
    box.innerHTML = `${text}${link}`;
}

/** <optgroup>s for the font dropdown; each name previewed in its font. */
export function fontOptions(current) {
    const groups = fontGroups();
    const known = groups.some(g => g.fonts.some(f => f.family === current));
    if (!known) groups.unshift({ label: 'Current', fonts: [{ family: current, label: current }] });
    return groups.map(g => `
        <optgroup label="${escapeHtml(g.label)}">
            ${g.fonts.map(f => `<option value="${escapeHtml(f.family)}" data-preview="${escapeHtml(fontStack(f.family))}"
                ${f.family === current ? 'selected' : ''}>${escapeHtml(f.label)}</option>`).join('')}
        </optgroup>`).join('');
}

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

/**
 * A text box preset holding `content`; geometry is given for a 1920×1080
 * slide and scaled to the project's size (so a footer stays at the bottom
 * of a 4:3 slide too).
 */
function fieldBox(content, _s, { x, y, width, height, fontSize, textAlign = 'center', verticalAlign = 'center' }) {
    const sx = state.slideWidth / 1920;
    const sy = state.slideHeight / 1080;
    return {
        content,
        x: Math.round(x * sx), y: Math.round(y * sy),
        width: Math.round(width * sx), height: Math.round(height * sy),
        fontSize: Math.round(fontSize * Math.min(sx, sy)), textAlign, verticalAlign,
    };
}

const TextElement = {
    type: 'text',
    label: 'Add Text Box',
    icon: '📝',
    className: 'element-text',
    category: 'text',

    // Toolbar: "Text Box", and Fields ▾ with text boxes holding an
    // automatic field (core/fields.js), placed where that field usually
    // goes (`placed`: the preset's position is kept, not the usual stagger).
    variants: [
        { id: 'box', label: 'Text Box', icon: '📝', preset: () => ({}) },
        {
            id: 'slidenumber', category: 'fields', label: 'Slide number', icon: '#', placed: true,
            preset: (s) => fieldBox('\\slidenumber', s, { x: 1680, y: 990, width: 200, height: 60, fontSize: 24, textAlign: 'right' }),
        },
        {
            id: 'footer', category: 'fields', label: 'Footer (title · section · number)', icon: '▁', placed: true,
            preset: (s) => fieldBox('\\presentationtitle · \\sectiontitle · \\slidenumber / \\totalslides', s,
                { x: 40, y: 1010, width: 1840, height: 50, fontSize: 20, textAlign: 'center' }),
        },
        {
            id: 'slidetitle', category: 'fields', label: 'Slide title', icon: 'T', placed: true,
            preset: (s) => fieldBox('# \\slidetitle', s, { x: 80, y: 40, width: 1760, height: 130, fontSize: 32, textAlign: 'left' }),
        },
        {
            id: 'sectiontitle', category: 'fields', label: 'Section title', icon: '§', placed: true,
            preset: (s) => fieldBox('\\sectiontitle', s, { x: 80, y: 990, width: 900, height: 60, fontSize: 24, textAlign: 'left' }),
        },
        {
            id: 'titlepage', category: 'fields', label: 'Title, author and date', icon: '🎓', placed: true,
            preset: (s) => fieldBox('# \\presentationtitle\n\n\\author\n\n\\date', s, { x: 260, y: 300, width: 1400, height: 480, fontSize: 36 }),
        },
        {
            id: 'toc', category: 'fields', label: 'Table of contents', icon: '☰', placed: true,
            preset: (s) => fieldBox('\\tableofcontents', s, { x: 200, y: 220, width: 1520, height: 700, fontSize: 36, textAlign: 'left', verticalAlign: 'top' }),
        },
    ],

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
        domEl.style.fontFamily = fontStack(el.fontFamily);
        domEl.style.color = el.fontColor;
        applyAlignmentStyles(domEl, el);

        // Bind editing handlers FIRST — a later render failure can
        // never detach the editing lifecycle from a canvas element.
        if (ctx.context === 'canvas') {
            domEl.ondblclick = (e) => {
                e.stopPropagation();
                // Already editing: the double-click selects a word, as in any text.
                if (domEl.classList.contains('editing-mode')) return;
                const word = clickedWord(domEl, e);
                domEl.classList.add('editing-mode');
                domEl.contentEditable = 'true';
                domEl.innerText = el.content;
                domEl.focus();
                selectWord(domEl, word);
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
            // Like the canvas: only the part of a long reference list that fits.
            renderContentSafely(domEl, hasAutoBibliography(el) ? bibliographyPageContent({ ...el }, 0) : el.content);
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
            // A reference list too long for the box: show the part that
            // fits; the rest continues on extra slides when presenting.
            const pages = hasAutoBibliography(el) ? bibliographyPages({ ...el }) : null;
            if (pages && pages.length > 1) {
                domEl.dataset.bibMore = String(pages.length - 1);
                domEl.title = `The reference list continues on ${pages.length - 1} more slide${pages.length > 2 ? 's' : ''} when presenting and exporting.`;
                renderContentSafely(domEl, bibliographyPageContent({ ...el }, 0));
            } else {
                delete domEl.dataset.bibMore;
                renderContentSafely(domEl, el.content);
            }
        }
    },

    // Buttons in properties() call these via data-element-action.
    actions: {
        openFontLicense(elIndex, url) {
            const api = pyApi();
            if (api) return api.open_url(url);
            window.open(url, '_blank', 'noopener');
            return Promise.resolve();
        },
        async addFonts() {
            const res = await importProjectFonts();
            if (res && res.success) {
                flashSaveIndicator('Fonts added ✓');
                document.dispatchEvent(new CustomEvent('slide-content-changed'));
            } else if (res && res.error && res.error !== 'Cancelled') {
                flashSaveIndicator(res.error);
            }
        },
    },

    exportInner(el) {
        return renderMarkdownAndKatexToString(el);
    },

    properties(el, elIndex) {
        // The panel HTML is inserted right after this returns.
        Promise.resolve().then(() => showFontLicense(el.fontFamily || 'sans-serif'));
        return `
            <div style="border-top: 1px solid var(--border-color); padding-top: 12px; margin-top: 4px;"></div>
            <div class="prop-group">
                <label>Font Family</label>
                <select class="prop-control" data-prop="fontFamily">
                    ${fontOptions(el.fontFamily || 'sans-serif')}
                </select>
                <div class="font-license" data-family="${escapeHtml(el.fontFamily || 'sans-serif')}"></div>
                <button class="btn btn-secondary btn-small" data-element-action="addFonts"
                        title="Copy .ttf / .otf / .woff / .woff2 files into the project's fonts/ folder">＋ Add font files…</button>
            </div>
            <div class="prop-row">
                <div class="prop-group">
                    <label>Font Size</label>
                    <input type="number" class="prop-control" value="${el.fontSize}" data-prop="fontSize">
                </div>
                <div class="prop-group">
                    <label>Text Color</label>
                    ${colorField({ 'data-prop': 'fontColor' }, el.fontColor, { allowNone: false })}
                </div>
            </div>
            <div class="prop-row">
                <div class="prop-group">
                    <label>Horizontal</label>
                    <select class="prop-control" data-prop="textAlign">
                        <option value="left" ${(el.textAlign || 'center') === 'left' ? 'selected' : ''}>Left</option>
                        <option value="center" ${(el.textAlign || 'center') === 'center' ? 'selected' : ''}>Center</option>
                        <option value="right" ${(el.textAlign || 'center') === 'right' ? 'selected' : ''}>Right</option>
                    </select>
                </div>
                <div class="prop-group">
                    <label>Vertical</label>
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