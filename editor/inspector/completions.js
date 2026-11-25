// ============================================================
// editor/inspector/completions.js — Autocomplete for .gl text,
// built from the live element registry and macro library:
//
//   .|                 directives (.slide, .element.<type>, .macro.<name>, ...)
//   .element.text |    parameters of that type not yet on the line
//   fontFamily:|       values (enums, or colors already used in the file)
//   ::|                element names of the enclosing .macro.<name>
//   ::title |          that element's parameters (+ hidden)
//
// Used as a CodeMirror show-hint provider (see codeEditor.js).
// ============================================================

import { state } from '../../core/state.js';
import { ElementRegistry } from '../../core/registry.js';
import { STYLE_KEYS } from '../../core/defaults.js';

const PROJECT_PARAMS = ['version', 'width', 'height', 'grid', 'darkmode', 'citestyle', 'nextid'];

// Known values for enumerated parameters.
const VALUES = {
    kind: ['rect', 'ellipse'],
    curve: ['straight', 'smooth'],
    closed: ['yes', 'no'],
    lockAspect: ['yes', 'no'],
    hidden: ['yes', 'no'],
    darkmode: ['yes', 'no'],
    dash: ['solid', 'dashed', 'dotted'],
    start: ['none', 'arrow', 'dot'],
    end: ['none', 'arrow', 'dot'],
    textAlign: ['left', 'center', 'right'],
    verticalAlign: ['top', 'center', 'bottom'],
    fontFamily: ['sans-serif', 'serif', 'monospace'],
    borderStyle: ['solid', 'dashed', 'dotted', 'none'],
    citestyle: ['numeric', 'authoryear'],
};
const COLOR_KEYS = new Set(['bg', 'borderCol', 'fontColor', 'stroke', 'fill']);

function elementProps(type) {
    const def = ElementRegistry.get(type);
    return def && def.gl && Array.isArray(def.gl.props) ? def.gl.props : [];
}

/** The .macro.<name> instance whose body contains line `lineNo`, if any. */
function enclosingMacro(cm, lineNo) {
    const indentOf = (s) => s.match(/^[ \t]*/)[0].length;
    const here = indentOf(cm.getLine(lineNo));
    for (let i = lineNo - 1; i >= 0; i--) {
        const line = cm.getLine(i);
        if (line.trim() === '') continue;
        if (indentOf(line) >= here) continue;
        const m = line.trim().match(/^\.macro\.([\w-]+)/);
        return m ? m[1] : null;
    }
    return null;
}

function findNamed(elements, name) {
    for (const el of elements || []) {
        if (el.name === name) return el;
        const inner = findNamed(el.children, name);
        if (inner) return inner;
    }
    return null;
}

/** Element type and existing keys for the directive/override on this line. */
function lineContext(cm, lineNo, text) {
    const keys = new Set([...text.matchAll(/(?:^|\s)([A-Za-z]\w*):/g)].map(m => m[1]));
    let m;
    if ((m = text.match(/^\.element\.([\w-]+)/))) return { params: ['id', 'name', ...elementProps(m[1])], keys };
    if (text.match(/^\.macro\./)) return { params: ['id', 'name', ...elementProps('macro')], keys };
    if (text.startsWith('.project')) return { params: PROJECT_PARAMS, keys };
    if (text.startsWith('.slide')) return { params: ['id'], keys };
    if (text.startsWith('.define')) return { params: ['width', 'height'], keys };
    if ((m = text.match(/^\.defaults\.([\w-]+)/))) return { params: STYLE_KEYS[m[1]] || [], keys };
    if ((m = text.match(/^::([\w-]+)/))) {
        const macro = state.macros && state.macros[enclosingMacro(cm, lineNo)];
        const target = macro && findNamed(macro.children, m[1]);
        return { params: target ? [...elementProps(target.type), 'hidden'] : ['hidden'], keys };
    }
    return null;
}

