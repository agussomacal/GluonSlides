// ============================================================
// editor/inspector/tokenizer.js — Pure syntax tokenizer for Gluon (.gl)
// text. Produces `{ type, value }` tokens for comments,
// structural/function directives, element directives, brace args,
// key:value parameters, and indented body content (including
// inline/display math) while preserving original whitespace/tabs.
// ============================================================

const STRUCTURAL_DIRECTIVES = new Set(['project', 'section', 'slide', 'notes', 'function', 'var', 'import', 'define', 'defaults', 'palette', 'style']);
const DIRECTIVE_HEAD_RE = /^\.(project|section|slide|notes|element|macro|function|var|import|define|defaults|palette|style)(?:\.([a-zA-Z0-9_-]+))?(?=\s|$|\{)/;
const OVERRIDE_HEAD_RE = /^::[A-Za-z][\w-]*/;   // ::name inside a .macro.* instance
// Lines after these directives are an element body (text, points, children).
const BODY_DIRECTIVE_RE = /^\.(element|macro|define)[.\s{]|^\.(define|notes)$/;

function tokenizeParamsSegment(segment) {
    const tokens = [];
    let cursor = 0;

    while (cursor < segment.length) {
        const wsMatch = segment.slice(cursor).match(/^\s+/);
        if (wsMatch) {
            tokens.push({ type: 'plain', value: wsMatch[0] });
            cursor += wsMatch[0].length;
            continue;
        }

        const paramMatch = segment.slice(cursor).match(/^([a-zA-Z0-9_]+)(:)(?:"((?:[^"\\]|\\.)*)"|(\S*))?/);
        if (!paramMatch) {
            tokens.push({ type: 'plain', value: segment[cursor] });
            cursor += 1;
            continue;
        }

        const [fullMatch, key, colon, quotedVal, bareVal] = paramMatch;
        tokens.push({ type: 'param-key', value: key });
        tokens.push({ type: 'param-punct', value: colon });

        if (quotedVal !== undefined) {
            const rawQuoted = fullMatch.slice(key.length + colon.length);
            tokens.push({ type: 'param-str', value: rawQuoted });
        } else if (bareVal !== undefined && bareVal.length > 0) {
            if (/^#[0-9a-fA-F]{3,8}$/.test(bareVal)) {
                tokens.push({ type: 'param-color', value: bareVal });
            } else if (/^-?\d+(\.\d+)?$/.test(bareVal)) {
                tokens.push({ type: 'param-num', value: bareVal });
            } else {
                tokens.push({ type: 'param-val', value: bareVal });
            }
        }

        cursor += fullMatch.length;
    }

    return tokens;
}

function tokenizeDirectiveLine(line) {
    const tokens = [];
    const leadingWsMatch = line.match(/^\s*/);
    const leadingWs = leadingWsMatch ? leadingWsMatch[0] : '';
    let cursor = leadingWs.length;
    if (leadingWs) {
        tokens.push({ type: 'plain', value: leadingWs });
    }

    const restAfterWs = line.slice(cursor);
    const headMatch = restAfterWs.match(DIRECTIVE_HEAD_RE);
    if (!headMatch) {
        return tokenizeBodyLine(line);
    }

    const kind = headMatch[1];
    const headText = headMatch[0];

    if (kind === 'element' || kind === 'macro') {
        tokens.push({ type: 'directive-element', value: headText });
    } else if (STRUCTURAL_DIRECTIVES.has(kind)) {
        tokens.push({ type: 'directive-struct', value: headText });
    } else {
        tokens.push({ type: 'plain', value: headText });
    }

    cursor += headText.length;

    const afterHead = line.slice(cursor);
    const wsBeforeBraceMatch = afterHead.match(/^\s+/);
    if (wsBeforeBraceMatch) {
        tokens.push({ type: 'plain', value: wsBeforeBraceMatch[0] });
        cursor += wsBeforeBraceMatch[0].length;
    }

    if (line[cursor] === '{') {
        let endBrace = -1;
        for (let i = cursor + 1; i < line.length; i++) {
            if (line[i] === '\\') {
                i++;
                continue;
            }
            if (line[i] === '}') {
                endBrace = i;
                break;
            }
        }
        if (endBrace !== -1) {
            tokens.push({ type: 'brace-arg', value: line.slice(cursor, endBrace + 1) });
            cursor = endBrace + 1;
        } else {
            tokens.push({ type: 'brace-arg', value: line.slice(cursor) });
            return tokens;
        }
    }

    const tail = line.slice(cursor);
    if (tail) {
        tokens.push(...tokenizeParamsSegment(tail));
    }

    return tokens;
}

function tokenizeBodyLine(line) {
    const tokens = [];
    const indentMatch = line.match(/^([ \t]+)/);
    let idx = 0;
    if (indentMatch) {
        tokens.push({ type: 'body-indent', value: indentMatch[1] });
        idx = indentMatch[1].length;
    }

    const bodyPart = line.slice(idx);
    const mathRe = /(\$\$[\s\S]*?\$\$|\$(?:\\.|[^$\\])+\$)/g;
    let lastIndex = 0;
    let match;

    while ((match = mathRe.exec(bodyPart)) !== null) {
        if (match.index > lastIndex) {
            tokens.push({ type: 'body-text', value: bodyPart.slice(lastIndex, match.index) });
        }
        tokens.push({ type: 'body-math', value: match[0] });
        lastIndex = match.index + match[0].length;
    }

    if (lastIndex < bodyPart.length) {
        tokens.push({ type: 'body-text', value: bodyPart.slice(lastIndex) });
    }

    return tokens;
}

export function tokenizeGlLine(line, { inElementBody = false } = {}) {
    const s = String(line ?? '');
    if (s === '') {
        return [{ type: 'plain', value: '' }];
    }

    const trimmedStart = s.replace(/^[ \t\u200B-\u200D\uFEFF]+/, '');
    if (!inElementBody && trimmedStart.startsWith('#')) {
        return [{ type: 'comment', value: s }];
    }

    if (DIRECTIVE_HEAD_RE.test(trimmedStart)) {
        return tokenizeDirectiveLine(s);
    }

    if (inElementBody) {
        return tokenizeBodyLine(s);
    }

    return [{ type: 'plain', value: s }];
}

/**
 * Tokenizes one line given the context carried over from the previous
 * line (whether we are inside an element body). Returns the tokens and
 * the context for the next line. Used line-by-line by the CodeMirror
 * mode and by tokenizeGlDocument.
 */
export function scanGlLine(line, inElementBody) {
    const trimmedStart = line.replace(/^[ \t\u200B-\u200D\uFEFF]+/, '');

    if (DIRECTIVE_HEAD_RE.test(trimmedStart)) {
        return {
            tokens: tokenizeGlLine(line, { inElementBody: false }),
            inElementBody: BODY_DIRECTIVE_RE.test(trimmedStart),
        };
    }

    // ::name key:value — an override inside a macro instance.
    const override = trimmedStart.match(OVERRIDE_HEAD_RE);
    if (override) {
        const indent = line.slice(0, line.length - trimmedStart.length);
        const tokens = [];
        if (indent) tokens.push({ type: 'plain', value: indent });
        tokens.push({ type: 'directive-element', value: override[0] });
        const rest = trimmedStart.slice(override[0].length);
        if (rest) tokens.push(...tokenizeParamsSegment(rest));
        return { tokens, inElementBody: true };
    }

    if (line.trim() === '') {
        const indentMatch = line.match(/^([ \t]+)/);
        const tokens = inElementBody && indentMatch
            ? [{ type: 'body-indent', value: indentMatch[1] }]
            : [{ type: 'body-text', value: line }];
        return { tokens, inElementBody };
    }

    return { tokens: tokenizeGlLine(line, { inElementBody }), inElementBody };
}

export function tokenizeGlDocument(text) {
    const result = [];
    let inElementBody = false;
    for (const line of String(text ?? '').split('\n')) {
        const scanned = scanGlLine(line, inElementBody);
        inElementBody = scanned.inElementBody;
        result.push(scanned.tokens);
    }
    return result;
}
