// ============================================================
// editor/glInspector.js — Editable, bidirectionally synced .gl
// source inspector with per-line syntax highlighting, native
// cursor placement, cross-line navigation, Tab/Shift+Tab
// insertion, customizable editor & highlight settings,
// context menu ("Go to Gluon file"), and jump-to-line.
// ============================================================

import { state, serializeProject, markDirty, ensureElementIds } from '../core/state.js';
import { parseGl, looksLikeGl } from '../core/gl/glformat.js';
import { hydrateFigureElements } from '../elements/figure/figure.js';
import { tokenizeGlDocument } from './glTokenizer.js';
import {
    bindMarkDirtyAndRender,
    syncSlideSizeSelect,
    syncGridSizeSelect,
    updateDimensionsCSS,
} from '../core/render.js';

const INSPECTOR_ID = 'gl-inspector-drawer';
const MENU_ID = 'gl-context-menu';
const SETTINGS_ID = 'gl-inspector-settings-popover';
const STYLESHEET_HREF = 'editor/glInspector.css';
const SETTINGS_STORAGE_KEY = 'gluon_gl_inspector_settings_v1';
const APPLY_DEBOUNCE_MS = 350;

const SLIDE_NODE_SELECTOR = '[data-slide-id], [data-slide-index], .slide-thumb, .thumbnail, .slide-item, .slide-card';
const ELEMENT_NODE_SELECTOR = '[data-element-id], [data-el-id], [data-el-index], .element, .element-wrapper, .canvas-element';

const DEFAULT_SETTINGS = {
    tabSize: 2,
    fontSize: 13,
    lineHeight: 20,
    autoApply: true,
    colors: {
        directiveStruct: '#c084fc',
        directiveElement: '#38bdf8',
        braceArg: '#fbbf24',
        paramKey: '#a5b4fc',
        paramNum: '#fdba74',
        paramColor: '#2dd4bf',
        paramStr: '#86efac',
        paramVal: '#cbd5e1',
        bodyText: '#f1f5f9',
        bodyMath: '#f472b6',
        comment: '#64748b',
    },
};

const TOKEN_COLOR_FIELDS = [
    { key: 'directiveStruct', label: 'Structural (.project, .slide)', cssVar: '--gl-tok-directive-struct' },
    { key: 'directiveElement', label: 'Element (.element.*)', cssVar: '--gl-tok-directive-element' },
    { key: 'braceArg', label: 'Brace args ({Title})', cssVar: '--gl-tok-brace-arg' },
    { key: 'paramKey', label: 'Parameter keys (id:, x:)', cssVar: '--gl-tok-param-key' },
    { key: 'paramNum', label: 'Numbers', cssVar: '--gl-tok-param-num' },
    { key: 'paramColor', label: 'Colors (#hex)', cssVar: '--gl-tok-param-color' },
    { key: 'paramStr', label: 'Strings ("...")', cssVar: '--gl-tok-param-str' },
    { key: 'paramVal', label: 'Other values', cssVar: '--gl-tok-param-val' },
    { key: 'bodyText', label: 'Body content text', cssVar: '--gl-tok-body-text' },
    { key: 'bodyMath', label: 'Math ($...$)', cssVar: '--gl-tok-body-math' },
    { key: 'comment', label: 'Comments (#)', cssVar: '--gl-tok-comment' },
];

let settings = loadSettings();
let currentTarget = null; // { slideId, elementId }
let highlightedLine = -1;
let isOpen = false;
let isSettingsOpen = false;
let initialized = false;
let isInspectorFocused = false;
let hasUnappliedDraft = false;
let isApplyingFromInspector = false;
let debounceTimer = null;
let renderEditorRef = null;

function loadSettings() {
    try {
        const raw = localStorage.getItem(SETTINGS_STORAGE_KEY);
        if (!raw) return structuredClone(DEFAULT_SETTINGS);
        const parsed = JSON.parse(raw);
        return {
            tabSize: Number.isFinite(Number(parsed.tabSize)) ? Number(parsed.tabSize) : DEFAULT_SETTINGS.tabSize,
            fontSize: Number.isFinite(Number(parsed.fontSize)) ? Number(parsed.fontSize) : DEFAULT_SETTINGS.fontSize,
            lineHeight: Number.isFinite(Number(parsed.lineHeight)) ? Number(parsed.lineHeight) : DEFAULT_SETTINGS.lineHeight,
            autoApply: parsed.autoApply !== undefined ? !!parsed.autoApply : DEFAULT_SETTINGS.autoApply,
            colors: {
                ...DEFAULT_SETTINGS.colors,
                ...(parsed.colors || {}),
            },
        };
    } catch {
        return structuredClone(DEFAULT_SETTINGS);
    }
}

function saveSettings() {
    try {
        localStorage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify(settings));
    } catch {
        // Ignore storage quota errors
    }
}

