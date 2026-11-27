// ============================================================
// ui/projectSettings.js — "⚙ Project settings", four tabs:
//
//   Presentation  author and date (for the \author / \date fields)
//   Defaults  the project's style defaults per element type
//   Styles    named styles (Title, Caption...) that elements can use
//   Colors    the theme colors (palette) offered by every color field
//
// Everything applies at once; every element that inherits a value
// follows (cascade: element > style > project default > built-in).
// ============================================================

import { state, pyApi, markDirty, flashSaveIndicator } from '../core/state.js';
import { formatDate } from '../core/fields.js';
import {
    defaultValue, projectStyle, setProjectDefault, adoptDefaults,
    styleNames, getStyle, createStyle, setStyleValue, renameStyle, deleteStyle, styleUsage, STYLE_NAME_RE,
} from '../core/defaults.js';
import {
    palette, setPalette, paletteUsage, renamePaletteColor, removePaletteColor, COLOR_NAME_RE,
} from '../core/colors.js';
import { escapeHtml } from '../core/render.js';
import { renderEditor } from '../editor/editor.js';
import { fontOptions, showFontLicense } from '../elements/text/text.js';
import { colorField } from './colorPicker.js';

const MODAL_ID = 'project-settings-modal';
const TYPES = [
    { type: 'text', label: 'Text' },
    { type: 'shape', label: 'Shapes' },
    { type: 'path', label: 'Lines & curves' },
];

const ui = { tab: 'defaults', styleType: 'text', style: null, message: '' };

const opt = (value, current, label) => `<option value="${value}" ${String(current) === value ? 'selected' : ''}>${label}</option>`;

// ---------- Fields (shared by the Defaults and Styles tabs) ----------
//
// A target says what a field edits:
//   { kind: 'default', type }        -> data-default="type.key"
//   { kind: 'style', type, name }    -> data-style-field="key"

function attrsFor(target, key) {
    return target.kind === 'default' ? { 'data-default': `${target.type}.${key}` } : { 'data-style-field': key };
}

function attrHtml(target, key) {
    return Object.entries(attrsFor(target, key)).map(([k, v]) => `${k}="${escapeHtml(v)}"`).join(' ');
}

/** The value a field shows, and whether the target sets it itself. */
function valueOf(target, key) {
    if (target.kind === 'default') {
        return { value: defaultValue(target.type, key), own: projectStyle(target.type)[key] !== undefined };
    }
    const style = getStyle(target.type, target.name) || {};
    const own = style[key] !== undefined && style[key] !== '';
    return { value: own ? style[key] : defaultValue(target.type, key), own };
}

function field(target, key, label, control) {
    const { own } = valueOf(target, key);
    const resetTitle = target.kind === 'default' ? 'Back to the built-in default' : 'Use the project default';
    const tag = own
        ? `<button type="button" class="prop-reset" data-unset="${key}" title="${resetTitle}">↺</button>`
        : (target.kind === 'style' ? '<span class="prop-default-tag" title="From the project defaults">default</span>' : '');
    return `
        <div class="prop-group">
            <label><span class="prop-label-text" title="${label}">${label}</span>${tag}</label>
            ${control}
        </div>`;
}

const color = (t, key, opts) => colorField(attrsFor(t, key), valueOf(t, key).value, opts);
const number = (t, key, attrs = '') => `<input type="number" class="prop-control" ${attrHtml(t, key)} value="${escapeHtml(valueOf(t, key).value ?? '')}" ${attrs}>`;
const select = (t, key, options) => `<select class="prop-control" ${attrHtml(t, key)}>${options.map(([v, l]) => opt(v, valueOf(t, key).value, l)).join('')}</select>`;

