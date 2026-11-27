// ============================================================
// editor/editor.js — The editor manager.
// Supports single & multi-selection for slides and elements,
// slide drag-and-drop reordering, group dragging & arrow nudging,
// cut/copy/paste, and deletion.
// ============================================================

import { visualBox } from '../core/arrange.js';
import { updateAllConnectors, updateConnectors, isConnector, parseEnd, findTarget, anchor, formatEnd, SIDES } from '../core/connectors.js';
import {
    state,
    markDirty,
    flashSaveIndicator,
    getSelectedElementIndices,
    setSelectedElementIndices,
    getSelectedSlideIndices,
    setSelectedSlideIndices,
    allocateElementId,
    allocateSlideId,
    activeElements,
    activeGroup,
    activeGroupPath,
    setEditingGroup,
    currentSlide,
} from '../core/state.js';
import {
    masters, masterFor, isEditingMaster, editedMaster, slidesUsing,
    createMaster, renameMaster, deleteMaster, setSlideMaster,
} from '../core/masters.js';
import { ElementRegistry } from '../core/registry.js';
import {
    applyCommonBoxStyles,
    getGridSvgDataUri,
    updateDimensionsCSS,
    syncSlideSizeSelect,
    syncGridSizeSelect,
    escapeHtml,
    buildStaticElement,
} from '../core/render.js';
import { startDragOrResize, updateResizeCursor, gridSteps, snapToGridPoint } from '../core/geometry.js';
import { alignElements, distributeElements, reorderElements, canReorder, setLocked, isLocked } from '../core/arrange.js';
import { saveAndExitTextEditing } from '../elements/text/text.js';
import { beginCitationPass } from '../core/citations.js';
import { slideStepCount, elementStep, elementUntil, visibleAtStep } from '../core/steps.js';
import { withSlideContext, contextForSlide, invalidateNumbering, sectionNames } from '../core/fields.js';
import { initMarqueeSelection } from './marquee.js';
import './formatBar.js'; // bold / colour / highlight over selected words while editing text
import './textAutocomplete.js'; // \ and \cite{ suggestions while typing on the canvas
import { renderAddElementToolbar } from './toolbar.js';
import { initDrawingTools, startTool } from './tools.js';
import { makeMacroFromSelection, detachSelected, resetSelectedInstances } from './macroOps.js';
import { resetWorkingElement } from '../core/macros.js';
import { colorField } from '../ui/colorPicker.js';
import {
    withDefaults, forDrawing, withoutStyle, isStyleKey, inheritsKey, inheritedFrom,
    STYLE_KEYS, styleNames, getStyle, createStyle,
} from '../core/defaults.js';
import { createGroupFrame, groupScale } from '../elements/group/group.js';
import { enterGroup, exitGroup, groupSelection, ungroupSelection, isEditingGroup } from './groupOps.js';

const SLIDE_DRAG_THRESHOLD_PX = 5;

// ---------- Toolbar (built from the registry, left-to-right) ----------

export function renderToolbarButtons() {
    const container = document.querySelector('.editor-toolbar');
    if (container) renderAddElementToolbar(container, addElement);
}

// ---------- Element lifecycle ----------

/** Adds an element of `type`, optionally using one of its toolbar variants. */
export async function addElement(type, variantId = null) {
    if (!currentSlide()) return;
    const def = ElementRegistry.get(type);
    if (!def) {
        console.error(`No element registered for type '${type}'`);
        return;
    }
    // Variants that are drawn (lines, curves, freehand) start a tool instead.
    if (startTool(type, variantId)) return;

    // Variants that ask first (a CSV file, pasted cells); null cancels.
    const variant = variantId && Array.isArray(def.variants) ? def.variants.find(v => v.id === variantId) : null;
    let picked = {};
    if (variant && typeof variant.pick === 'function') {
        picked = await variant.pick();
        if (!picked || !currentSlide()) return;
    }

    const elements = activeElements(); // inside the group being edited, if any
    const stagger = elements.length * 30;
    const offset = isEditingGroup() ? 20 : 200;
    insertNewElement(def, variantId, { x: offset + stagger, y: offset + stagger, ...picked });
}

/** Adds an element of `type` with `props` (e.g. a pasted image), selected. */
export function insertElement(type, props) {
    const def = ElementRegistry.get(type);
    if (!def || !currentSlide()) return;
    insertNewElement(def, null, props);
}

/** Builds an element from defaults + variant preset + `props`, adds and selects it. */
function insertNewElement(def, variantId, props) {
    const variant = variantId && Array.isArray(def.variants)
        ? def.variants.find(v => v.id === variantId)
        : null;
    const preset = variant && typeof variant.preset === 'function'
        ? variant.preset(state.slideWidth / 1920)
        : (variant && variant.preset) || {};

    const el = {
        // Style values are inherited from the project defaults unless the
        // variant sets them (e.g. a dot's fill).
        ...withoutStyle(def.type, def.defaults({})),
        ...preset,
        // Placed variants (e.g. a slide number) keep their own position.
        ...(variant && variant.placed ? Object.fromEntries(Object.entries(props).filter(([k]) => k !== 'x' && k !== 'y')) : props),
        id: allocateElementId(), // stable, monotonic, never reused
    };

    const elements = activeElements();
    elements.push(el);
    setSelectedElementIndices([elements.length - 1], elements.length - 1);
    setSelectedSlideIndices([state.currentSlideIndex]);
    markDirty();
    renderEditor();
}

function updateProp(propName, value) {
    const elements = activeElements();
    const indices = getSelectedElementIndices();
    if (indices.length === 0) return;

    // Numeric if any selected element's type declares it numeric (its
    // .gl spec), or it is one of the common geometry/border props.
    const commonNumeric = ['x', 'y', 'width', 'height', 'fontSize', 'borderWidth', 'step', 'until', 'rotate'];
    const isNumeric = commonNumeric.includes(propName) || indices.some(idx => {
        const def = elements[idx] && ElementRegistry.get(elements[idx].type);
        return !!(def && def.gl && Array.isArray(def.gl.numericProps) && def.gl.numericProps.includes(propName));
    });
    const parsedVal = isNumeric ? Number(value) : value;

    // Proportion-locked elements: typing a width/height adjusts the other.
    if (propName === 'width' || propName === 'height') {
        indices.forEach(idx => {
            const e = elements[idx];
            if (!e || e.lockAspect !== 'yes' || !(parsedVal > 0) || !e.width || !e.height) return;
            if (propName === 'width') e.height = Math.round(e.height * (parsedVal / e.width) * 100) / 100;
            else e.width = Math.round(e.width * (parsedVal / e.height) * 100) / 100;
        });
    }

    const primaryIdx = (state.selectedElementIndex !== null && indices.includes(state.selectedElementIndex))
        ? state.selectedElementIndex
        : indices[0];
    const primaryEl = elements[primaryIdx];
    const prevVal = primaryEl ? primaryEl[propName] : undefined;

    if (propName === 'x' || propName === 'y') {
        const delta = Number(parsedVal) - Number(prevVal);
        indices.forEach(idx => {
            if (elements[idx]) {
                elements[idx][propName] = Number(elements[idx][propName]) + delta;
            }
        });
    } else {
        indices.forEach(idx => {
            if (!elements[idx]) return;
            // Step 1 (or empty) = visible from the start: not stored.
            if (propName === 'step' && !(parsedVal > 1)) delete elements[idx].step;
            // Rotation: kept between -180 and 180; none is not stored.
            else if (propName === 'rotate') {
                const a = ((Number(parsedVal) % 360) + 540) % 360 - 180;
                if (!a) delete elements[idx].rotate; else elements[idx].rotate = Math.round(a * 10) / 10;
            }
            // Disappears after: empty (or before it appears) = never.
            else if (propName === 'until' && !(parsedVal >= elementStep(elements[idx]))) delete elements[idx].until;
            else elements[idx][propName] = (propName === 'step' || propName === 'until') ? Math.round(parsedVal) : parsedVal;
        });
    }

    markDirty();
    renderCanvas();
    updateThumbnailLive();
}

/**
 * Marks style fields that come from the project defaults ("default")
 * and gives overridden ones a ↺ to go back to the default.
 */
/**
 * Puts a label's text in a span so it can shrink with an ellipsis,
 * keeping the label (and a tag / ↺ after it) on one line.
 */
function prepareLabel(label) {
    if (label.querySelector('.prop-label-text')) return;
    const span = document.createElement('span');
    span.className = 'prop-label-text';
    [...label.childNodes].filter(n => n.nodeType === Node.TEXT_NODE).forEach(n => span.appendChild(n));
    span.textContent = span.textContent.trim();
    span.title = span.textContent;
    label.prepend(span);
}

function markInheritedFields(panel, el) {
    panel.querySelectorAll('[data-prop]').forEach(control => {
        const key = control.dataset.prop;
        if (!isStyleKey(el.type, key)) return;
        const label = control.closest('.prop-group')?.querySelector('label');
        if (!label || label.querySelector('.prop-default-tag, .prop-reset')) return;
        prepareLabel(label);
        if (inheritsKey(el, key)) {
            // Where the value comes from: its style's name, or "default".
            const from = inheritedFrom(el, key);
            const title = from === 'default'
                ? 'From the project defaults (⚙ Project settings)'
                : `From the style "${from}"`;
            label.insertAdjacentHTML('beforeend',
                ` <span class="prop-default-tag${from === 'default' ? '' : ' from-style'}" title="${escapeHtml(title)}">${escapeHtml(from)}</span>`);
        } else {
            label.insertAdjacentHTML('beforeend',
                ` <button type="button" class="prop-reset" data-reset-prop="${key}" title="Use the project default">↺</button>`);
        }
    });
}

/** ↺ next to a field: the selected elements inherit that property again. */
function resetToDefault(key) {
    const elements = activeElements();
    getSelectedElementIndices().forEach(i => {
        if (elements[i]) delete elements[i][key];
    });
    markDirty();
    renderEditor();
}

