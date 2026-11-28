// ============================================================
// export/html.js — Interactive HTML viewer string builder.
// Consumes only the element registry (exportInner) and core helpers.
// The output is the interactive viewer (present/viewer.js), the print
// source for the vector PDF (headless Chromium), and what the in-app
// Present mode shows — one HTML serves all three.
// ============================================================

import { updateAllConnectors } from '../core/connectors.js';
import { state } from '../core/state.js';
import { escapeHtml, exportElementMarkup } from '../core/render.js';
import { exportFontCss } from '../core/fonts.js';
import { elementStep, elementUntil, slideStepCount } from '../core/steps.js';
import { expandSlides } from '../core/bibPages.js';
import { masterFor } from '../core/masters.js';
import { withSlideContext, invalidateNumbering } from '../core/fields.js';
import { startingVariables } from '../core/variables.js';
import { palette, resolveColor } from '../core/colors.js';
import { applyFormulas } from '../core/bindings.js';

const KATEX_CDN = 'https://cdn.jsdelivr.net/npm/katex@0.16.9/dist/';

async function fetchText(url, what) {
    try {
        return await (await fetch(url)).text();
    } catch (e) {
        console.warn(`Could not load ${what} for export:`, e);
        return '';
    }
}

/**
 * KaTeX's fonts the app ships (libs/fonts) embedded in the CSS as data,
 * so math looks right in an exported file opened offline; the others
 * stay links. Cached: they don't change.
 */
