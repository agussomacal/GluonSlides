// ============================================================
// core/citations.js — Bibliography support (.bib).
// Parses BibTeX, resolves \cite{...} / [@...] / \fullcite{...}
// / \printbibliography markers in text elements, and formats
// inline citations in the project's citation style.
//
// Render-time only: .gl content keeps raw markers untouched.
// ============================================================

import { state } from './state.js';

export const CITATION_STYLES = ['numeric', 'authoryear'];

// ---------- BibTeX parsing ----------

/** Strip only the outermost wrapping braces of a field value. */
function stripOuterBraces(value) {
    let v = String(value).trim();
    while (v.startsWith('{') && v.endsWith('}')) {
        // Only strip if the outer pair actually wraps the whole value
        // (e.g. "{A} and {B}" must keep its inner braces).
        let depth = 0;
        let wraps = true;
        for (let i = 0; i < v.length; i++) {
            if (v[i] === '{') depth++;
            else if (v[i] === '}') depth--;
            if (depth === 0 && i < v.length - 1) {
                wraps = false;
                break;
            }
        }
        if (!wraps) break;
        v = v.slice(1, -1).trim();
    }
    return v;
}

/** Clean a field value: collapse whitespace, normalize LaTeX accents. */
function cleanField(value) {
    return String(value)
        .replace(/\s+/g, ' ')
        .trim();
}

/** Parse the field region of an entry body: name = value pairs. */
function parseFields(body) {
    const fields = {};
    let p = 0;
    while (p < body.length) {
        const nm = /\s*([a-zA-Z][a-zA-Z0-9_-]*)\s*=\s*/y;
        nm.lastIndex = p;
        const mm = nm.exec(body);
        if (!mm) break;
        p = nm.lastIndex;

        let value;
        const ch = body[p];
        if (ch === '{') {
            let depth = 1;
            let q = p + 1;
            while (q < body.length && depth > 0) {
                if (body[q] === '{') depth++;
                else if (body[q] === '}') depth--;
                q++;
            }
            value = body.slice(p + 1, q - 1);
            p = q;
        } else if (ch === '"') {
            let q = p + 1;
            while (q < body.length && body[q] !== '"') q++;
            value = body.slice(p + 1, q);
            p = q + 1;
        } else {
            const m2 = /[^\s,]+/.exec(body.slice(p));
            value = m2 ? m2[0] : '';
            p += value.length;
        }

        fields[mm[1].toLowerCase()] = cleanField(value);
        const c = body.indexOf(',', p);
        if (c === -1) break;
        p = c + 1;
    }
    return fields;
}

/**
 * Parse a .bib file into { key: {type, author, year, title, ...} }.
 * Handles standard entries, nested braces, quoted/bare values,
 * @comment/@preamble/@string (ignored) and % comments.
 */
