// ============================================================
// editor/editor.js — The editor manager.
// Supports single & multi-selection for slides and elements,
// slide drag-and-drop reordering, group dragging & arrow nudging,
// cut/copy/paste, and deletion.
// ============================================================

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
} from '../core/state.js';
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
import { saveAndExitTextEditing } from '../elements/text/text.js';
import { beginCitationPass } from '../core/citations.js';
import { slideStepCount } from '../core/steps.js';
import { initMarqueeSelection } from './marquee.js';
import './citeAutocomplete.js'; // \cite{ suggestions while typing on the canvas
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
export function addElement(type, variantId = null) {
    if (!state.slides[state.currentSlideIndex]) return;
    const def = ElementRegistry.get(type);
    if (!def) {
        console.error(`No element registered for type '${type}'`);
        return;
    }
    // Variants that are drawn (lines, curves, freehand) start a tool instead.
    if (startTool(type, variantId)) return;

    const elements = activeElements(); // inside the group being edited, if any
    const stagger = elements.length * 30;
    const offset = isEditingGroup() ? 20 : 200;
    insertNewElement(def, variantId, { x: offset + stagger, y: offset + stagger });
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
        ...props,
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
    const commonNumeric = ['x', 'y', 'width', 'height', 'fontSize', 'borderWidth', 'step'];
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
            else elements[idx][propName] = propName === 'step' ? Math.round(parsedVal) : parsedVal;
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
        </div>`;
}

/** Shown when nothing is selected: the current slide's speaker notes. */
function slideSection(slide) {
    const steps = slideStepCount(slide);
    return `
        <div class="prop-divider"></div>
        <div class="prop-group">
            <label for="slide-notes">Speaker notes</label>
            <textarea id="slide-notes" class="prop-control slide-notes" rows="8" data-slide-prop="notes"
                      placeholder="Only you see these, in the presenter view.">${escapeHtml(slide.notes || '')}</textarea>
        </div>
        <p class="prop-hint">${steps > 1
            ? `This slide builds up in ${steps} steps (set an object's <strong>Appears at step</strong>).`
            : 'To reveal objects one click at a time, select one and set <strong>Appears at step</strong>.'}</p>`;
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
    if (!key || !slide) return;
    if (e.target.value.trim() === '') delete slide[key];
    else slide[key] = e.target.value;
    markDirty();
});
propertiesPanel.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && e.target.id === 'make-macro-name') {
        e.preventDefault();
        makeMacroFromPanel();
    }
});
propertiesPanel.addEventListener('change', onPropertyControl);

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
        if (!el) return;
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

export function updateThumbnailLive() {
    const activeContainer = document.querySelectorAll('.thumb-container')[state.currentSlideIndex];
    if (!activeContainer) return;
    const scaler = activeContainer.querySelector('.thumb-canvas-scaler');
    if (!scaler) return;

    scaler.innerHTML = '';
    state.slides[state.currentSlideIndex].elements.forEach(el => {
        scaler.appendChild(buildThumbElement(el));
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

function renderCanvas() {
    const canvas = document.getElementById('slide-canvas');
    canvas.innerHTML = '';

    gridSteps();

    if (state.gridSize > 0) {
        canvas.style.backgroundImage = getGridSvgDataUri(state.slideWidth, state.slideHeight, state.gridSize, state.isDarkMode);
        canvas.style.backgroundSize = '100% 100%';
        canvas.style.backgroundPosition = '0px 0px';
        canvas.style.width = `${state.slideWidth}px`;
        canvas.style.height = `${state.slideHeight}px`;
    } else {
        canvas.style.backgroundImage = 'none';
    }

    const slide = state.slides[state.currentSlideIndex];
    if (!slide) return;

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
        const onMove = (m) => {
            const r = container.getBoundingClientRect();
            let px = (m.clientX - r.left) * ((container.offsetWidth || 1) / (r.width || 1));
            let py = (m.clientY - r.top) * ((container.offsetHeight || 1) / (r.height || 1));
            if (!m.altKey && !m.shiftKey && state.gridSize > 0) {
                px = snapToGridPoint(px, stepX);
                py = snapToGridPoint(py, stepY);
            }
            moved = true;
            def.dragHandle(el, id, px, py, { shiftKey: m.shiftKey, start });
            repaint();
        };
        const onUp = () => {
            window.removeEventListener('mousemove', onMove);
            window.removeEventListener('mouseup', onUp);
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
        if (Number(el.step) > 1 && !activeGroup()) domEl.dataset.step = String(Math.round(el.step));

        // Drawn with defaults/style filled in and colors resolved;
        // geometry edits use `el`.
        const view = forDrawing(el);
        applyCommonBoxStyles(domEl, view);

        if (def) {
            def.renderDom(domEl, view, { context: 'canvas', elIndex });
        }

        // Elements with handles (paths) are reshaped with those, not box edges.
        const boxResize = !def || def.boxResize !== false;
        if (def && typeof def.handles === 'function' && selectedSet.size === 1 && selectedSet.has(elIndex)) {
            appendHandles(container, domEl, el, def, elIndex);
        }

        renderedItems.push({ el, domEl, elIndex });

        domEl.onmousemove = (e) => {
            if (domEl.classList.contains('editing-mode') || !boxResize) return;
            updateResizeCursor(domEl, el, e);
        };

        const dragCallbacks = {
            onGeometryChanged() {
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
                startDragOrResize(freshDom, el, e, dragCallbacks, null, { allowResize: boxResize });
                return;
            }

            state.selectedElementIndex = elIndex;
            const groupItems = renderedItems
                .filter(item => getSelectedElementIndices().includes(item.elIndex))
                .map(item => ({ el: item.el, domEl: item.domEl }));

            startDragOrResize(domEl, el, e, dragCallbacks, groupItems, { allowResize: boxResize });
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
    if (editingEl && !editingEl.contains(e.target)) {
        const el = state.selectedElementIndex !== null ? activeElements()[state.selectedElementIndex] : null;
        if (el) saveAndExitTextEditing(editingEl, el);
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

function renderPropertiesPanel() {
    const panelBody = document.getElementById('properties-body');
    const slide = state.slides[state.currentSlideIndex];
    const elements = activeElements();
    const selectedIndices = getSelectedElementIndices();
    const group = activeGroup();
    const groupBanner = group ? editingBanner(group) : '';

    if (selectedIndices.length === 0 || !slide) {
        panelBody.innerHTML = groupBanner + `<div class="no-selection">Select an object on the canvas to inspect and customize its properties. Drag on empty space to select several.</div>`
            + (slide && !group ? slideSection(slide) : '');
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
    `;

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
    beginCitationPass();
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
        const container = document.createElement('div');
        container.className = `thumb-container ${idx === state.currentSlideIndex ? 'active' : ''} ${selectedSlideSet.has(idx) ? 'selected' : ''}`;
        container.dataset.slideId = String(slide.id);
        attachSlideDragReorder(container, idx, thumbList);

        const labelRow = document.createElement('div');
        labelRow.className = 'thumb-label-row';
        labelRow.innerHTML = `<span>${escapeHtml(slide.title)}</span><span>${idx + 1}</span>`;

        const thumb = document.createElement('div');
        thumb.className = 'slide-thumb';

        const scaler = document.createElement('div');
        scaler.className = 'thumb-canvas-scaler';

        slide.elements.forEach(el => {
            scaler.appendChild(buildThumbElement(el));
        });

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

    renderCanvas();
    renderPropertiesPanel();
    syncToolbarSelectsNow();

    // Lets other views (e.g. the .gl inspector) follow every re-render
    // without wrapping this function.
    document.dispatchEvent(new CustomEvent('editor-rendered'));
}

// ---------- Slide operations ----------

export function addSlide() {
    const usedTitles = new Set(state.slides.map(s => s.title));
    let n = state.slides.length + 1;
    while (usedTitles.has(`Slide ${n}`)) n++;
    state.slides.push({ id: allocateSlideId(), title: `Slide ${n}`, elements: [] });
    const newIdx = state.slides.length - 1;
    state.currentSlideIndex = newIdx;
    setSelectedSlideIndices([newIdx]);
    setSelectedElementIndices([], null);
    markDirty();
    renderEditor();
}

export function selectSlide(index) {
    if (index < 0 || index >= state.slides.length) return;
    setEditingGroup(null);
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