/** Style picker for elements that have style properties. */
function styleSection(el) {
    if (!STYLE_KEYS[el.type]) return '';
    const names = styleNames(el.type);
    const current = el.style || '';
    const options = [`<option value="" ${current ? '' : 'selected'}>None (project defaults)</option>`,
        ...names.map(n => `<option value="${escapeHtml(n)}" ${n === current ? 'selected' : ''}>${escapeHtml(n)}</option>`)];
    if (current && !names.includes(current)) options.push(`<option value="${escapeHtml(current)}" selected>${escapeHtml(current)} (missing)</option>`);
    return `
        <div class="prop-group">
            <label>Style</label>
            <div class="prop-inline">
                <select class="prop-control" data-prop="style">${options.join('')}</select>
                <button class="btn btn-secondary" data-action="style-from-element"
                        title="New style from this element's look">＋</button>
                <button class="btn btn-secondary" data-action="manage-styles" title="Edit styles (Project settings)">✎</button>
            </div>
        </div>`;
}

/**
 * "＋" next to Style: a new style with the selected element's own style
 * values; the element then uses it (and stops storing those values).
 */
export function styleFromSelected() {
    const el = activeElements()[state.selectedElementIndex];
    if (!el || !STYLE_KEYS[el.type]) return false;
    const base = el.type === 'text' ? 'text-style' : `${el.type}-style`;
    let i = styleNames(el.type).length + 1;
    while (styleNames(el.type).includes(`${base}${i}`)) i++;
    const name = `${base}${i}`;
    const values = {};
    STYLE_KEYS[el.type].forEach(k => {
        if (el[k] !== undefined && el[k] !== '') {
            values[k] = el[k];
            delete el[k];
        }
    });
    // Values the element inherited from a previous style stay with it.
    const previous = el.style ? getStyle(el.type, el.style) : null;
    if (previous) Object.entries(previous).forEach(([k, v]) => { if (values[k] === undefined) values[k] = v; });
    createStyle(el.type, name, values);
    el.style = name;
    markDirty();
    renderEditor();
    document.dispatchEvent(new CustomEvent('open-project-settings', { detail: { tab: 'styles', styleType: el.type, style: name } }));
    return true;
}

/** "✎" next to Style: the Styles tab for this element's type/style. */
export function manageStyles() {
    const el = activeElements()[state.selectedElementIndex];
    if (!el) return false;
    document.dispatchEvent(new CustomEvent('open-project-settings', {
        detail: { tab: 'styles', styleType: el.type, style: el.style || null },
    }));
    return true;
}

/** Builds: the click at which the element appears while presenting. */
function stepSection(el) {
    return `
        <div class="prop-group">
            <label title="While presenting, the element appears after this many clicks on its slide (1 = shown from the start)">Appears at step</label>
            <input type="number" class="prop-control" min="1" step="1" value="${Number(el.step) > 1 ? Math.round(el.step) : 1}" data-prop="step">
        </div>
        <div class="prop-group">
            <label title="The last step it is shown at; after it the element disappears (empty: it stays to the end of the slide)">Disappears after step</label>
            <input type="number" class="prop-control" min="${elementStep(el)}" step="1" value="${elementUntil(el) ?? ''}" placeholder="never" data-prop="until">
        </div>`;
}