let katexFontCache = null;
async function embedKatexFonts(css) {
    if (!katexFontCache) {
        katexFontCache = {};
        const names = [...new Set(css.match(/KaTeX_[A-Za-z0-9-]+\.woff2/g) || [])];
        await Promise.all(names.map(async (name) => {
            try {
                const res = await fetch(`libs/fonts/${name}`);
                if (!res.ok) return;
                const bytes = new Uint8Array(await res.arrayBuffer());
                let bin = '';
                for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
                katexFontCache[name] = `data:font/woff2;base64,${btoa(bin)}`;
            } catch (e) { /* stays a link */ }
        }));
    }
    return css.replace(/url\((["']?)fonts\/(KaTeX_[A-Za-z0-9-]+\.woff2)\1\)/g,
        (m, q, name) => (katexFontCache[name] ? `url(${katexFontCache[name]})` : m));
}

/**
 * Sliders, plots and values in text that follow them (core/liveEngine.js,
 * inlined: the file works offline), with the variables' starting values.
 * Nothing when the presentation has none.
 */
async function liveScript(needed, needsMatplotlib = false) {
    if (!needed) return '';
    // the matplotlib reader after the engine: its imports are then names already there
    const strip = (js) => js.replace(/^import [^;]*;\s*$/gm, '').replace(/^export /gm, '');
    const engine = strip(await fetchText('core/liveEngine.js', 'the plot engine'))
        // in a block of its own: its names can't collide with the engine's
        + (needsMatplotlib ? `\n{\n${strip(await fetchText('core/mplEngine.js', 'the matplotlib reader'))}\n}` : '');
    const vars = JSON.stringify(startingVariables()).replace(/</g, '\\u003c');
    // the theme colours (palette(i), '@primary' in colour formulas)
    const theme = JSON.stringify(palette().map(p => ({ name: p.name, color: resolveColor(p.color) || p.color }))).replace(/</g, '\\u003c');
    const run = `(function () {
${engine}
setThemeColors(${theme});
const vars = ${vars};
const startVars = Object.assign({}, vars);
const root = document.body;
// Animations (elements/animation): played on their slide, from their step; the variables keep their values.
const player = animationPlayer(vars, () => liveUpdate(root, vars));
const specOf = (node) => { try { return JSON.parse(node.getAttribute('data-glanim')); } catch (e) { return null; } };
const stepsOf = (node) => { const host = node.closest('.el') || node; return [Number(host.dataset.step) || 1, host.dataset.until !== undefined ? Number(host.dataset.until) : Infinity]; };
let playing = {};
function syncAnimations() {
    const viewer = window.GluonViewer;
    if (!viewer) return;
    const pos = viewer.position();
    const slide = document.getElementById('slide-' + pos.slide);
    const active = {};
    if (slide) slide.querySelectorAll('[data-glanim]').forEach((node, i) => {
        const [from, until] = stepsOf(node);
        const spec = specOf(node);
        if (!spec || from > pos.step || pos.step > until) return;
        const key = pos.slide + ':' + i;
        active[key] = spec;
        if (!playing[key]) player.start(key, spec);
    });
    Object.keys(playing).forEach(key => {
        if (active[key]) return;
        player.stop(key);
        // afterwards:reset: its variables back to where they started
        if (playing[key].afterwards === 'reset') { parseTracks(playing[key].tracks).forEach(t => { if (t.name in startVars) vars[t.name] = startVars[t.name]; }); liveUpdate(root, vars); }
    });
    playing = active;
}
// A control moved here: redraw, and tell the other windows (presenter view, audience: viewer.js);
// an animation driving that variable stops.
const moved = (name) => { player.touch(name); liveUpdate(root, vars); window.dispatchEvent(new CustomEvent('gluon-vars-out', { detail: Object.assign({}, vars) })); };
bindSliders(root, vars, moved);
window.addEventListener('gluon-vars-in', (e) => { Object.assign(vars, e.detail || {}); liveUpdate(root, vars); });
// The presenter view redraws its copies of the slides: their inputs work too; a new slide or step: its animations.
window.addEventListener('gluon-rendered', () => { bindSliders(root, vars, moved); liveUpdate(root, vars); syncAnimations(); });
syncAnimations();
// Printed (the PDF): each page shows the values where the animations end at that step,
// after those of the slides before it.
(function printValues() {
    const pages = document.querySelectorAll('.print-page');
    if (!pages.length) return;
    let carried = Object.assign({}, vars);
    let slideOf = -1;
    let slideEnd = null;
    pages.forEach(page => {
        const index = Number(page.dataset.printSlide);
        const step = Number(page.dataset.printStep) || 1;
        const original = document.getElementById('slide-' + index);
        if (index !== slideOf) { if (slideEnd) carried = slideEnd; slideOf = index; slideEnd = null; }
        const pageVars = Object.assign({}, carried);
        const all = Object.assign({}, carried);
        if (original) original.querySelectorAll('[data-glanim]').forEach(node => {
            const spec = specOf(node);
            if (!spec) return;
            const [from] = stepsOf(node);
            const end = animationEnd(spec, all);
            Object.assign(all, end);
            if (from <= step) Object.assign(pageVars, end);
        });
        slideEnd = all;
        liveUpdate(page, pageVars);
    });
})();
})();`;
    return `<script>${run.replace(/<\/script/gi, '<\\/script')}<\/script>`;
}

/** One slide: its elements, the ones that build up marked with data-step. */
function slideMarkup(slide, idx, source = idx) {
    const bg = state.isDarkMode ? '#1e293b' : '#ffffff';
    const style = `width: ${state.slideWidth}px; height: ${state.slideHeight}px;`
        + `background: ${bg}; position: absolute;`
        + `box-shadow: 0 25px 50px rgba(0,0,0,0.5); border-radius: 4px; overflow: hidden;`;
    // data-source: the slide in the project (continuation pages share it).
    let markup = `<div class="slide ${idx === 0 ? 'active' : ''}" id="slide-${idx}" data-source="${source}" data-steps="${slideStepCount(slide)}" style="${style}">`;
    // The master underneath (always visible: master elements have no steps).
    const master = masterFor(slide);
    if (master) master.elements.forEach(el => { markup += exportElementMarkup(el); });
    (slide.elements || []).forEach(el => {
        const html = exportElementMarkup(el);
        const n = elementStep(el);
        const until = elementUntil(el);
        // data-step: appears at that step; data-until: gone after that step
        const attrs = `${n > 1 ? `data-step="${n}" ` : ''}${until !== null ? `data-until="${until}" ` : ''}`;
        markup += attrs ? html.replace(/^<div /, `<div ${attrs}`) : html;
    });
    return markup + `</div>`;
}

/**
 * The whole presentation as one HTML file.
 *   startSlide  slide of the project (and step) shown first (in-app Present mode)
 *   startAt     or: index in the presented slides (with continuation pages)
 *   localAssets KaTeX fonts from the app's libs/ instead of the CDN
 *               (the in-app frame works offline)
 *   mode        'audience' (the slides) or 'presenter' (presenter view)
 *   notes       include the speaker notes (for the presenter view)
 */
export async function getExportHtmlString({ startSlide = 0, startAt = null, startStep = 1, localAssets = false, mode = 'audience', notes = true } = {}) {
    updateAllConnectors(); // attached lines where their shapes are
    let katexCss = await embedKatexFonts(await fetchText('libs/katex.min.css', 'KaTeX CSS'));
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

    // Formula-driven settings at the starting values (sliders move them from there).
    applyFormulas(startingVariables());
    // Slides as presented: long reference lists continue on extra pages.
    invalidateNumbering();
    const pages = expandSlides();
    // Fields (\slidenumber ...) count the slides as presented.
    const slidesMarkup = pages.map((p, idx) => withSlideContext({ source: p.source, number: idx + 1, total: pages.length },
        () => slideMarkup(p.slide, idx, p.source))).join('');
    applyFormulas(); // back to the values the editor shows
    const liveJs = await liveScript(/data-glslider|data-glinput|data-gl-plot|data-glbind|data-glanim/.test(slidesMarkup), /&quot;lang&quot;:&quot;matplotlib&quot;/.test(slidesMarkup));
    // Speaker notes for the presenter view; "<" escaped so the JSON can't end the script.
    const notesJson = JSON.stringify(pages.map(p => (notes && p.slide.notes) || '')).replace(/</g, '\\u003c');
    const wanted = startAt !== null ? Number(startAt) : pages.findIndex(p => p.source === (Number(startSlide) || 0));
    const start = Math.max(0, Math.min(pages.length - 1, wanted));

    return `<!DOCTYPE html><html lang="en" data-equations="${state.equations === 'text' ? 'text' : 'center'}"><head><meta charset="UTF-8"><title>${escapeHtml(state.projectName || 'Presentation')}</title>
        <style>${katexCss}</style>
        <style>${textStyles}</style>
        <style>${fontCss}</style>
        <style>
            body { background: #000000; display: flex; justify-content: center; align-items: center; height: 100vh; margin: 0; font-family: sans-serif; overflow: hidden; cursor: default; }
            .slide-wrapper { width: 100vw; height: 100vh; display: flex; justify-content: center; align-items: center; position: relative; }
            .slide { display: none; transform-origin: center center; }
            .slide.active { display: block; }
            [data-step], [data-until] { transition: opacity 0.25s ease; }
            .step-hidden { opacity: 0; visibility: hidden; }
            .gl-off { display: none !important; } /* hidden by its condition (visible:"=…") */
            .gl-colorkey .gl-key.off { opacity: 0.35; text-decoration: line-through; } /* a colour key's legend: a key turned off */
            .gl-colorkey .gl-key.off .gl-key-swatch { filter: grayscale(1); }
            .gluon-blank { position: fixed; inset: 0; z-index: 2000; pointer-events: none; opacity: 0; transition: opacity 0.2s; }
            .gluon-blank.black { background: #000000; opacity: 1; }
            .gluon-blank.white { background: #ffffff; opacity: 1; }
            .gluon-counter { position: fixed; right: 24px; bottom: 20px; z-index: 2001; padding: 6px 12px; border-radius: 6px; background: rgba(15, 23, 42, 0.85); color: #e2e8f0; font: 14px system-ui, sans-serif; opacity: 0; transition: opacity 0.3s; pointer-events: none; }
            .gluon-counter.visible { opacity: 1; }
            .nav-hint { position: fixed; bottom: 20px; color: #94a3b8; font-size: 14px; pointer-events: none; z-index: 1000; transition: opacity 0.6s; }
            .nav-hint.hidden { opacity: 0; }
            .print-pages { display: none; }

            /* Presenter view (present/viewer.js) */
            body.gluon-presenter { display: block; background: #0b1120; color: #e2e8f0; font-family: system-ui, sans-serif; }
            body.gluon-presenter .slide-wrapper, body.gluon-presenter .nav-hint { display: none; }
            .gp { position: fixed; inset: 0; display: grid; grid-template-columns: 3fr 2fr; grid-template-rows: auto 1fr 1fr; gap: 12px; padding: 12px; box-sizing: border-box; }
            .gp-bar { grid-column: 1 / -1; display: flex; align-items: center; gap: 10px; font-size: 15px; }
            .gp-timer { font: 600 30px/1 ui-monospace, monospace; color: #f8fafc; min-width: 110px; }
            .gp-timer.paused { color: #f59e0b; }
            .gp-clock { color: #94a3b8; font-size: 18px; margin-left: 8px; }
            .gp-pos { color: #cbd5e1; margin-left: 16px; }
            .gp-spacer { flex: 1; }
            .gp-audience { color: #f59e0b; }
            .gp button { background: #1e293b; color: #e2e8f0; border: 1px solid #334155; border-radius: 6px; padding: 6px 12px; font: inherit; cursor: pointer; }
            .gp button:hover { background: #334155; }
            .gp button.on { background: #f8fafc; color: #0f172a; }
            .gp-current { grid-row: 2 / 4; }
            .gp section { display: flex; flex-direction: column; min-height: 0; min-width: 0; }
            .gp-label { display: flex; align-items: center; gap: 6px; color: #94a3b8; font-size: 12px; text-transform: uppercase; letter-spacing: 0.06em; margin-bottom: 6px; }
            .gp-label button { padding: 1px 7px; font-size: 12px; text-transform: none; }
            .gp-stage { position: relative; flex: 1; min-height: 0; overflow: hidden; }
            .gp-current .gp-stage { cursor: pointer; }
            .gp-current .gp-stage.blanked::after { content: 'Audience sees a blank screen'; position: absolute; inset: 0; display: flex; align-items: center; justify-content: center; background: rgba(0,0,0,0.6); color: #f8fafc; font-size: 18px; }
            .gp-copy { position: absolute !important; display: block !important; transform-origin: top left; box-shadow: 0 8px 24px rgba(0,0,0,0.5) !important; }
            .gp-end { position: absolute; inset: 0; display: flex; align-items: center; justify-content: center; color: #64748b; border: 1px dashed #334155; border-radius: 6px; }
            .gp-notes-text { flex: 1; overflow: auto; white-space: pre-wrap; line-height: 1.45; background: #111827; border: 1px solid #1f2937; border-radius: 6px; padding: 12px 14px; color: #f1f5f9; }
            .gp-notes-text.empty { color: #64748b; font-style: italic; }

            @page { size: ${state.slideWidth}px ${state.slideHeight}px; margin: 0; }
            @media print {
                body { height: auto; display: block; background: #ffffff; }
                /* Printing (vector PDF): one page per build step, made by the viewer. */
                .slide-wrapper { width: auto; height: auto; display: block; position: static; }
                body:has(> .print-pages) .slide-wrapper { display: none !important; }
                .print-pages { display: block !important; }
                .slide { display: block !important; position: relative !important; left: 0 !important; top: 0 !important; margin: 0 !important; transform: none !important; box-shadow: none !important; border-radius: 0 !important; page-break-after: always; break-after: page; }
                .slide:last-child { page-break-after: auto; break-after: auto; }
                .step-hidden { opacity: 1 !important; visibility: visible !important; }
                .nav-hint, .gluon-blank, .gluon-counter, .gp { display: none !important; }
            }
        </style></head><body><div class="slide-wrapper">${slidesMarkup}</div>
        <div class="nav-hint">→ / Space: next · ←: back · S: presenter view · B: black screen · F: full screen · number + Enter: go to slide</div>
        <script type="application/json" id="gluon-notes">${notesJson}<\/script>
        <script>window.GLUON_START = { slide: ${start}, step: ${Math.max(1, Number(startStep) || 1)} };${mode === 'presenter' ? " window.GLUON_MODE = 'presenter';" : ''}<\/script>
        <script>${viewerJs.replace(/<\/script/gi, '<\\/script')}<\/script>${liveJs}</body></html>`;
}
