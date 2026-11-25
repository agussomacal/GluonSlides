// ============================================================
// core/fields.js — Automatic fields in text: commands replaced by
// their value on each slide (when drawing, presenting and exporting;
// the .gl text keeps the command).
//
//   \slidenumber  \totalslides       7 / 24 (as presented: continuation
//                                    pages of long reference lists
//                                    count; build steps don't)
//   \slidetitle  \sectiontitle       the slide's name, its section
//   \presentationtitle \author \date from the .project header
//   \tableofcontents                 the sections, the current one bold
//
// Which slide a text belongs to: renderers that draw other slides than
// the current one (thumbnails, exports) wrap the drawing in
// withSlideContext(); otherwise it is the slide being edited.
// ============================================================

import { state } from './state.js';
import { expandSlides } from './bibPages.js';

export const FIELDS = [
    { name: 'slidenumber', label: 'Slide number', example: '7' },
    { name: 'totalslides', label: 'Number of slides', example: '24' },
    { name: 'slidetitle', label: 'Slide title' },
    { name: 'sectiontitle', label: 'Section title' },
    { name: 'presentationtitle', label: 'Presentation title' },
    { name: 'author', label: 'Author (Project settings)' },
    { name: 'date', label: 'Date (Project settings)' },
    { name: 'tableofcontents', label: 'Table of contents (sections)' },
];

const FIELD_RE = new RegExp(String.raw`\\(${FIELDS.map(f => f.name).join('|')})(?![A-Za-z])(\s*\{\})?`, 'g');

let context = null;      // { source, number, total } of the slide being drawn
let numbering = null;    // cached { first: Map(source -> number), total }
let numbering_busy = false;

/** Draws `fn` as slide `source` (index in state.slides), presented as `number`. */
export function withSlideContext(ctx, fn) {
    const previous = context;
    context = ctx;
    try {
        return fn();
    } finally {
        context = previous;
    }
}

/** Forget the cached numbering (slides, bibliography or sizes changed). */
export function invalidateNumbering() {
    numbering = null;
}

/** First presented number of every slide, and the presented total. */
function presentedNumbering() {
    if (numbering) return numbering;
    if (numbering_busy) {
        // Measuring a reference list while numbering: plain numbers.
        return { first: new Map((state.slides || []).map((_, i) => [i, i + 1])), total: (state.slides || []).length };
    }
    numbering_busy = true;
    try {
        const first = new Map();
        const pages = expandSlides();
        pages.forEach((p, i) => { if (!first.has(p.source)) first.set(p.source, i + 1); });
        numbering = { first, total: pages.length };
    } finally {
        numbering_busy = false;
    }
    return numbering;
}

/** Context for project slide `source` (its first presented page). */
export function contextForSlide(source) {
    const n = presentedNumbering();
    return { source, number: n.first.get(source) || source + 1, total: n.total };
}

function currentContext() {
    if (context) return context;
    // Editing a master: show the values of the first slide using it.
    return contextForSlide(Math.max(0, state.currentSlideIndex || 0));
}

/** Markdown-safe text (field values are plain text). */
function plain(s) {
    return String(s ?? '').replace(/([\\`*_[\]<>#|])/g, '\\$1');
}

export function sectionOf(index) {
    const slide = (state.slides || [])[index];
    return (slide && slide.section) || '';
}

/** Section names in order (each once). */
export function sectionNames() {
    const out = [];
    (state.slides || []).forEach(s => {
        if (s.section && out[out.length - 1] !== s.section && !out.includes(s.section)) out.push(s.section);
    });
    return out;
}

export function formatDate(value) {
    const v = String(value ?? '').trim();
    if (!v) return '';
    const d = v.toLowerCase() === 'today' ? new Date() : (/^\d{4}-\d{2}-\d{2}$/.test(v) ? new Date(`${v}T12:00:00`) : null);
    if (!d || Number.isNaN(d.getTime())) return v; // free text, e.g. "Spring 2026"
    return d.toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' });
}

function tableOfContents(currentSection) {
    const names = sectionNames();
    if (!names.length) return '_No sections yet: give slides a section (Properties, with no object selected)._';
    return names.map((n, i) => (n === currentSection ? `${i + 1}. **${plain(n)}**` : `${i + 1}. ${plain(n)}`)).join('\n');
}

/** Replaces the field commands in `text` with this slide's values. */
export function resolveFields(text) {
    const raw = String(text ?? '');
    if (!raw.includes('\\')) return raw;
    FIELD_RE.lastIndex = 0;
    if (!FIELD_RE.test(raw)) return raw;
    FIELD_RE.lastIndex = 0;
    const ctx = currentContext();
    const slide = (state.slides || [])[ctx.source];
    return raw.replace(FIELD_RE, (_, name) => {
        switch (name) {
            case 'slidenumber': return String(ctx.number);
            case 'totalslides': return String(ctx.total);
            case 'slidetitle': return plain(slide ? slide.title : '');
            case 'sectiontitle': return plain(sectionOf(ctx.source));
            case 'presentationtitle': return plain(state.projectName || '');
            case 'author': return plain(state.author || '');
            case 'date': return plain(formatDate(state.date));
            case 'tableofcontents': return tableOfContents(sectionOf(ctx.source));
            default: return _;
        }
    });
}

// ---------- Suggestions after "\" (canvas text boxes and the inspector) ----------

/** Commands offered after a backslash: the fields, then bibliography commands. */
const CITE_COMMANDS = [
    { name: 'cite', label: 'Citation [1] / (Smith, 2020)', insert: 'cite{' },
    { name: 'citet', label: 'Citation as text: Smith (2020)', insert: 'citet{' },
    { name: 'fullcite', label: 'Full reference', insert: 'fullcite{' },
    { name: 'printbibliography', label: 'List of references' },
];

/** Text just before the cursor ending in a command being typed: group 1 = its letters. */
export const OPEN_COMMAND_RE = /(?:^|[^\\A-Za-z])\\([A-Za-z]*)$/;

/** [{ name, label, insert }] whose name starts with `typed`. */
export function commandCandidates(typed = '') {
    const t = typed.toLowerCase();
    return [...FIELDS.map(f => ({ name: f.name, label: f.label, insert: f.name })), ...CITE_COMMANDS.map(c => ({ insert: c.name, ...c }))]
        .filter(c => c.name.startsWith(t) && c.name !== t);
}
