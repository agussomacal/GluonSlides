// ============================================================
// core/citations.js — Bibliography support (.bib).
// Parses BibTeX and resolves citation commands in text elements:
//
//   \cite{key}  \citep{key}  \parencite{key}   [1]            (Smith, 2020)
//   \citet{key} \textcite{key}                  Smith [1]      Smith (2020)
//   \cite[p.~5]{key}                            [1, p. 5]      (Smith, 2020, p. 5)
//   \cite{a,b}                                  [1, 2]         (Smith, 2020; Doe, 2019)
//   \fullcite{key}                              the full reference
//   \printbibliography                          the list of cited works
//
// Numbers follow the order of first citation in the presentation.
// Unknown keys show as a highlighted [? key]. Render-time only: .gl
// content keeps the commands as typed.
// ============================================================

import { state } from './state.js';

export const CITATION_STYLES = ['numeric', 'authoryear'];

/** Citation commands; group 1 = command, 2 = optional [note], 3 = keys. */
const CITE_SOURCE = String.raw`\\(cite|citep|citet|parencite|textcite)\s*(?:\[([^\]]*)\])?\s*\{([^}]*)\}`;
const TEXTUAL = new Set(['citet', 'textcite']);
/** \printbibliography with an optional [from-to] part of the list. */
const PRINT_BIB_RE = /\\printbibliography(?:\s*\[\s*(\d+)?\s*(-)?\s*(\d+)?\s*\])?/g;
/** Every command whose braces hold keys (for collecting and autocomplete). */
const KEYS_SOURCE = String.raw`\\(?:cite|citep|citet|parencite|textcite|fullcite)\s*(?:\[[^\]]*\])?\s*\{([^}]*)\}`;
/** Text just before the cursor inside an unfinished command: group 1 = the key being typed. */
export const OPEN_CITE_RE = /\\(?:cite|citep|citet|parencite|textcite|fullcite)\s*(?:\[[^\]]*\])?\s*\{(?:[^}]*,)?\s*([^,}\s]*)$/;

// ---------- BibTeX parsing ----------

