// ============================================================
// core/steps.js — Builds: elements with `step:N` appear at the
// N-th step of their slide while presenting (step 1 = from the
// start). Only a slide's own elements count; elements inside groups
// and macros appear with their group.
// ============================================================

/** The step at which an element appears (1 when it has none). */
export function elementStep(el) {
    const n = Math.round(Number(el && el.step));
    return n > 1 ? n : 1;
}

/** Number of steps of a slide (1 when nothing builds up). */
export function slideStepCount(slide) {
    return (slide && slide.elements || []).reduce((max, el) => Math.max(max, elementStep(el)), 1);
}