/** The fields for one element type (defaults or a style). */
function typeFields(t) {
    if (t.type === 'text') {
        const font = valueOf(t, 'fontFamily').value || 'sans-serif';
        return `
            ${field(t, 'fontFamily', 'Font', `
                <select class="prop-control" ${attrHtml(t, 'fontFamily')}>${fontOptions(font)}</select>
                <div class="font-license" data-family="${escapeHtml(font)}"></div>`)}
            <div class="prop-row">
                ${field(t, 'fontSize', 'Size (px)', number(t, 'fontSize', 'min="4" step="1"'))}
                ${field(t, 'fontColor', 'Color', color(t, 'fontColor', { allowNone: false }))}
            </div>
            <div class="prop-row">
                ${field(t, 'textAlign', 'Horizontal', select(t, 'textAlign', [['left', 'Left'], ['center', 'Center'], ['right', 'Right']]))}
                ${field(t, 'verticalAlign', 'Vertical', select(t, 'verticalAlign', [['top', 'Top'], ['center', 'Center'], ['bottom', 'Bottom']]))}
            </div>
            <div class="prop-row">
                ${field(t, 'bg', 'Background', color(t, 'bg'))}
                ${field(t, 'borderCol', 'Border', color(t, 'borderCol'))}
            </div>`;
    }
    if (t.type === 'shape') {
        return `
            <div class="prop-row">
                ${field(t, 'bg', 'Fill', color(t, 'bg'))}
                ${field(t, 'borderCol', 'Border', color(t, 'borderCol'))}
            </div>
            <div class="prop-row">
                ${field(t, 'borderWidth', 'Thickness', number(t, 'borderWidth', 'min="0" step="1"'))}
                ${field(t, 'borderStyle', 'Border style', select(t, 'borderStyle', [['solid', 'Solid'], ['dashed', 'Dashed'], ['dotted', 'Dotted'], ['none', 'None']]))}
            </div>`;
    }
    return `
        <div class="prop-row">
            ${field(t, 'stroke', 'Stroke', color(t, 'stroke', { allowNone: false }))}
            ${field(t, 'strokeWidth', 'Width (px)', number(t, 'strokeWidth', 'min="0.5" step="0.5"'))}
        </div>
        <div class="prop-row">
            ${field(t, 'dash', 'Line style', select(t, 'dash', [['solid', 'Solid'], ['dashed', 'Dashed'], ['dotted', 'Dotted']]))}
            ${field(t, 'fill', 'Fill (closed)', color(t, 'fill'))}
        </div>`;
}

// ---------- Tabs ----------

function defaultsTab() {
    return `
        <p class="prop-hint">Every element that doesn't set a property itself (or through its style) uses these. An element can override any value in the properties panel; ↺ there returns it to the default.</p>
        ${TYPES.map(({ type, label }) => `
            <div class="settings-section-title">${label}</div>
            ${typeFields({ kind: 'default', type })}`).join('')}

        <div class="settings-section-title">Existing elements</div>
        <p class="prop-hint">Older projects store every value in each element, so they don't follow the defaults. This makes elements whose values are just the standard ones follow the defaults (and their style); values you changed on purpose are kept.</p>
        <button class="btn btn-secondary" data-settings-action="adopt">Use project defaults for existing elements</button>
        <div class="prop-hint settings-result">${escapeHtml(ui.message)}</div>`;
}

function stylesTab() {
    const names = styleNames(ui.styleType);
    if (ui.style && !names.includes(ui.style)) ui.style = null;
    if (!ui.style && names.length) ui.style = names[0];
    const typeTabs = TYPES.map(({ type, label }) => `
        <button type="button" class="seg${type === ui.styleType ? ' active' : ''}" data-style-type="${type}">${label}</button>`).join('');
    const list = names.map(name => {
        const n = styleUsage(ui.styleType, name);
        return `<button type="button" class="style-chip${name === ui.style ? ' active' : ''}" data-pick-style="${escapeHtml(name)}">
            ${escapeHtml(name)} <span class="style-count" title="Elements using it">${n}</span></button>`;
    }).join('');
    const editor = ui.style ? `
        <div class="style-editor">
            <div class="prop-row">
                <div class="prop-group">
                    <label>Name</label>
                    <input type="text" class="prop-control" data-rename-style value="${escapeHtml(ui.style)}" spellcheck="false">
                </div>
                <div class="prop-group style-delete">
                    <label>&nbsp;</label>
                    <button class="btn btn-secondary" data-settings-action="delete-style">Delete</button>
                </div>
            </div>
            <p class="prop-hint">Fields tagged <em>default</em> come from the project defaults; set one to make it part of the style.</p>
            ${typeFields({ kind: 'style', type: ui.styleType, name: ui.style })}
        </div>` : `<p class="prop-hint">No ${TYPES.find(t => t.type === ui.styleType).label.toLowerCase()} styles yet.</p>`;
    return `
        <p class="prop-hint">Named looks such as <em>Title</em> or <em>Caption</em>. Pick one for an element in the properties panel (Style); changing a style updates every element using it.</p>
        <div class="seg-row">${typeTabs}</div>
        <div class="style-list">${list}</div>
        <div class="prop-inline new-style">
            <input type="text" class="prop-control" data-new-style placeholder="New style name, e.g. title" spellcheck="false">
            <button class="btn btn-secondary" data-settings-action="new-style">＋ Add style</button>
        </div>
        <div class="prop-error">${escapeHtml(ui.message)}</div>
        ${editor}`;
}

