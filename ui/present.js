// ============================================================
// ui/present.js — Present mode inside the app. Shows the exported
// HTML (export/html.js + present/viewer.js) in a full-screen frame,
// so the talk looks exactly like the exported file.
//
//   ▶ Present (toolbar) / Shift+F5   from the current slide
//   F5                               from the first slide
//   Esc                              back to the editor, on the slide
//                                    the talk was at
// ============================================================

import { state } from '../core/state.js';
import { getExportHtmlString } from '../export/html.js';
import { selectSlide } from '../editor/editor.js';

let overlay = null;
let lastPosition = null;
let enteredFullscreen = false;

export function isPresenting() {
    return overlay !== null;
}

/** Starts the slide show; `fromStart` begins at the first slide. */
export async function startPresentation({ fromStart = false } = {}) {
    if (overlay || !state.slides.length) return;
    // A text box being typed in saves on blur.
    if (document.activeElement && document.activeElement !== document.body) document.activeElement.blur();

    const startSlide = fromStart ? 0 : state.currentSlideIndex;
    lastPosition = { slide: startSlide, step: 1 };

    overlay = document.createElement('div');
    overlay.id = 'present-overlay';
    overlay.innerHTML = '<div class="present-loading">Preparing the presentation…</div>';
    document.body.appendChild(overlay);

    // Full screen must be asked for during the click/key press itself.
    enteredFullscreen = false;
    if (overlay.requestFullscreen) {
        overlay.requestFullscreen().then(() => { enteredFullscreen = true; }, () => { /* stays a window-sized overlay */ });
    }

    let html;
    try {
        html = await getExportHtmlString({ startSlide, localAssets: true });
    } catch (e) {
        stopPresentation();
        alert(`Could not start the presentation: ${e.message}`);
        return;
    }
    if (!overlay) return; // closed while preparing

    const frame = document.createElement('iframe');
    frame.className = 'present-frame';
    frame.title = 'Presentation';
    frame.srcdoc = html;
    frame.addEventListener('load', () => frame.contentWindow && frame.contentWindow.focus());
    overlay.replaceChildren(frame);
}

/** Leaves the slide show and shows the slide it ended on. */
export function stopPresentation() {
    if (!overlay) return;
    overlay.remove();
    overlay = null;
    if (document.fullscreenElement && document.exitFullscreen) document.exitFullscreen().catch(() => {});
    if (lastPosition && lastPosition.slide !== state.currentSlideIndex) selectSlide(lastPosition.slide);
}

window.addEventListener('message', (e) => {
    const frame = overlay && overlay.querySelector('.present-frame');
    if (!frame || e.source !== frame.contentWindow || !e.data) return;
    if (e.data.type === 'gluon-position') lastPosition = { slide: e.data.slide, step: e.data.step };
    else if (e.data.type === 'gluon-exit') stopPresentation();
});

// Esc in full screen is taken by the browser: leaving full screen ends the show.
document.addEventListener('fullscreenchange', () => {
    if (overlay && enteredFullscreen && !document.fullscreenElement) stopPresentation();
});

window.addEventListener('keydown', (e) => {
    if (e.key !== 'F5' || overlay) return;
    const editor = document.getElementById('editor-view');
    if (!editor || !editor.classList.contains('active')) return;
    e.preventDefault();
    startPresentation({ fromStart: !e.shiftKey });
});
