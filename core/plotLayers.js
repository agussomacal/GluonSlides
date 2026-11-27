// ============================================================
// core/plotLayers.js — A plot's body as layers that can be edited one
// at a time (the layer cards of elements/plot): read into blocks, and
// written back changing only what was changed. A layer's line is
// rewritten when one of its settings changes; its formula lines,
// comments and blank lines stay exactly as typed.
//
//   blocks(code)                 [{ kind, params: [[key, value]...], head, body: [lines] }]
//   setParam(code, i, key, v)    v === null / '' removes the setting
//   setBody(code, i, text)       the layer's formula (or rows)
//   removeLayer / duplicateLayer / moveLayer / addLayer
// ============================================================

import { LAYER_KINDS } from './liveEngine.js';

const HEAD_RE = /^\s*\.([a-z]+)\b(.*)$/;

function parseParams(text) {
    const out = [];
    for (const [, k, v] of String(text || '').matchAll(/([A-Za-z]+):("(?:[^"\\]|\\.)*"|\{[^}]*\}|\S+)/g)) {
        let value = v.startsWith('"') ? v.slice(1, -1).replace(/\\(["\\])/g, '$1') : v;
        if (value.startsWith('{') && value.endsWith('}')) value = value.slice(1, -1);
        out.push([k, value]);
    }
    return out;
}

/** A setting as written: data in braces, values with spaces or quotes quoted. */
function formatParam(key, value) {
    const v = String(value);
    if (key === 'data' && !/[\s"}]/.test(v)) return `data:{${v}}`;
    if (v !== '' && /^[^\s"{}]+$/.test(v)) return `${key}:${v}`;
    // inside quotes only \" and \\ are escapes: a backslash is doubled only before " or \ (or at the end)
    return `${key}:"${v.replace(/\\(?=["\\]|$)/g, '\\\\').replace(/"/g, '\\"')}"`;
}

function headLine(kind, params) {
    return [`.${kind}`, ...params.map(([k, v]) => formatParam(k, v))].join(' ');
}

/** The layers of a body (text before any layer line is a first curve, with no line of its own). */
export function blocks(code) {
    const out = [];
    let current = null;
    String(code || '').split('\n').forEach(raw => {
        const m = raw.match(HEAD_RE);
        if (m && LAYER_KINDS.includes(m[1])) {
            current = { kind: m[1], params: parseParams(m[2]), head: raw, body: [] };
            out.push(current);
            return;
        }
        if (!current) {
            current = { kind: 'curve', params: [], head: null, body: [] };
            out.push(current);
        }
        current.body.push(raw);
    });
    // text before the first layer line with only comments and blank lines: it belongs to that layer
    if (out.length && out[0].head === null && !out[0].body.some(l => l.trim() && !l.trim().startsWith('#'))) {
        const blank = out.shift();
        if (out.length) out[0].leading = blank.body;
    }
    return out;
}

function write(list) {
    return list.map(b => [...(b.leading || []), ...(b.head !== null ? [b.head] : []), ...b.body].join('\n')).join('\n');
}

const at = (code, i) => {
    const list = blocks(code);
    if (!list[i]) throw new Error(`no layer ${i + 1}`);
    return list;
};

/** The settings of layer i as { key: value }. */
export function paramsOf(code, i) {
    const b = blocks(code)[i];
    return b ? Object.fromEntries(b.params) : {};
}

/** Sets (or, with null / '', removes) a setting of layer i. */
export function setParam(code, i, key, value) {
    const list = at(code, i);
    const b = list[i];
    const params = b.params.filter(([k]) => k !== key);
    if (value !== null && value !== undefined && value !== '') {
        const where = b.params.findIndex(([k]) => k === key);
        if (where >= 0) params.splice(where, 0, [key, String(value)]);
        else params.push([key, String(value)]);
    }
    b.params = params;
    b.head = headLine(b.kind, params);
    return write(list);
}

/** Replaces the formula (or rows) of layer i. */
export function setBody(code, i, text) {
    const list = at(code, i);
    list[i].body = String(text ?? '').split('\n');
    if (list[i].head === null && list.length > 1 && !text.trim()) list.splice(i, 1);
    return write(list);
}

export function bodyOf(code, i) {
    const b = blocks(code)[i];
    return b ? b.body.join('\n').replace(/\n+$/, '') : '';
}

export function removeLayer(code, i) {
    const list = at(code, i);
    list.splice(i, 1);
    return write(list);
}

export function duplicateLayer(code, i) {
    const list = at(code, i);
    const b = list[i];
    const copy = { kind: b.kind, params: b.params.map(p => [...p]), head: headLine(b.kind, b.params), body: [...b.body] };
    if (b.head === null) b.head = headLine(b.kind, b.params);
    list.splice(i + 1, 0, copy);
    return write(list);
}

/** Moves layer i by delta (later layers are drawn on top). */
export function moveLayer(code, i, delta) {
    const list = at(code, i);
    const j = i + delta;
    if (j < 0 || j >= list.length) return code;
    list.forEach(b => { if (b.head === null) b.head = headLine(b.kind, b.params); });
    const [b] = list.splice(i, 1);
    // a layer's trailing blank lines stay with it; make sure each starts on its own line
    list.splice(j, 0, b);
    return write(list);
}

/** Adds a layer from its text (a template) at the end. */
export function addLayer(code, text) {
    const trimmed = String(code || '').replace(/\s+$/, '');
    return trimmed ? `${trimmed}\n${text}` : text;
}
