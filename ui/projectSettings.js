// ============================================================
// ui/projectSettings.js — "⚙ Project settings": the project's style
// defaults (core/defaults.js). Every element that does not set a
// property itself inherits it from here; changes apply at once.
// ============================================================

import { state, pyApi, markDirty, flashSaveIndicator } from '../core/state.js';
import { defaultValue, projectStyle, setProjectDefault, adoptDefaults } from '../core/defaults.js';
import { escapeHtml } from '../core/render.js';
import { renderEditor } from '../editor/editor.js';
import { fontOptions, showFontLicense } from '../elements/text/text.js';

const MODAL_ID = 'project-settings-modal';

const opt = (value, current, label) => `<option value="${value}" ${String(current) === value ? 'selected' : ''}>${label}</option>`;
const hex = (v, fallback) => (/^#[0-9a-fA-F]{6}$/.test(String(v)) ? v : fallback);

/** One setting: label (+ ↺ when the project overrides the built-in value) and control. */
function field(type, key, label, control) {
    const overridden = projectStyle(type)[key] !== undefined;
    return `
        <div class="prop-group">
            <label><span class="prop-label-text" title="${label}">${label}</span>${overridden
                ? ` <button type="button" class="prop-reset" data-unset="${type}.${key}" title="Back to the built-in default">↺</button>`
                : ''}</label>
            ${control}
        </div>`;
}

function color(type, key, fallback) {
    return `<input type="color" class="prop-control prop-color" data-default="${type}.${key}" value="${hex(defaultValue(type, key), fallback)}">`;
}

function number(type, key, attrs = '') {
    return `<input type="number" class="prop-control" data-default="${type}.${key}" value="${escapeHtml(defaultValue(type, key) ?? '')}" ${attrs}>`;
}

function bodyHtml() {
    const v = (type, key) => defaultValue(type, key);
    return `
        <h2>Project settings</h2>
        <p>Defaults for this project. Every element that doesn't set a property itself uses these, so a change here updates all of them. An element can still override any value in the properties panel (↺ there returns it to the default).</p>

        <div class="settings-section-title">Text</div>
        ${field('text', 'fontFamily', 'Font', `
            <select class="prop-control" data-default="text.fontFamily">${fontOptions(v('text', 'fontFamily') || 'sans-serif')}</select>
            <div class="font-license" data-family="${escapeHtml(v('text', 'fontFamily') || 'sans-serif')}"></div>`)}
        <div class="prop-row">
            ${field('text', 'fontSize', 'Size (px)', number('text', 'fontSize', 'min="4" step="1"'))}
            ${field('text', 'fontColor', 'Color', color('text', 'fontColor', '#0f172a'))}
        </div>
        <div class="prop-row">
            ${field('text', 'textAlign', 'H-alignment', `<select class="prop-control" data-default="text.textAlign">
                ${opt('left', v('text', 'textAlign'), 'Left')}${opt('center', v('text', 'textAlign'), 'Center')}${opt('right', v('text', 'textAlign'), 'Right')}</select>`)}
            ${field('text', 'verticalAlign', 'V-alignment', `<select class="prop-control" data-default="text.verticalAlign">
                ${opt('top', v('text', 'verticalAlign'), 'Top')}${opt('center', v('text', 'verticalAlign'), 'Center')}${opt('bottom', v('text', 'verticalAlign'), 'Bottom')}</select>`)}
        </div>

        <div class="settings-section-title">Shapes</div>
        <div class="prop-row">
            ${field('shape', 'bg', 'Fill', color('shape', 'bg', '#cbd5e1'))}
            ${field('shape', 'borderCol', 'Border color', color('shape', 'borderCol', '#475569'))}
        </div>
        <div class="prop-row">
            ${field('shape', 'borderWidth', 'Border width', number('shape', 'borderWidth', 'min="0" step="1"'))}
            ${field('shape', 'borderStyle', 'Border style', `<select class="prop-control" data-default="shape.borderStyle">
                ${opt('solid', v('shape', 'borderStyle'), 'Solid')}${opt('dashed', v('shape', 'borderStyle'), 'Dashed')}${opt('dotted', v('shape', 'borderStyle'), 'Dotted')}${opt('none', v('shape', 'borderStyle'), 'None')}</select>`)}
        </div>

        <div class="settings-section-title">Lines &amp; curves</div>
        <div class="prop-row">
            ${field('path', 'stroke', 'Stroke', color('path', 'stroke', '#0f172a'))}
            ${field('path', 'strokeWidth', 'Width (px)', number('path', 'strokeWidth', 'min="0.5" step="0.5"'))}
        </div>
        ${field('path', 'dash', 'Line style', `<select class="prop-control" data-default="path.dash">
            ${opt('solid', v('path', 'dash'), 'Solid')}${opt('dashed', v('path', 'dash'), 'Dashed')}${opt('dotted', v('path', 'dash'), 'Dotted')}</select>`)}

        <div class="settings-section-title">Existing elements</div>
        <p class="prop-hint">Older projects store every value in each element, so they don't follow the defaults. This makes elements whose values are just the standard ones follow the project defaults; values you changed on purpose are kept.</p>
        <button class="btn btn-secondary" data-settings-action="adopt">Use project defaults for existing elements</button>
        <div class="prop-hint settings-result" id="settings-adopt-result"></div>

        <div class="modal-actions">
            <button class="btn btn-primary" data-settings-action="close">Done</button>
        </div>`;
}

function modal() {
    let el = document.getElementById(MODAL_ID);
    if (!el) {
        el = document.createElement('div');
        el.id = MODAL_ID;
        el.className = 'modal-backdrop';
        el.innerHTML = '<div class="modal project-settings"></div>';
        document.body.appendChild(el);
        wire(el);
    }
    return el;
}

function render() {
    const m = modal();
    m.querySelector('.project-settings').innerHTML = bodyHtml();
    const family = defaultValue('text', 'fontFamily') || 'sans-serif';
    showFontLicense(family, m.querySelector('.font-license'));
}

/** Applies a change and redraws the slides (and this dialog). */
function apply(type, key, value, { redrawDialog = false } = {}) {
    setProjectDefault(type, key, value);
    markDirty();
    renderEditor();
    if (redrawDialog) render();
}

function addResetButton(control, type, key) {
    const label = control.closest('.prop-group')?.querySelector('label');
    if (!label || label.querySelector('[data-unset]')) return;
    label.insertAdjacentHTML('beforeend',
        ` <button type="button" class="prop-reset" data-unset="${type}.${key}" title="Back to the built-in default">↺</button>`);
}

function wire(m) {
    const onChange = (e) => {
        const target = e.target.closest('[data-default]');
        if (!target) return;
        const [type, key] = target.dataset.default.split('.');
        const isChoice = target.tagName === 'SELECT';
        if (e.type !== (isChoice ? 'change' : 'input')) return;
        let value = target.value;
        if (target.type === 'number') {
            if (value === '' || !Number.isFinite(Number(value))) return;
            value = Number(value);
        }
        // Selects redraw the dialog (↺ / licence notice). Typed values
        // only gain their ↺: redrawing would replace the buttons under the
        // mouse (e.g. Done) when the field loses focus.
        apply(type, key, value, { redrawDialog: isChoice });
        if (!isChoice) addResetButton(target, type, key);
    };
    m.addEventListener('input', onChange);
    m.addEventListener('change', onChange);

    m.addEventListener('click', async (e) => {
        const unset = e.target.closest('[data-unset]');
        if (unset) {
            const [type, key] = unset.dataset.unset.split('.');
            apply(type, key, null, { redrawDialog: true });
            return;
        }
        const lic = e.target.closest('[data-element-action="openFontLicense"]');
        if (lic) {
            const api = pyApi();
            if (api) api.open_url(lic.dataset.arg);
            return;
        }
        const action = e.target.closest('[data-settings-action]');
        if (!action) {
            if (e.target === m) close(); // click on the backdrop
            return;
        }
        if (action.dataset.settingsAction === 'close') close();
        if (action.dataset.settingsAction === 'adopt') {
            const n = adoptDefaults();
            markDirty();
            renderEditor();
            const out = m.querySelector('#settings-adopt-result');
            out.textContent = n
                ? `${n} stored value${n === 1 ? '' : 's'} removed: those elements now follow the defaults.`
                : 'Nothing to change: elements already follow the defaults (or use their own values).';
            flashSaveIndicator('Elements follow the project defaults ✓');
        }
    });

    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && m.classList.contains('show')) close();
    });
}

export function openProjectSettings() {
    render();
    modal().classList.add('show');
}

function close() {
    modal().classList.remove('show');
}

// Kept for tests/debugging: the state the dialog edits.
export function projectDefaults() {
    return state.defaults;
}
