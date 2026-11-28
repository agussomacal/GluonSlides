// ============================================================
// core/gl/glformat.js — The Gluon (.gl) project format.
// Generic serializer/parser driven by each element's `gl` spec
// in ElementRegistry, with tab-indented block bodies.
// ============================================================


// colour settings that may be a formula of the variables (core/liveEngine.js COLOR_KEYS)
const COLOR_FORMULA_KEYS = ['bg', 'borderCol', 'fontColor', 'stroke', 'fill', 'accent'];
import {ElementRegistry} from '../registry.js';

export const GL_FORMAT_VERSION = 2;

const BODY_INDENT = '\t';
// Holder returned for a .notes block so parseBlock hands it the body.
const NOTES_TYPE = '__slide_notes__';
const PROJECT_PARAMS = ['version', 'width', 'height', 'grid', 'darkmode', 'citestyle', 'nextid'];
/** Header values written only when set: shown by the \author and \date fields. */
export const PROJECT_TEXT_PARAMS = ['author', 'date'];
/** Display equations follow the text's alignment (written only then; centred otherwise). */
const EQUATIONS_PARAM = 'equations';
const DIRECTIVE_RE = /^\.(project|section|master|slide|notes|element|import|define|macro|defaults|palette|style|vars)(?:\.([a-zA-Z0-9_-]+))?(?=\s|$|\{)/;

const DEFAULT_NUMERIC_PROPS = new Set(['x', 'y', 'width', 'height', 'fontSize', 'borderWidth']);
const COMMON_ELEMENT_PROPS = [
    'x', 'y', 'width', 'height', 'bg', 'borderCol', 'borderWidth', 'borderStyle',
];

function getElementGlSpec(type) {
    const def = ElementRegistry.get ? ElementRegistry.get(type) : null;
    const gl = def && def.gl ? def.gl : null;
    return {
        registered: Boolean(def),
        props: Array.isArray(gl?.props) ? gl.props : COMMON_ELEMENT_PROPS,
        body: gl && 'body' in gl ? gl.body : null,
        numericProps: new Set(
            Array.isArray(gl?.numericProps) ? gl.numericProps : DEFAULT_NUMERIC_PROPS
        ),
        serializeBody: typeof gl?.serializeBody === 'function' ? gl.serializeBody : null,
        parseBody: typeof gl?.parseBody === 'function' ? gl.parseBody : null,
        // Optional directive name, e.g. 'macro.card' (default 'element.<type>').
        directive: typeof gl?.directive === 'function' ? gl.directive : null,
        // Optional: settings an element doesn't write (e.g. a circle's box: it writes cx, cy, r).
        omit: typeof gl?.omit === 'function' ? gl.omit : null,
        // Optional: completes an element just read (e.g. a circle's box from cx, cy, r).
        afterParse: typeof gl?.afterParse === 'function' ? gl.afterParse : null,
    };
}

// ---------- low-level encoding ----------

function normalizeGlText(text) {
    return String(text ?? '')
        .replace(/[\u200B-\u200D\uFEFF]/g, '')
        .replace(/\u00A0/g, ' ')
        .replace(/\uFF0E/g, '.')
        .replace(/\r\n|\r|\u2028|\u2029/g, '\n');
}

function encodeBraceArg(value) {
    return String(value ?? '')
        .replace(/\\/g, '\\\\')
        .replace(/\{/g, '\\{')
        .replace(/\}/g, '\\}');
}

function decodeBraceArg(value) {
    let out = '';
    for (let i = 0; i < value.length; i++) {
        const ch = value[i];
        if (ch === '\\' && i + 1 < value.length) {
            out += value[i + 1];
            i++;
        } else {
            out += ch;
        }
    }
    return out;
}

function encodeParamValue(value) {
    const s = String(value ?? '');
    if (s === '' || /[\s"]/.test(s)) {
        return '"' + s.replace(/\\/g, '\\\\').replace(/"/g, '\\"') + '"';
    }
    return s;
}

function parseParams(line) {
    const params = {};
    const re = /([a-zA-Z0-9_]+):(?:"((?:[^"\\]|\\.)*)"|(\S*))/g;
    let m;
    while ((m = re.exec(line)) !== null) {
        const key = m[1];
        if (m[2] !== undefined) {
            params[key] = m[2].replace(/\\(["\\])/g, '$1');
        } else {
            params[key] = m[3];
        }
    }
    return params;
}

/** `key:value key:value` for an object (values encoded as in directives). */
export function formatGlParams(obj) {
    return Object.entries(obj)
        .filter(([, v]) => v !== undefined && v !== null && v !== '')
        .map(([k, v]) => `${k}:${encodeParamValue(v)}`)
        .join(' ');
}

/** Parses `key:value key:"quoted value"` pairs from a line. */
export function parseGlParams(line) {
    return parseParams(line);
}

/** Indents a multi-line text body one level (escaping lines that start with '.'). */
export function indentGlBody(text) {
    return String(text).split('\n').map(indentBodyLine).join('\n');
}

/** Reverses one level of body indentation (and the '.' escape). */
export function unindentGlBodyLine(line) {
    return unindentBodyLine(line);
}

function indentBodyLine(line) {
    const escaped = line.startsWith('.') ? '\\' + line : line;
    if (escaped.length === 0) return '';
    return BODY_INDENT + escaped;
}

function unindentBodyLine(line) {
    let s = line;
    if (s.startsWith('\t')) {
        s = s.slice(1);
    } else if (s.startsWith('  ')) {
        s = s.slice(2);
    } else if (s.startsWith(' ')) {
        s = s.replace(/^ +/, '');
    }
    return s.startsWith('\\.') ? s.slice(1) : s;
}

function normalizeUniqueIds(project) {
    let maxId = Math.max(1, Number(project.nextId) || 1);
    const seenSlideIds = new Set();
    const seenElementIds = new Set();

    const allocFreshId = () => {
        const id = maxId;
        maxId += 1;
        return id;
    };

    const fixElements = (elements) => {
        for (const el of (elements || [])) {
            const rawElId = Number(el.id);
            let elId = Number.isInteger(rawElId) && rawElId > 0 ? rawElId : null;
            if (elId === null || seenElementIds.has(elId)) {
                elId = allocFreshId();
            }
            el.id = elId;
            seenElementIds.add(elId);
            if (elId >= maxId) maxId = elId + 1;
            if (Array.isArray(el.children)) fixElements(el.children);
        }
    };

    // Masters and slides share the ID space.
    for (const slide of [...(project.masters || []), ...(project.slides || [])]) {
        const rawSlideId = Number(slide.id);
        let slideId = Number.isInteger(rawSlideId) && rawSlideId > 0 ? rawSlideId : null;
        if (slideId === null || seenSlideIds.has(slideId)) {
            slideId = allocFreshId();
        }
        slide.id = slideId;
        seenSlideIds.add(slideId);
        if (slideId >= maxId) maxId = slideId + 1;
        fixElements(slide.elements);
    }

    project.nextId = maxId;
}

// ---------- serializer ----------

export function serializeGl(project) {
    const working = {
        ...project,
        slides: structuredClone(project.slides || []),
        masters: structuredClone(project.masters || []),
    };
    normalizeUniqueIds(working);

    const lines = [];
    lines.push('# Gluon slide project — saved by GluonSlides');
    lines.push('# Indented lines after an .element.* directive form its body.');

    const headerParams = {
        version: GL_FORMAT_VERSION,
        width: project.slideWidth,
        height: project.slideHeight,
        grid: project.gridSize,
        darkmode: project.isDarkMode ? 'yes' : 'no',
        citestyle: project.citestyle || 'numeric',
        nextid: project.nextId,
    };
    const headerArgs = working.projectName ? ` {${encodeBraceArg(working.projectName)}}` : '';
    const header = PROJECT_PARAMS
        .map(k => `${k}:${encodeParamValue(headerParams[k])}`)
        .join(' ');
    (project.imports || []).forEach(file => lines.push(`.import {${encodeBraceArg(file)}}`));
    // Optional header values, written only when set (for \author, \date).
    const extra = PROJECT_TEXT_PARAMS.filter(k => project[k]).map(k => ` ${k}:${encodeParamValue(project[k])}`).join('')
        + (project.equations === 'text' ? ` ${EQUATIONS_PARAM}:text` : '');
    lines.push(`.project${headerArgs} ${header}${extra}`);

    // Theme colors, e.g. .palette primary:#1d4ed8 accent:#f59e0b
    if (Array.isArray(project.palette) && project.palette.length) {
        lines.push(`.palette ${formatGlParams(Object.fromEntries(project.palette.map(p => [p.name, p.color])))}`);
    }
    // Variables (core/variables.js): files, then values written here
    (project.varFiles || []).forEach(f => {
        const params = formatGlParams({ sync: f.sync === false ? 'no' : 'yes', original: f.original || '' });
        lines.push(`.vars {${encodeBraceArg(f.file)}}${params ? ' ' + params : ''}`);
    });
    if (project.vars && Object.keys(project.vars).length) {
        lines.push(`.vars ${formatGlParams(project.vars)}`);
    }
    // Project-wide style defaults, e.g. .defaults.text fontFamily:"EB Garamond"
    Object.keys(project.defaults || {}).sort().forEach(type => {
        const params = formatGlParams(project.defaults[type] || {});
        if (params) lines.push(`.defaults.${type} ${params}`);
    });
    // Named styles, e.g. .style.text {title} fontSize:64
    Object.keys(project.styles || {}).sort().forEach(type => {
        Object.entries(project.styles[type] || {}).forEach(([name, values]) => {
            const params = formatGlParams(values || {});
            lines.push(`.style.${type} {${encodeBraceArg(name)}}${params ? ' ' + params : ''}`);
        });
    });

    // Macros defined in the project file itself (others live in imports).
    (project.macros || []).forEach(def => {
        lines.push('');
        lines.push(...serializeGlDefine(def));
    });

    // Master slides: drawn under the slides (core/masters.js).
    (working.masters || []).forEach(m => {
        lines.push('');
        lines.push(`.master {${encodeBraceArg(m.name)}} id:${encodeParamValue(m.id ?? '')}`);
        lines.push(...serializeGlElements(m.elements));
    });

    let section = '';
    (working.slides || []).forEach(slide => {
        const title = slide.title ? ` {${encodeBraceArg(slide.title)}}` : '';
        // Sections: `.section {Name}` before the first slide of each one
        // (a bare `.section` ends the previous one).
        if ((slide.section || '') !== section) {
            section = slide.section || '';
            lines.push('');
            lines.push(section ? `.section {${encodeBraceArg(section)}}` : '.section');
        }
        lines.push('');
        const master = slide.master ? ` master:${encodeParamValue(slide.master)}` : '';
        lines.push(`.slide${title} id:${encodeParamValue(slide.id ?? '')}${master}`);
        // Speaker notes: an indented block right after the .slide line.
        if (typeof slide.notes === 'string' && slide.notes.trim() !== '') {
            lines.push('.notes');
            lines.push(slide.notes.replace(/\s+$/, '').split('\n').map(indentBodyLine).join('\n'));
        }
        lines.push(...serializeGlElements(slide.elements));
    });

    return lines.join('\n') + '\n';
}

/**
 * Serializes a list of elements (directive line + indented body each)
 * to an array of lines. Used for slides and, recursively, by group
 * elements for their children.
 */
export function serializeGlElements(elements) {
    const lines = [];
    (elements || []).forEach(el => {
        lines.push(serializeElementDirective(el));
        const body = serializeElementBody(el);
        if (body !== null) lines.push(body);
    });
    return lines;
}

/** `.define {name} width:W height:H` + its indented elements, as lines. */
export function serializeGlDefine(def) {
    const head = `.define {${encodeBraceArg(def.name)}} width:${encodeParamValue(def.width)} height:${encodeParamValue(def.height)}`;
    const body = serializeGlElements(def.children || []);
    return body.length ? [head, indentGlBlock(body)] : [head];
}

/** A macro library file (e.g. macros.gl): imports + definitions. */
export function serializeGlLibrary({ imports = [], macros = [] } = {}) {
    const lines = ['# Gluon macro library — saved by GluonSlides'];
    imports.forEach(file => lines.push(`.import {${encodeBraceArg(file)}}`));
    macros.forEach(def => {
        lines.push('');
        lines.push(...serializeGlDefine(def));
    });
    return lines.join('\n') + '\n';
}

/** Indents every non-empty line one level (for nested blocks). */
export function indentGlBlock(lines) {
    return lines.join('\n').split('\n').map(l => (l === '' ? '' : BODY_INDENT + l)).join('\n');
}

function serializeElementDirective(el) {
    const spec = getElementGlSpec(el.type);
    // Elements inside macro definitions have a name but no project id.
    const head = [];
    if (el.id !== undefined && el.id !== null) head.push(`id:${encodeParamValue(el.id)}`);
    if (el.name) head.push(`name:${encodeParamValue(el.name)}`);
    if (el.style) head.push(`style:${encodeParamValue(el.style)}`);
    // Builds: the click at which the element appears (1 = from the start).
    if (Number(el.step) > 1) head.push(`step:${Math.round(Number(el.step))}`);
    // ...and the last step it is shown at (it disappears after it).
    if (Number(el.until) >= Math.max(1, Number(el.step) || 1)) head.push(`until:${Math.round(Number(el.until))}`);
    // Locked in the editor (can't be dragged); no effect on the slides.
    if (el.locked === 'yes') head.push('locked:yes');
    // Turned about its centre, in degrees (clockwise).
    // always quoted ("=…"), whatever it holds
    const formula = (key) => (el.formulas && el.formulas[key] ? `${key}:"${`=${el.formulas[key]}`.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"` : null);
    if (formula('rotate')) head.push(formula('rotate'));
    else if (Number(el.rotate)) head.push(`rotate:${Math.round(Number(el.rotate) * 10) / 10}`);
    // Opacity (0 to 1; 1 is not written) and a visibility condition (core/bindings.js).
    if (formula('opacity')) head.push(formula('opacity'));
    else if (el.opacity !== undefined && Number(el.opacity) < 1) head.push(`opacity:${Math.round(Number(el.opacity) * 100) / 100}`);
    if (formula('visible')) head.push(formula('visible'));

    if (!spec.registered) {
        const raw = Object.keys(el)
            .filter(k => !['type', 'id', 'name', 'style', 'step', 'until', 'locked', 'rotate', 'opacity', 'formulas'].includes(k) && !k.startsWith('_') && el[k] !== undefined && el[k] !== null)
            .filter(k => !(typeof el[k] === 'string' && el[k].startsWith('data:')))
            .map(k => `${k}:${encodeParamValue(typeof el[k] === 'object' ? JSON.stringify(el[k]) : el[k])}`);
        return `.element.${el.type} ${[...head, ...raw].join(' ')}`.trimEnd();
    }

    const parts = head;
    const omitted = spec.omit ? spec.omit(el) : null;
    spec.props.forEach(key => {
        if (omitted && omitted.has(key) && !(el.formulas && el.formulas[key])) return;
        // a formula of the variables is written as it was typed (core/bindings.js)
        if (formula(key)) { parts.push(formula(key)); return; }
        const v = el[key];
        if (v === undefined || v === null || v === '') return;
        if (typeof v === 'string' && v.startsWith('data:')) return;
        parts.push(`${key}:${encodeParamValue(v)}`);
    });
    const directive = spec.directive ? spec.directive(el) : `element.${el.type}`;
    return `.${directive} ${parts.join(' ')}`.trimEnd();
}

function defaultSerializeBody(el, bodyProp) {
    if (!bodyProp) return null;
    const raw = String(el[bodyProp] ?? '');
    if (raw === '' || raw.startsWith('data:')) return null;
    return raw
        .split('\n')
        .map(indentBodyLine)
        .join('\n');
}

function serializeElementBody(el) {
    const spec = getElementGlSpec(el.type);
    if (!spec.body) return null;
    if (spec.serializeBody) {
        return spec.serializeBody(el, (targetEl) => defaultSerializeBody(targetEl, spec.body));
    }
    return defaultSerializeBody(el, spec.body);
}

// ---------- parser ----------

export function parseGl(text) {
    const project = {
        version: GL_FORMAT_VERSION,
        name: 'Untitled Project',
        slideWidth: 1920,
        slideHeight: 1080,
        gridSize: 20,
        isDarkMode: false,
        nextId: 1,
        slides: [],
        masters: [],
    };
    let currentSlide = null;
    let section = ''; // set by .section, applies to the following slides
    const rawLines = normalizeGlText(text).split('\n');
    const library = { imports: [], defines: [] };

    parseBlock(rawLines, 0, ({ kind, subtype, braceArg, params, lineNo }) => {
        const libraryItem = handleLibraryDirective(library, { kind, braceArg, params, lineNo });
        if (libraryItem !== undefined) {
            currentSlide = null; // elements after a .define need a new .slide
            return libraryItem;
        }
        if (kind === 'project') {
            applyProjectParams(project, braceArg.value, params);
            currentSlide = null;
            return null;
        }
        if (kind === 'vars') {
            if (braceArg.value) {
                project.varFiles = project.varFiles || [];
                project.varFiles.push({ file: braceArg.value, sync: params.sync !== 'no', original: params.original || '' });
            } else {
                project.vars = project.vars || {};
                for (const [k, v] of Object.entries(params)) {
                    const n = Number(v);
                    project.vars[k] = v !== '' && Number.isFinite(n) ? n : v;
                }
            }
            currentSlide = null;
            return null;
        }
        if (kind === 'palette') {
            project.palette = Object.entries(params).map(([name, color]) => ({ name, color }));
            currentSlide = null;
            return null;
        }
        if (kind === 'style') {
            if (!subtype || !braceArg.value) {
                throw new Error(`Line ${lineNo}: .style needs a type and a name, e.g. .style.text {title} fontSize:60`);
            }
            const spec = getElementGlSpec(subtype);
            const typed = {};
            for (const [k, v] of Object.entries(params)) {
                const n = Number(v);
                typed[k] = spec.numericProps.has(k) && Number.isFinite(n) ? n : v;
            }
            project.styles = project.styles || {};
            project.styles[subtype] = { ...(project.styles[subtype] || {}), [braceArg.value]: typed };
            currentSlide = null;
            return null;
        }
        if (kind === 'defaults') {
            if (!subtype) throw new Error(`Line ${lineNo}: .defaults needs an element type, e.g. .defaults.text`);
            const spec = getElementGlSpec(subtype);
            const typed = {};
            for (const [k, v] of Object.entries(params)) {
                const n = Number(v);
                typed[k] = spec.numericProps.has(k) && Number.isFinite(n) ? n : v;
            }
            project.defaults = { ...(project.defaults || {}), [subtype]: { ...((project.defaults || {})[subtype] || {}), ...typed } };
            currentSlide = null;
            return null;
        }
        if (kind === 'section') {
            section = braceArg.value || '';
            currentSlide = null;
            return null;
        }
        if (kind === 'master') {
            const parsedId = Number(params.id);
            currentSlide = {
                id: Number.isInteger(parsedId) && parsedId > 0 ? parsedId : null,
                name: braceArg.value || `Master ${project.masters.length + 1}`,
                elements: [],
            };
            project.masters.push(currentSlide);
            return null;
        }
        if (kind === 'slide') {
            const parsedId = params.id !== undefined && params.id !== ''
                ? (Number.isFinite(Number(params.id)) ? Number(params.id) : params.id)
                : project.slides.length + 1;
            currentSlide = {
                id: parsedId,
                title: braceArg.value || `Slide ${project.slides.length + 1}`,
                elements: [],
            };
            if (section) currentSlide.section = section;
            if (params.master) currentSlide.master = params.master;
            project.slides.push(currentSlide);
            return null;
        }
        if (kind === 'notes') {
            if (!currentSlide) throw new Error(`Line ${lineNo}: .notes must follow a .slide line`);
            return { type: NOTES_TYPE, slide: currentSlide };
        }
        if (!currentSlide) {
            throw new Error(`Line ${lineNo}: .${kind}.${subtype ?? '?'} appears before any .slide`);
        }
        const el = buildElementFromDirective(kind, subtype, params, lineNo);
        currentSlide.elements.push(el);
        return el;
    });
    project.imports = library.imports;
    project.macros = finishDefines(library.defines);
    project.defaults = project.defaults || {};
    project.styles = project.styles || {};
    project.varFiles = project.varFiles || [];
    project.vars = project.vars || {};
    if (project.palette === undefined) project.palette = null; // project uses the starter palette

    if (project.slides.length === 0) {
        const preview = rawLines
            .map(l => l.trim())
            .filter(Boolean)
            .slice(0, 5)
            .join(' | ');
        throw new Error(`No .slide found in project file. Seen lines: ${preview || '(none)'}`);
    }

    normalizeUniqueIds(project);
    return project;
}

/**
 * Parses a block that may only contain .element directives (a group's
 * body, already unindented one level). `lineOffset` keeps error line
 * numbers relative to the whole file.
 */
export function parseGlElements(text, lineOffset = 0) {
    const elements = [];
    parseBlock(String(text ?? '').split('\n'), lineOffset, ({ kind, subtype, params, lineNo }) => {
        if (kind !== 'element' && kind !== 'macro') {
            throw new Error(`Line ${lineNo}: .${kind} is not allowed inside an element body.`);
        }
        const el = buildElementFromDirective(kind, subtype, params, lineNo);
        elements.push(el);
        return el;
    });
    return elements;
}

/**
 * Parses a macro library file (only .import and .define allowed).
 * Returns { imports: [file], macros: [{ name, width, height, children }] }.
 */
export function parseGlLibrary(text) {
    const library = { imports: [], defines: [] };
    parseBlock(normalizeGlText(text).split('\n'), 0, ({ kind, braceArg, params, lineNo }) => {
        const item = handleLibraryDirective(library, { kind, braceArg, params, lineNo });
        if (item === undefined) {
            throw new Error(`Line ${lineNo}: only .import and .define are allowed in a macro library.`);
        }
        return item;
    });
    return { imports: library.imports, macros: finishDefines(library.defines) };
}

/**
 * .import / .define handling shared by project files and libraries.
 * Returns undefined for other directives, null for .import, and for
 * .define a holder whose indented body is parsed like a group's.
 */
function handleLibraryDirective(library, { kind, braceArg, params, lineNo }) {
    if (kind === 'import') {
        if (!braceArg.value) throw new Error(`Line ${lineNo}: .import needs a file name, e.g. .import {macros.gl}`);
        library.imports.push(braceArg.value);
        return null;
    }
    if (kind === 'define') {
        if (!/^[A-Za-z][\w-]*$/.test(braceArg.value || '')) {
            throw new Error(`Line ${lineNo}: .define needs a name of letters, digits, - or _, e.g. .define {card}`);
        }
        const holder = { type: 'group', children: [] };
        library.defines.push({
            holder,
            name: braceArg.value,
            width: Number(params.width) || 0,
            height: Number(params.height) || 0,
        });
        return holder;
    }
    return undefined;
}

function finishDefines(defines) {
    return defines.map(({ holder, name, width, height }) => ({
        name,
        width: width || 100,
        height: height || 100,
        children: holder.children,
    }));
}

function buildElementFromDirective(kind, subtype, params, lineNo) {
    if (!subtype) {
        throw new Error(`Line ${lineNo}: Missing ${kind === 'macro' ? 'macro name' : 'element subtype'} on .${kind} directive.`);
    }
    if (kind === 'macro') {
        const el = buildElement('macro', params);
        el.ref = subtype;
        return el;
    }
    return buildElement(subtype, params);
}

/** Directive match for a line, but only at column 0 (indented = body). */
function matchTopLevelDirective(line) {
    if (/^[ \t]/.test(line)) return null;
    return line.replace(/^\p{Cf}+/u, '').match(DIRECTIVE_RE);
}

/**
 * Shared line loop: column-0 directives go to `onDirective`, which
 * returns the element that owns the following indented body lines
 * (or null). Body lines are unindented one level and handed to the
 * element's parseBody / body property when the block ends.
 */
function parseBlock(rawLines, lineOffset, onDirective) {
    let currentElement = null;
    let bodyLines = null;
    let bodyStartLine = 0;

    for (let i = 0; i < rawLines.length; i++) {
        const lineNo = i + 1 + lineOffset;
        const line = rawLines[i].replace(/\s+$/, '');
        const trimmedStart = line.replace(/^[\s\p{Cf}]+/u, '');

        if (!currentElement && trimmedStart.startsWith('#')) continue;

        const dirMatch = matchTopLevelDirective(line);
        if (dirMatch) {
            flushBody(currentElement, bodyLines, bodyStartLine);
            const rest = line.replace(/^\p{Cf}+/u, '').slice(dirMatch[0].length);
            const braceArg = extractBraceArg(rest);
            const params = parseParams(rest.slice(braceArg.rawLength));
            currentElement = onDirective({ kind: dirMatch[1], subtype: dirMatch[2], braceArg, params, lineNo });
            bodyLines = currentElement ? [] : null;
            bodyStartLine = lineNo; // body lines start after this one
            continue;
        }

        if (line.trim() === '') {
            if (currentElement && bodyLines !== null && hasMoreBodyLines(rawLines, i + 1)) {
                bodyLines.push('');
            }
            continue;
        }

        if (!currentElement) {
            throw new Error(`Line ${lineNo}: Unexpected content before any element: "${line.slice(0, 60)}"`);
        }
        bodyLines.push(unindentBodyLine(line));
    }

    flushBody(currentElement, bodyLines, bodyStartLine);
}

function hasMoreBodyLines(rawLines, startIndex) {
    for (let j = startIndex; j < rawLines.length; j++) {
        const candidate = rawLines[j].replace(/\s+$/, '');
        if (candidate.trim() === '') continue;
        return !matchTopLevelDirective(candidate);
    }
    return false;
}

function flushBody(element, bodyLines, bodyStartLine = 0) {
    if (!element || !bodyLines) return;
    if (element.type === NOTES_TYPE) {
        const notes = bodyLines.join('\n').replace(/^\n+|\s+$/g, '');
        if (notes) element.slide.notes = notes;
        return;
    }
    let leading = 0;
    while (bodyLines.length && bodyLines[0] === '') {
        bodyLines.shift();
        leading++;
    }
    while (bodyLines.length && bodyLines[bodyLines.length - 1] === '') bodyLines.pop();

    const spec = getElementGlSpec(element.type);
    const joined = bodyLines.join('\n');

    if (spec.parseBody) {
        spec.parseBody(joined, element, { lineOffset: bodyStartLine + leading });
    } else if (spec.body) {
        element[spec.body] = joined;
    }
}

function extractBraceArg(rest) {
    rest = rest.replace(/^\s+/, '');
    if (!rest.startsWith('{')) return {value: '', rawLength: 0};
    let depth = 0;
    for (let i = 0; i < rest.length; i++) {
        const ch = rest[i];
        if (ch === '\\') {
            i++;
            continue;
        }
        if (ch === '{') depth++;
        else if (ch === '}') {
            depth--;
            if (depth === 0) {
                return {value: decodeBraceArg(rest.slice(1, i)), rawLength: i + 1};
            }
        }
    }
    throw new Error('Unterminated {argument} in directive line.');
}

function applyProjectParams(project, name, params) {
    if (name) project.name = name;
    if (params.version) project.version = Number(params.version) || GL_FORMAT_VERSION;
    if (params.width) project.slideWidth = Number(params.width) || 1920;
    if (params.height) project.slideHeight = Number(params.height) || 1080;
    if (params.grid !== undefined) project.gridSize = Number(params.grid) || 0;
    if (params.darkmode !== undefined) project.isDarkMode = params.darkmode === 'yes';
    if (params.citestyle !== undefined) project.citestyle = params.citestyle === 'authoryear' ? 'authoryear' : 'numeric';
    if (params.nextid) project.nextId = Math.max(1, Number(params.nextid) || 1);
    PROJECT_TEXT_PARAMS.forEach(k => { if (params[k]) project[k] = params[k]; });
    if (params[EQUATIONS_PARAM] === 'text') project.equations = 'text';
}

function buildElement(type, params) {
    const rawId = params.id !== undefined && params.id !== '' ? Number(params.id) : NaN;
    const el = {type, id: Number.isFinite(rawId) ? rawId : null};
    if (params.name) el.name = params.name;
    if (params.style) el.style = params.style;
    const step = Math.round(Number(params.step));
    if (step > 1) el.step = step;
    const until = Math.round(Number(params.until));
    if (until >= Math.max(1, step || 1)) el.until = until;
    if (params.locked === 'yes') el.locked = 'yes';
    // "=…": a formula of the variables (core/bindings.js); its value comes when drawing
    const isFormula = (v) => typeof v === 'string' && v.trim().startsWith('=');
    const keepFormula = (key, raw) => { el.formulas = { ...(el.formulas || {}), [key]: raw.trim().slice(1).trim() }; };
    if (isFormula(params.rotate)) keepFormula('rotate', params.rotate);
    else {
        const rotate = Number(params.rotate);
        if (rotate && Number.isFinite(rotate)) el.rotate = rotate;
    }
    if (isFormula(params.opacity)) keepFormula('opacity', params.opacity);
    else if (params.opacity !== undefined && Number.isFinite(Number(params.opacity))) el.opacity = Math.max(0, Math.min(1, Number(params.opacity)));
    if (isFormula(params.visible)) keepFormula('visible', params.visible);
    const spec = getElementGlSpec(type);

    const keysToRead = spec.registered ? spec.props : Object.keys(params).filter(k => !['id', 'name', 'style', 'step', 'until', 'locked', 'rotate', 'opacity', 'visible'].includes(k));
    keysToRead.forEach(key => {
        if (params[key] === undefined) return;
        const raw = params[key];
        if (spec.numericProps.has(key) && isFormula(raw)) {
            keepFormula(key, raw);
            el[key] = 0;
        } else if (COLOR_FORMULA_KEYS.includes(key) && isFormula(raw)) {
            keepFormula(key, raw); // a colour given by a formula (core/bindings.js): its value comes when drawing
        } else if (spec.numericProps.has(key)) {
            const num = Number(raw);
            el[key] = Number.isFinite(num) ? num : 0;
        } else {
            el[key] = raw;
        }
    });
    if (spec.afterParse) spec.afterParse(el);
    return el;
}

export function looksLikeGl(content) {
    const lines = normalizeGlText(content).split('\n');
    for (const line of lines) {
        const t = line.trim();
        if (t === '' || t.startsWith('#')) continue;
        return !t.startsWith('{') && DIRECTIVE_RE.test(t);
    }
    return false;
}