/** Shown when nothing is selected: the current slide's speaker notes. */
function slideSection(slide) {
    const steps = slideStepCount(slide);
    const names = sectionNames();
    return `
        <div class="prop-divider"></div>
        <div class="prop-group">
            <label for="slide-section" title="Typing here sets the section of this slide and of the following slides that were in the same section">Section (from this slide on)</label>
            <input type="text" id="slide-section" class="prop-control" list="slide-section-names" data-slide-prop="section"
                   value="${escapeHtml(slide.section || '')}" placeholder="none — e.g. Introduction" spellcheck="false">
            <datalist id="slide-section-names">${names.map(n => `<option value="${escapeHtml(n)}">`).join('')}</datalist>
        </div>
        ${slideMasterField(slide)}
        <div class="prop-group">
            <label for="slide-notes">Speaker notes</label>
            <textarea id="slide-notes" class="prop-control slide-notes" rows="8" data-slide-prop="notes"
                      placeholder="Only you see these, in the presenter view.">${escapeHtml(slide.notes || '')}</textarea>
        </div>
        <p class="prop-hint">${steps > 1
            ? `This slide builds up in ${steps} steps (set an object's <strong>Appears at step</strong> and <strong>Disappears after step</strong>; <strong>Steps</strong> in the toolbar shows one of them).`
            : 'To reveal objects one click at a time, select one and set <strong>Appears at step</strong>.'}</p>`;
}

// ---------- Master slides ----------

/** Slide panel: which master the slide shows, and editing it. */
function slideMasterField(slide) {
    const list = masters();
    if (!list.length) {
        return `
        <div class="prop-group">
            <label>Master slide</label>
            <button class="btn btn-secondary" data-action="edit-master" style="width: 100%;" title="Elements on the master appear on every slide: background, logo, footer, slide number">▦ Create a master slide</button>
        </div>`;
    }
    const current = slide.master === 'none' ? 'none' : (masterFor(slide) || list[0]).name;
    const options = list.map((m, i) => `<option value="${escapeHtml(m.name)}" ${m.name === current ? 'selected' : ''}>${escapeHtml(m.name)}${i === 0 ? ' (default)' : ''}</option>`).join('')
        + `<option value="none" ${current === 'none' ? 'selected' : ''}>None</option>`;
    return `
        <div class="prop-group">
            <label for="slide-master">Master slide</label>
            <div class="prop-inline">
                <select id="slide-master" class="prop-control" data-slide-prop="master">${options}</select>
                <button class="btn btn-secondary" data-action="edit-master" title="Edit this master (it appears on every slide using it)" ${current === 'none' ? 'disabled' : ''}>✎ Edit</button>
                <button class="btn btn-secondary" data-action="new-master" title="New master slide">＋</button>
            </div>
        </div>`;
}

function masterBanner() {
    const m = editedMaster();
    const n = slidesUsing(m);
    return `
        <div class="group-banner master-banner">
            <span>Editing master <strong>${escapeHtml(m.name)}</strong> — shown on <strong>${n} slide${n === 1 ? '' : 's'}</strong>. Fields like <code>\\slidenumber</code> show each slide's value.</span>
            <button class="btn btn-secondary" data-action="exit-master">Done (Esc)</button>
        </div>`;
}

/** Panel while editing a master with nothing selected. */
function masterSection() {
    const m = editedMaster();
    return `
        <div class="prop-divider"></div>
        <div class="prop-group">
            <label for="master-name">Master name</label>
            <input type="text" id="master-name" class="prop-control" data-master-prop="name" value="${escapeHtml(m.name)}" spellcheck="false">
            <div class="prop-error" id="master-error"></div>
        </div>
        <p class="prop-hint">Add a background, logo or footer here (Fields ▾ has slide numbers and footers). Slides choose their master in the panel (with no object selected); the first master is the default.</p>
        <button class="btn btn-secondary" data-action="delete-master" style="width: 100%;">🗑 Delete this master</button>`;
}

/** Edits the master of the current slide (creating the first one if needed). */
export function editMaster() {
    const slide = state.slides[state.currentSlideIndex];
    if (!masters().length) createMaster();
    const m = masterFor(slide) || masters()[0];
    setEditingGroup(null);
    state.editingMasterIndex = masters().indexOf(m);
    setSelectedElementIndices([], null);
    markDirty();
    renderEditor();
    return true;
}

/** A new master, used by the current slide, opened for editing. */
export function newMaster() {
    const idx = createMaster();
    const slide = state.slides[state.currentSlideIndex];
    setSlideMaster(slide, masters()[idx].name);
    setEditingGroup(null);
    state.editingMasterIndex = idx;
    setSelectedElementIndices([], null);
    markDirty();
    renderEditor();
    return true;
}

/** Leaves master editing (Esc / Done). Returns false when not editing one. */
export function leaveMaster() {
    if (!isEditingMaster()) return false;
    setEditingGroup(null);
    state.editingMasterIndex = null;
    setSelectedElementIndices([], null);
    renderEditor();
    return true;
}

export function deleteEditedMaster() {
    if (!isEditingMaster()) return false;
    deleteMaster(state.editingMasterIndex);
    state.editingMasterIndex = null;
    setSelectedElementIndices([], null);
    markDirty();
    renderEditor();
    flashSaveIndicator('Master deleted ✓');
    return true;
}


/** "Make macro" field shown under any selection. */
function makeMacroSection() {
    return `
        <div class="prop-divider"></div>
        <div class="prop-group">
            <label>Make Macro</label>
            <div class="prop-inline">
                <input type="text" id="make-macro-name" class="prop-control" placeholder="name, e.g. card" spellcheck="false">
                <button class="btn btn-secondary" data-action="make-macro">🧩 Create</button>
            </div>
            <div class="prop-error" id="make-macro-error"></div>
            <p class="prop-hint">Saves the selection to macros.gl and replaces it with a reusable instance (Macros menu).</p>
        </div>`;
}

/** Make-macro button / Enter in its name field. */
export async function makeMacroFromPanel() {
    const input = document.getElementById('make-macro-name');
    const res = await makeMacroFromSelection(input ? input.value : '');
    if (!res.success) {
        const err = document.getElementById('make-macro-error');
        if (err) err.textContent = res.error;
        return false;
    }
    renderEditor();
    return true;
}

export function detachSelectedMacros() {
    if (!detachSelected()) return false;
    renderEditor();
    return true;
}

// ---------- Properties panel events ----------
// Controls in the panel HTML carry data-prop="<property>"; buttons that
// run element-specific code carry data-element-action="<action>" (with
// an optional data-arg) and are dispatched through the element's
// `actions` (see core/registry.js). No inline handlers, no globals.

const propertiesPanel = document.getElementById('properties-body');

function onPropertyControl(e) {
    const control = e.target;
    if (!control.dataset || !control.dataset.prop) return;
    // Dropdowns, checkboxes and color fields apply on change (then the
    // panel is redrawn, since they can enable/disable other fields);
    // text/number inputs apply live while typing.
    const isChoice = control.tagName === 'SELECT' || control.type === 'checkbox' || control.classList.contains('color-field');
    if (e.type !== (isChoice ? 'change' : 'input')) return;
    const value = control.type === 'checkbox' ? (control.checked ? 'yes' : 'no') : control.value;
    updateProp(control.dataset.prop, value);
    if (isChoice) {
        renderPropertiesPanel();
    } else {
        // Inside a macro: refresh "Overridden here" without stealing focus.
        const info = document.getElementById('macro-child-info');
        const group = activeGroup();
        const el = activeElements()[state.selectedElementIndex];
        if (info && group && el) info.innerHTML = macroChildInfo(group, el);
        // The field now overrides the project default: show its ↺.
        if (el && isStyleKey(el.type, control.dataset.prop)) {
            const label = control.closest('.prop-group')?.querySelector('label');
            if (label && !label.querySelector('.prop-reset')) {
                prepareLabel(label);
                label.querySelector('.prop-default-tag')?.remove();
                label.insertAdjacentHTML('beforeend',
                    ` <button type="button" class="prop-reset" data-reset-prop="${control.dataset.prop}" title="Use the project default">↺</button>`);
            }
        }
    }
}
propertiesPanel.addEventListener('input', onPropertyControl);
// Slide-level fields (speaker notes) while nothing is selected.
propertiesPanel.addEventListener('input', (e) => {
    const key = e.target.dataset && e.target.dataset.slideProp;
    const slide = state.slides[state.currentSlideIndex];
    if (!key || !slide || key === 'master') return;
    if (key === 'section') {
        setSectionFrom(state.currentSlideIndex, e.target.value.trim());
        markDirty();
        renderThumbnailSectionHeaders();
        return;
    }
    if (e.target.value.trim() === '') delete slide[key];
    else slide[key] = e.target.value;
    markDirty();
});

/**
 * Sections are runs of slides (.section in the file). Setting one on a
 * slide changes it for that slide and the following slides that were
 * in the same section, i.e. "a new section starts here" / renaming.
 */
function setSectionFrom(index, name) {
    const old = state.slides[index].section || '';
    for (let i = index; i < state.slides.length && (state.slides[i].section || '') === old; i++) {
        if (name) state.slides[i].section = name;
        else delete state.slides[i].section;
    }
}
propertiesPanel.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && e.target.id === 'make-macro-name') {
        e.preventDefault();
        makeMacroFromPanel();
    }
});
propertiesPanel.addEventListener('change', onPropertyControl);
// Master slides: renaming the master, choosing a slide's master.
propertiesPanel.addEventListener('change', (e) => {
    if (e.target.dataset && e.target.dataset.masterProp === 'name') {
        if (renameMaster(state.editingMasterIndex, e.target.value)) {
            markDirty();
            renderEditor();
        } else {
            const err = document.getElementById('master-error');
            if (err) err.textContent = 'Master names must be unique (and not "none").';
        }
    }
    if (e.target.dataset && e.target.dataset.slideProp === 'master') {
        setSlideMaster(state.slides[state.currentSlideIndex], e.target.value);
        markDirty();
        renderEditor();
    }
});

propertiesPanel.addEventListener('click', (e) => {
    const reset = e.target.closest('[data-reset-prop]');
    if (reset) {
        resetToDefault(reset.dataset.resetProp);
        return;
    }
    const btn = e.target.closest('[data-element-action]');
    if (!btn) return;
    const elIndex = state.selectedElementIndex;
    const el = elIndex !== null ? activeElements()[elIndex] : null;
    if (!el) return;
    const result = ElementRegistry.callAction(el.type, btn.dataset.elementAction, elIndex, btn.dataset.arg, el);
    // Synchronous actions edit `el` directly; async ones save themselves.
    if (!(result instanceof Promise)) {
        markDirty();
        renderEditor();
    }
});

export function moveSelectedElementsByArrow(key, altKey = false) {
    const elements = activeElements();
    const indices = getSelectedElementIndices();
    if (indices.length === 0) return false;

    const { stepX, stepY } = gridSteps();
    const baseStepX = altKey ? 1 : (state.gridSize > 0 ? stepX : 10);
    const baseStepY = altKey ? 1 : (state.gridSize > 0 ? stepY : 10);

    let dx = 0;
    let dy = 0;
    if (key === 'ArrowLeft') dx = -baseStepX;
    else if (key === 'ArrowRight') dx = baseStepX;
    else if (key === 'ArrowUp') dy = -baseStepY;
    else if (key === 'ArrowDown') dy = baseStepY;
    else return false;

    indices.forEach(idx => {
        const el = elements[idx];
        if (!el || isLocked(el)) return;
        let nextX = el.x + dx;
        let nextY = el.y + dy;
        if (!altKey && state.gridSize > 0) {
            nextX = snapToGridPoint(nextX, stepX);
            nextY = snapToGridPoint(nextY, stepY);
        }
        el.x = nextX;
        el.y = nextY;
    });

    markDirty();
    renderCanvas();
    renderPropertiesPanel();
    updateThumbnailLive();
    return true;
}

export function deleteSelectedElements(showFlash = false) {
    const elements = activeElements();
    const indices = getSelectedElementIndices();
    if (indices.length === 0) return false;

    const toRemove = new Set(indices);
    // In place, so a group's children array keeps its identity.
    const kept = elements.filter((_, idx) => !toRemove.has(idx));
    elements.splice(0, elements.length, ...kept);
    setSelectedElementIndices([], null);
    markDirty();
    renderEditor();
    if (showFlash) {
        flashSaveIndicator(indices.length > 1 ? `${indices.length} objects removed ✓` : 'Object removed ✓');
    }
    return true;
}

// ---------- Thumbnails ----------

function buildThumbElement(el) {
    return buildStaticElement(el, 'thumb-element');
}

/** What a slide's thumbnail draws: its master's elements, then its own. */
function thumbElementsOf(slide) {
    const master = masterFor(slide);
    return [...(master ? master.elements : []), ...(slide ? slide.elements : [])];
}

export function updateThumbnailLive() {
    if (isEditingMaster()) return; // the slides' thumbnails update when leaving the master
    const activeContainer = document.querySelectorAll('.thumb-container')[state.currentSlideIndex];
    if (!activeContainer) return;
    const scaler = activeContainer.querySelector('.thumb-canvas-scaler');
    if (!scaler) return;

    scaler.innerHTML = '';
    const slide = state.slides[state.currentSlideIndex];
    withSlideContext(contextForSlide(state.currentSlideIndex), () => {
        thumbElementsOf(slide).forEach(el => scaler.appendChild(buildThumbElement(el)));
    });
}

function updateSlideTitleInput() {
    const input = document.getElementById('slide-title-input');
    if (!input) return;
    const slide = state.slides[state.currentSlideIndex];
    const desired = slide ? (slide.title || '') : '';
    if (document.activeElement !== input && input.value !== desired) {
        input.value = desired;
    }
}

function updateThumbLabels() {
    document.querySelectorAll('.thumb-container').forEach((container, idx) => {
        const slide = state.slides[idx];
        const labelRow = container.querySelector('.thumb-label-row');
        if (slide && labelRow) {
            labelRow.innerHTML = `<span>${escapeHtml(slide.title)}</span><span>${idx + 1}</span>`;
        }
    });
}

export function renameCurrentSlide(value) {
    const slide = state.slides[state.currentSlideIndex];
    if (!slide) return;
    slide.title = value;
    markDirty();
    updateThumbLabels();
}

// ---------- Canvas ----------

// ---------- Fitting the canvas and thumbnails to their space ----------

const FIT_MARGIN = 28;

/** Scales the canvas to fit the workspace (window size, panes shown or hidden). */
export function fitCanvas() {
    const ws = document.getElementById('workspace-area');
    const canvas = document.getElementById('slide-canvas');
    if (!ws || !canvas || !ws.clientWidth) return;
    const s = Math.max(0.05, Math.min(1.5, Math.min((ws.clientWidth - 2 * FIT_MARGIN) / state.slideWidth,
        (ws.clientHeight - 2 * FIT_MARGIN) / state.slideHeight)));
    canvas.style.setProperty('--canvas-scale', String(s));
    canvas.style.left = `${Math.round((ws.clientWidth - state.slideWidth * s) / 2)}px`;
    canvas.style.top = `${Math.round((ws.clientHeight - state.slideHeight * s) / 2)}px`;
}

/** Each thumbnail's content scaled to the thumbnail's width (any slide size). */
export function fitThumbnails() {
    const thumb = document.querySelector('#slides-thumb-list .slide-thumb');
    if (!thumb || !thumb.clientWidth) return;
    document.getElementById('slides-thumb-list').style.setProperty('--thumb-scale', String(thumb.clientWidth / state.slideWidth));
}

let fitObserver = null;
function watchSizes() {
    if (fitObserver || typeof ResizeObserver === 'undefined') return;
    fitObserver = new ResizeObserver(() => { fitCanvas(); fitThumbnails(); });
    ['workspace-area', 'slides-thumb-list'].forEach(id => { const n = document.getElementById(id); if (n) fitObserver.observe(n); });
}

function renderCanvas() {
    updateAllConnectors(); // a moved / turned shape: its lines follow
    watchSizes();
    updateStepPreview();
    const canvas = document.getElementById('slide-canvas');
    canvas.innerHTML = '';

    gridSteps();

    // The slide's size, always (a stale size stayed when the grid was off).
    canvas.style.width = `${state.slideWidth}px`;
    canvas.style.height = `${state.slideHeight}px`;
    if (state.gridSize > 0) {
        canvas.style.backgroundImage = getGridSvgDataUri(state.slideWidth, state.slideHeight, state.gridSize, state.isDarkMode);
        canvas.style.backgroundSize = '100% 100%';
        canvas.style.backgroundPosition = '0px 0px';
    } else {
        canvas.style.backgroundImage = 'none';
    }
    fitCanvas();

    const slide = currentSlide(); // a slide, or the master being edited
    canvas.classList.toggle('editing-master', isEditingMaster());
    if (!slide) return;

    // The slide's master underneath: drawn, not editable here.
    const master = !isEditingMaster() && masterFor(slide);
    if (master) {
        master.elements.forEach(el => {
            const node = buildStaticElement(el, 'canvas-element master-element');
            node.dataset.masterElement = String(el.id);
            canvas.appendChild(node);
        });
    }

    // Elements along the path to the edited group are drawn as open
    // shells; the edited group's children are interactive; everything
    // else is drawn static and dimmed.
    renderLevel(canvas, slide.elements, activeGroupPath(), 0);
}

/** The DOM container holding the interactive elements (canvas or group frame). */
export function activeContainer() {
    return document.querySelector('.group-entered > .group-frame') || document.getElementById('slide-canvas');
}

function renderLevel(container, elements, path, depth) {
    if (depth === path.length) {
        renderInteractiveElements(container, elements);
        return;
    }
    const open = path[depth];
    elements.forEach(el => {
        if (el !== open) {
            container.appendChild(buildStaticElement(el, 'canvas-element outside-group'));
            return;
        }
        const shell = document.createElement('div');
        shell.className = 'canvas-element element-group group-entered';
        applyCommonBoxStyles(shell, forDrawing(el));
        const frame = createGroupFrame(el);
        shell.appendChild(frame);
        container.appendChild(shell);
        renderLevel(frame, el.children, path, depth + 1);
    });
}

// ---------- Element handles (path points / corners) ----------

/**
 * Draws the element's handles (def.handles) and wires dragging them
 * (def.dragHandle). Double-clicking a point handle removes the point.
 */
function appendHandles(container, domEl, el, def, elIndex) {
    const rect = container.getBoundingClientRect();
    const unit = (container.offsetWidth || 1) / (rect.width || 1); // container units per screen px

    const paint = () => {
        domEl.querySelectorAll('.el-handle').forEach(h => h.remove());
        def.handles(el).forEach(h => {
            const node = document.createElement('div');
            node.className = `el-handle el-handle-${h.kind}`;
            node.dataset.handle = h.id;
            node.style.left = `${h.x}px`;
            node.style.top = `${h.y}px`;
            node.style.setProperty('--handle-size', `${12 * unit}px`);
            node.addEventListener('mousedown', (e) => startHandleDrag(e, h.id));
            if (h.kind === 'point' && typeof def.removePoint === 'function') {
                node.addEventListener('dblclick', (e) => {
                    e.stopPropagation();
                    if (def.removePoint(el, Number(h.id.slice(1)))) {
                        markDirty();
                        renderEditor();
                    }
                });
            }
            domEl.appendChild(node);
        });
    };

    const repaint = () => {
        const view = forDrawing(el);
        applyCommonBoxStyles(domEl, view);
        def.renderDom(domEl, view, { context: 'canvas', elIndex });
        paint();
    };

    function startHandleDrag(e, id) {
        if (e.button !== 0) return;
        e.preventDefault();
        e.stopPropagation();
        const start = { x: el.x, y: el.y, width: el.width, height: el.height };
        const { stepX, stepY } = gridSteps();
        let moved = false;
        // A line's end can be attached to a shape: dropped on one of its anchors.
        const endKey = el.type === 'path' && el.closed !== 'yes' ? lineEndKey(el, id) : null;
        let snap = null;
        const onMove = (m) => {
            const r = container.getBoundingClientRect();
            let px = Math.round((m.clientX - r.left) * ((container.offsetWidth || 1) / (r.width || 1)));
            let py = Math.round((m.clientY - r.top) * ((container.offsetHeight || 1) / (r.height || 1)));
            if (!m.altKey && !m.shiftKey && state.gridSize > 0) {
                px = snapToGridPoint(px, stepX);
                py = snapToGridPoint(py, stepY);
            }
            if (endKey && !m.altKey) {
                snap = anchorUnder(activeElements(), el, px, py, container);
                if (snap) [px, py] = snap.point;
            } else {
                snap = null;
                clearAnchorDots(container);
            }
            moved = true;
            def.dragHandle(el, id, px, py, { shiftKey: m.shiftKey, start });
            repaint();
        };
        const onUp = () => {
            window.removeEventListener('mousemove', onMove);
            window.removeEventListener('mouseup', onUp);
            clearAnchorDots(container);
            if (moved && endKey) {
                if (snap) el[endKey] = formatEnd(snap.target, snap.side, activeElements());
                else delete el[endKey];
                if (!el.from && !el.to) delete el.route;
            }
            if (moved) {
                markDirty();
                renderEditor();
            }
        };
        window.addEventListener('mousemove', onMove);
        window.addEventListener('mouseup', onUp);
    }

    paint();
}

/**
 * What a drag can line up with (core/geometry.js smart guides): the other
 * objects at this level, the master's objects on a slide, and the
 * slide (or group frame) itself.
 */
function guideTargets(container, elements, movingIndices) {
    const moving = new Set(movingIndices);
    const targets = elements.filter((el, i) => !moving.has(i) && el.hidden !== 'yes');
    if (!activeGroup() && !isEditingMaster()) {
        const m = masterFor(currentSlide());
        if (m) targets.push(...(m.elements || []));
    }
    return {
        targets: targets.map(el => visualBox(el)), // turned elements: the box they cover
        frame: { width: container.offsetWidth || state.slideWidth, height: container.offsetHeight || state.slideHeight },
    };
}

// ---------- Rotating ----------

/** Dragging the round handle: the element turns about its centre (paths: their points). */
function startRotate(e, el, domEl, container) {
    if (e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();
    const r = domEl.getBoundingClientRect();
    const cx = r.left + r.width / 2;
    const cy = r.top + r.height / 2;
    const isPath = el.type === 'path';
    const startAngle = Math.atan2(e.clientY - cy, e.clientX - cx) * 180 / Math.PI;
    const startRot = Number(el.rotate) || 0;
    const startPts = isPath ? (el.points || []).map(([fx, fy]) => [el.x + fx * el.width, el.y + fy * el.height]) : null;
    let moved = false;
    const onMove = (m) => {
        const now = Math.atan2(m.clientY - cy, m.clientX - cx) * 180 / Math.PI;
        let a = startRot + (now - startAngle);
        if (m.shiftKey) a = Math.round(a / 15) * 15;
        else {
            const right = Math.round(a / 90) * 90;
            if (Math.abs(a - right) < 3) a = right; // square angles stick
        }
        a = ((a % 360) + 540) % 360 - 180;
        moved = true;
        if (isPath) {
            // a line turns its points about the box's centre
            const ox = el.x + el.width / 2;
            const oy = el.y + el.height / 2;
            const t = (a - startRot) * Math.PI / 180;
            const pts = startPts.map(([x, y]) => [ox + (x - ox) * Math.cos(t) - (y - oy) * Math.sin(t), oy + (x - ox) * Math.sin(t) + (y - oy) * Math.cos(t)]);
            const def = ElementRegistry.get('path');
            const xs = pts.map(p => p[0]), ys = pts.map(p => p[1]);
            const x0 = Math.min(...xs), y0 = Math.min(...ys);
            const w = Math.max(1, Math.max(...xs) - x0), h = Math.max(1, Math.max(...ys) - y0);
            Object.assign(el, { x: x0, y: y0, width: w, height: h, points: pts.map(([x, y]) => [(x - x0) / w, (y - y0) / h]) });
            applyCommonBoxStyles(domEl, forDrawing(el));
            def.renderDom(domEl, forDrawing(el), { context: 'canvas', elIndex: -1 });
        } else {
            el.rotate = Math.round(a * 10) / 10;
            domEl.style.transform = el.rotate ? `rotate(${el.rotate}deg)` : '';
            refreshConnectorsLive(container, activeElements());
        }
        const field = document.querySelector('[data-prop="rotate"]');
        if (field) field.value = isPath ? '' : el.rotate;
    };
    const onUp = () => {
        window.removeEventListener('mousemove', onMove);
        window.removeEventListener('mouseup', onUp);
        if (!moved) return;
        if (!isPath && !el.rotate) delete el.rotate;
        markDirty();
        renderEditor();
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
}

// ---------- Attaching lines to shapes (core/connectors.js) ----------

const ANCHOR_SIDES = ['top', 'right', 'bottom', 'left', 'center'];

/** 'from' / 'to' when handle `id` is the first / last point of an open path. */
function lineEndKey(el, id) {
    if (!/^p\d+$/.test(id)) return null;
    const i = Number(id.slice(1));
    const n = (el.points || []).length;
    return i === 0 ? 'from' : (i === n - 1 ? 'to' : null);
}

/** The shape under (px, py) and its anchor nearest to it ({ target, side, point }), dots shown. */
function anchorUnder(elements, self, px, py, container) {
    const slack = 24 * ((container.offsetWidth || 1) / (container.getBoundingClientRect().width || 1)) / 2;
    let best = null;
    for (const el of elements) {
        if (el === self || el.type === 'path' || isLocked(el)) continue;
        const box = findTarget(elements, { id: el.id, side: 'auto' });
        if (!box || px < box.x - slack || px > box.x + box.width + slack || py < box.y - slack || py > box.y + box.height + slack) continue;
        for (const side of ANCHOR_SIDES) {
            const a = anchor(box, side);
            const d = Math.hypot(a.point[0] - px, a.point[1] - py);
            if (!best || d < best.d) best = { target: el, box, side, point: a.point, d };
        }
    }
    showAnchorDots(container, best);
    return best;
}

function clearAnchorDots(container) {
    container.querySelectorAll(':scope > .anchor-dot').forEach(n => n.remove());
}

function showAnchorDots(container, best) {
    clearAnchorDots(container);
    if (!best) return;
    const unit = (container.offsetWidth || 1) / (container.getBoundingClientRect().width || 1);
    ANCHOR_SIDES.forEach(side => {
        const [x, y] = anchor(best.box, side).point;
        const dot = document.createElement('div');
        dot.className = `anchor-dot${side === best.side ? ' active' : ''}`;
        dot.style.left = `${x}px`;
        dot.style.top = `${y}px`;
        dot.style.setProperty('--ui-unit', String(unit));
        container.appendChild(dot);
    });
}

/** A line just drawn: ends that start or stop on a shape attach to it (side facing the other end). */
export function attachDrawnLine(el, elements) {
    if (el.type !== 'path' || el.closed === 'yes' || (el.points || []).length !== 2) return;
    const pts = el.points.map(([fx, fy]) => [el.x + fx * el.width, el.y + fy * el.height]);
    ['from', 'to'].forEach((key, i) => {
        const [px, py] = pts[i];
        const hit = [...elements].reverse().find(t => t !== el && t.type !== 'path' && !isLocked(t)
            && px >= t.x && px <= t.x + t.width && py >= t.y && py <= t.y + t.height);
        if (hit) el[key] = formatEnd(hit, 'auto', elements);
    });
    if (el.from || el.to) updateConnectors(elements);
}

/** While dragging: connectors attached to what moves are redrawn at once. */
function refreshConnectorsLive(container, elements) {
    updateConnectors(elements).forEach(conn => {
        const node = container.querySelector(`:scope > [data-element-id="${conn.id}"]`);
        const def = ElementRegistry.get('path');
        if (!node || !def) return;
        const view = forDrawing(conn);
        applyCommonBoxStyles(node, view);
        def.renderDom(node, view, { context: 'canvas', elIndex: elements.indexOf(conn) });
    });
}

/** A connector dragged away from its shapes: its ends come loose (unless they moved with it). */
function detachMovedConnector(el, elements) {
    const moved = new Set(getSelectedElementIndices().map(i => elements[i]).filter(Boolean));
    for (const key of ['from', 'to']) {
        const end = parseEnd(el[key]);
        const target = end && findTarget(elements, end, el);
        if (end && !(target && moved.has(target.el))) delete el[key];
    }
}

function renderInteractiveElements(container, elements) {
    const selectedSet = new Set(getSelectedElementIndices());
    // Canvas units per screen pixel, so UI marks (step badges) keep their size.
    const rect = container.getBoundingClientRect();
    container.style.setProperty('--ui-unit', String((container.offsetWidth || 1) / (rect.width || 1)));
    const renderedItems = [];

    elements.forEach((el, elIndex) => {
        const def = ElementRegistry.get(el.type);
        const domEl = document.createElement('div');
        domEl.className = `canvas-element ${def ? def.className : 'element-shape'}`;
        domEl.dataset.elementId = String(el.id);
        if (selectedSet.has(elIndex)) {
            domEl.classList.add('selected');
        }
        if (!activeGroup()) {
            const from = elementStep(el), until = elementUntil(el);
            if (from > 1 || until !== null) domEl.dataset.stepLabel = until !== null ? (until > from ? `${from}–${until}` : `${from} only`) : String(from);
            // Step preview (toolbar): what isn't shown at that step is hidden here too.
            if (state.previewStep && !visibleAtStep(el, state.previewStep)) domEl.classList.add('step-preview-hidden');
        }
        const locked = isLocked(el);
        if (locked) domEl.classList.add('locked');

        // Drawn with defaults/style filled in and colors resolved;
        // geometry edits use `el`.
        const view = forDrawing(el);
        applyCommonBoxStyles(domEl, view);

        if (def) {
            def.renderDom(domEl, view, { context: 'canvas', elIndex });
        }

        // Elements with handles (paths) are reshaped with those, not box edges.
        const boxResize = !def || def.boxResize !== false;
        if (!locked && def && typeof def.handles === 'function' && selectedSet.size === 1 && selectedSet.has(elIndex)) {
            appendHandles(container, domEl, el, def, elIndex);
        }

        // A round handle above a single selected element turns it (paths: their points).
        if (!locked && selectedSet.size === 1 && selectedSet.has(elIndex) && !domEl.classList.contains('editing-mode')) {
            const knob = document.createElement('div');
            knob.className = 'rotate-handle';
            knob.title = 'Drag to rotate (Shift: 15° steps)';
            knob.addEventListener('mousedown', (e) => startRotate(e, el, domEl, container));
            domEl.appendChild(knob);
        }

        renderedItems.push({ el, domEl, elIndex });

        domEl.onmousemove = (e) => {
            if (domEl.classList.contains('editing-mode') || !boxResize) return;
            if (locked) { domEl.style.cursor = 'default'; return; }
            updateResizeCursor(domEl, el, e);
        };

        const dragCallbacks = {
            onGeometryChanged() {
                refreshConnectorsLive(container, elements);
                if (el.type === 'group') {
                    // Rescale the contents live while the group is resized.
                    const frame = container.querySelector(`:scope > [data-element-id="${el.id}"] > .group-frame`);
                    const { sx, sy } = groupScale(el);
                    if (frame) frame.style.transform = `scale(${sx}, ${sy})`;
                }
                const xInput = document.getElementById('prop-x');
                const yInput = document.getElementById('prop-y');
                if (xInput) xInput.value = Math.round(el.x);
                if (yInput) yInput.value = Math.round(el.y);
            },
            onFinish(hasDragged, isResizing) {
                // A connector moved on its own (not with its shapes) comes loose.
                if (hasDragged && !isResizing && isConnector(el)) detachMovedConnector(el, elements);
                if (hasDragged) markDirty();
                renderPropertiesPanel();
                if (hasDragged) {
                    renderEditor();
                }
            },
        };

        domEl.onmousedown = (e) => {
            if (domEl.classList.contains('editing-mode')) return;
            if (e.button !== 0) return;
            // Locked: no dragging. The press goes on to the canvas, so a drag
            // selects with a rectangle; a click selects it (see the click handler).
            if (locked) return;
            e.stopPropagation();

            const multiToggle = e.ctrlKey || e.metaKey;
            let currentSelected = getSelectedElementIndices();

            if (multiToggle) {
                if (currentSelected.includes(elIndex)) {
                    currentSelected = currentSelected.filter(i => i !== elIndex);
                    const nextPrimary = currentSelected.length > 0 ? currentSelected[currentSelected.length - 1] : null;
                    setSelectedElementIndices(currentSelected, nextPrimary);
                } else {
                    setSelectedElementIndices([...currentSelected, elIndex], elIndex);
                }
                renderCanvas();
                renderPropertiesPanel();
                return;
            }

            if (!currentSelected.includes(elIndex)) {
                setSelectedElementIndices([elIndex], elIndex);
                renderCanvas();
                renderPropertiesPanel();
                const freshDom = activeContainer().querySelector(`:scope > [data-element-id="${el.id}"]`);
                if (!freshDom) return;
                startDragOrResize(freshDom, el, e, dragCallbacks, null, { allowResize: boxResize, guides: guideTargets(container, elements, [elIndex]) });
                return;
            }

            state.selectedElementIndex = elIndex;
            const groupItems = renderedItems
                .filter(item => getSelectedElementIndices().includes(item.elIndex))
                .map(item => ({ el: item.el, domEl: item.domEl }));

            startDragOrResize(domEl, el, e, dragCallbacks, groupItems, { allowResize: boxResize, guides: guideTargets(container, elements, getSelectedElementIndices()) });
        };

        container.appendChild(domEl);
    });
}

// Canvas background click clears element selection so slide is active.
// While editing a group, clicking outside it leaves the group.
document.getElementById('slide-canvas').addEventListener('click', (e) => {
    const inEnteredGroup = e.target.closest('.group-entered');
    if (isEditingGroup() && !inEnteredGroup) {
        exitGroup();
        renderEditor();
        return;
    }
    // A click on a locked object selects it (it can't be dragged).
    const lockedNode = e.target.closest('.canvas-element.locked[data-element-id]');
    if (lockedNode && lockedNode.parentElement === activeContainer()) {
        const idx = activeElements().findIndex(x => String(x.id) === lockedNode.dataset.elementId);
        if (idx >= 0) {
            const additive = e.ctrlKey || e.metaKey;
            const current = getSelectedElementIndices();
            setSelectedElementIndices(additive ? [...new Set([...current, idx])] : [idx], idx);
            renderCanvas();
            renderPropertiesPanel();
        }
        return;
    }
    if (e.target.id === 'slide-canvas' || (inEnteredGroup && !e.target.closest('[data-element-id]'))) {
        setSelectedElementIndices([], null);
        setSelectedSlideIndices([state.currentSlideIndex]);
        renderCanvas();
        renderPropertiesPanel();
        updateSlideThumbSelectionUI();
    }
});

// Clicking outside an editing text box commits it.
window.addEventListener('click', (e) => {
    const editingEl = document.querySelector('.canvas-element.editing-mode');
    // The format bar and the suggestion list belong to the editing.
    if (e.target.closest && e.target.closest('.format-bar, .cite-menu')) return;
    if (editingEl && !editingEl.contains(e.target)) {
        const el = state.selectedElementIndex !== null ? activeElements()[state.selectedElementIndex] : null;
        if (!el) return;
        // Elements with their own editing (columns, tables) commit themselves.
        const def = ElementRegistry.get(el.type);
        if (def && typeof def.commitEditing === 'function') def.commitEditing(editingEl, el);
        else saveAndExitTextEditing(editingEl, el);
    }
});

// ---------- Element-module notifications (no import cycles) ----------
document.addEventListener('slide-content-changed', () => {
    beginCitationPass();   // content may have gained/lost \cite markers
    renderCanvas();
    renderPropertiesPanel();
    updateThumbnailLive();
});
document.addEventListener('slide-thumbnail-changed', () => {
    updateThumbnailLive();
});

// ---------- Properties panel ----------

/** Banner shown while editing a group or a macro instance/definition. */
function editingBanner(group) {
    let text;
    if (group.type === 'macro' && group._session === 'definition') {
        text = `Editing macro <strong>${escapeHtml(group.ref)}</strong> — changes apply to <strong>every instance</strong>.`;
    } else if (group.type === 'macro') {
        text = `Editing this instance of <strong>${escapeHtml(group.ref)}</strong> — changes are saved as overrides; other instances are unaffected.`;
    } else {
        text = `Editing group <strong>#${group.id}</strong> — positions are relative to the group.`;
    }
    return `
        <div class="group-banner${group.type === 'macro' ? ' macro-banner' : ''}">
            <span>${text}</span>
            <button class="btn btn-secondary" data-action="exit-group">Done (Esc)</button>
        </div>`;
}