function colorsTab() {
    const rows = palette().map((p, i) => {
        const n = paletteUsage(p.name);
        return `
            <div class="palette-row" data-index="${i}">
                <input type="color" value="${escapeHtml(p.color)}" data-palette-color title="Change the color">
                <input type="text" class="prop-control" value="${escapeHtml(p.name)}" data-palette-name spellcheck="false">
                <span class="palette-usage" title="Color properties using it">${n ? `${n} use${n === 1 ? '' : 's'}` : 'unused'}</span>
                <button type="button" class="prop-reset" data-palette-remove title="Remove (its uses keep the color)">✕</button>
            </div>`;
    }).join('');
    return `
        <p class="prop-hint">Theme colors are offered first by every color field. Elements refer to them by name (<code>@accent</code>), so changing a color here updates everything that uses it. Opacity is chosen per use, in the color field.</p>
        <div class="palette-list">${rows}</div>
        <button class="btn btn-secondary" data-settings-action="add-color">＋ Add color</button>
        <div class="prop-error">${escapeHtml(ui.message)}</div>`;
}

function datePreview(date) {
    return date
        ? `Shows as: <strong>${escapeHtml(formatDate(date))}</strong>`
        : '<code>today</code> always shows the current day; a date like 2026-03-14 is written out in full.';
}

/** Presentation tab: header values shown by the \author and \date fields. */
function presentationTab() {
    const date = state.date || '';
    return `
        <p class="prop-hint">Shown wherever a text box uses the field: <code>\\presentationtitle</code>, <code>\\author</code>, <code>\\date</code>
            (also <code>\\slidenumber</code>, <code>\\totalslides</code>, <code>\\slidetitle</code>, <code>\\sectiontitle</code>, <code>\\tableofcontents</code>).
            Fields ▾ in the toolbar adds them; typing <code>\\</code> in a text box suggests them.</p>
        <div class="prop-group">
            <label>Title</label>
            <input type="text" class="prop-control prop-readonly" disabled value="${escapeHtml(state.projectName || '')}" title="The project's name">
        </div>
        <div class="prop-group">
            <label for="project-author">Author</label>
            <input type="text" id="project-author" class="prop-control" data-project-field="author" value="${escapeHtml(state.author || '')}" placeholder="e.g. Ada Lovelace, University of London">
        </div>
        <div class="prop-group">
            <label for="project-date">Date</label>
            <div class="prop-inline">
                <input type="text" id="project-date" class="prop-control" data-project-field="date" value="${escapeHtml(date)}" placeholder="today, 2026-03-14, or any text">
                <button class="btn btn-secondary" data-settings-action="date-today" title="Always the current day">Today</button>
            </div>
            <p class="prop-hint" data-date-preview>${datePreview(date)}</p>
        </div>
        <div class="prop-group">
            <label for="project-equations">Display equations ($$…$$)</label>
            <select id="project-equations" class="prop-control" data-project-field="equations">
                <option value="center"${state.equations !== 'text' ? ' selected' : ''}>Centred, as in LaTeX</option>
                <option value="text"${state.equations === 'text' ? ' selected' : ''}>Aligned with the text (left in a left-aligned box)</option>
            </select>
        </div>`;
}

