// ============================================================
// editor/inspector/codeEditor.js — CodeMirror 5 wrapper for .gl
// text: the "gluon" syntax mode (driven by tokenizer.js) and a small
// adapter API. Knows nothing about slides or app state.
//
// CodeMirror itself is loaded globally from libs/codemirror (see
// dependencies.yaml / index.html).
// ============================================================

import { scanGlLine } from './tokenizer.js';

const ACTIVE_LINE_CLASS = 'gl-active-line';

// ---------- Syntax mode ----------

function defineGluonMode(CodeMirror) {
    if (CodeMirror.modes.gluon) return;

    CodeMirror.defineMode('gluon', (config) => ({
        startState: () => ({ inElementBody: false, queue: [] }),
        copyState: (s) => ({ inElementBody: s.inElementBody, queue: s.queue.slice() }),

        token(stream, st) {
            if (stream.sol()) {
                const scanned = scanGlLine(stream.string, st.inElementBody);
                st.inElementBody = scanned.inElementBody;
                st.queue = scanned.tokens.filter(t => t.value !== '');
            }
            const tok = st.queue.shift();
            if (!tok) {
                stream.skipToEnd();
                return null;
            }
            // Tokens cover the line exactly; clamp defensively anyway.
            stream.pos = Math.min(stream.string.length, stream.pos + tok.value.length);
            if (stream.pos === stream.start) stream.next();
            return `gl-${tok.type}`;
        },

        blankLine(st) {
            st.queue = [];
        },

        // Body lines of an .element.* directive are indented one level.
        indent(st) {
            return st.inElementBody ? config.indentUnit : 0;
        },

        lineComment: '#',
    }));
}

// ---------- Adapter ----------

// Keys while the suggestion list is open: Enter or Tab accepts the
// highlighted suggestion, Esc closes the list.
const HINT_KEYS = {
    Enter: (cm, h) => h.pick(),
    Up: (cm, h) => h.moveFocus(-1),
    Down: (cm, h) => h.moveFocus(1),
    PageUp: (cm, h) => h.moveFocus(-h.menuSize() + 1, true),
    PageDown: (cm, h) => h.moveFocus(h.menuSize() - 1, true),
    Home: (cm, h) => h.setFocus(0),
    End: (cm, h) => h.setFocus(h.length - 1),
    Tab: (cm, h) => h.pick(),
    Esc: (cm, h) => h.close(),
};

/**
 * Creates the editor inside `host`. Returns an adapter with a small,
 * app-agnostic API. `onApplyShortcut` runs on Ctrl/Cmd+Enter; `hint`
 * is an optional show-hint provider for suggestions.
 */
export function createGlCodeEditor(host, { tabSize = 2, onApplyShortcut = null, hint = null } = {}) {
    const CodeMirror = window.CodeMirror;
    if (!CodeMirror) throw new Error('CodeMirror is not loaded (libs/codemirror/codemirror.min.js).');
    defineGluonMode(CodeMirror);

    const cm = CodeMirror(host, {
        value: '',
        mode: 'gluon',
        lineNumbers: false,
        indentWithTabs: true,
        indentUnit: tabSize,
        tabSize,
        smartIndent: true,
        lineWrapping: false,
        spellcheck: false,
        extraKeys: {
            Tab: (ed) => {
                if (ed.somethingSelected()) ed.indentSelection('add');
                else ed.replaceSelection('\t', 'end', '+input');
            },
            'Shift-Tab': 'indentLess',
            'Ctrl-Enter': () => onApplyShortcut && onApplyShortcut(),
            'Cmd-Enter': () => onApplyShortcut && onApplyShortcut(),
            'Ctrl-Space': (ed) => showHints(ed),
        },
    });

    // ---------- Suggestions (CodeMirror show-hint add-on) ----------
    function showHints(ed) {
        if (!hint || typeof ed.showHint !== 'function') return;
        ed.showHint({
            completeSingle: false,
            customKeys: HINT_KEYS,
            closeCharacters: /[\s()[\]{};>,]/,
            hint: (cmInst) => {
                const res = hint(cmInst);
                if (res) {
                    // After picking a parameter name, offer its values.
                    window.CodeMirror.on(res, 'pick', (picked) => {
                        if (picked && picked.chainValues) setTimeout(() => showHints(ed), 0);
                    });
                }
                return res;
            },
        });
    }
    if (hint) {
        cm.on('inputRead', (ed, change) => {
            if (change.origin !== '+input' || ed.state.completionActive) return;
            const ch = change.text[change.text.length - 1].slice(-1);
            // "{" and "," too: \cite{ suggests bibliography keys.
            if (/[\w.:#{,-]/.test(ch) || ch === ' ') showHints(ed);
        });
    }

    let inputHandler = null;
    let focusHandler = null;
    let cursorLineHandler = null;
    let activeLineHandle = null;
    let lastCursorLine = -1;
    let silent = false; // true while we change the text programmatically

    function markActiveLine(lineIdx) {
        if (activeLineHandle) cm.removeLineClass(activeLineHandle, 'background', ACTIVE_LINE_CLASS);
        activeLineHandle = lineIdx >= 0 && lineIdx < cm.lineCount()
            ? cm.addLineClass(lineIdx, 'background', ACTIVE_LINE_CLASS)
            : null;
    }

    cm.on('changes', () => {
        if (!silent && inputHandler) inputHandler(cm.getValue());
    });

    cm.on('cursorActivity', () => {
        const line = cm.getCursor().line;
        markActiveLine(line);
        if (silent || line === lastCursorLine) return;
        lastCursorLine = line;
        if (cursorLineHandler) cursorLineHandler(line);
    });

    cm.on('focus', () => focusHandler && focusHandler(true));
    cm.on('blur', () => focusHandler && focusHandler(false));

    function withSilence(fn) {
        silent = true;
        try {
            fn();
        } finally {
            silent = false;
        }
    }

    return {
        getValue: () => cm.getValue(),

        /**
         * Replaces the whole text (e.g. when the canvas changed). Keeps
         * the scroll position and clears undo history, since the new text
         * did not come from typing.
         */
        setValue(text) {
            const next = String(text ?? '');
            if (next === cm.getValue()) return;
            const scroll = cm.getScrollInfo();
            withSilence(() => {
                cm.setValue(next);
                cm.clearHistory();
            });
            cm.scrollTo(scroll.left, scroll.top);
        },

        /** Moves the cursor to a line and scrolls it into view. */
        jumpToLine(lineIdx, { focus = true } = {}) {
            const line = Math.max(0, Math.min(lineIdx, cm.lineCount() - 1));
            withSilence(() => cm.setCursor({ line, ch: 0 }));
            lastCursorLine = line;
            markActiveLine(line);
            const top = cm.charCoords({ line, ch: 0 }, 'local').top;
            cm.scrollTo(null, Math.max(0, top - cm.getScrollInfo().clientHeight * 0.35));
            if (focus) cm.focus();
        },

        /** Highlights a line without moving the cursor or focusing. */
        setHighlightLine(lineIdx) {
            markActiveLine(lineIdx);
        },

        setTabSize(size) {
            cm.setOption('tabSize', size);
            cm.setOption('indentUnit', size);
        },

        /** Call after the host becomes visible or changes size. */
        refresh: () => cm.refresh(),
        focus: () => cm.focus(),
        isFocused: () => cm.hasFocus(),

        onInput(handler) { inputHandler = handler; },
        onFocusChange(handler) { focusHandler = handler; },
        onCursorLineChange(handler) { cursorLineHandler = handler; },
    };
}