function applySettingsToDom() {
    const drawer = document.getElementById(INSPECTOR_ID);
    if (!drawer) return;

    const tabSize = Math.max(1, Math.min(16, Number(settings.tabSize) || 2));
    const fontSize = Math.max(10, Math.min(28, Number(settings.fontSize) || 13));
    const lineHeight = Math.max(14, Math.min(42, Number(settings.lineHeight) || 20));
    settings.tabSize = tabSize;
    settings.fontSize = fontSize;
    settings.lineHeight = lineHeight;

    drawer.style.setProperty('--gl-tab-size', String(tabSize));
    drawer.style.setProperty('--gl-font-size', `${fontSize}px`);
    drawer.style.setProperty('--gl-line-height', `${lineHeight}px`);

    for (const field of TOKEN_COLOR_FIELDS) {
        const val = settings.colors[field.key] || DEFAULT_SETTINGS.colors[field.key];
        drawer.style.setProperty(field.cssVar, val);
    }

    syncSettingsControlsFromState();
}

function syncSettingsControlsFromState() {
    const tabInput = document.getElementById('gl-set-tab-size');
    const fontInput = document.getElementById('gl-set-font-size');
    const lhInput = document.getElementById('gl-set-line-height');
    const autoApplyInput = document.getElementById('gl-set-auto-apply');

    if (tabInput) tabInput.value = String(settings.tabSize);
    if (fontInput) fontInput.value = String(settings.fontSize);
    if (lhInput) lhInput.value = String(settings.lineHeight);
    if (autoApplyInput) autoApplyInput.checked = !!settings.autoApply;

    for (const field of TOKEN_COLOR_FIELDS) {
        const picker = document.getElementById(`gl-set-color-${field.key}`);
        if (picker) picker.value = settings.colors[field.key] || DEFAULT_SETTINGS.colors[field.key];
    }
}

function setSettingsOpen(open) {
    isSettingsOpen = !!open;
    const popover = document.getElementById(SETTINGS_ID);
    const btn = document.getElementById('gl-inspector-settings-btn');
    if (popover) popover.classList.toggle('open', isSettingsOpen);
    if (btn) btn.classList.toggle('active', isSettingsOpen);
    if (isSettingsOpen) syncSettingsControlsFromState();
}

function buildSettingsPopoverHtml() {
    const colorRowsHtml = TOKEN_COLOR_FIELDS.map(field => `
        <div class="gl-settings-row">
            <label for="gl-set-color-${field.key}">${field.label}</label>
            <input type="color" id="gl-set-color-${field.key}" data-color-key="${field.key}" />
        </div>
    `).join('');

    return `
        <div class="gl-settings-header">
            <span>Inspector & Highlight Settings</span>
            <button type="button" id="gl-settings-close-btn" title="Close settings">✕</button>
        </div>
        <div class="gl-settings-scroll">
            <div>
                <div class="gl-settings-section-title">Editor Properties</div>
                <div class="gl-settings-row">
                    <label for="gl-set-tab-size">Tab size (spaces)</label>
                    <input type="number" id="gl-set-tab-size" min="1" max="16" step="1" />
                </div>
                <div class="gl-settings-row">
                    <label for="gl-set-font-size">Font size (px)</label>
                    <input type="number" id="gl-set-font-size" min="10" max="28" step="1" />
                </div>
                <div class="gl-settings-row">
                    <label for="gl-set-line-height">Line height (px)</label>
                    <input type="number" id="gl-set-line-height" min="14" max="42" step="1" />
                </div>
                <div class="gl-settings-row">
                    <label for="gl-set-auto-apply">Auto-apply edits while typing</label>
                    <input type="checkbox" id="gl-set-auto-apply" />
                </div>
            </div>
            <div>
                <div class="gl-settings-section-title">Syntax Highlight Colors</div>
                ${colorRowsHtml}
            </div>
        </div>
        <div class="gl-settings-footer">
            <button type="button" id="gl-settings-reset-btn">Reset Defaults</button>
        </div>
    `;
}

// ---------- Native Per-Line Highlighted Editor Adapter ----------

