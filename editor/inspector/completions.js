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
import { STYLE_KEYS, styleNames } from '../../core/defaults.js';
import { palette } from '../../core/colors.js';
import { citationCandidates, OPEN_CITE_RE } from '../../core/citations.js';
import { variableCandidates, OPEN_VAR_RE } from '../../core/variables.js';
import { commandCandidates, OPEN_COMMAND_RE } from '../../core/fields.js';
import { LAYERS, paramOf } from '../../core/plotSchema.js';
import { formulaNames } from '../../core/liveEngine.js';
import { allVariables } from '../../core/variables.js';
import { dataTable } from '../../core/plotData.js';

const PROJECT_PARAMS = ['version', 'width', 'height', 'grid', 'darkmode', 'citestyle', 'nextid', 'author', 'date'];

// Known values for enumerated parameters.
const VALUES = {
    kind: ['rect', 'ellipse'],
    curve: ['straight', 'smooth'],
    closed: ['yes', 'no'],
    lockAspect: ['yes', 'no'],
    locked: ['yes', 'no'],
    divider: ['none', 'line'],
    header: ['yes', 'no'],
    borders: ['horizontal', 'all', 'none'],
    stripes: ['yes', 'no'],
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
    if ((m = text.match(/^\.element\.([\w-]+)/))) {
        return { params: ['id', 'name', ...(STYLE_KEYS[m[1]] ? ['style'] : []), 'step', 'locked', ...elementProps(m[1])], keys, type: m[1] };
    }
    if (text.match(/^\.macro\./)) return { params: ['id', 'name', 'step', 'locked', ...elementProps('macro')], keys };
    if (text.startsWith('.project')) return { params: PROJECT_PARAMS, keys };
    if (text.startsWith('.slide')) return { params: ['id', 'master'], keys };
    if (text.startsWith('.master')) return { params: ['id'], keys };
    if (text.startsWith('.define')) return { params: ['width', 'height'], keys };
    if ((m = text.match(/^\.defaults\.([\w-]+)/))) return { params: STYLE_KEYS[m[1]] || [], keys };
    if ((m = text.match(/^\.style\.([\w-]+)/))) return { params: STYLE_KEYS[m[1]] || [], keys };
    if (text.startsWith('.palette')) return { params: [], keys };
    if (text.startsWith('.vars {')) return { params: ['sync', 'original'], keys };
    if (text.startsWith('.vars')) return { params: [], keys };
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
        { text: '.section {', displayText: '.section {Name}  (the following slides)' },
        { text: '.master {', displayText: '.master {Name} id:  (drawn under every slide)' },
        { text: '.notes', displayText: '.notes  (speaker notes, indented below)' },
        { text: '.define {', displayText: '.define {name} width: height:' },
        { text: '.import {', displayText: '.import {macros.gl}' },
        { text: '.project {', displayText: '.project {Name} ...' },
        ...Object.keys(STYLE_KEYS).map(t => ({ text: `.defaults.${t} `, displayText: `.defaults.${t}  (project defaults)` })),
        ...Object.keys(STYLE_KEYS).map(t => ({ text: `.style.${t} {`, displayText: `.style.${t} {name}  (named style)` })),
        { text: '.palette ', displayText: '.palette name:#hex ...  (theme colors)' },
        { text: '.vars {', displayText: '.vars {data/file.json} sync:yes  (variables from a file)' },
        { text: '.vars ', displayText: '.vars name:value ...  (variables)' },
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

/** The type of the element whose body line `lineNo` is in (or null). */
function enclosingElementType(cm, lineNo) {
    for (let i = lineNo; i >= 0; i--) {
        const t = cm.getLine(i);
        if (/^\S/.test(t)) {
            const m = t.match(/^\.element\.([\w-]+)/);
            return m ? m[1] : null;
        }
    }
    return null;
}

const LAYER_LINE_RE = /^[ \t]+\.([a-z]+)\b/;

/** In a plot's body: layer lines, their settings and values, and formulas. */
function plotHints(cm, cur, lineText, before, result) {
    const indent = before.match(/^[ \t]*/)[0];
    const text = before.slice(indent.length);
    // a layer line being started
    if (/^\.[a-z]*$/.test(text)) {
        const list = Object.entries(LAYERS).filter(([k]) => `.${k}`.startsWith(text) && `.${k}` !== text)
            .map(([k, d]) => ({ text: `.${k} `, displayText: `.${k}  —  ${d.label}${d.formula ? `: ${d.formula}` : ''}` }));
        return result(list, indent.length);
    }
    const head = lineText.match(LAYER_LINE_RE);
    if (head && LAYERS[head[1]]) {
        const kind = head[1];
        const word = before.match(/[^\s]*$/)[0];
        if (/^[A-Za-z]+:/.test(word)) {
            const key = word.slice(0, word.indexOf(':'));
            const typed = word.slice(key.length + 1).replace(/^"/, '');
            const param = paramOf(kind, key);
            if (!param) return null;
            let values = [];
            if (param.type === 'select') values = param.options.map(([v]) => v).filter(Boolean);
            else if (param.type === 'bool') values = ['yes', 'no'];
            else if (param.type === 'color') values = palette().map(p => `@${p.name}`);
            else if (param.type === 'formula') values = Object.keys(allVariables()).sort();
            else if (param.type === 'column') {
                const data = (lineText.match(/\bdata:(?:\{([^}]+)\}|"([^"]+)"|(\S+))/) || []).slice(1).find(Boolean);
                const t = data ? dataTable(data) : null;
                values = (t && t.header) || [];
            }
            const quote = (v) => (/[\s"]/.test(v) ? `"${v}"` : v);
            const list = values.filter(v => String(v).toLowerCase().startsWith(typed.toLowerCase()) && v !== typed)
                .map(v => ({ text: `${key}:${quote(String(v))} `, displayText: String(v) }));
            return result(list, cur.ch - word.length);
        }
        if (/^[A-Za-z]*$/.test(word) && /\s$/.test(before.slice(0, before.length - word.length))) {
            const present = new Set([...lineText.matchAll(/([A-Za-z]+):/g)].map(m => m[1]));
            const list = LAYERS[kind].params.filter(p => !present.has(p.key) && p.key.startsWith(word))
                .map(p => ({ text: `${p.key}:`, displayText: `${p.key}  —  ${p.label}${p.help ? `: ${p.help}` : ''}`, chainValues: ['select', 'bool', 'color', 'column', 'formula'].includes(p.type) }));
            return result(list, cur.ch - word.length);
        }
        return null;
    }
    // a formula line: the layer above says which names it gets
    let kind = 'curve';
    for (let i = cur.line - 1; i >= 0; i--) {
        const m = cm.getLine(i).match(LAYER_LINE_RE);
        if (m) { kind = m[1]; break; }
        if (/^\S/.test(cm.getLine(i))) break;
    }
    const word = before.match(/[A-Za-z_][A-Za-z0-9_]*$/);
    if (!word) return null;
    const typed = word[0];
    const d = LAYERS[kind] || {};
    const vars = allVariables();
    const { functions, constants } = formulaNames();
    const list = [
        ...(d.coords || []).map(n => ({ text: n, displayText: `${n}  —  the layer's ${n}` })),
        ...Object.keys(vars).sort().map(n => ({ text: n, displayText: `${n}  —  ${vars[n]}` })),
        ...(d.outputs || []).map(n => ({ text: `${n} = `, displayText: `${n} = …  —  what the layer draws` })),
        ...functions.map(n => ({ text: `${n}(`, displayText: `${n}(…)` })),
        ...constants.map(n => ({ text: n, displayText: n })),
    ].filter(c => c.text.toLowerCase().startsWith(typed.toLowerCase()) && c.text !== typed);
    return result(list.slice(0, 40), cur.ch - typed.length);
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

    // Inside a plot: its layers, their settings, the formulas' names.
    if (indent.length > 0 && enclosingElementType(cm, cur.line) === 'plot') {
        return plotHints(cm, cur, lineText, before, result);
    }

    // \cite{… in body text: bibliography keys.
    const cite = before.match(OPEN_CITE_RE);
    if (cite && indent.length > 0) {
        const typed = cite[1];
        const after = lineText.slice(cur.ch);
        const close = /^\s*[},]/.test(after) ? '' : '}';
        const list = citationCandidates(typed)
            .filter(c => c.key !== typed || close)
            .map(c => ({ text: c.key + close, displayText: `${c.key}  —  ${c.label}` }));
        return result(list, cur.ch - typed.length);
    }

    // \var{… in body text: the variables.
    const variable = before.match(OPEN_VAR_RE);
    if (variable && indent.length > 0) {
        const typed = variable[1];
        const close = /^\s*\}/.test(lineText.slice(cur.ch)) ? '' : '}';
        const list = variableCandidates(typed)
            .filter(c => c.name !== typed || close)
            .map(c => ({ text: c.name + close, displayText: `${c.name}  —  ${c.label}` }));
        return result(list, cur.ch - typed.length);
    }

    // "\" in body text: fields and bibliography commands.
    const command = indent.length > 0 && before.match(OPEN_COMMAND_RE);
    if (command) {
        const list = commandCandidates(command[1])
            .map(c => ({ text: c.insert, displayText: `\\${c.name}  —  ${c.label}`, chainValues: c.insert.endsWith('{') }));
        return result(list, cur.ch - command[1].length);
    }

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
    // a setting written as a formula (x:"=860 + 300*mu"): the variables and functions
    const formula = before.match(/[A-Za-z]\w*:"?=[^"]*?([A-Za-z_]\w*)$/);
    if (formula) {
        const typed = formula[1];
        const vars = allVariables();
        const { functions } = formulaNames();
        const list = [
            ...Object.keys(vars).sort().map(n => ({ text: n, displayText: `${n}  —  ${vars[n]}` })),
            ...functions.map(n => ({ text: `${n}(`, displayText: `${n}(…)` })),
        ].filter(c => c.text.startsWith(typed) && c.text !== typed);
        return result(list, cur.ch - typed.length);
    }
    const word = before.match(/[^\s]*$/)[0];
    if (/^[A-Za-z]\w*:/.test(word)) {
        const key = word.slice(0, word.indexOf(':'));
        const typed = word.slice(key.length + 1);
        let values = VALUES[key] || (COLOR_KEYS.has(key)
            ? ['transparent', ...palette().map(p => `@${p.name}`), ...documentColors(cm)]
            : []);
        if (key === 'style') values = styleNames(ctx.type || '');
        const list = values.filter(v => matches(v, typed) || typed === '').filter(v => v !== typed)
            .map(v => ({ text: `${key}:${v} `, displayText: v }));
        return result(list, cur.ch - word.length);
    }
    if (/^[A-Za-z]*$/.test(word) && before.length > indent.length && /\s$/.test(before.slice(0, before.length - word.length))) {
        const list = ctx.params
            .filter((k, i, all) => all.indexOf(k) === i && !ctx.keys.has(k))
            .filter(k => k.toLowerCase().startsWith(word.toLowerCase()))
            .map(k => ({ text: `${k}:`, displayText: k, chainValues: Boolean(VALUES[k] || COLOR_KEYS.has(k) || k === 'style') }));
        return result(list, cur.ch - word.length);
    }
    return null;
}