function bodyHtml() {
    const tabs = [['presentation', 'Presentation'], ['defaults', 'Defaults'], ['styles', 'Styles'], ['colors', 'Colors']].map(([id, label]) => `
        <button type="button" class="settings-tab${ui.tab === id ? ' active' : ''}" data-tab="${id}">${label}</button>`).join('');
    const content = ui.tab === 'styles' ? stylesTab() : ui.tab === 'colors' ? colorsTab()
        : ui.tab === 'presentation' ? presentationTab() : defaultsTab();
    return `
        <h2>Project settings</h2>
        <div class="settings-tabs">${tabs}</div>
        <div class="settings-content">${content}</div>
        <div class="modal-actions">
            <button class="btn btn-primary" data-settings-action="close">Done</button>
        </div>`;
}

// ---------- Behaviour ----------

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
    const box = m.querySelector('.project-settings');
    const scroll = box.querySelector('.settings-content')?.scrollTop || 0;
    box.innerHTML = bodyHtml();
    const content = box.querySelector('.settings-content');
    if (content) content.scrollTop = scroll;
    box.querySelectorAll('.font-license').forEach(b => showFontLicense(b.dataset.family, b));
    ui.message = '';
}

/** Applies a change to the project and redraws the slides. */
function commit({ redrawDialog = true } = {}) {
    markDirty();
    renderEditor();
    if (redrawDialog) render();
}

function setField(target, value) {
    if (target.dataset.default) {
        const [type, key] = target.dataset.default.split('.');
        setProjectDefault(type, key, value);
    } else if (target.dataset.styleField && ui.style) {
        setStyleValue(ui.styleType, ui.style, target.dataset.styleField, value);
    }
}

function addResetButton(control) {
    const label = control.closest('.prop-group')?.querySelector('label');
    if (!label || label.querySelector('[data-unset]')) return;
    label.querySelector('.prop-default-tag')?.remove();
    const key = control.dataset.default ? control.dataset.default.split('.')[1] : control.dataset.styleField;
    label.insertAdjacentHTML('beforeend', ` <button type="button" class="prop-reset" data-unset="${key}" title="Reset">↺</button>`);
}

