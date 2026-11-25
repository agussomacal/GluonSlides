// ============================================================
// core/masters.js — Master slides: elements drawn under every slide
// (a background, logo, footer with \slidenumber ...).
//
//   .master {Default} id:40          in the .gl file, like a slide
//   .slide {Title} id:1 master:none  this slide shows no master
//   .slide {X} id:2 master:Dark      this one uses the master "Dark"
//
// Slides without `master:` use the first master. Masters are edited on
// the canvas like a slide (state.editingMasterIndex, see currentSlide()).
// ============================================================

import { state, allocateId } from './state.js';

export function masters() {
    if (!Array.isArray(state.masters)) state.masters = [];
    return state.masters;
}

/** The master a slide shows, or null (none defined, or master:none). */
export function masterFor(slide) {
    if (!slide || slide.master === 'none') return null;
    const list = masters();
    if (slide.master) return list.find(m => m.name === slide.master) || list[0] || null;
    return list[0] || null;
}

export function isEditingMaster() {
    return state.editingMasterIndex !== null && state.editingMasterIndex !== undefined
        && Boolean(masters()[state.editingMasterIndex]);
}

export function editedMaster() {
    return isEditingMaster() ? masters()[state.editingMasterIndex] : null;
}

/** Slides showing master `m`. */
export function slidesUsing(m) {
    return (state.slides || []).filter(s => masterFor(s) === m).length;
}

function uniqueName(base) {
    const names = new Set(masters().map(m => m.name));
    if (!names.has(base)) return base;
    let i = 2;
    while (names.has(`${base} ${i}`)) i++;
    return `${base} ${i}`;
}

/** A new, empty master; returns its index. */
export function createMaster(name = masters().length ? 'Master' : 'Default') {
    masters().push({ id: allocateId(), name: uniqueName(name), elements: [] });
    return masters().length - 1;
}

/** Renames master `index`, updating the slides that name it. Returns false if taken. */
export function renameMaster(index, name) {
    const m = masters()[index];
    const clean = String(name || '').trim();
    if (!m || !clean || clean === 'none' || masters().some((x, i) => i !== index && x.name === clean)) return false;
    (state.slides || []).forEach(s => { if (s.master === m.name) s.master = clean; });
    m.name = clean;
    return true;
}

/** Deletes master `index`; slides that named it go back to the first master. */
export function deleteMaster(index) {
    const m = masters()[index];
    if (!m) return;
    (state.slides || []).forEach(s => { if (s.master === m.name) delete s.master; });
    masters().splice(index, 1);
}

/** Sets which master a slide uses: a name, 'none', or '' for the first one. */
export function setSlideMaster(slide, value) {
    if (!slide) return;
    const first = masters()[0];
    if (!value || (first && value === first.name)) delete slide.master;
    else slide.master = value;
}