function createLineEditorAdapter(host) {
    let currentText = '';
    let inputHandler = null;
    let focusChangeHandler = null;
    let keyDownHandler = null;
    let isRenderingDom = false;
    let lastLine = 0;
    let lastCol = 0;

    function readTextFromDom() {
        const lineEls = [...host.querySelectorAll('.gl-tok-line')];
        if (lineEls.length === 0) return currentText;
        return lineEls.map(el => (el.textContent || '').replace(/\u00A0$/, '')).join('\n');
    }

    function ensureLineVisible(lineEl) {
        if (!lineEl) return;
        const lineTop = lineEl.offsetTop;
        const lineBottom = lineTop + lineEl.offsetHeight;
        const viewTop = host.scrollTop;
        const viewBottom = viewTop + host.clientHeight;

        if (lineTop < viewTop + 10) {
            host.scrollTop = Math.max(0, lineTop - 10);
        } else if (lineBottom > viewBottom - 10) {
            host.scrollTop = Math.max(0, lineBottom - host.clientHeight + 10);
        }
    }

    function getCaretLineAndCol() {
        const sel = window.getSelection();
        if (!sel || sel.rangeCount === 0) return { line: -1, col: 0 };
        const range = sel.getRangeAt(0);
        const baseNode = range.startContainer;
        const lineEl = baseNode.nodeType === Node.ELEMENT_NODE
            ? (baseNode.matches('.gl-tok-line') ? baseNode : baseNode.closest('.gl-tok-line'))
            : baseNode.parentElement?.closest('.gl-tok-line');
        if (!lineEl || !host.contains(lineEl)) return { line: -1, col: 0 };

        const lineIdx = Number(lineEl.dataset.line);
        let col = 0;
        try {
            const preRange = document.createRange();
            preRange.selectNodeContents(lineEl);
            preRange.setEnd(baseNode, range.startOffset);
            col = preRange.toString().replace(/\u00A0$/, '').length;
        } catch {
            col = 0;
        }
        return { line: Number.isFinite(lineIdx) ? lineIdx : -1, col };
    }

    function placeCaretInLine(lineEl, col = 0) {
        lineEl.focus({ preventScroll: true });

        const walker = document.createTreeWalker(lineEl, NodeFilter.SHOW_TEXT);
        let remaining = Math.max(0, col);
        let targetNode = null;
        let targetOffset = 0;

        while (walker.nextNode()) {
            const node = walker.currentNode;
            const len = (node.textContent || '').replace(/\u00A0$/, '').length;
            if (remaining <= len) {
                targetNode = node;
                targetOffset = remaining;
                break;
            }
            remaining -= len;
        }

        const sel = window.getSelection();
        const range = document.createRange();
        if (targetNode) {
            const maxOffset = (targetNode.textContent || '').replace(/\u00A0$/, '').length;
            range.setStart(targetNode, Math.min(targetOffset, maxOffset));
        } else {
            range.setStart(lineEl, 0);
        }
        range.collapse(true);
        sel.removeAllRanges();
        sel.addRange(range);
    }

    function renderLines(text, activeLineIdx, { restoreLine = -1, restoreCol = 0 } = {}) {
        isRenderingDom = true;
        try {
            const tokenizedLines = tokenizeGlDocument(text);
            const frag = document.createDocumentFragment();

            tokenizedLines.forEach((tokens, lineIdx) => {
                const lineDiv = document.createElement('div');
                lineDiv.className = 'gl-tok-line' + (lineIdx === activeLineIdx ? ' highlighted' : '');
                lineDiv.dataset.line = String(lineIdx);
                lineDiv.contentEditable = 'true';
                lineDiv.spellcheck = false;

                if (!tokens || tokens.length === 0) {
                    lineDiv.appendChild(document.createTextNode('\u00A0'));
                } else {
                    tokens.forEach(tok => {
                        const span = document.createElement('span');
                        span.className = `gl-tok-${tok.type}`;
                        span.textContent = tok.value;
                        lineDiv.appendChild(span);
                    });
                }

                if (lineDiv.textContent === '') {
                    lineDiv.appendChild(document.createTextNode('\u00A0'));
                }

                frag.appendChild(lineDiv);
            });

            host.innerHTML = '';
            host.appendChild(frag);

            if (restoreLine >= 0) {
                const targetLine = host.querySelector(`.gl-tok-line[data-line="${restoreLine}"]`);
                if (targetLine) {
                    placeCaretInLine(targetLine, restoreCol);
                    ensureLineVisible(targetLine);
                }
            }
        } finally {
            isRenderingDom = false;
        }
    }

    function moveToLine(nextLine, preferredCol) {
        const lines = currentText.split('\n');
        const clamped = Math.max(0, Math.min(nextLine, lines.length - 1));
        const targetText = lines[clamped] || '';
        const clampedCol = Math.max(0, Math.min(preferredCol, targetText.length));

        highlightedLine = clamped;
        lastLine = clamped;
        lastCol = clampedCol;

        host.querySelectorAll('.gl-tok-line').forEach((el, idx) => {
            el.classList.toggle('highlighted', idx === highlightedLine);
        });

        const targetEl = host.querySelector(`.gl-tok-line[data-line="${clamped}"]`);
        if (targetEl) {
            placeCaretInLine(targetEl, clampedCol);
            ensureLineVisible(targetEl);
        }
    }

    function commitText(nextText, nextLine, nextCol) {
        currentText = nextText;
        highlightedLine = nextLine;
        lastLine = nextLine;
        lastCol = nextCol;
        renderLines(currentText, highlightedLine, { restoreLine: nextLine, restoreCol: nextCol });
        if (inputHandler) inputHandler(currentText);
    }

    host.addEventListener('input', () => {
        if (isRenderingDom) return;
        const { line, col } = getCaretLineAndCol();
        const safeLine = line >= 0 ? line : lastLine;
        currentText = readTextFromDom();
        if (safeLine >= 0) {
            highlightedLine = safeLine;
            lastLine = safeLine;
            lastCol = col;
        }
        renderLines(currentText, highlightedLine, { restoreLine: safeLine, restoreCol: col });
        if (inputHandler) inputHandler(currentText);
    });

    host.addEventListener('click', () => {
        const { line, col } = getCaretLineAndCol();
        if (line >= 0) {
            lastLine = line;
            lastCol = col;
            if (line !== highlightedLine) {
                highlightedLine = line;
                host.querySelectorAll('.gl-tok-line').forEach((el, idx) => {
                    el.classList.toggle('highlighted', idx === highlightedLine);
                });
            }
        }
    });

    host.addEventListener('keyup', () => {
        if (isRenderingDom) return;
        const { line, col } = getCaretLineAndCol();
        if (line >= 0) {
            lastLine = line;
            lastCol = col;
        }
    });

    host.addEventListener('keydown', (e) => {
        const caret = getCaretLineAndCol();
        const line = caret.line >= 0 ? caret.line : lastLine;
        const col = caret.line >= 0 ? caret.col : lastCol;
        const lines = currentText.split('\n');

        if (e.key === 'Tab' && !e.altKey && !e.ctrlKey && !e.metaKey) {
            e.preventDefault();
            e.stopPropagation();

            const safeLine = Math.max(0, Math.min(line, Math.max(0, lines.length - 1)));
            const currentLineStr = lines[safeLine] || '';
            const safeCol = Math.max(0, Math.min(col, currentLineStr.length));

            if (e.shiftKey) {
                let updated = currentLineStr;
                let removed = 0;
                if (updated.startsWith('\t')) {
                    updated = updated.slice(1);
                    removed = 1;
                } else {
                    const leadingSpaces = updated.match(/^ +/);
                    if (leadingSpaces) {
                        removed = Math.min(leadingSpaces[0].length, settings.tabSize || 2);
                        updated = updated.slice(removed);
                    }
                }
                if (removed > 0) {
                    lines[safeLine] = updated;
                    commitText(lines.join('\n'), safeLine, Math.max(0, safeCol - removed));
                }
                return;
            }

            const before = currentLineStr.slice(0, safeCol);
            const after = currentLineStr.slice(safeCol);
            lines[safeLine] = `${before}\t${after}`;
            commitText(lines.join('\n'), safeLine, safeCol + 1);
            return;
        }

        if (line >= 0) {
            const currentLineStr = lines[line] || '';

            if (e.key === 'ArrowUp' && !e.altKey && !e.ctrlKey && !e.metaKey && !e.shiftKey) {
                if (line > 0) {
                    e.preventDefault();
                    moveToLine(line - 1, col);
                    return;
                }
            }

            if (e.key === 'ArrowDown' && !e.altKey && !e.ctrlKey && !e.metaKey && !e.shiftKey) {
                if (line < lines.length - 1) {
                    e.preventDefault();
                    moveToLine(line + 1, col);
                    return;
                }
            }

            if (e.key === 'ArrowLeft' && col === 0 && line > 0 && !e.altKey && !e.ctrlKey && !e.metaKey && !e.shiftKey) {
                e.preventDefault();
                moveToLine(line - 1, (lines[line - 1] || '').length);
                return;
            }

            if (e.key === 'ArrowRight' && col >= currentLineStr.length && line < lines.length - 1 && !e.altKey && !e.ctrlKey && !e.metaKey && !e.shiftKey) {
                e.preventDefault();
                moveToLine(line + 1, 0);
                return;
            }

            if (e.key === 'Backspace' && col === 0 && line > 0 && !e.ctrlKey && !e.metaKey) {
                e.preventDefault();
                const prevLen = (lines[line - 1] || '').length;
                const merged = (lines[line - 1] || '') + currentLineStr;
                lines.splice(line - 1, 2, merged);
                commitText(lines.join('\n'), line - 1, prevLen);
                return;
            }

            if (e.key === 'Enter' && !e.shiftKey && !(e.ctrlKey || e.metaKey)) {
                e.preventDefault();
                const before = currentLineStr.slice(0, col);
                const after = currentLineStr.slice(col);
                lines.splice(line, 1, before, after);
                commitText(lines.join('\n'), line + 1, 0);
                return;
            }
        }

        if (keyDownHandler) keyDownHandler(e);
    }, true);

    host.addEventListener('focusin', () => {
        const { line, col } = getCaretLineAndCol();
        if (line >= 0) {
            highlightedLine = line;
            lastLine = line;
            lastCol = col;
            host.querySelectorAll('.gl-tok-line').forEach((el, idx) => {
                el.classList.toggle('highlighted', idx === highlightedLine);
            });
        }
        if (focusChangeHandler) focusChangeHandler(true);
    });

    host.addEventListener('focusout', (e) => {
        if (!host.contains(e.relatedTarget)) {
            if (focusChangeHandler) focusChangeHandler(false);
        }
    });

    return {
        getValue() {
            return currentText;
        },
        setValue(text) {
            currentText = String(text ?? '');
            lastLine = 0;
            lastCol = 0;
            renderLines(currentText, highlightedLine);
        },
        setHighlightLine(lineIndex) {
            highlightedLine = lineIndex;
            renderLines(currentText, highlightedLine);
        },
        focus() {
            const firstLine = host.querySelector('.gl-tok-line');
            if (firstLine) {
                placeCaretInLine(firstLine, 0);
            }
        },
        isFocused() {
            return host.contains(document.activeElement);
        },
        jumpToLine(lineIndex, statusText) {
            const lines = currentText.split('\n');
            const clampedLine = Math.max(0, Math.min(lineIndex, Math.max(0, lines.length - 1)));
            highlightedLine = clampedLine;
            lastLine = clampedLine;
            lastCol = 0;
            renderLines(currentText, clampedLine);

            const targetRow = host.querySelector(`.gl-tok-line[data-line="${clampedLine}"]`);
            if (targetRow) {
                placeCaretInLine(targetRow, 0);
                host.scrollTop = Math.max(0, targetRow.offsetTop - host.clientHeight * 0.35);
            }
            setStatus(statusText);
        },
        onInput(handler) {
            inputHandler = handler;
        },
        onFocusChange(handler) {
            focusChangeHandler = handler;
        },
        onKeyDown(handler) {
            keyDownHandler = handler;
        },
    };
}