function wire(m) {
    const onChange = (e) => {
        // Presentation tab: author / date. Never redrawn while typing or on
        // blur (a redraw would replace the button being clicked, e.g. Today).
        const field = e.target.closest('[data-project-field]');
        if (field) {
            if (e.type !== 'input') return;
            state[field.dataset.projectField] = field.value.trim();
            if (field.dataset.projectField === 'equations') document.documentElement.dataset.equations = state.equations;
            commit({ redrawDialog: false });
            const preview = m.querySelector('[data-date-preview]');
            if (preview && field.dataset.projectField === 'date') preview.innerHTML = datePreview(state.date);
            return;
        }
        const target = e.target.closest('[data-default], [data-style-field]');
        if (target) {
            const isChoice = target.tagName === 'SELECT' || target.classList.contains('color-field');
            if (e.type !== (isChoice ? 'change' : 'input')) return;
            let value = target.value;
            if (target.type === 'number') {
                if (value === '' || !Number.isFinite(Number(value))) return;
                value = Number(value);
            }
            setField(target, value);
            // Selects/colors redraw the dialog; typed values only gain their ↺
            // (a redraw would replace buttons under the mouse, e.g. Done).
            commit({ redrawDialog: isChoice });
            if (!isChoice) addResetButton(target);
            return;
        }
        // Colors tab: a palette color changed (live) or renamed (on change).
        const row = e.target.closest('.palette-row');
        if (row) {
            const i = Number(row.dataset.index);
            const entries = palette().map(p => ({ ...p }));
            if (e.target.matches('[data-palette-color]') && e.type === 'input') {
                entries[i].color = e.target.value;
                setPalette(entries);
                commit({ redrawDialog: false });
            }
            if (e.target.matches('[data-palette-name]') && e.type === 'change') {
                const name = e.target.value.trim();
                if (name === entries[i].name) return;
                if (!COLOR_NAME_RE.test(name) || entries.some(p => p.name === name)) {
                    ui.message = 'Color names use letters, digits, - or _ and must be unique.';
                } else {
                    renamePaletteColor(entries[i].name, name);
                }
                commit();
            }
            return;
        }
        if (e.target.matches('[data-rename-style]') && e.type === 'change') {
            const name = e.target.value.trim();
            if (name !== ui.style) {
                if (renameStyle(ui.styleType, ui.style, name)) ui.style = name;
                else ui.message = 'Style names use letters, digits, - or _ and must be unique.';
                commit();
            }
        }
    };
    m.addEventListener('input', onChange);
    m.addEventListener('change', onChange);

    m.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && e.target.matches('[data-new-style]')) {
            e.preventDefault();
            m.querySelector('[data-settings-action="new-style"]').click();
        }
    });

    m.addEventListener('click', (e) => {
        const tab = e.target.closest('[data-tab]');
        if (tab) {
            ui.tab = tab.dataset.tab;
            render();
            return;
        }
        const segment = e.target.closest('[data-style-type]');
        if (segment) {
            ui.styleType = segment.dataset.styleType;
            ui.style = null;
            render();
            return;
        }
        const pick = e.target.closest('[data-pick-style]');
        if (pick) {
            ui.style = pick.dataset.pickStyle;
            render();
            return;
        }
        const unset = e.target.closest('[data-unset]');
        if (unset) {
            const key = unset.dataset.unset;
            if (ui.tab === 'styles' && ui.style) setStyleValue(ui.styleType, ui.style, key, null);
            else {
                const control = unset.closest('.prop-group').querySelector('[data-default]');
                setProjectDefault(control.dataset.default.split('.')[0], key, null);
            }
            commit();
            return;
        }
        const lic = e.target.closest('[data-element-action="openFontLicense"]');
        if (lic) {
            const api = pyApi();
            if (api) api.open_url(lic.dataset.arg);
            return;
        }
        const remove = e.target.closest('[data-palette-remove]');
        if (remove) {
            const i = Number(remove.closest('.palette-row').dataset.index);
            removePaletteColor(palette()[i].name);
            commit();
            return;
        }
        const action = e.target.closest('[data-settings-action]');
        if (!action) {
            if (e.target === m) close(); // click on the backdrop
            return;
        }
        switch (action.dataset.settingsAction) {
        case 'close':
            close();
            break;
        case 'date-today':
            state.date = 'today';
            commit();
            break;
        case 'adopt': {
            const n = adoptDefaults();
            ui.message = n
                ? `${n} stored value${n === 1 ? '' : 's'} removed: those elements now follow the defaults.`
                : 'Nothing to change: elements already follow the defaults (or use their own values).';
            flashSaveIndicator('Elements follow the project defaults ✓');
            commit();
            break;
        }
        case 'new-style': {
            const input = m.querySelector('[data-new-style]');
            const name = (input.value || '').trim();
            if (!STYLE_NAME_RE.test(name)) ui.message = 'Style names use letters, digits, - or _ (starting with a letter).';
            else if (!createStyle(ui.styleType, name)) ui.message = `A style named "${name}" already exists.`;
            else ui.style = name;
            commit();
            break;
        }
        case 'delete-style':
            deleteStyle(ui.styleType, ui.style);
            ui.style = null;
            commit();
            break;
        case 'add-color': {
            const entries = palette().map(p => ({ ...p }));
            let i = entries.length + 1;
            while (entries.some(p => p.name === `color${i}`)) i++;
            entries.push({ name: `color${i}`, color: '#888888' });
            setPalette(entries);
            commit();
            break;
        }
        default:
            break;
        }
    });

    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && m.classList.contains('show') && !document.getElementById('color-popover')) close();
    });
}

/** Opens the dialog, optionally on a tab ('presentation' | 'defaults' | 'styles' | 'colors'), and a style. */
export function openProjectSettings(tab = null, { styleType = null, style = null } = {}) {
    if (typeof tab === 'string') ui.tab = tab;
    if (styleType) ui.styleType = styleType;
    if (style) ui.style = style;
    render();
    modal().classList.add('show');
}

function close() {
    modal().classList.remove('show');
}