/**
 * While editing a macro: which definition element the selected one is
 * (its name, used by ::name overrides) and what this instance changes.
 */
function macroChildSection(group, el) {
    if (!group || group.type !== 'macro') return '';
    return `<div id="macro-child-info">${macroChildInfo(group, el)}</div>`;
}

function macroChildInfo(group, el) {
    if (group._session === 'definition') {
        return `
            <div class="prop-group">
                <label>Name in macro (used by ::name overrides)</label>
                <input type="text" class="prop-control" value="${escapeHtml(el.name || '')}" data-prop="name" spellcheck="false">
            </div>`;
    }
    if (!el._origin) {
        return `<p class="prop-hint">Extra element — only in this instance.</p>`;
    }
    const o = (group.overrides || []).find(x => x.target === el._origin);
    const changed = o ? [...Object.keys(o.props || {}), ...(o.body !== undefined ? ['text'] : [])] : [];
    return `
        <div class="prop-group">
            <label>From macro, named</label>
            <input type="text" class="prop-control prop-readonly" disabled value="::${escapeHtml(el._origin)}">
        </div>
        ${changed.length ? `
            <p class="prop-hint">Overridden here: ${changed.map(escapeHtml).join(', ')}</p>
            <button class="btn btn-secondary" data-action="reset-override" style="width: 100%;">↺ Reset to macro</button>` : ''}`;
}

