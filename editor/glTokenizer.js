// ============================================================
// editor/glTokenizer.js — Pure syntax tokenizer for Gluon (.gl)
// text. Produces `{ type, value }` tokens for comments,
// structural/function directives, element directives, brace args,
// key:value parameters, and indented body content (including
// inline/display math).
// ============================================================

const STRUCTURAL_DIRECTIVES = new Set(['project', 'slide', 'function', 'var']);
const DIRECTIVE_HEAD_RE = /^\.(project|slide|element|function|var)(?:\.([a-zA-Z0-9_-]+))?(?=\s|$|\{)/;

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

    if (kind === 'element') {
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
    const indentMatch = line.match(/^(\s+)/);
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

    const trimmedStart = s.replace(/^[\s\u200B-\u200D\uFEFF]+/, '');
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

export function tokenizeGlDocument(text) {
    const lines = String(text ?? '').split('\n');
    const result = [];
    let inElementBody = false;

    for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        const trimmedStart = line.replace(/^[\s\u200B-\u200D\uFEFF]+/, '');

        if (DIRECTIVE_HEAD_RE.test(trimmedStart)) {
            inElementBody = trimmedStart.startsWith('.element.');
            result.push(tokenizeGlLine(line, { inElementBody: false }));
            continue;
        }

        if (line.trim() === '') {
            result.push([{ type: 'body-text', value: '' }]);
            continue;
        }

        result.push(tokenizeGlLine(line, { inElementBody }));
    }

    return result;
}