function stripOuterBraces(value) {
    let v = String(value).trim();
    while (v.startsWith('{') && v.endsWith('}')) {
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

function cleanField(value) {
    return String(value)
        .replace(/\s+/g, ' ')
        .trim();
}

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

export function parseBibtex(src) {
    const entries = {};
    const s = String(src ?? '').replace(/\r\n?/g, '\n');

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
        const open = at + head[0].length - 1;

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

// ---------- LaTeX text in BibTeX fields ----------

// Combining marks for accent commands: \'e -> é, \"{o} -> ö ...
const ACCENTS = {
    "'": '\u0301', '`': '\u0300', '^': '\u0302', '"': '\u0308', '~': '\u0303',
    '=': '\u0304', '.': '\u0307', u: '\u0306', v: '\u030C', H: '\u030B',
    c: '\u0327', k: '\u0328', r: '\u030A', d: '\u0323', b: '\u0331',
};
const SYMBOLS = {
    ss: 'ß', o: 'ø', O: 'Ø', ae: 'æ', AE: 'Æ', oe: 'œ', OE: 'Œ', aa: 'å', AA: 'Å',
    l: 'ł', L: 'Ł', i: 'ı', j: 'ȷ', '&': '&', '%': '%', '$': '$', '#': '#', '_': '_',
};

/** Turns BibTeX/LaTeX markup into plain text: accents, symbols, dashes, braces. */
export function decodeLatex(value) {
    let s = String(value ?? '');
    // \'{e}, \'e, {\'e}, \c{c}, \"{\i}
    s = s.replace(/\\(['`^"~=.])\s*(?:\{\s*(\\?[A-Za-z])\s*\}|(\\?[A-Za-z]))/g,
        (_, acc, a, b) => (((a || b) === '\\i' ? 'i' : (a || b) === '\\j' ? 'j' : (a || b)) + ACCENTS[acc]).normalize('NFC'));
    s = s.replace(/\\([uvHckrdb])\s*(?:\{\s*(\\?[A-Za-z])\s*\}|\s+([A-Za-z]))/g,
        (_, acc, a, b) => (((a || b) === '\\i' ? 'i' : (a || b)) + ACCENTS[acc]).normalize('NFC'));
    s = s.replace(/\\(ss|ae|AE|oe|OE|aa|AA|o|O|l|L|i|j)(?![A-Za-z])\s*(\{\})?/g, (_, c) => SYMBOLS[c]);
    s = s.replace(/\\([&%$#_])/g, (_, c) => SYMBOLS[c]);
    s = s.replace(/\\(La)?TeX\b\s*(\{\})?/g, (_, la) => (la ? 'LaTeX' : 'TeX'));
    s = s.replace(/\\(?:textit|textbf|emph|textrm|textsc|mbox|text)\s*\{([^{}]*)\}/g, '$1');
    s = s.replace(/---/g, '—').replace(/--/g, '–').replace(/~/g, ' ');
    // Remove grouping braces, keeping escaped ones (\{ \}).
    s = s.replace(/\\\{/g, '\u0001').replace(/\\\}/g, '\u0002').replace(/[{}]/g, '')
        .replace(/\u0001/g, '{').replace(/\u0002/g, '}');
    return s.replace(/\s+/g, ' ').trim();
}

// ---------- Names ----------

/** Splits a BibTeX author list into { first, last } (braces keep "{van Dyke}" whole). */
function splitTopLevel(text, sep) {
    const parts = [];
    let depth = 0;
    let startIdx = 0;
    for (let i = 0; i < text.length; i++) {
        if (text[i] === '{') depth++;
        else if (text[i] === '}') depth--;
        else if (depth === 0 && text.slice(i).match(sep)?.index === 0) {
            const m = text.slice(i).match(sep);
            parts.push(text.slice(startIdx, i));
            startIdx = i + m[0].length;
            i = startIdx - 1;
        }
    }
    parts.push(text.slice(startIdx));
    return parts.map(p => p.trim()).filter(Boolean);
}

function parseAuthors(field) {
    if (!field) return [];
    return splitTopLevel(String(field), /^\s+and\s+/i).map(name => {
        if (/^others$/i.test(name)) return { others: true };
        const byComma = splitTopLevel(name, /^,/);
        if (byComma.length >= 2) {
            return { last: decodeLatex(byComma[0]), first: decodeLatex(byComma.slice(1).reverse().join(' ')) };
        }
        const words = splitTopLevel(name, /^\s+/);
        // "Ludwig van Beethoven": lowercase particles belong to the last name.
        let i = words.length - 1;
        while (i > 0 && /^[a-z]/.test(words[i - 1])) i--;
        return { first: decodeLatex(words.slice(0, i).join(' ')), last: decodeLatex(words.slice(i).join(' ')) };
    });
}

function initials(first) {
    return String(first || '').split(/[\s ]+/).filter(Boolean)
        .map(w => w.split('-').map(p => (p ? `${p[0]}.` : '')).join('-')).join(' ');
}

function formatAuthorsBrief(entry) {
    const authors = parseAuthors(entry.author || entry.editor);
    const lasts = authors.filter(a => !a.others).map(a => a.last);
    if (lasts.length === 0) return decodeLatex(entry.author || entry.organization || entry.title || 'Anon.');
    if (lasts.length === 1 && authors.length === 1) return lasts[0];
    if (lasts.length === 2 && authors.length === 2) return `${lasts[0]} & ${lasts[1]}`;
    return `${lasts[0]} et al.`;
}

function formatAuthorsFull(entry) {
    const authors = parseAuthors(entry.author || entry.editor);
    const names = authors.map(a => (a.others ? 'et al.' : [a.last, initials(a.first)].filter(Boolean).join(', ')));
    if (names.length <= 1) return names[0] || '';
    if (names[names.length - 1] === 'et al.') return `${names.slice(0, -1).join(', ')}, et al.`;
    return `${names.slice(0, -1).join(', ')} & ${names[names.length - 1]}`;
}

function year(entry) {
    return decodeLatex(entry.year || (entry.date || '').slice(0, 4)) || 'n.d.';
}

/** "Smith, J. & Doe, A. (2020). *Title*. Journal, 12(3), 45–67." */
export function formatFullReference(key, entry) {
    const authors = formatAuthorsFull(entry);
    const title = decodeLatex(entry.title || '');
    const venue = decodeLatex(entry.journal || entry.journaltitle || entry.booktitle || entry.publisher || entry.school || entry.institution || '');
    let vol = decodeLatex(entry.volume || '');
    if (vol && entry.number) vol += `(${decodeLatex(entry.number)})`;
    const pages = decodeLatex(entry.pages || '').replace(/-+/g, '–');
    const where = [venue, vol, pages].filter(Boolean).join(', ');
    const parts = [];
    parts.push(`${authors || title || key} (${year(entry)}).`);
    if (title && authors) parts.push(`*${title}*.`);
    if (where) parts.push(`${where}.`);
    return parts.join(' ');
}

// ---------- Which keys the presentation cites ----------

function normalizeCiteText(raw) {
    return String(raw ?? '').replace(/\\\\(cite|citep|citet|parencite|textcite|fullcite)\b/g, '\\$1');
}

/** Texts of an element and everything inside it (groups, macro instances). */
function elementTexts(el, seenMacros, out) {
    if (!el) return out;
    if (typeof el.content === 'string') out.push(el.content);
    (el.children || []).forEach(c => elementTexts(c, seenMacros, out));
    if (el.type === 'macro') {
        // Overridden bodies first, then the definition, then extra elements.
        (el.overrides || []).forEach(o => { if (typeof o.body === 'string') out.push(o.body); });
        const def = state.macros && state.macros[el.ref];
        if (def && !seenMacros.has(el.ref)) {
            seenMacros.add(el.ref);
            (def.children || []).forEach(c => elementTexts(c, seenMacros, out));
            seenMacros.delete(el.ref);
        }
        (el.extras || []).forEach(c => elementTexts(c, seenMacros, out));
    }
    return out;
}

/** Cited keys in order of first citation. */
export function collectCitationKeys() {
    const keys = [];
    const seen = new Set();
    (state.slides || []).forEach(slide => {
        (slide.elements || []).forEach(el => {
            elementTexts(el, new Set(), []).forEach(text => {
                const re = new RegExp(KEYS_SOURCE, 'g');
                let m;
                while ((m = re.exec(normalizeCiteText(text))) !== null) {
                    m[1].split(',').map(k => k.trim()).filter(Boolean).forEach(k => {
                        if (!seen.has(k)) { seen.add(k); keys.push(k); }
                    });
                }
            });
        });
    });
    return keys;
}

export function beginCitationPass() {
    state._citationOrder = collectCitationKeys();
}

/** Cited keys that are not in the bibliography. */
export function missingCitationKeys() {
    const bib = getBibMap();
    return collectCitationKeys().filter(k => !bib[k]);
}

// ---------- Resolution ----------

function getBibMap() {
    if (!state.bibEntries || typeof state.bibEntries !== 'object') {
        state.bibEntries = {};
    }
    return state.bibEntries;
}

function escapeText(s) {
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function missingMark(key) {
    return `<span class="cite-missing" title="Not in bibliography.bib">[? ${escapeText(key)}]</span>`;
}

function citationNumber(key) {
    const order = Array.isArray(state._citationOrder) ? state._citationOrder : collectCitationKeys();
    const idx = order.indexOf(key);
    return idx >= 0 ? idx + 1 : '?';
}

function ensureOrderIncludesCitedKeys(text) {
    const re = new RegExp(KEYS_SOURCE, 'g');
    let m;
    while ((m = re.exec(text)) !== null) {
        const keys = m[1].split(',').map(k => k.trim()).filter(Boolean);
        if (keys.some(k => !(state._citationOrder || []).includes(k))) {
            beginCitationPass();
            return;
        }
    }
}

function resolveCiteCommand(command, rawNote, rawKeys) {
    const bib = getBibMap();
    const keys = String(rawKeys || '').split(',').map(k => k.trim()).filter(Boolean);
    const note = rawNote ? decodeLatex(rawNote) : '';
    const known = keys.filter(k => bib[k]);
    const missing = keys.filter(k => !bib[k]).map(missingMark).join('');
    if (!known.length) return missing || missingMark('');
    const textual = TEXTUAL.has(command);

    let out;
    if (state.citestyle === 'authoryear') {
        if (textual) {
            out = known.map((k, i) => `${formatAuthorsBrief(bib[k])} (${year(bib[k])}${note && i === known.length - 1 ? `, ${note}` : ''})`).join(', ');
        } else {
            out = `(${known.map(k => `${formatAuthorsBrief(bib[k])}, ${year(bib[k])}`).join('; ')}${note ? `, ${note}` : ''})`;
        }
    } else {
        const numbers = known.map(citationNumber).sort((a, b) => (Number(a) || 1e9) - (Number(b) || 1e9));
        const nums = `**[${numbers.join(', ')}${note ? `, ${note}` : ''}]**`;
        out = textual
            ? `${known.map(k => formatAuthorsBrief(bib[k])).join(', ')} ${nums}`
            : nums;
    }
    return out + missing;
}

export function resolveCitations(rawText) {
    let text = normalizeCiteText(rawText);
    ensureOrderIncludesCitedKeys(text);

    const bib = getBibMap();

    // \printbibliography, or a part of the list: [9-], [1-8], [5] (1-based, citation order).
    text = text.replace(PRINT_BIB_RE, (_, from, dash, to) => {
        const order = state._citationOrder || [];
        if (!order.length) return '_No citations in this presentation._';
        const start = Math.max(1, Number(from) || 1);
        const end = Math.min(order.length, to ? Number(to) : (dash || !from ? order.length : start));
        const lines = order.slice(start - 1, end).map(key => {
            const entry = bib[key];
            const label = state.citestyle === 'authoryear' ? '-' : `${citationNumber(key)}.`;
            return entry ? `${label} ${formatFullReference(key, entry)}` : `${label} ${missingMark(key)}`;
        });
        if (!lines.length) return '';
        return `**${start > 1 ? 'References (continued)' : 'References'}**\n\n${lines.join('\n')}`;
    });

    text = text.replace(/\\fullcite\s*\{([^}]*)\}/g, (_, keys) =>
        keys.split(',').map(k => {
            const trimmed = k.trim();
            const entry = bib[trimmed];
            return entry ? formatFullReference(trimmed, entry) : missingMark(trimmed);
        }).join('; '),
    );

    text = text.replace(new RegExp(CITE_SOURCE, 'g'), (_, command, note, keys) => resolveCiteCommand(command, note, keys));
    return text;
}

// ---------- Autocomplete ----------

/**
 * Bibliography entries matching `typed` (key, author or title), for
 * the \cite{ autocomplete: [{ key, label }] with label "Smith (2020) Title".
 */
export function citationCandidates(typed = '') {
    const t = String(typed).toLowerCase();
    const bib = getBibMap();
    return Object.keys(bib)
        .map(key => {
            const e = bib[key];
            const title = decodeLatex(e.title || '');
            return { key, label: `${formatAuthorsBrief(e)} (${year(e)}) ${title}`, haystack: `${key} ${decodeLatex(e.author || '')} ${title}`.toLowerCase() };
        })
        .filter(c => !t || c.key.toLowerCase().startsWith(t) || c.haystack.includes(t))
        .sort((a, b) => (b.key.toLowerCase().startsWith(t) - a.key.toLowerCase().startsWith(t)) || a.key.localeCompare(b.key))
        .map(({ key, label }) => ({ key, label }));
}

// ---------- Project bib state ----------

export function setBibSource(rawText) {
    state.rawBib = String(rawText ?? '');
    state.bibEntries = parseBibtex(state.rawBib);
    beginCitationPass();
    document.dispatchEvent(new CustomEvent('bibliography-changed'));
}