// ---------- Arrange: align, distribute, layers, lock (core/arrange.js) ----------

/** Small align icons: a guide line and two bars lined up on it. */
function alignIcon(mode) {
    const horizontal = ['left', 'center', 'right'].includes(mode);
    // Bars (long, short) as [x, y, w, h] in a 16×16 box, and the guide line.
    const bars = {
        left: [[2, 3, 11, 4], [2, 9, 7, 4]], center: [[2.5, 3, 11, 4], [4.5, 9, 7, 4]], right: [[3, 3, 11, 4], [7, 9, 7, 4]],
        top: [[3, 2, 4, 11], [9, 2, 4, 7]], middle: [[3, 2.5, 4, 11], [9, 4.5, 4, 7]], bottom: [[3, 3, 4, 11], [9, 7, 4, 7]],
    }[mode];
    const at = { left: 1.5, center: 8, right: 14.5, top: 1.5, middle: 8, bottom: 14.5 }[mode];
    const line = horizontal ? `<line x1="${at}" y1="0.5" x2="${at}" y2="15.5"/>` : `<line x1="0.5" y1="${at}" x2="15.5" y2="${at}"/>`;
    return `<svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">${bars.map(([x, y, w, h]) => `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="1" fill="currentColor" opacity="0.75"/>`).join('')}<g stroke="currentColor" stroke-width="1.2">${line}</g></svg>`;
}

