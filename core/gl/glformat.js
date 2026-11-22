// ============================================================
// core/gl/glformat.js — The Gluon (.gl) project format.
// Generic serializer/parser driven by each element's `gl` spec
// in ElementRegistry, with indented block bodies.
// ============================================================

import {ElementRegistry} from '../registry.js';

export const GL_FORMAT_VERSION = 2;

const BODY_INDENT = '  ';
const PROJECT_PARAMS = ['version', 'width', 'height', 'grid', 'darkmode', 'nextid'];
const DIRECTIVE_RE = /^\.(project|slide|element)(?:\.([a-zA-Z0-9_-]+))?(?=\s|$|\{)/;

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

function indentBodyLine(line) {
    const escaped = line.startsWith('.') ? '\\' + line : line;
    if (escaped.length === 0) return '';
    return BODY_INDENT + escaped;
}

function unindentBodyLine(line) {
    let s = line;
    if (s.startsWith(BODY_INDENT)) {
        s = s.slice(BODY_INDENT.length);
    } else if (s.startsWith('\t')) {
        s = s.slice(1);
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

    for (const slide of (project.slides || [])) {
        const rawSlideId = Number(slide.id);
        let slideId = Number.isInteger(rawSlideId) && rawSlideId > 0 ? rawSlideId : null;
        if (slideId === null || seenSlideIds.has(slideId)) {
            slideId = allocFreshId();
        }
        slide.id = slideId;
        seenSlideIds.add(slideId);
        if (slideId >= maxId) maxId = slideId + 1;

        for (const el of (slide.elements || [])) {
            const rawElId = Number(el.id);
            let elId = Number.isInteger(rawElId) && rawElId > 0 ? rawElId : null;
            if (elId === null || seenElementIds.has(elId)) {
                elId = allocFreshId();
            }
            el.id = elId;
            seenElementIds.add(elId);
            if (elId >= maxId) maxId = elId + 1;
        }
    }

    project.nextId = maxId;
}

// ---------- serializer ----------

export function serializeGl(project) {
    const working = {
        ...project,
        slides: (project.slides || []).map(s => ({
            ...s,
            elements: (s.elements || []).map(el => ({...el})),
        })),
    };
    normalizeUniqueIds(working);

    const lines = [];
    lines.push('# Gluon slide project — saved by Slide Studio');
    lines.push('# Indented lines after an .element.* directive form its body.');

    const headerParams = {
        version: GL_FORMAT_VERSION,
        width: working.slideWidth ?? 1920,
        height: working.slideHeight ?? 1080,
        grid: working.gridSize ?? 20,
        darkmode: working.isDarkMode ? 'yes' : 'no',
        nextid: working.nextId ?? 1,
    };
    const headerArgs = working.projectName ? ` {${encodeBraceArg(working.projectName)}}` : '';
    const header = PROJECT_PARAMS
        .map(k => `${k}:${encodeParamValue(headerParams[k])}`)
        .join(' ');
    lines.push(`.project${headerArgs} ${header}`);

    (working.slides || []).forEach(slide => {
        const title = slide.title ? ` {${encodeBraceArg(slide.title)}}` : '';
        lines.push('');
        lines.push(`.slide${title} id:${encodeParamValue(slide.id ?? '')}`);
        (slide.elements || []).forEach(el => {
            lines.push(serializeElementDirective(el));
            const body = serializeElementBody(el);
            if (body !== null) {
                lines.push(body);
            }
        });
    });

    return lines.join('\n') + '\n';
}

function serializeElementDirective(el) {
    const spec = getElementGlSpec(el.type);
    const idVal = (el.id !== undefined && el.id !== null) ? encodeParamValue(el.id) : '';

    if (!spec.registered) {
        const raw = Object.keys(el)
            .filter(k => k !== 'type' && k !== 'id' && el[k] !== undefined && el[k] !== null)
            .filter(k => !(typeof el[k] === 'string' && el[k].startsWith('data:')))
            .map(k => `${k}:${encodeParamValue(typeof el[k] === 'object' ? JSON.stringify(el[k]) : el[k])}`)
            .join(' ');
        return `.element.${el.type} id:${idVal}${raw ? ' ' + raw : ''}`;
    }

    const parts = [`id:${idVal}`];
    spec.props.forEach(key => {
        const v = el[key];
        if (v === undefined || v === null || v === '') return;
        if (typeof v === 'string' && v.startsWith('data:')) return;
        parts.push(`${key}:${encodeParamValue(v)}`);
    });
    return `.element.${el.type} ${parts.join(' ')}`;
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
    };

    let currentSlide = null;
    let currentElement = null;
    let bodyLines = null;

    const rawLines = normalizeGlText(text).split('\n');

    for (let i = 0; i < rawLines.length; i++) {
        const line = rawLines[i].replace(/\s+$/, '');
        const trimmedStart = line.replace(/^[\s\p{Cf}]+/u, '');

        if (!currentElement && trimmedStart.startsWith('#')) {
            continue;
        }

        const dirMatch = trimmedStart.match(DIRECTIVE_RE);
        if (dirMatch) {
            flushBody(currentElement, bodyLines);
            currentElement = null;
            bodyLines = null;

            const kind = dirMatch[1];
            const subtype = dirMatch[2];
            const rest = trimmedStart.slice(dirMatch[0].length);
            const braceArg = extractBraceArg(rest);
            const params = parseParams(rest.slice(braceArg.rawLength));

            if (kind === 'project') {
                applyProjectParams(project, braceArg.value, params);
                currentSlide = null;
            } else if (kind === 'slide') {
                const parsedId = params.id !== undefined && params.id !== ''
                    ? (Number.isFinite(Number(params.id)) ? Number(params.id) : params.id)
                    : project.slides.length + 1;
                currentSlide = {
                    id: parsedId,
                    title: braceArg.value || `Slide ${project.slides.length + 1}`,
                    elements: [],
                };
                project.slides.push(currentSlide);
            } else if (kind === 'element') {
                if (!currentSlide) {
                    throw new Error(`Line ${i + 1}: .element.${subtype ?? '?'} appears before any .slide`);
                }
                if (!subtype) {
                    throw new Error(`Line ${i + 1}: Missing element subtype on .element directive.`);
                }
                currentElement = buildElement(subtype, params);
                currentSlide.elements.push(currentElement);
                bodyLines = [];
            }
            continue;
        }

        if (line.trim() === '') {
            if (currentElement && bodyLines !== null && hasMoreBodyLines(rawLines, i + 1)) {
                bodyLines.push('');
            }
            continue;
        }

        if (!currentElement) {
            throw new Error(`Line ${i + 1}: Unexpected content before any element: "${line.slice(0, 60)}"`);
        }
        if (bodyLines === null) bodyLines = [];
        bodyLines.push(unindentBodyLine(line));
    }

    flushBody(currentElement, bodyLines);

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

function hasMoreBodyLines(rawLines, startIndex) {
    for (let j = startIndex; j < rawLines.length; j++) {
        const candidate = rawLines[j].replace(/\s+$/, '');
        const trimmed = candidate.replace(/^[\s\p{Cf}]+/u, '');
        if (trimmed === '') continue;
        if (DIRECTIVE_RE.test(trimmed)) return false;
        return true;
    }
    return false;
}

function flushBody(element, bodyLines) {
    if (!element || !bodyLines) return;
    while (bodyLines.length && bodyLines[0] === '') bodyLines.shift();
    while (bodyLines.length && bodyLines[bodyLines.length - 1] === '') bodyLines.pop();

    const spec = getElementGlSpec(element.type);
    const joined = bodyLines.join('\n');

    if (spec.parseBody) {
        spec.parseBody(joined, element);
    } else if (spec.body) {
        element[spec.body] = joined;
    }
    element._hadBody = bodyLines.length > 0;
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
    if (params.version !== undefined && params.version !== '') {
        project.version = Number(params.version) || GL_FORMAT_VERSION;
    }
    if (params.width !== undefined && params.width !== '') {
        project.slideWidth = Number(params.width) || 1920;
    }
    if (params.height !== undefined && params.height !== '') {
        project.slideHeight = Number(params.height) || 1080;
    }
    if (params.grid !== undefined && params.grid !== '') {
        const g = Number(params.grid);
        project.gridSize = Number.isFinite(g) ? g : 20;
    }
    if (params.darkmode !== undefined && params.darkmode !== '') {
        project.isDarkMode = params.darkmode === 'yes';
    }
    if (params.nextid !== undefined && params.nextid !== '') {
        project.nextId = Math.max(1, Number(params.nextid) || 1);
    }
}

function buildElement(type, params) {
    const rawId = params.id !== undefined && params.id !== '' ? Number(params.id) : NaN;
    const el = {type, id: Number.isFinite(rawId) ? rawId : null};
    const spec = getElementGlSpec(type);

    const keysToRead = spec.registered ? spec.props : Object.keys(params).filter(k => k !== 'id');
    keysToRead.forEach(key => {
        if (params[key] === undefined) return;
        const raw = params[key];
        if (spec.numericProps.has(key)) {
            const num = Number(raw);
            el[key] = Number.isFinite(num) ? num : 0;
        } else {
            el[key] = raw;
        }
    });
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

