// ============================================================
// core/bibPages.js — Long reference lists continue on extra slides.
//
// A text box containing a plain \printbibliography (no [range]) shows
// as many references as fit in it; the rest go to copies of its slide
// (same layout, the list continued). The copies exist only when
// presenting and exporting (expandSlides); nothing is saved in the .gl
// file, and the split follows the bibliography as it changes.
// \printbibliography[9-] etc. (core/citations.js) chooses by hand.
//
// Fitting is measured with the export markup (what the audience sees),
// in a hidden box of the element's width, then height compared.
// ============================================================

import { state } from './state.js';
import { exportElementMarkup } from './render.js';
import { beginCitationPass } from './citations.js';

/** \printbibliography without a [range]: paginated automatically. */
const AUTO_BIB_RE = /\\printbibliography(?!\s*\[)/;
const cache = new Map();
let host = null;

export function hasAutoBibliography(el) {
    return Boolean(el && el.type === 'text' && typeof el.content === 'string' && AUTO_BIB_RE.test(el.content));
}

function withRange(content, from, to) {
    return content.replace(AUTO_BIB_RE, `\\printbibliography[${from}-${to}]`);
}

function measuringHost() {
    if (host && host.isConnected) return host;
    host = document.createElement('div');
    host.setAttribute('aria-hidden', 'true');
    host.style.cssText = 'position:absolute;left:-100000px;top:0;visibility:hidden;pointer-events:none;';
    document.body.appendChild(host);
    return host;
}

/** True when `content` fits in the element's box. */
function fits(el, content) {
    const box = measuringHost();
    box.style.width = `${state.slideWidth}px`;
    box.innerHTML = exportElementMarkup({ ...el, content, x: 0, y: 0 });
    const node = box.firstElementChild;
    if (!node) return true;
    node.style.height = 'auto';
    node.style.minHeight = '0';
    const needed = node.offsetHeight;
    box.innerHTML = '';
    return needed <= Number(el.height) + 1;
}

function hash(s) {
    let h = 0;
    for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
    return h;
}

/**
 * Ranges [[from, to], ...] (1-based, in citation order) of the pages a
 * plain \printbibliography element needs; one range when it all fits
 * (or nothing is cited). Needs the element's raw properties (`el` may
 * be a plain copy: styles and defaults are applied when measuring).
 */
export function bibliographyPages(el) {
    if (!hasAutoBibliography(el)) return [[1, Infinity]];
    if (!Array.isArray(state._citationOrder)) beginCitationPass();
    const total = state._citationOrder.length;
    if (total <= 1 || typeof document === 'undefined') return [[1, Infinity]];

    const key = JSON.stringify([el.content, el.width, el.height, el.fontSize, el.fontFamily, el.style,
        state.citestyle, state._citationOrder, hash(state.rawBib || ''), state.slideWidth,
        hash(JSON.stringify(state.defaults || {})), hash(JSON.stringify(state.styles || {})), document.fonts && document.fonts.size]);
    if (cache.has(key)) return cache.get(key);

    const plain = { ...el };
    const pages = [];
    let from = 1;
    while (from <= total) {
        // Largest `to` that fits (at least one reference per page).
        let lo = from;
        let hi = total;
        while (lo < hi) {
            const mid = Math.ceil((lo + hi) / 2);
            if (fits(plain, withRange(el.content, from, mid))) lo = mid;
            else hi = mid - 1;
        }
        pages.push([from, lo]);
        from = lo + 1;
    }
    if (cache.size > 200) cache.clear();
    cache.set(key, pages);
    return pages;
}

/** The content to show for page `page` of a paginated element. */
export function bibliographyPageContent(el, page = 0) {
    const pages = bibliographyPages(el);
    if (pages.length <= 1) return el.content;
    const [from, to] = pages[Math.min(page, pages.length - 1)];
    return withRange(el.content, from, to);
}

/**
 * The slides as presented and exported: every slide, followed by its
 * continuation copies when a reference list does not fit.
 * Returns [{ slide, source, page, pages }] (source = index in state.slides).
 */
export function expandSlides() {
    beginCitationPass();
    const out = [];
    (state.slides || []).forEach((slide, source) => {
        const idx = (slide.elements || []).findIndex(hasAutoBibliography);
        const pages = idx >= 0 ? bibliographyPages(slide.elements[idx]) : [[1, Infinity]];
        if (pages.length <= 1) {
            out.push({ slide, source, page: 0, pages: 1 });
            return;
        }
        pages.forEach((_, page) => {
            const elements = slide.elements.map((el, i) => (i === idx
                ? { ...el, content: bibliographyPageContent(el, page) }
                : el));
            out.push({ slide: { ...slide, elements }, source, page, pages: pages.length });
        });
    });
    return out;
}

// Fonts arriving late change how much fits.
if (typeof document !== 'undefined' && document.fonts) {
    document.fonts.addEventListener?.('loadingdone', () => cache.clear());
}