const ALIGN_BUTTONS = [
    ['left', 'Align left edges'], ['center', 'Align centres (horizontally)'], ['right', 'Align right edges'],
    ['top', 'Align top edges'], ['middle', 'Align middles (vertically)'], ['bottom', 'Align bottom edges'],
];
const ORDER_BUTTONS = [
    ['front', 'To front', 'Bring to front (Ctrl+Shift+])'], ['forward', 'Forward', 'Bring forward (Ctrl+])'],
    ['backward', 'Backward', 'Send backward (Ctrl+[)'], ['back', 'To back', 'Send to back (Ctrl+Shift+[)'],
];

function arrangeSection(indices) {
    const elements = activeElements();
    const several = indices.length > 1;
    const allLocked = indices.every(i => isLocked(elements[i]));
    const where = several ? 'to each other' : (activeGroup() ? 'in the group' : 'on the slide');
    const btn = (action, arg, text, title, disabled = false) =>
        `<button type="button" class="btn btn-secondary arrange-btn" data-action="${action}" data-arg="${arg}" title="${title}" ${disabled ? 'disabled' : ''}>${text}</button>`;
    return `
        <div class="prop-divider"></div>
        <div class="prop-group arrange-section">
            <label>Align ${where}</label>
            <div class="arrange-row">${ALIGN_BUTTONS.map(([m, t]) => btn('align', m, alignIcon(m), t, allLocked)).join('')}</div>
            ${indices.length >= 3 ? `
            <label>Distribute evenly</label>
            <div class="arrange-row">
                ${btn('distribute', 'x', 'Horizontally', 'Equal gaps from left to right')}
                ${btn('distribute', 'y', 'Vertically', 'Equal gaps from top to bottom')}
            </div>` : ''}
            <label>Layer</label>
            <div class="arrange-row">${ORDER_BUTTONS.map(([op, text, t]) => btn('reorder', op, text, t, !canReorder(elements, indices, op))).join('')}</div>
            <label class="prop-check arrange-lock" title="A locked object can't be moved or resized; dragging on it selects with a rectangle">
                <input type="checkbox" data-arrange-lock ${allLocked ? 'checked' : ''}>
                🔒 Lock position (Ctrl+Shift+L)
            </label>
        </div>`;
}

function afterArrange(message) {
    markDirty();
    renderCanvas();
    renderPropertiesPanel();
    updateThumbnailLive();
    if (message) flashSaveIndicator(message);
}

export function alignSelected(mode) {
    const indices = getSelectedElementIndices();
    if (!indices.length) return false;
    const container = activeContainer();
    const frame = { width: container.offsetWidth || state.slideWidth, height: container.offsetHeight || state.slideHeight };
    alignElements(activeElements(), indices, mode, frame);
    afterArrange();
    return true;
}

export function distributeSelected(axis) {
    const indices = getSelectedElementIndices();
    if (indices.length < 3) return false;
    distributeElements(activeElements(), indices, axis);
    afterArrange();
    return true;
}

export function reorderSelected(op) {
    const indices = getSelectedElementIndices();
    if (!indices.length || !canReorder(activeElements(), indices, op)) return false;
    const primary = activeElements()[state.selectedElementIndex];
    const next = reorderElements(activeElements(), indices, op);
    setSelectedElementIndices(next, primary ? activeElements().indexOf(primary) : next[next.length - 1]);
    afterArrange();
    return true;
}

/** Locks the selection, or unlocks it if it is all locked already (or `locked` given). */
export function toggleLockSelected(locked = null) {
    const indices = getSelectedElementIndices();
    if (!indices.length) return false;
    const lock = locked === null ? !indices.every(i => isLocked(activeElements()[i])) : locked;
    setLocked(activeElements(), indices, lock);
    afterArrange(lock ? 'Locked 🔒' : 'Unlocked');
    return true;
}

propertiesPanel.addEventListener('change', (e) => {
    if (e.target.matches && e.target.matches('[data-arrange-lock]')) toggleLockSelected(e.target.checked);
});

function renderPropertiesPanel() {
    const panelBody = document.getElementById('properties-body');
    const slide = currentSlide();
    const elements = activeElements();
    const selectedIndices = getSelectedElementIndices();
    const group = activeGroup();
    const groupBanner = (isEditingMaster() ? masterBanner() : '') + (group ? editingBanner(group) : '');

    if (selectedIndices.length === 0 || !slide) {
        const below = group ? '' : isEditingMaster() ? masterSection() : slide ? slideSection(slide) : '';
        panelBody.innerHTML = groupBanner + `<div class="no-selection">Select an object on the canvas to inspect and customize its properties. Drag on empty space to select several.</div>`
            + below;
        return;
    }

    if (selectedIndices.length > 1) {
        const firstEl = withDefaults(elements[selectedIndices[0]]);
        panelBody.innerHTML = groupBanner + `
            <div class="prop-group">
                <label>Selection</label>
                <input type="text" class="prop-control prop-readonly" value="${selectedIndices.length} objects selected" disabled>
            </div>
            <p class="prop-hint">
                Drag or use <strong>Arrow keys</strong> to move all ${selectedIndices.length} objects together, <strong>Ctrl+X / Ctrl+C / Ctrl+V</strong> to cut/copy/paste, or <strong>Delete</strong> to remove.
            </p>
            <button class="btn btn-secondary" data-action="group-selection" style="width: 100%;">🗂️ Group (Ctrl+G)</button>
            ${arrangeSection(selectedIndices)}
            <div class="prop-divider"></div>
            <div class="prop-group">
                <label>Background Color (All Selected)</label>
                ${colorField({ 'data-prop': 'bg' }, firstEl.bg)}
            </div>
            <div class="prop-row">
                <div class="prop-group">
                    <label>Border</label>
                    ${colorField({ 'data-prop': 'borderCol' }, firstEl.borderCol)}
                </div>
                <div class="prop-group">
                    <label>Thickness</label>
                    <input type="number" class="prop-control" min="0" max="20" value="${firstEl.borderWidth}" data-prop="borderWidth">
                </div>
            </div>
        ` + makeMacroSection();
        return;
    }

    const activeIdx = selectedIndices[0];
    const rawEl = elements[activeIdx];
    const el = withDefaults(rawEl); // shows inherited values
    const sessionInfo = macroChildSection(group, rawEl);
    const def = ElementRegistry.get(el.type);
    const typeLabel = def && typeof def.typeLabel === 'function'
        ? def.typeLabel(el)
        : (def ? def.label.replace(/^Add\s+/i, '') : el.type);

    let html = groupBanner + sessionInfo + `
        <div class="prop-group">
            <label>Object Type</label>
            <input type="text" class="prop-control prop-readonly" value="${escapeHtml(typeLabel)}" disabled>
        </div>
        ${styleSection(rawEl)}
        ${group ? '' : stepSection(rawEl)}
        <div class="prop-row">
            <div class="prop-group">
                <label>X Position</label>
                <input type="number" id="prop-x" class="prop-control" value="${Math.round(el.x)}" data-prop="x">
            </div>
            <div class="prop-group">
                <label>Y Position</label>
                <input type="number" id="prop-y" class="prop-control" value="${Math.round(el.y)}" data-prop="y">
            </div>
        </div>
        <div class="prop-row">
            <div class="prop-group">
                <label>Width</label>
                <input type="number" class="prop-control" value="${Math.round(el.width)}" data-prop="width">
            </div>
            <div class="prop-group">
                <label>Height</label>
                <input type="number" class="prop-control" value="${Math.round(el.height)}" data-prop="height">
            </div>
        </div>
        ${el.type === 'path' ? '' : `
        <div class="prop-row">
            <div class="prop-group">
                <label title="Turn it about its centre (drag the round handle above it; Shift: 15° steps)">Rotation (°)</label>
                <input type="number" class="prop-control" step="1" value="${Math.round((Number(el.rotate) || 0) * 10) / 10}" data-prop="rotate">
            </div>
        </div>`}
    `;

    html += arrangeSection([activeIdx]);

    if (def) {
        html += def.properties(el, activeIdx);
    }

    if (!def || def.boxStyle !== false) html += `
        <div class="prop-divider"></div>
        <div class="prop-group">
            <label>Background Color</label>
            ${colorField({ 'data-prop': 'bg' }, el.bg)}
        </div>
        <div class="prop-row">
            <div class="prop-group">
                <label>Border</label>
                ${colorField({ 'data-prop': 'borderCol' }, el.borderCol)}
            </div>
            <div class="prop-group">
                <label>Thickness</label>
                <input type="number" class="prop-control" min="0" max="20" value="${el.borderWidth}" data-prop="borderWidth">
            </div>
        </div>
        <div class="prop-group">
            <label>Border Style</label>
            <select class="prop-control" data-prop="borderStyle">
                <option value="solid" ${el.borderStyle === 'solid' ? 'selected' : ''}>Solid</option>
                <option value="dashed" ${el.borderStyle === 'dashed' ? 'selected' : ''}>Dashed</option>
                <option value="dotted" ${el.borderStyle === 'dotted' ? 'selected' : ''}>Dotted</option>
                <option value="none" ${el.borderStyle === 'none' ? 'selected' : ''}>None</option>
            </select>
        </div>
    `;

    panelBody.innerHTML = html + makeMacroSection();
    markInheritedFields(panelBody, rawEl);
}

