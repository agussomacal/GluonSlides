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
import { initMarqueeSelection } from './marquee.js';
import { renderAddElementToolbar } from './toolbar.js';
import { initDrawingTools, startTool } from './tools.js';
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
        ...def.defaults({}),
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
    const commonNumeric = ['x', 'y', 'width', 'height', 'fontSize', 'borderWidth'];
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
            if (elements[idx]) {
                elements[idx][propName] = parsedVal;
            }
        });
    }

    markDirty();
    renderCanvas();
    updateThumbnailLive();
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
    // Dropdowns and checkboxes apply on change (then the panel is redrawn,
    // since they can enable/disable other fields); text/number/color
    // inputs apply live while typing.
    const isChoice = control.tagName === 'SELECT' || control.type === 'checkbox';
    if (e.type !== (isChoice ? 'change' : 'input')) return;
    const value = control.type === 'checkbox' ? (control.checked ? 'yes' : 'no') : control.value;
    updateProp(control.dataset.prop, value);
    if (isChoice) renderPropertiesPanel();
}
propertiesPanel.addEventListener('input', onPropertyControl);
propertiesPanel.addEventListener('change', onPropertyControl);

propertiesPanel.addEventListener('click', (e) => {
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
        applyCommonBoxStyles(shell, el);
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
        applyCommonBoxStyles(domEl, el);
        def.renderDom(domEl, el, { context: 'canvas', elIndex });
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
    const renderedItems = [];

    elements.forEach((el, elIndex) => {
        const def = ElementRegistry.get(el.type);
        const domEl = document.createElement('div');
        domEl.className = `canvas-element ${def ? def.className : 'element-shape'}`;
        domEl.dataset.elementId = String(el.id);
        if (selectedSet.has(elIndex)) {
            domEl.classList.add('selected');
        }

        applyCommonBoxStyles(domEl, el);

        if (def) {
            def.renderDom(domEl, el, { context: 'canvas', elIndex });
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

function renderPropertiesPanel() {
    const panelBody = document.getElementById('properties-body');
    const slide = state.slides[state.currentSlideIndex];
    const elements = activeElements();
    const selectedIndices = getSelectedElementIndices();
    const group = activeGroup();
    const groupBanner = group ? `
        <div class="group-banner">
            <span>Editing group <strong>#${group.id}</strong> — positions are relative to the group.</span>
            <button class="btn btn-secondary" data-action="exit-group">Done (Esc)</button>
        </div>` : '';

    if (selectedIndices.length === 0 || !slide) {
        panelBody.innerHTML = groupBanner + `<div class="no-selection">Select an object on the canvas to inspect and customize its properties. Drag on empty space to select several.</div>`;
        return;
    }

    if (selectedIndices.length > 1) {
        const firstEl = elements[selectedIndices[0]];
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
                <input type="color" class="prop-control prop-color" value="${firstEl.bg === 'transparent' ? '#ffffff' : firstEl.bg}" data-prop="bg">
            </div>
            <div class="prop-row">
                <div class="prop-group">
                    <label>Border Color</label>
                    <input type="color" class="prop-control prop-color" value="${firstEl.borderCol === 'transparent' ? '#000000' : firstEl.borderCol}" data-prop="borderCol">
                </div>
                <div class="prop-group">
                    <label>Border Width</label>
                    <input type="number" class="prop-control" min="0" max="20" value="${firstEl.borderWidth}" data-prop="borderWidth">
                </div>
            </div>
        `;
        return;
    }

    const activeIdx = selectedIndices[0];
    const el = elements[activeIdx];
    const def = ElementRegistry.get(el.type);
    const typeLabel = def && typeof def.typeLabel === 'function'
        ? def.typeLabel(el)
        : (def ? def.label.replace(/^Add\s+/i, '') : el.type);

    let html = groupBanner + `
        <div class="prop-group">
            <label>Object Type</label>
            <input type="text" class="prop-control prop-readonly" value="${escapeHtml(typeLabel)}" disabled>
        </div>
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
            <input type="color" class="prop-control prop-color" value="${el.bg === 'transparent' ? '#ffffff' : el.bg}" data-prop="bg">
        </div>
        <div class="prop-row">
            <div class="prop-group">
                <label>Border Color</label>
                <input type="color" class="prop-control prop-color" value="${el.borderCol === 'transparent' ? '#000000' : el.borderCol}" data-prop="borderCol">
            </div>
            <div class="prop-group">
                <label>Border Width (px)</label>
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

    panelBody.innerHTML = html;
}

// ---------- Groups ----------

document.addEventListener('enter-group', (e) => {
    enterGroup(e.detail.id);
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
    if (!el || el.type !== 'group') return false;
    enterGroup(el.id);
    renderEditor();
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
    state.editingGroupId = null;
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