let adapter = null;

// ---------- DOM & Styles ----------

function ensureStylesheet() {
    const existing = [...document.querySelectorAll('link[rel="stylesheet"]')];
    if (existing.some(link => (link.getAttribute('href') || '').includes(STYLESHEET_HREF))) {
        return;
    }
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = STYLESHEET_HREF;
    document.head.appendChild(link);
}

function setModeBadge(mode, text) {
    const badge = document.getElementById('gl-inspector-badge');
    if (!badge) return;
    badge.classList.remove('listening', 'error');
    if (mode === 'listening') {
        badge.classList.add('listening');
    } else if (mode === 'error') {
        badge.classList.add('error');
    }
    badge.textContent = text;
}

function setStatus(text) {
    const statusEl = document.getElementById('gl-inspector-status');
    if (statusEl) statusEl.textContent = text;
}

function ensureDom() {
    ensureStylesheet();

    if (!document.getElementById(MENU_ID)) {
        const menu = document.createElement('div');
        menu.id = MENU_ID;
        menu.innerHTML = `
            <button type="button" id="gl-menu-goto-btn">
                <span>📄</span>
                <span>Go to Gluon file</span>
            </button>
        `;
        document.body.appendChild(menu);
    }

    if (!document.getElementById(INSPECTOR_ID)) {
        const drawer = document.createElement('section');
        drawer.id = INSPECTOR_ID;
        drawer.setAttribute('aria-label', 'Gluon File Inspector');
        drawer.innerHTML = `
            <div class="gl-inspector-header">
                <div class="gl-inspector-meta">
                    <strong>.gl Inspector</strong>
                    <span id="gl-inspector-badge" class="gl-inspector-badge">Editor Sync</span>
                    <span id="gl-inspector-status">Ready</span>
                </div>
                <div class="gl-inspector-actions">
                    <button type="button" id="gl-inspector-apply-btn" class="primary" title="Apply .gl changes to editor (Ctrl/Cmd+Enter)">Apply</button>
                    <button type="button" id="gl-inspector-refresh-btn" title="Discard draft & reload from editor state">Reset from State</button>
                    <button type="button" id="gl-inspector-settings-btn" title="Editor & syntax highlight settings">⚙ Settings</button>
                    <button type="button" id="gl-inspector-close-btn" title="Close inspector">✕</button>
                </div>
            </div>
            <div class="gl-inspector-body">
                <div id="gl-inspector-editor" class="gl-line-editor" role="textbox" aria-multiline="true"></div>
            </div>
        `;
        document.body.appendChild(drawer);

        const popover = document.createElement('div');
        popover.id = SETTINGS_ID;
        popover.className = 'gl-settings-popover';
        popover.innerHTML = buildSettingsPopoverHtml();
        document.body.appendChild(popover);

        const editorHost = document.getElementById('gl-inspector-editor');
        adapter = createLineEditorAdapter(editorHost);

        applySettingsToDom();

        adapter.onFocusChange((focused) => {
            isInspectorFocused = focused;
            if (focused) {
                setModeBadge('listening', 'Editor Listening');
            } else if (!hasUnappliedDraft) {
                setModeBadge('synced', 'Editor Sync');
                refreshGlInspectorText(currentTarget, { force: true });
            }
        });

        adapter.onInput((val) => {
            hasUnappliedDraft = true;
            setModeBadge('listening', 'Editor Listening');
            clearTimeout(debounceTimer);
            if (settings.autoApply) {
                debounceTimer = setTimeout(() => {
                    applyInspectorTextToEditor(val, { silentOnError: true });
                }, APPLY_DEBOUNCE_MS);
            }
        });

        adapter.onKeyDown((e) => {
            if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
                e.preventDefault();
                clearTimeout(debounceTimer);
                applyInspectorTextToEditor(adapter.getValue(), { silentOnError: false });
            }
        });

        document.getElementById('gl-inspector-apply-btn').onclick = () => {
            clearTimeout(debounceTimer);
            applyInspectorTextToEditor(adapter.getValue(), { silentOnError: false });
        };

        document.getElementById('gl-inspector-refresh-btn').onclick = () => {
            clearTimeout(debounceTimer);
            hasUnappliedDraft = false;
            setModeBadge('synced', 'Editor Sync');
            refreshGlInspectorText(currentTarget, { force: true });
        };

        document.getElementById('gl-inspector-settings-btn').onclick = (e) => {
            e.stopPropagation();
            setSettingsOpen(!isSettingsOpen);
        };

        document.getElementById('gl-inspector-close-btn').onclick = () => {
            closeGlInspector();
        };

        document.getElementById('gl-settings-close-btn').onclick = () => {
            setSettingsOpen(false);
        };

        document.getElementById('gl-set-tab-size').onchange = (e) => {
            settings.tabSize = Number(e.target.value) || DEFAULT_SETTINGS.tabSize;
            applySettingsToDom();
            saveSettings();
        };

        document.getElementById('gl-set-font-size').onchange = (e) => {
            settings.fontSize = Number(e.target.value) || DEFAULT_SETTINGS.fontSize;
            applySettingsToDom();
            saveSettings();
        };

        document.getElementById('gl-set-line-height').onchange = (e) => {
            settings.lineHeight = Number(e.target.value) || DEFAULT_SETTINGS.lineHeight;
            applySettingsToDom();
            saveSettings();
        };

        document.getElementById('gl-set-auto-apply').onchange = (e) => {
            settings.autoApply = !!e.target.checked;
            saveSettings();
        };

        popover.querySelectorAll('input[type="color"][data-color-key]').forEach(picker => {
            picker.addEventListener('input', (e) => {
                const key = e.target.dataset.colorKey;
                if (!key) return;
                settings.colors[key] = e.target.value;
                applySettingsToDom();
                saveSettings();
            });
        });

        document.getElementById('gl-settings-reset-btn').onclick = () => {
            settings = structuredClone(DEFAULT_SETTINGS);
            applySettingsToDom();
            saveSettings();
        };
    }
}