export function parseBibtex(src) {
    const entries = {};
    const s = String(src);

    const text = s.split('\n')
        .filter(line => !/^\s*%/.test(line))
        .join('\n');

    let pos = 0;
    while (pos < text.length) {
        const at = text.indexOf('@', pos);
        if (at === -1) break;

        const head = /^@\s*([a-zA-Z]+)\s*\{/.exec(text.slice(at));
        if (!head) { pos = at + 1; continue; }

        const type = head[1].toLowerCase();
        const open = at + head[0].length - 1; // index of '{'

        let depth = 1;
        let q = open + 1;
        while (q < text.length && depth > 0) {
            if (text[q] === '{') depth++;
            else if (text[q] === '}') depth--;
            q++;
        }
        const body = text.slice(open + 1, q - 1);
        pos = q;

        if (type === 'comment' || type === 'preamble' || type === 'string') continue;

        const comma = body.indexOf(',');
        if (comma === -1) continue;
        const key = body.slice(0, comma).trim();
        if (!key) continue;

        entries[key] = { type, ...parseFields(body.slice(comma + 1)) };
    }
    return entries;
}

// ---------- Formatting helpers ----------

/** Naive author splitting: "Donald E. Knuth and Leslie Lamport" → last names. */
function authorLastNames(authorField) {
    if (!authorField) return [];
    return authorField
        .split(/\s+and\s+/i)
        .map(a => {
            const parts = a.trim().split(/\s+/);
            return parts.length > 0 ? parts[parts.length - 1].replace(/,$/, '') : '';
        })
        .filter(Boolean);
}

function formatAuthorsBrief(entry) {
    const lasts = authorLastNames(entry.author);
    if (lasts.length === 0) return entry.author || 'Unknown';
    if (lasts.length === 1) return lasts[0];
    if (lasts.length === 2) return `${lasts[0]} & ${lasts[1]}`;
    return `${lasts[0]} et al.`;
}

function formatFullReference(key, entry) {
    const bits = [];
    if (entry.author) bits.push(entry.author);
    if (entry.title) bits.push(`*${stripOuterBraces(entry.title)}*`);
    if (entry.journal || entry.booktitle) bits.push(entry.journal || entry.booktitle);
    const tail = [entry.year].filter(Boolean).join(', ');
    if (tail) bits.push(tail);
    if (bits.length === 0) bits.push(`[${key}]`);
    return bits.join('. ');
}

// ---------- Citation ordering (numeric style) ----------

// Groups: m[1]=\cite keys, m[3]=[@key] key.
const CITE_MARKER_SOURCE = '\\\\cite\\{([^}]*)\\}|\\[(@)([^\\]\\s]+)\\]';

/** Collect all cited keys across slides in deterministic order. */
export function collectCitationKeys() {
    const keys = [];
    const seen = new Set();
    (state.slides || []).forEach(slide => {
        (slide.elements || []).forEach(el => {
            if (typeof el.content !== 'string') return;
            let m;
            const re = new RegExp(CITE_MARKER_SOURCE, 'g');
            while ((m = re.exec(el.content)) !== null) {
                const list = (m[1] !== undefined ? m[1] : m[3])
                    .split(',').map(k => k.trim()).filter(Boolean);
                list.forEach(k => {
                    if (!seen.has(k)) { seen.add(k); keys.push(k); }
                });
            }
        });
    });
    return keys;
}

/** Rebuild the per-pass number map. Call at the start of each full render. */
export function beginCitationPass() {
    state._citationOrder = collectCitationKeys();
}

// ---------- Resolution ----------

function resolveSingleKey(key) {
    const entry = state.bibEntries[key];
    if (!entry) return `**[?]**`;
    if (state.citestyle === 'authoryear') {
        const year = entry.year || 'n.d.';
        return `(${formatAuthorsBrief(entry)}, ${year})`;
    }
    const idx = (state._citationOrder || []).indexOf(key);
    return `**[${idx >= 0 ? idx + 1 : '?'}]**`;
}

function resolveMatch(m) {
    if (m[1] !== undefined) {                 // \cite{key1,key2} form
        const keys = m[1].split(',').map(k => k.trim()).filter(Boolean);
        return keys.map(resolveSingleKey).join('');
    }
    return resolveSingleKey(m[3]);            // [@key] form
}

/**
 * Replace citation markers with their rendered form and expand
 * \fullcite{key} and \printbibliography.
 */
export function resolveCitations(rawText) {
    let text = String(rawText ?? '');

    // \printbibliography — the full list of cited references.
    if (/\\printbibliography/.test(text)) {
        const lines = (state._citationOrder || []).map(key => {
            const entry = state.bibEntries[key];
            return entry ? `- ${formatFullReference(key, entry)}` : `- [?] ${key}`;
        });
        const bib = lines.length > 0
            ? '**References**\n\n' + lines.join('\n')
            : '_No citations in this presentation._';
        text = text.replace(/\\printbibliography/g, bib);
    }

    // \fullcite{key} — the full reference inline.
    text = text.replace(/\\fullcite\{([^}]*)\}/g, (_, keys) =>
        keys.split(',').map(k => {
            const entry = state.bibEntries[k.trim()];
            return entry ? formatFullReference(k.trim(), entry) : `**[? ${k.trim()}]**`;
        }).join('; ')
    );

    // \cite{...} and [@key]
    text = text.replace(new RegExp(CITE_MARKER_SOURCE, 'g'), resolveMatch);
    return text;
}

// ---------- Project bib state ----------

export function setBibSource(rawText) {
    state.rawBib = String(rawText ?? '');
    state.bibEntries = parseBibtex(state.rawBib);
    beginCitationPass();
}