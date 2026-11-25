// ============================================================
// editor/macroOps.js — Make a macro from the selection, and detach
// an instance back into an ordinary group.
// ============================================================

import {
    state,
    activeElements,
    getSelectedElementIndices,
    setSelectedElementIndices,
    allocateElementId,
    reassignIdsDeep,
    markDirty,
    flashSaveIndicator,
} from '../core/state.js';
import {
    DEFAULT_LIBRARY, MACRO_NAME_RE, getMacro, resolveInstance,
    nameElements, stripIds, loadImportedLibraries, stripSessionKeys, closeSession,
} from '../core/macros.js';

/**
 * Turns the selection into macro `name`, stored in macros.gl (imported
 * by the project), and replaces it with an instance. A single selected
 * group becomes the macro's contents with the group's frame.
 * Returns { success, error }.
 */
export async function makeMacroFromSelection(name) {
    name = String(name || '').trim();
    if (!MACRO_NAME_RE.test(name)) {
        return { success: false, error: 'Use letters, digits, - or _ (starting with a letter).' };
    }

    // Make sure an existing macros.gl is loaded before adding to it, so
    // saving never overwrites definitions we have not read.
    if (!state.imports.includes(DEFAULT_LIBRARY)) {
        state.imports = [...state.imports, DEFAULT_LIBRARY];
        await loadImportedLibraries();
    }
    if (getMacro(name)) return { success: false, error: `A macro named "${name}" already exists.` };

    const elements = activeElements();
    const indices = getSelectedElementIndices();
    if (indices.length === 0) return { success: false, error: 'Select the objects to turn into a macro.' };
    const picked = indices.map(i => elements[i]);

    let box;
    let children;
    if (picked.length === 1 && picked[0].type === 'group') {
        const g = picked[0];
        box = { x: g.x, y: g.y, width: g.width, height: g.height };
        children = structuredClone(g.children || []);
        state.macros[name] = { name, width: g.frameWidth || g.width, height: g.frameHeight || g.height, children, source: DEFAULT_LIBRARY };
    } else {
        const left = Math.min(...picked.map(e => e.x));
        const top = Math.min(...picked.map(e => e.y));
        const width = Math.max(1, Math.max(...picked.map(e => e.x + e.width)) - left);
        const height = Math.max(1, Math.max(...picked.map(e => e.y + e.height)) - top);
        box = { x: left, y: top, width, height };
        children = picked.map(e => ({ ...structuredClone(e), x: e.x - left, y: e.y - top }));
        state.macros[name] = { name, width, height, children, source: DEFAULT_LIBRARY };
    }
    // Definition elements are addressed by name, not by project id.
    stripIds(children);
    nameElements(children);

    const instance = {
        type: 'macro', id: allocateElementId(), ref: name,
        ...box, overrides: [], extras: [],
    };
    const insertAt = indices[indices.length - 1] - (indices.length - 1);
    const pickedSet = new Set(indices);
    const remaining = elements.filter((_, i) => !pickedSet.has(i));
    remaining.splice(insertAt, 0, instance);
    elements.splice(0, elements.length, ...remaining);
    setSelectedElementIndices([insertAt], insertAt);

    markDirty();
    flashSaveIndicator(`Macro "${name}" created ✓`);
    return { success: true };
}

/** Removes all overrides and extras of the selected instance(s). */
export function resetSelectedInstances() {
    const elements = activeElements();
    let count = 0;
    getSelectedElementIndices().forEach(i => {
        const inst = elements[i];
        if (!inst || inst.type !== 'macro') return;
        inst.overrides = [];
        inst.extras = [];
        count++;
    });
    if (!count) return false;
    markDirty();
    flashSaveIndicator('Reset to the macro definition ✓');
    return true;
}

/** Replaces each selected macro instance by an equivalent group. */
export function detachSelected() {
    const elements = activeElements();
    const indices = getSelectedElementIndices();
    let count = 0;
    indices.forEach(i => {
        const inst = elements[i];
        if (!inst || inst.type !== 'macro') return;
        if (inst._session) closeSession(inst);
        const { macro, children, error } = resolveInstance(inst);
        stripSessionKeys(children);
        if (error) return;
        const group = {
            type: 'group', id: inst.id,
            x: inst.x, y: inst.y, width: inst.width, height: inst.height,
            frameWidth: macro.width, frameHeight: macro.height,
            bg: 'transparent', borderCol: 'transparent', borderWidth: 0, borderStyle: 'solid',
            children: children.map(c => reassignIdsDeep(c)),
        };
        elements[i] = group;
        count++;
    });
    if (!count) return false;
    markDirty();
    flashSaveIndicator(count > 1 ? `${count} macros detached ✓` : 'Macro detached ✓');
    return true;
}
