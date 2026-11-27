// ============================================================
// editor/navigate.js — Shows a place of the project: an element (by id,
// wherever it is: a slide, inside a group, on a master) or a slide,
// selecting it and flashing it on the canvas. Used by find (ui/find.js)
// and go to a variable's definition (ui/goToVariable.js).
// ============================================================

import { state, findElementPath, setEditingGroup, setSelectedElementIndices } from '../core/state.js';
import { renderEditor, selectSlide, leaveMaster } from './editor.js';

function flash(id) {
    requestAnimationFrame(() => {
        const node = document.querySelector(`#slide-canvas [data-element-id="${CSS.escape(String(id))}"]`);
        if (!node) return;
        node.classList.remove('find-flash');
        void node.offsetWidth;
        node.classList.add('find-flash');
        setTimeout(() => node.classList.remove('find-flash'), 1400);
    });
}

/** Shows element `id`: its slide (or master), the group it is in, selected. True if found. */
export function revealElement(id) {
    const where = (list, isMaster) => {
        for (let i = 0; i < list.length; i++) {
            const path = findElementPath(list[i], id);
            if (path) return { index: i, path, isMaster };
        }
        return null;
    };
    const hit = where(state.slides || [], false) || where(state.masters || [], true);
    if (!hit) return false;
    if (hit.isMaster) {
        setEditingGroup(null);
        state.editingMasterIndex = hit.index;
    } else {
        leaveMaster();
        if (state.currentSlideIndex !== hit.index) selectSlide(hit.index);
    }
    // inside a group: enter it, then select the element there
    const group = hit.path.length ? hit.path[hit.path.length - 1] : null;
    setEditingGroup(group ? group.id : null);
    const container = group ? group.children : (hit.isMaster ? state.masters[hit.index] : state.slides[hit.index]).elements;
    const idx = container.findIndex(e => e.id === id);
    setSelectedElementIndices(idx >= 0 ? [idx] : [], idx >= 0 ? idx : null);
    renderEditor();
    flash(id);
    return true;
}

/** Shows slide `id` (or a master's), nothing selected. */
export function revealSlide(id) {
    const i = (state.slides || []).findIndex(s => s.id === id);
    if (i >= 0) {
        leaveMaster();
        selectSlide(i);
        setSelectedElementIndices([], null);
        renderEditor();
        return true;
    }
    const m = (state.masters || []).findIndex(s => s.id === id);
    if (m >= 0) {
        setEditingGroup(null);
        state.editingMasterIndex = m;
        setSelectedElementIndices([], null);
        renderEditor();
        return true;
    }
    return false;
}
