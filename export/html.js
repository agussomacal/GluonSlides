// ============================================================
// export/html.js — Interactive HTML viewer string builder.
// Consumes only the element registry (exportInner) and core helpers.
// The output is the interactive viewer (present/viewer.js), the print
// source for the vector PDF (headless Chromium), and what the in-app
// Present mode shows — one HTML serves all three.
// ============================================================

import { state } from '../core/state.js';
import { escapeHtml, exportElementMarkup } from '../core/render.js';
import { exportFontCss } from '../core/fonts.js';
import { elementStep, slideStepCount } from '../core/steps.js';

const KATEX_CDN = 'https://cdn.jsdelivr.net/npm/katex@0.16.9/dist/';

async function fetchText(url, what) {
    try {
        return await (await fetch(url)).text();
    } catch (e) {
        console.warn(`Could not load ${what} for export:`, e);
        return '';
    }
}

/** One slide: its elements, the ones that build up marked with data-step. */
function slideMarkup(slide, idx, { forPrint = false } = {}) {
    const bg = state.isDarkMode ? '#1e293b' : '#ffffff';
    const style = `width: ${state.slideWidth}px; height: ${state.slideHeight}px;`
        + `background: ${bg}; position: absolute;`
        + `box-shadow: 0 25px 50px rgba(0,0,0,0.5); border-radius: 4px; overflow: hidden;`;
    let markup = `<div class="slide ${idx === 0 ? 'active' : ''}" id="slide-${idx}" data-steps="${slideStepCount(slide)}" style="${style}">`;
    (slide.elements || []).forEach(el => {
        const html = exportElementMarkup(el);
        const n = elementStep(el);
        markup += n > 1 && !forPrint ? html.replace(/^<div /, `<div data-step="${n}" `) : html;
    });
    return markup + `</div>`;
}

/**
 * The whole presentation as one HTML file.
 *   startSlide  slide shown first (in-app Present mode)
 *   localAssets KaTeX fonts from the app's libs/ instead of the CDN
 *               (the in-app frame works offline)
 */
export async function getExportHtmlString({ startSlide = 0, localAssets = false } = {}) {
    let katexCss = await fetchText('libs/katex.min.css', 'KaTeX CSS');
    katexCss = katexCss.replace(/url\((?!["']?(?:data:|https?:))/g, `url(${localAssets ? 'libs/' : KATEX_CDN}`);
    // Same stylesheet the editor uses — viewer matches canvas by construction.
    const textStyles = await fetchText('text-styles.css', 'text-styles.css');
    const viewerJs = await fetchText('present/viewer.js', 'the slide viewer');

    // Text fonts the project uses, embedded so the file works anywhere.
    let fontCss = '';
    try {
        fontCss = await exportFontCss();
    } catch (e) {
        console.warn('Could not embed fonts for export:', e);
    }

    const slidesMarkup = state.slides.map((s, idx) => slideMarkup(s, idx)).join('');

    return `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><title>${escapeHtml(state.projectName || 'Presentation')}</title>
        <style>${katexCss}</style>
        <style>${textStyles}</style>
        <style>${fontCss}</style>
        <style>
            .katex .mathbb { font-family: 'KaTeX_Math', 'Times New Roman', serif !important; font-weight: bold; letter-spacing: 0.05em; }
            body { background: #000000; display: flex; justify-content: center; align-items: center; height: 100vh; margin: 0; font-family: sans-serif; overflow: hidden; cursor: default; }
            .slide-wrapper { width: 100vw; height: 100vh; display: flex; justify-content: center; align-items: center; position: relative; }
            .slide { display: none; transform-origin: center center; }
            .slide.active { display: block; }
            [data-step] { transition: opacity 0.25s ease; }
            .step-hidden { opacity: 0; visibility: hidden; }
            .gluon-blank { position: fixed; inset: 0; z-index: 2000; pointer-events: none; opacity: 0; transition: opacity 0.2s; }
            .gluon-blank.black { background: #000000; opacity: 1; }
            .gluon-blank.white { background: #ffffff; opacity: 1; }
            .gluon-counter { position: fixed; right: 24px; bottom: 20px; z-index: 2001; padding: 6px 12px; border-radius: 6px; background: rgba(15, 23, 42, 0.85); color: #e2e8f0; font: 14px system-ui, sans-serif; opacity: 0; transition: opacity 0.3s; pointer-events: none; }
            .gluon-counter.visible { opacity: 1; }
            .nav-hint { position: fixed; bottom: 20px; color: #94a3b8; font-size: 14px; pointer-events: none; z-index: 1000; transition: opacity 0.6s; }
            .nav-hint.hidden { opacity: 0; }

            @page { size: ${state.slideWidth}px ${state.slideHeight}px; margin: 0; }
            @media print {
                body { height: auto; display: block; background: #ffffff; }
                .slide-wrapper { width: auto; height: auto; display: block; position: static; }
                .slide { display: block !important; position: relative !important; left: 0 !important; top: 0 !important; margin: 0 !important; transform: none !important; box-shadow: none !important; border-radius: 0 !important; page-break-after: always; break-after: page; }
                .slide:last-child { page-break-after: auto; break-after: auto; }
                .step-hidden { opacity: 1 !important; visibility: visible !important; }
                .nav-hint, .gluon-blank, .gluon-counter { display: none !important; }
            }
        </style></head><body><div class="slide-wrapper">${slidesMarkup}</div>
        <div class="nav-hint">→ / Space: next · ←: back · B: black screen · F: full screen · type a number + Enter: go to slide</div>
        <script>window.GLUON_START = { slide: ${Math.max(0, Math.min(state.slides.length - 1, Number(startSlide) || 0))} };<\/script>
        <script>${viewerJs.replace(/<\/script/gi, '<\\/script')}<\/script></body></html>`;
}