// ---------- Target Resolution & Line Lookup ----------

function parseIdValue(raw) {
    if (raw === undefined || raw === null || raw === '') return null;
    const num = Number(raw);
    return Number.isFinite(num) ? num : String(raw);
}

function hasIdParam(line, targetId) {
    if (targetId === undefined || targetId === null || targetId === '') return false;
    const escaped = String(targetId).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return new RegExp(`(?:^|\\s)id:(?:"${escaped}"|${escaped})(?=\\s|$)`).test(line);
}

export function findGlTargetLine(glText, { slideId = null, elementId = null } = {}) {
    const lines = String(glText ?? '').split('\n');
    const normSlideId = parseIdValue(slideId);
    const normElementId = parseIdValue(elementId);

    let slideLineIndex = -1;
    let inTargetSlide = normSlideId === null;

    for (let i = 0; i < lines.length; i++) {
        const trimmed = lines[i].trimStart();

        if (trimmed.startsWith('.slide')) {
            if (normSlideId !== null) {
                if (hasIdParam(trimmed, normSlideId)) {
                    slideLineIndex = i;
                    inTargetSlide = true;
                    if (normElementId === null) {
                        return i;
                    }
                } else if (inTargetSlide) {
                    break;
                }
            }
            continue;
        }

        if (normElementId !== null && inTargetSlide) {
            if (trimmed.startsWith('.element.') && hasIdParam(trimmed, normElementId)) {
                return i;
            }
        }
    }

    if (slideLineIndex !== -1) return slideLineIndex;
    return normElementId !== null || normSlideId !== null ? 0 : -1;
}

