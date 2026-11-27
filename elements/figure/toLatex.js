// ============================================================
// elements/figure/toLatex.js — "Convert to LaTeX": a picture of an
// equation read back to an editable `$\displaystyle …$` text box
// (backend/importers/equations.py, the optional equation component).
// Offered on pictures from the right-click menu and the figure's panel,
// for the ones the import didn't convert (it only converts readings the
// model is sure of; here the user asked, so an unsure reading is used
// too, with a word to check it). The picture stays in figures/; undo
// brings it back.
// ============================================================

import { state, pyApi, markDirty, currentSlide, findElementPath, flashSaveIndicator } from '../../core/state.js';
import { busy, progressBar } from '../../ui/busy.js';

const RASTER = /\.(png|jpe?g|gif|webp|bmp)$/i;

/** Whether `el` is a picture the reader can try. */
export function canReadEquation(el) {
    return Boolean(el && el.type === 'figure' && RASTER.test(el.filePath || ''));
}

/** The array holding element `id` on the slide being edited. */
function containerOf(id) {
    const slide = currentSlide();
    const path = findElementPath(slide, id);
    if (!path) return null;
    return path.length ? path[path.length - 1].children : slide.elements;
}

/** A small dialog: the question, Download / Cancel, then the download's progress. */
function askAndDownload(api, message) {
    return new Promise(resolve => {
        const backdrop = document.createElement('div');
        backdrop.className = 'modal-backdrop show';
        backdrop.id = 'equation-extra-modal';
        backdrop.innerHTML = `
            <div class="modal" style="width: 460px;">
                <h3>Convert to LaTeX</h3>
                <p class="equation-extra-text"></p>
                <div class="prop-hint equation-extra-status"></div>
                <div class="modal-error equation-extra-error"></div>
                <div class="modal-actions">
                    <button class="btn btn-secondary" data-extra="no">Cancel</button>
                    <button class="btn btn-primary" data-extra="yes">Download</button>
                </div>
            </div>`;
        backdrop.querySelector('.equation-extra-text').textContent = message;
        document.body.appendChild(backdrop);
        const done = (ok) => { backdrop.remove(); resolve(ok); };
        const yes = backdrop.querySelector('[data-extra="yes"]');
        backdrop.querySelector('[data-extra="no"]').onclick = () => done(false);
        yes.onclick = async () => {
            yes.disabled = true;
            const status = backdrop.querySelector('.equation-extra-status');
            progressBar(status, { stage: 'Downloading the equation component' });
            const poll = setInterval(async () => {
                try {
                    const p = await api.import_progress();
                    if (p && p.success && p.stage) progressBar(status, p);
                } catch (e) { /* the bar just stays */ }
            }, 250);
            let got;
            try {
                got = await api.install_extra('equations');
            } catch (e) {
                got = { success: false, error: e.message };
            } finally {
                clearInterval(poll);
            }
            if (got && got.success) return done(true);
            status.textContent = '';
            backdrop.querySelector('.equation-extra-error').textContent = (got && got.error) || 'Download failed';
            yes.disabled = false;
            yes.textContent = 'Try again';
        };
    });
}

/** Reads the picture `el` and puts the LaTeX text box in its place. */
export async function convertFigureToLatex(el) {
    const api = pyApi();
    if (!api || typeof api.read_equation !== 'function' || !canReadEquation(el)) return false;
    const id = el.id;
    const read = () => busy('Reading the equation…', api.read_equation(state.projectFolder || '', el));
    let res = await read();
    if (res && !res.success && res.needs_extra === 'equations') {
        if (!await askAndDownload(api, res.extra_message || 'Reading equations needs an extra component. Download it now?')) return false;
        res = await read();
    }
    if (!res || !res.success) {
        flashSaveIndicator(`Convert to LaTeX: ${(res && res.error) || 'failed'}`);
        return false;
    }
    // The element may have moved (into a group) or gone while it was read.
    const container = containerOf(id);
    const index = container ? container.findIndex(e => e.id === id) : -1;
    if (index < 0) return false;
    const old = container[index];
    const text = { ...res.element, id, x: old.x, y: old.y, width: old.width, height: old.height };
    ['step', 'until', 'rotate', 'locked'].forEach(key => {
        if (old[key] !== undefined) text[key] = old[key];
        else delete text[key];
    });
    if (old.name) text.name = old.name;
    container[index] = text;
    markDirty();
    document.dispatchEvent(new CustomEvent('slide-content-changed'));
    flashSaveIndicator(res.unsure ? 'Converted to LaTeX: the model was unsure, check it' : 'Converted to LaTeX ✓');
    return true;
}
