// ============================================================
// editor/groupOps.js — Group / ungroup the selection, enter and
// leave a group. All operations act on the active element list
// (slide level, or inside the group being edited).
// ============================================================

import {
    state,
    activeElements,
    activeGroup,
    findElementPath,
    currentSlide,
    getSelectedElementIndices,
    setSelectedElementIndices,
    setEditingGroup,
    allocateElementId,
    markDirty,
    flashSaveIndicator,
} from '../core/state.js';
import { groupScale } from '../elements/group/group.js';

const round = (v) => Math.round(v * 100) / 100;

/** Wraps the selected elements (2+) in a new group. */
export function groupSelection() {
    const elements = activeElements();
    const indices = getSelectedElementIndices();
    if (indices.length < 2) return false;

    const picked = indices.map(i => elements[i]);
    const left = Math.min(...picked.map(e => e.x));
    const top = Math.min(...picked.map(e => e.y));
    const right = Math.max(...picked.map(e => e.x + e.width));
    const bottom = Math.max(...picked.map(e => e.y + e.height));
    const width = Math.max(1, right - left);
    const height = Math.max(1, bottom - top);

    const group = {
        type: 'group',
        id: allocateElementId(),
        x: left, y: top, width, height,
        frameWidth: width, frameHeight: height,
        bg: 'transparent', borderCol: 'transparent', borderWidth: 0, borderStyle: 'solid',
        children: picked.map(e => ({ ...e, x: e.x - left, y: e.y - top })),
    };

    // The group takes the stacking position of the topmost picked element.
    const insertAt = indices[indices.length - 1] - (indices.length - 1);
    const pickedSet = new Set(indices);
    const remaining = elements.filter((_, i) => !pickedSet.has(i));
    remaining.splice(insertAt, 0, group);
    elements.splice(0, elements.length, ...remaining);

    setSelectedElementIndices([insertAt], insertAt);
    markDirty();
    flashSaveIndicator(`Grouped ${picked.length} objects ✓`);
    return true;
}

/**
 * Converts a child from a group's frame space into the group's parent
 * space, baking in the group's scale (fonts/borders use the geometric
 * mean of the two scales, which is exact for proportional resizes).
 */
function bakeChild(child, group) {
    const { sx, sy } = groupScale(group);
    const k = Math.sqrt(sx * sy);
    const out = {
        ...child,
        x: round(group.x + child.x * sx),
        y: round(group.y + child.y * sy),
        width: round(child.width * sx),
        height: round(child.height * sy),
    };
    if (typeof child.fontSize === 'number') out.fontSize = round(child.fontSize * k);
    if (typeof child.borderWidth === 'number') out.borderWidth = round(child.borderWidth * k);
    return out;
}

/** Replaces every selected group by its children. */
export function ungroupSelection() {
    const elements = activeElements();
    const indices = getSelectedElementIndices();
    if (!indices.some(i => elements[i] && elements[i].type === 'group')) return false;

    const result = [];
    const newSelection = [];
    elements.forEach((el, i) => {
        if (indices.includes(i) && el.type === 'group') {
            (el.children || []).forEach(child => {
                newSelection.push(result.length);
                result.push(bakeChild(child, el));
            });
        } else {
            if (indices.includes(i)) newSelection.push(result.length);
            result.push(el);
        }
    });
    elements.splice(0, elements.length, ...result);

    setSelectedElementIndices(newSelection);
    markDirty();
    flashSaveIndicator('Ungrouped ✓');
    return true;
}

/** Enters the group with `id` so its children can be edited. */
export function enterGroup(id) {
    setEditingGroup(id);
}

/** Leaves the current group, selecting it at the parent level. */
export function exitGroup() {
    const group = activeGroup();
    if (!group) return false;
    const path = findElementPath(currentSlide(), group.id) || [];
    const parent = path[path.length - 1] || null;
    setEditingGroup(parent ? parent.id : null);
    const idx = activeElements().indexOf(group);
    setSelectedElementIndices(idx >= 0 ? [idx] : [], idx >= 0 ? idx : null);
    return true;
}

/** True while some group is being edited. */
export function isEditingGroup() {
    return state.editingGroupId !== null && activeGroup() !== null;
}