function formatTargetLabel(target = {}, lineIdx = -1) {
    const parts = [];
    if (target.slideId !== null && target.slideId !== undefined) parts.push(`slide id:${target.slideId}`);
    if (target.elementId !== null && target.elementId !== undefined) parts.push(`element id:${target.elementId}`);
    const desc = parts.length ? ` (${parts.join(', ')})` : '';
    return lineIdx >= 0 ? `Line ${lineIdx + 1}${desc}` : 'Full file';
}

// ---------- Inspector <-> Editor Sync ----------

function preserveFigureDataUris(oldSlides, newSlides) {
    if (!Array.isArray(oldSlides) || !Array.isArray(newSlides)) return;

    const bySlideAndElId = new Map();
    const byElIdOnly = new Map();

    for (const s of oldSlides) {
        for (const el of (s.elements || [])) {
            if (el.type !== 'figure' || typeof el.src !== 'string' || !el.src.startsWith('data:')) continue;
            if (el.id !== undefined && el.id !== null) {
                bySlideAndElId.set(`${parseIdValue(s.id)}::${parseIdValue(el.id)}`, {
                    src: el.src,
                    filePath: el.filePath || '',
                });
                byElIdOnly.set(parseIdValue(el.id), {
                    src: el.src,
                    filePath: el.filePath || '',
                });
            }
        }
    }

    for (const s of newSlides) {
        for (const el of (s.elements || [])) {
            if (el.type !== 'figure') continue;
            const cached = bySlideAndElId.get(`${parseIdValue(s.id)}::${parseIdValue(el.id)}`)
                || byElIdOnly.get(parseIdValue(el.id));
            if (cached && cached.filePath === (el.filePath || '')) {
                el.src = cached.src;
            }
        }
    }
}

