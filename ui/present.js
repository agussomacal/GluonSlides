// ============================================================
// ui/present.js — Present mode inside the app. Shows the exported
// HTML (export/html.js + present/viewer.js) in a full-screen frame,
// so the talk looks exactly like the exported file.
//
//   ▶ Present (toolbar) / Shift+F5   from the current slide
//   F5                               from the first slide
//   S (while presenting)             presenter view
//   Esc                              back to the editor, on the slide
//                                    the talk was at
//
// Presenter view: this window shows the presenter view (notes, next
// slide, timer) and a second window (backend/presentation.py, page
// present/audience.html) shows the slides: full screen on the other
// screen when there are two. With two screens Present starts in the
// presenter view directly. Messages between the two:
//   presenter frame --gluon-control--> here --api.audience_control--> audience
//   audience --api.audience_event--> 'gluon-remote' event here --> presenter frame
// ============================================================

import { state, pyApi } from '../core/state.js';
import { getExportHtmlString } from '../export/html.js';
import { selectSlide } from '../editor/editor.js';
import { matches } from '../core/shortcuts.js';

let overlay = null;
let mode = null;            // 'audience' | 'presenter'
let audienceOpen = false;
let lastPosition = null;
let enteredFullscreen = false;

export function isPresenting() {
    return overlay !== null;
}

function frame() {
    return overlay && overlay.querySelector('.present-frame');
}

function requestFullscreen() {
    enteredFullscreen = false;
    if (overlay.requestFullscreen) {
        overlay.requestFullscreen().then(() => { enteredFullscreen = true; }, () => { /* window-sized overlay */ });
    }
}

async function showFrame(html) {
    if (!overlay) return;
    const f = document.createElement('iframe');
    f.className = 'present-frame';
    f.title = mode === 'presenter' ? 'Presenter view' : 'Presentation';
    f.setAttribute('allow', 'fullscreen');
    f.srcdoc = html;
    f.addEventListener('load', () => f.contentWindow && f.contentWindow.focus());
    overlay.replaceChildren(f);
}

/** Two or more screens: the audience gets its own window right away. */
async function hasSecondScreen() {
    const api = pyApi();
    if (!api || typeof api.screen_count !== 'function') return false;
    try {
        const res = await api.screen_count();
        return Boolean(res && res.count > 1);
    } catch (e) {
        return false;
    }
}

/**
 * Starts the slide show.
 *   fromStart  begin at the first slide (else the current one)
 *   presenter  true/false forces the presenter view; undefined: only
 *              when a second screen is connected
 */
export async function startPresentation({ fromStart = false, presenter } = {}) {
    if (overlay || !state.slides.length) return;
    // A text box being typed in saves on blur.
    if (document.activeElement && document.activeElement !== document.body) document.activeElement.blur();

    const startSlide = fromStart ? 0 : state.currentSlideIndex;
    // source: slide of the project; at: index among the presented slides
    // (long reference lists add continuation pages).
    lastPosition = { source: startSlide, at: null, step: 1 };

    overlay = document.createElement('div');
    overlay.id = 'present-overlay';
    overlay.innerHTML = '<div class="present-loading">Preparing the presentation…</div>';
    document.body.appendChild(overlay);
    // Full screen must be asked for during the click/key press itself.
    requestFullscreen();

    try {
        const usePresenter = presenter !== undefined ? presenter : await hasSecondScreen();
        if (usePresenter) await openPresenterView({ source: startSlide });
        else {
            mode = 'audience';
            await showFrame(await getExportHtmlString({ startSlide, localAssets: true }));
        }
    } catch (e) {
        stopPresentation();
        alert(`Could not start the presentation: ${e.message}`);
    }
}

/** Switches to (or starts) the presenter view with an audience window. */
async function openPresenterView({ source = 0, at = null, step = 1 } = {}) {
    mode = 'presenter';
    lastPosition = { source, at, step };
    const start = { startSlide: source, startAt: at, startStep: step, localAssets: true };
    const api = pyApi();
    if (api && typeof api.open_audience_window === 'function') {
        // The audience never gets the notes.
        const audienceHtml = await getExportHtmlString({ ...start, notes: false });
        const res = await api.open_audience_window(audienceHtml);
        audienceOpen = Boolean(res && res.success);
    }
    if (!overlay) return; // ended meanwhile
    await showFrame(await getExportHtmlString({ ...start, mode: 'presenter' }));
    if (!audienceOpen) {
        // Rehearsal: no audience window (e.g. in a browser), the presenter view alone.
        frame()?.addEventListener('load', () => frame()?.contentWindow.postMessage({ type: 'gluon-audience-closed', text: 'Rehearsal: no audience window' }, '*'), { once: true });
    }
}

/** Leaves the slide show and shows the slide it ended on. */
export function stopPresentation() {
    if (!overlay) return;
    overlay.remove();
    overlay = null;
    mode = null;
    if (audienceOpen) {
        audienceOpen = false;
        const api = pyApi();
        if (api && api.close_audience_window) api.close_audience_window();
    }
    if (document.fullscreenElement && document.exitFullscreen) document.exitFullscreen().catch(() => {});
    if (lastPosition && lastPosition.source !== state.currentSlideIndex) selectSlide(lastPosition.source);
}

// ---------- Messages ----------

/** { source, at, step } from a viewer message ({ slide, source?, step }). */
function positionOf(m) {
    const at = Number(m.slide) || 0;
    return { source: Number.isFinite(Number(m.source)) ? Number(m.source) : at, at, step: Number(m.step) || 1 };
}

/** From the frame in this window (slides or presenter view). */
window.addEventListener('message', (e) => {
    const f = frame();
    if (!f || e.source !== f.contentWindow || !e.data) return;
    const m = e.data;
    if (m.type === 'gluon-position') {
        lastPosition = positionOf(m);
    } else if (m.type === 'gluon-control') {
        // Presenter view moved: the audience window follows.
        if (m.action === 'goto') lastPosition = positionOf(m);
        const api = pyApi();
        if (audienceOpen && api && api.audience_control) api.audience_control(m);
    } else if (m.type === 'gluon-exit') {
        stopPresentation();
    } else if (m.type === 'gluon-presenter-request' && mode === 'audience') {
        openPresenterView({ source: positionOf(m).source, at: Number(m.slide) || 0, step: Number(m.step) || 1 });
    }
});

/** From the audience window, through Python (backend/presentation.py). */
window.addEventListener('gluon-remote', (e) => {
    const m = e.detail || {};
    if (!overlay) return;
    if (m.type === 'gluon-exit') { stopPresentation(); return; }
    if (m.type === 'gluon-audience-closed') audienceOpen = false;
    if (m.type === 'gluon-position') lastPosition = positionOf(m);
    if (m.type === 'gluon-position' || m.type === 'gluon-audience-closed') {
        const f = frame();
        if (f && f.contentWindow) f.contentWindow.postMessage(m, '*');
    }
});

// Esc in full screen is taken by the browser: leaving full screen ends the show.
document.addEventListener('fullscreenchange', () => {
    if (overlay && enteredFullscreen && !document.fullscreenElement) stopPresentation();
});

window.addEventListener('keydown', (e) => {
    if (overlay || !(matches(e, 'presentStart') || matches(e, 'presentHere'))) return;
    const editor = document.getElementById('editor-view');
    if (!editor || !editor.classList.contains('active')) return;
    e.preventDefault();
    startPresentation({ fromStart: matches(e, 'presentStart') });
});