// ---------- Groups ----------

document.addEventListener('enter-group', (e) => {
    enterGroup(e.detail.id, e.detail.mode || 'instance');
    renderEditor();
});

/** Ctrl+G / button: group the selection. */
export function groupSelected() {
    if (!groupSelection()) return false;
    renderEditor();
    return true;
}

/** Ctrl+Shift+G / button: ungroup selected groups. */
export function ungroupSelected() {
    if (!ungroupSelection()) return false;
    renderEditor();
    return true;
}

/** Enters the selected group (properties-panel button). */
export function enterSelectedGroup() {
    const el = activeElements()[state.selectedElementIndex];
    if (!el || (el.type !== 'group' && el.type !== 'macro')) return false;
    enterGroup(el.id);
    renderEditor();
    return true;
}

/** Edits the selected instance's macro definition (all instances follow). */
export function editSelectedDefinition() {
    const el = activeElements()[state.selectedElementIndex];
    if (!el || el.type !== 'macro') return false;
    enterGroup(el.id, 'definition');
    renderEditor();
    return true;
}

/** "Reset to macro": drops this instance's override of the selected element. */
export function resetSelectedOverride() {
    const group = activeGroup();
    const el = activeElements()[state.selectedElementIndex];
    if (!group || group.type !== 'macro' || !el || !el._origin) return false;
    resetWorkingElement(group, el._origin);
    markDirty(); // the sync drops the override
    renderEditor();
    return true;
}

export function resetSelectedInstance() {
    if (!resetSelectedInstances()) return false;
    renderEditor();
    return true;
}

/** Opens the macro's definition in the .gl inspector. */
export function gotoSelectedDefinition() {
    const el = activeElements()[state.selectedElementIndex];
    const group = activeGroup();
    const ref = el && el.type === 'macro' ? el.ref : (group && group.type === 'macro' ? group.ref : null);
    if (!ref) return false;
    document.dispatchEvent(new CustomEvent('open-macro-definition', { detail: { name: ref } }));
    return true;
}

/** Esc / "Done": leave the group being edited. */
export function leaveGroup() {
    if (!exitGroup()) return false;
    renderEditor();
    return true;
}

// Drawing tools for lines, curves and freehand strokes.
initDrawingTools({
    workspace: document.getElementById('workspace-area'),
    getContainer: activeContainer,
    onCreate(type, variantId, props) {
        insertNewElement(ElementRegistry.get(type), variantId, props);
        const elements = activeElements();
        const made = elements[elements.length - 1];
        if (made && made.type === 'path') {
            attachDrawnLine(made, elements);
            renderEditor();
        }
    },
});

// Drag on empty canvas space to select every element the box touches.
initMarqueeSelection({
    workspace: document.getElementById('workspace-area'),
    canvas: document.getElementById('slide-canvas'),
    getContainer: activeContainer,
    onSelect(indices) {
        const primary = indices.length ? indices[indices.length - 1] : null;
        setSelectedElementIndices(indices, primary);
        setSelectedSlideIndices([state.currentSlideIndex]);
        renderCanvas();
        renderPropertiesPanel();
        updateSlideThumbSelectionUI();
    },
});

// ---------- Thumbnails, Slide selection & Drag reorder ----------

function updateSlideThumbSelectionUI() {
    const selectedSet = new Set(getSelectedSlideIndices());
    document.querySelectorAll('.thumb-container').forEach((container, idx) => {
        container.classList.toggle('active', idx === state.currentSlideIndex);
        container.classList.toggle('selected', selectedSet.has(idx));
    });
}

function reorderSlides(movingIndices, targetIndex, placeAfter) {
    const movingSet = new Set(movingIndices);
    const movingSlides = movingIndices.map(idx => state.slides[idx]).filter(Boolean);
    if (movingSlides.length === 0) return false;

    const remainingSlides = [];
    const remainingOrigIndices = [];
    state.slides.forEach((s, idx) => {
        if (!movingSet.has(idx)) {
            remainingSlides.push(s);
            remainingOrigIndices.push(idx);
        }
    });

    let insertPos = remainingSlides.length;
    if (targetIndex >= 0 && targetIndex < state.slides.length) {
        if (movingSet.has(targetIndex)) {
            let found = -1;
            if (placeAfter) {
                for (let i = targetIndex + 1; i < state.slides.length; i++) {
                    if (!movingSet.has(i)) {
                        found = remainingOrigIndices.indexOf(i);
                        break;
                    }
                }
                insertPos = found !== -1 ? found : remainingSlides.length;
            } else {
                for (let i = targetIndex - 1; i >= 0; i--) {
                    if (!movingSet.has(i)) {
                        found = remainingOrigIndices.indexOf(i) + 1;
                        break;
                    }
                }
                insertPos = found !== -1 ? found : 0;
            }
        } else {
            const remIdx = remainingOrigIndices.indexOf(targetIndex);
            insertPos = placeAfter ? remIdx + 1 : remIdx;
        }
    }

    const nextSlides = [
        ...remainingSlides.slice(0, insertPos),
        ...movingSlides,
        ...remainingSlides.slice(insertPos),
    ];

    const unchanged = nextSlides.length === state.slides.length
        && nextSlides.every((s, idx) => s === state.slides[idx]);
    if (unchanged) return false;

    const activeSlideObj = state.slides[state.currentSlideIndex];
    state.slides = nextSlides;

    const newSelectedIndices = movingSlides.map(s => state.slides.indexOf(s)).filter(i => i !== -1);
    const newActiveIdx = activeSlideObj ? state.slides.indexOf(activeSlideObj) : 0;
    state.currentSlideIndex = newActiveIdx !== -1 ? newActiveIdx : (newSelectedIndices[0] ?? 0);
    setSelectedSlideIndices(newSelectedIndices);
    setSelectedElementIndices([], null);

    markDirty();
    renderEditor();
    flashSaveIndicator(movingSlides.length > 1 ? `${movingSlides.length} slides reordered ✓` : 'Slide reordered ✓');
    return true;
}

function attachSlideDragReorder(container, idx, thumbList) {
    container.addEventListener('mousedown', (e) => {
        if (e.button !== 0) return;
        const multiToggle = e.ctrlKey || e.metaKey;
        const startX = e.clientX;
        const startY = e.clientY;
        let isDragging = false;
        let dropTargetIdx = null;
        let dropAfter = false;

        const containers = () => [...thumbList.querySelectorAll('.thumb-container')];

        const clearIndicators = () => {
            containers().forEach(c => {
                c.classList.remove('dragging', 'drop-before', 'drop-after');
            });
        };

        const computeDropTarget = (clientY) => {
            const list = containers();
            for (let i = 0; i < list.length; i++) {
                const rect = list[i].getBoundingClientRect();
                const midY = rect.top + rect.height / 2;
                if (clientY < midY) {
                    return { targetIdx: i, after: false };
                }
            }
            return { targetIdx: list.length - 1, after: true };
        };

        const onMouseMove = (moveEvent) => {
            const dist = Math.hypot(moveEvent.clientX - startX, moveEvent.clientY - startY);
            if (!isDragging && dist >= SLIDE_DRAG_THRESHOLD_PX) {
                isDragging = true;

                let currentSel = getSelectedSlideIndices();
                if (multiToggle && !currentSel.includes(idx)) {
                    state.currentSlideIndex = idx;
                    setSelectedSlideIndices([idx]);
                    setSelectedElementIndices([], null);
                    updateSlideThumbSelectionUI();
                }

                const activeSel = new Set(getSelectedSlideIndices());
                containers().forEach((c, cIdx) => {
                    if (activeSel.has(cIdx)) c.classList.add('dragging');
                });
            }

            if (!isDragging) return;

            const info = computeDropTarget(moveEvent.clientY);
            dropTargetIdx = info.targetIdx;
            dropAfter = info.after;

            containers().forEach((c, cIdx) => {
                c.classList.remove('drop-before', 'drop-after');
                if (cIdx === dropTargetIdx) {
                    c.classList.add(dropAfter ? 'drop-after' : 'drop-before');
                }
            });
        };

        const onMouseUp = (upEvent) => {
            window.removeEventListener('mousemove', onMouseMove);
            window.removeEventListener('mouseup', onMouseUp);

            const wasDragging = isDragging;
            const finalTarget = dropTargetIdx;
            const finalAfter = dropAfter;
            clearIndicators();

            if (wasDragging) {
                const suppressClick = (clickEvt) => {
                    clickEvt.stopPropagation();
                    clickEvt.preventDefault();
                };
                container.addEventListener('click', suppressClick, { capture: true, once: true });
                setTimeout(() => container.removeEventListener('click', suppressClick, { capture: true }), 0);

                if (finalTarget !== null) {
                    const movingIndices = getSelectedSlideIndices();
                    reorderSlides(movingIndices, finalTarget, finalAfter);
                }
                return;
            }

            if (multiToggle) {
                toggleSlideSelection(idx);
            } else if (upEvent.button === 0) {
                selectSlide(idx);
            }
        };

        window.addEventListener('mousemove', onMouseMove);
        window.addEventListener('mouseup', onMouseUp);
    });
}