export async function applyInspectorTextToEditor(glText, { silentOnError = true } = {}) {
    if (!adapter) return false;
    const raw = String(glText ?? '');
    if (!raw.trim() || !looksLikeGl(raw)) {
        setModeBadge('error', 'Invalid .gl');
        setStatus('Expected .project / .slide directives');
        if (!silentOnError) alert('Could not apply .gl: Expected a valid .gl project structure.');
        return false;
    }

    let parsed;
    try {
        parsed = parseGl(raw);
    } catch (err) {
        setModeBadge('error', 'Parse Error');
        setStatus(err.message);
        if (!silentOnError) alert(`Could not apply .gl: ${err.message}`);
        return false;
    }

    isApplyingFromInspector = true;
    try {
        const prevSlideIndex = state.currentSlideIndex;
        const oldSlides = state.slides;

        preserveFigureDataUris(oldSlides, parsed.slides);

        state.slides = parsed.slides;
        state.slideWidth = Number.isFinite(Number(parsed.slideWidth)) ? Number(parsed.slideWidth) : 1920;
        state.slideHeight = Number.isFinite(Number(parsed.slideHeight)) ? Number(parsed.slideHeight) : 1080;
        state.gridSize = parsed.gridSize !== undefined && parsed.gridSize !== null ? Number(parsed.gridSize) : 20;
        state.isDarkMode = !!parsed.isDarkMode;
        state.projectName = parsed.name || state.projectName || 'Untitled Project';
        state.nextId = parsed.nextId || 1;
        ensureElementIds();

        state.currentSlideIndex = Math.max(0, Math.min(prevSlideIndex, Math.max(0, state.slides.length - 1)));
        state.selectedSlideIndices = state.slides.length > 0 ? [state.currentSlideIndex] : [];
        state.selectedElementIndex = null;
        state.selectedElementIndices = [];

        await hydrateFigureElements(state.slides, state.projectFolder);

        document.body.classList.toggle('dark-mode', state.isDarkMode);
        syncSlideSizeSelect();
        syncGridSizeSelect();
        updateDimensionsCSS();

        hasUnappliedDraft = false;
        markDirty();

        if (typeof renderEditorRef === 'function') {
            renderEditorRef();
        }

        setModeBadge(isInspectorFocused ? 'listening' : 'synced', isInspectorFocused ? 'Editor Listening' : 'Synced');
        setStatus('Applied to editor');
        return true;
    } finally {
        isApplyingFromInspector = false;
    }
}

export function jumpToGlTarget(target = {}, { focusEditor = true } = {}) {
    ensureDom();
    if (!adapter) return;

    const glText = serializeProject();
    if (!hasUnappliedDraft) {
        adapter.setValue(glText);
    }

    const lineIdx = findGlTargetLine(adapter.getValue(), target);
    const label = formatTargetLabel(target, lineIdx);

    if (focusEditor) {
        adapter.jumpToLine(lineIdx, label);
    } else {
        adapter.setHighlightLine(lineIdx);
        setStatus(label);
    }
}

export function refreshGlInspectorText(target = currentTarget, { force = false, jump = false } = {}) {
    if (!isOpen || isApplyingFromInspector) return;
    if (!force && (isInspectorFocused || hasUnappliedDraft)) return;

    ensureDom();
    currentTarget = target || currentTarget || {};
    const glText = serializeProject();
    const lineIdx = findGlTargetLine(glText, currentTarget);
    highlightedLine = lineIdx;
    adapter.setValue(glText);
    setModeBadge('synced', 'Editor Sync');

    if (jump) {
        adapter.jumpToLine(lineIdx, formatTargetLabel(currentTarget, lineIdx));
    } else {
        setStatus(formatTargetLabel(currentTarget, lineIdx));
    }
}

export function openGlInspector(target = {}) {
    ensureDom();
    applySettingsToDom();
    currentTarget = target || {};
    isOpen = true;
    hasUnappliedDraft = false;

    const drawer = document.getElementById(INSPECTOR_ID);
    if (drawer) drawer.classList.add('open');

    jumpToGlTarget(currentTarget, { focusEditor: true });
}

export function closeGlInspector() {
    clearTimeout(debounceTimer);
    setSettingsOpen(false);
    isOpen = false;
    isInspectorFocused = false;
    hasUnappliedDraft = false;
    const drawer = document.getElementById(INSPECTOR_ID);
    if (drawer) drawer.classList.remove('open');
}

// ---------- Context Menu & DOM Target Resolution ----------

function hideContextMenu() {
    const menu = document.getElementById(MENU_ID);
    if (menu) {
        menu.classList.remove('open');
        delete menu._pendingTarget;
    }
}

function extractSlideIndexFromOnclick(node) {
    let curr = node;
    for (let depth = 0; curr && depth < 4; depth++, curr = curr.parentElement) {
        const onclickAttr = curr.getAttribute && curr.getAttribute('onclick');
        if (!onclickAttr) continue;
        const m = onclickAttr.match(/selectSlide\(\s*(\d+)\s*\)/);
        if (m) return Number(m[1]);
    }
    return null;
}