/** Colors already used in the document, most frequent first. */
function documentColors(cm) {
    const counts = new Map();
    for (const m of cm.getValue().matchAll(/:(#[0-9a-fA-F]{3,8})\b/g)) {
        counts.set(m[1], (counts.get(m[1]) || 0) + 1);
    }
    return [...counts.entries()].sort((a, b) => b[1] - a[1]).map(([c]) => c);
}

function directiveCandidates() {
    const list = [
        { text: '.slide {', displayText: '.slide {Title} id:' },
        { text: '.define {', displayText: '.define {name} width: height:' },
        { text: '.import {', displayText: '.import {macros.gl}' },
        { text: '.project {', displayText: '.project {Name} ...' },
        ...Object.keys(STYLE_KEYS).map(t => ({ text: `.defaults.${t} `, displayText: `.defaults.${t}  (project defaults)` })),
    ];
    ElementRegistry.types()
        .filter(def => def.type !== 'macro')
        .forEach(def => list.push({ text: `.element.${def.type} `, displayText: `.element.${def.type}` }));
    Object.keys(state.macros || {}).sort().forEach(name => list.push({ text: `.macro.${name} `, displayText: `.macro.${name}  (macro)` }));
    return list;
}

function matches(candidate, typed) {
    const t = typed.toLowerCase();
    const c = (candidate.text || candidate).toLowerCase();
    return c.startsWith(t) && c !== t;
}

/** show-hint provider: suggestions for the cursor position, or null. */
export function glHints(cm) {
    const cur = cm.getCursor();
    const lineText = cm.getLine(cur.line);
    const before = lineText.slice(0, cur.ch);
    const indent = before.match(/^[ \t]*/)[0];
    const text = before.slice(indent.length);
    const result = (list, fromCh) => {
        if (!list.length) return null;
        return { list, from: { line: cur.line, ch: fromCh }, to: cur };
    };

    // Directive at the start of a line.
    if (/^\.[\w.-]*$/.test(text)) {
        return result(directiveCandidates().filter(c => matches(c, text)), indent.length);
    }

    // ::name inside a macro instance.
    if (/^::[\w-]*$/.test(text)) {
        const macro = state.macros && state.macros[enclosingMacro(cm, cur.line)];
        if (!macro) return null;
        const typed = text.slice(2);
        const list = (macro.children || [])
            .filter(c => c.name && c.name.toLowerCase().startsWith(typed.toLowerCase()) && c.name !== typed)
            .map(c => ({ text: `::${c.name} `, displayText: `::${c.name}  (${c.type})` }));
        return result(list, indent.length);
    }

    // Parameter key or value in a directive / override line.
    const ctx = lineContext(cm, cur.line, lineText.trim());
    if (!ctx) return null;
    const word = before.match(/[^\s]*$/)[0];
    if (/^[A-Za-z]\w*:/.test(word)) {
        const key = word.slice(0, word.indexOf(':'));
        const typed = word.slice(key.length + 1);
        const values = VALUES[key] || (COLOR_KEYS.has(key) ? ['transparent', ...documentColors(cm)] : []);
        const list = values.filter(v => matches(v, typed) || typed === '').filter(v => v !== typed)
            .map(v => ({ text: `${key}:${v} `, displayText: v }));
        return result(list, cur.ch - word.length);
    }
    if (/^[A-Za-z]*$/.test(word) && before.length > indent.length && /\s$/.test(before.slice(0, before.length - word.length))) {
        const list = ctx.params
            .filter((k, i, all) => all.indexOf(k) === i && !ctx.keys.has(k))
            .filter(k => k.toLowerCase().startsWith(word.toLowerCase()))
            .map(k => ({ text: `${k}:`, displayText: k, chainValues: Boolean(VALUES[k] || COLOR_KEYS.has(k)) }));
        return result(list, cur.ch - word.length);
    }
    return null;
}