function syncToolbarSelectsNow() {
    const gridSel = document.getElementById('grid-size-select');
    if (gridSel) {
        gridSel.value = String(state.gridSize ?? 20);
    }
    const sizeSel = document.getElementById('global-slide-size');
    if (sizeSel) {
        const key = `${state.slideWidth}x${state.slideHeight}`;
        sizeSel.value = ['1920x1080', '960x540', '1280x960'].includes(key) ? key : 'custom';
    }
}

export function renderEditor() {
    updateAllConnectors(); // lines attached to shapes follow them (core/connectors.js)
    beginCitationPass();
    invalidateNumbering(); // slides may have changed: recount \slidenumber
    updateDimensionsCSS();
    renderToolbarButtons();
    syncGridSizeSelect();
    syncSlideSizeSelect();
    syncToolbarSelectsNow();
    updateSlideTitleInput();

    const thumbList = document.getElementById('slides-thumb-list');
    thumbList.innerHTML = '';

    const selectedSlideSet = new Set(getSelectedSlideIndices());

    state.slides.forEach((slide, idx) => {
        const section = slide.section || '';
        if (section && section !== (idx > 0 ? (state.slides[idx - 1].section || '') : '')) {
            thumbList.appendChild(sectionHeader(section, idx));
        }
        const container = document.createElement('div');
        container.className = `thumb-container ${idx === state.currentSlideIndex ? 'active' : ''} ${selectedSlideSet.has(idx) ? 'selected' : ''}`;
        container.dataset.slideId = String(slide.id);
        if (section && collapsedSections.has(section)) container.classList.add('in-collapsed-section');
        attachSlideDragReorder(container, idx, thumbList);

        const labelRow = document.createElement('div');
        labelRow.className = 'thumb-label-row';
        labelRow.innerHTML = `<span>${escapeHtml(slide.title)}</span><span>${idx + 1}</span>`;

        const thumb = document.createElement('div');
        thumb.className = 'slide-thumb';

        const scaler = document.createElement('div');
        scaler.className = 'thumb-canvas-scaler';

        // Fields (\slidenumber ...) show this slide's values.
        withSlideContext(contextForSlide(idx), () => thumbElementsOf(slide).forEach(el => {
            scaler.appendChild(buildThumbElement(el));
        }));

        thumb.appendChild(scaler);
        container.appendChild(labelRow);
        container.appendChild(thumb);
        thumbList.appendChild(container);
    });

    const addThumb = document.createElement('div');
    addThumb.className = 'slide-thumb-add';
    addThumb.onclick = () => addSlide();
    addThumb.innerHTML = `
        <span style="font-size: 16px; font-weight: bold;">+</span>
        <span>Add Slide</span>`;
    thumbList.appendChild(addThumb);
    fitThumbnails();

    renderCanvas();
    renderPropertiesPanel();
    syncToolbarSelectsNow();

    // Lets other views (e.g. the .gl inspector) follow every re-render
    // without wrapping this function.
    document.dispatchEvent(new CustomEvent('editor-rendered'));
}

// ---------- Sections in the sidebar ----------

const collapsedSections = new Set(); // UI only, not saved

function sectionHeader(name, firstIndex) {
    const header = document.createElement('div');
    header.className = `thumb-section${collapsedSections.has(name) ? ' collapsed' : ''}`;
    header.dataset.section = name;
    let count = 0;
    for (let i = firstIndex; i < state.slides.length && state.slides[i].section === name; i++) count++;
    header.innerHTML = `<span class="thumb-section-caret">▾</span><span class="thumb-section-name">${escapeHtml(name)}</span><span class="thumb-section-count">${count}</span>`;
    header.title = 'Click to fold or unfold this section';
    header.addEventListener('click', () => {
        if (collapsedSections.has(name)) collapsedSections.delete(name);
        else collapsedSections.add(name);
        renderEditor();
    });
    return header;
}

/** Section headers changed (typing a section name): redraw the sidebar soon. */
let sectionRedrawTimer = null;
function renderThumbnailSectionHeaders() {
    clearTimeout(sectionRedrawTimer);
    sectionRedrawTimer = setTimeout(() => {
        const input = document.getElementById('slide-section');
        const hadFocus = document.activeElement === input;
        const caret = hadFocus ? input.selectionStart : null;
        renderEditor();
        const again = document.getElementById('slide-section');
        if (hadFocus && again) {
            again.focus();
            again.setSelectionRange(caret, caret);
        }
    }, 400);
}

// ---------- Slide operations ----------

export function addSlide() {
    const usedTitles = new Set(state.slides.map(s => s.title));
    let n = state.slides.length + 1;
    while (usedTitles.has(`Slide ${n}`)) n++;
    const last = state.slides[state.slides.length - 1];
    // A new slide (added at the end) continues the last section.
    state.slides.push({ id: allocateSlideId(), title: `Slide ${n}`, elements: [], ...(last && last.section ? { section: last.section } : {}) });
    const newIdx = state.slides.length - 1;
    state.currentSlideIndex = newIdx;
    setSelectedSlideIndices([newIdx]);
    setSelectedElementIndices([], null);
    markDirty();
    renderEditor();
}

// ---------- Step preview (toolbar): the slide as it looks at one step ----------

/** The toolbar's Steps selector: All, or one step of the current slide. */
function updateStepPreview() {
    const select = document.getElementById('step-preview');
    if (!select) return;
    const slide = state.editingMasterIndex === null ? currentSlide() : null;
    const n = slide ? slideStepCount(slide) : 1;
    if (state.previewStep && state.previewStep > n) state.previewStep = null;
    select.hidden = n <= 1;
    const wanted = ['all', ...Array.from({ length: n }, (_, i) => String(i + 1))];
    if ([...select.options].map(o => o.value).join() !== wanted.join()) {
        select.innerHTML = wanted.map(v => `<option value="${v}">${v === 'all' ? 'Steps: all' : `Step ${v} of ${n}`}</option>`).join('');
    }
    select.value = state.previewStep ? String(state.previewStep) : 'all';
    select.classList.toggle('active', Boolean(state.previewStep));
}

document.getElementById('step-preview')?.addEventListener('change', (e) => {
    state.previewStep = e.target.value === 'all' ? null : Number(e.target.value);
    setSelectedElementIndices([], null); // what is selected may be hidden now
    renderEditor();
});

export function selectSlide(index) {
    if (index < 0 || index >= state.slides.length) return;
    if (index !== state.currentSlideIndex) state.previewStep = null; // each slide starts with all its steps
    setEditingGroup(null);
    state.editingMasterIndex = null;
    state.currentSlideIndex = index;
    setSelectedSlideIndices([index]);
    setSelectedElementIndices([], null);
    renderEditor();
}

export function navigateSlideByArrow(delta) {
    if (!Array.isArray(state.slides) || state.slides.length === 0) return false;
    const nextIdx = Math.max(0, Math.min(state.slides.length - 1, state.currentSlideIndex + delta));
    if (nextIdx === state.currentSlideIndex) return true;
    selectSlide(nextIdx);
    return true;
}

export function toggleSlideSelection(index) {
    if (index < 0 || index >= state.slides.length) return;
    let current = getSelectedSlideIndices();
    if (current.includes(index)) {
        if (current.length > 1) {
            current = current.filter(i => i !== index);
            setSelectedSlideIndices(current);
            if (state.currentSlideIndex === index) {
                state.currentSlideIndex = current[0];
            }
        }
    } else {
        setSelectedSlideIndices([...current, index]);
        state.currentSlideIndex = index;
    }
    setSelectedElementIndices([], null);
    renderEditor();
}

export function extendSlideSelectionByArrow(delta) {
    if (!Array.isArray(state.slides) || state.slides.length === 0) return false;
    const currentIdx = Math.max(0, Math.min(state.currentSlideIndex, state.slides.length - 1));
    const nextIdx = Math.max(0, Math.min(state.slides.length - 1, currentIdx + delta));

    const existing = getSelectedSlideIndices();
    const merged = [...new Set([...existing, currentIdx, nextIdx])].sort((a, b) => a - b);

    state.currentSlideIndex = nextIdx;
    setSelectedSlideIndices(merged);
    setSelectedElementIndices([], null);
    renderEditor();
    return true;
}

export function deleteSelectedSlides(showFlash = true) {
    if (getSelectedElementIndices().length > 0) return false;

    const toDelete = getSelectedSlideIndices();
    if (toDelete.length === 0 || state.slides.length === 0) return false;

    const removeSet = new Set(toDelete);
    const remaining = state.slides.filter((_, idx) => !removeSet.has(idx));

    if (remaining.length === 0) {
        state.slides = [{ id: allocateSlideId(), title: 'Slide 1', elements: [] }];
        state.currentSlideIndex = 0;
        setSelectedSlideIndices([0]);
    } else {
        state.slides = remaining;
        const firstDeleted = Math.min(...toDelete);
        state.currentSlideIndex = Math.max(0, Math.min(firstDeleted, state.slides.length - 1));
        setSelectedSlideIndices([state.currentSlideIndex]);
    }

    setSelectedElementIndices([], null);
    markDirty();
    renderEditor();
    if (showFlash) {
        flashSaveIndicator(toDelete.length > 1 ? `${toDelete.length} slides deleted ✓` : 'Slide deleted ✓');
    }
    return true;
}