function resolveSlideFromNode(slideNode) {
    if (!slideNode) return null;
    const ds = slideNode.dataset || {};

    if (ds.slideId !== undefined) {
        const id = parseIdValue(ds.slideId);
        const found = state.slides.find(s => parseIdValue(s.id) === id);
        if (found) return found;
    }

    const idxRaw = ds.slideIndex ?? ds.index;
    if (idxRaw !== undefined && Number.isFinite(Number(idxRaw))) {
        const idx = Number(idxRaw);
        if (state.slides[idx]) return state.slides[idx];
    }

    const onclickIdx = extractSlideIndexFromOnclick(slideNode);
    if (onclickIdx !== null && state.slides[onclickIdx]) {
        return state.slides[onclickIdx];
    }

    let container = slideNode.parentElement;
    while (container && container !== document.body) {
        const allInContainer = [...container.querySelectorAll(SLIDE_NODE_SELECTOR)];
        if (allInContainer.length > 1) {
            const targetItem = allInContainer.find(
                item => item === slideNode || item.contains(slideNode)
            ) || slideNode;
            const pos = allInContainer.indexOf(targetItem);
            if (pos >= 0 && state.slides[pos]) {
                return state.slides[pos];
            }
            break;
        }
        container = container.parentElement;
    }

    return null;
}

function resolveElementFromNode(elNode, slide) {
    if (!elNode || !slide) return null;
    const elements = slide.elements || [];
    const ds = elNode.dataset || {};

    if (ds.elementId !== undefined || ds.elId !== undefined) {
        const id = parseIdValue(ds.elementId ?? ds.elId);
        return elements.find(el => parseIdValue(el.id) === id) || null;
    }

    const idxRaw = ds.elIndex ?? ds.elementIndex ?? ds.index;
    if (idxRaw !== undefined && Number.isFinite(Number(idxRaw))) {
        return elements[Number(idxRaw)] || null;
    }

    if (elNode.parentElement) {
        const siblings = [...elNode.parentElement.children].filter(
            node => node.matches(ELEMENT_NODE_SELECTOR)
        );
        const pos = siblings.indexOf(elNode);
        if (pos >= 0 && elements[pos]) return elements[pos];
    }

    return null;
}

function resolveContextTargetFromEvent(e) {
    if (!e || !e.target || typeof e.target.closest !== 'function') return null;

    const slideNode = e.target.closest(SLIDE_NODE_SELECTOR);
    if (slideNode) {
        const matchedSlide = resolveSlideFromNode(slideNode);
        if (matchedSlide) {
            return { slideId: matchedSlide.id, elementId: null };
        }
    }

    const elNode = e.target.closest(ELEMENT_NODE_SELECTOR);
    if (elNode) {
        const activeSlide = state.slides[state.currentSlideIndex] || null;
        if (activeSlide) {
            const matchedEl = resolveElementFromNode(elNode, activeSlide);
            return {
                slideId: activeSlide.id,
                elementId: matchedEl ? matchedEl.id : null,
            };
        }
    }

    return null;
}

export function initGlInspector() {
    if (initialized) return;
    initialized = true;
    ensureDom();

    const menu = document.getElementById(MENU_ID);
    const gotoBtn = document.getElementById('gl-menu-goto-btn');

    gotoBtn.onclick = () => {
        const target = menu._pendingTarget || {};
        hideContextMenu();
        openGlInspector(target);
    };

    document.addEventListener('contextmenu', (e) => {
        const target = resolveContextTargetFromEvent(e);
        if (!target) {
            hideContextMenu();
            return;
        }
        e.preventDefault();
        menu._pendingTarget = target;
        menu.style.left = `${Math.min(e.clientX, window.innerWidth - 205)}px`;
        menu.style.top = `${Math.min(e.clientY, window.innerHeight - 60)}px`;
        menu.classList.add('open');
    });

    document.addEventListener('click', (e) => {
        if (!menu.contains(e.target)) {
            hideContextMenu();
        }
        const popover = document.getElementById(SETTINGS_ID);
        const settingsBtn = document.getElementById('gl-inspector-settings-btn');
        if (
            isSettingsOpen &&
            popover &&
            !popover.contains(e.target) &&
            settingsBtn &&
            !settingsBtn.contains(e.target)
        ) {
            setSettingsOpen(false);
        }
    });

    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') {
            hideContextMenu();
            if (isSettingsOpen) {
                setSettingsOpen(false);
                return;
            }
            if (isOpen && !isInspectorFocused) {
                closeGlInspector();
            }
        }
    });

    document.addEventListener('slide-content-changed', () => {
        refreshGlInspectorText(currentTarget);
    });
    document.addEventListener('slide-thumbnail-changed', () => {
        refreshGlInspectorText(currentTarget);
    });
}

export function attachGlInspectorToRender(originalRenderFn) {
    renderEditorRef = originalRenderFn;
    return function wrappedRenderEditor(...args) {
        const result = originalRenderFn.apply(this, args);
        if (isOpen && !isApplyingFromInspector && !isInspectorFocused && !hasUnappliedDraft) {
            refreshGlInspectorText(currentTarget);
        }
        return result;
    };
}

export { bindMarkDirtyAndRender };