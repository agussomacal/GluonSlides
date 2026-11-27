// ============================================================
// core/steps.js — Builds: elements with `step:N` appear at the
// N-th step of their slide while presenting (step 1 = from the
// start); with `until:M` they disappear again after step M (shown at
// steps N…M: Beamer's \only<2-3>, Slidev's v-switch). Only a slide's
// own elements count; elements inside groups and macros appear with
// their group.
// ============================================================

/** The step at which an element appears (1 when it has none). */
export function elementStep(el) {
    const n = Math.round(Number(el && el.step));
    return n > 1 ? n : 1;
}

/** The last step an element is shown at, or null (it stays). */
export function elementUntil(el) {
    const n = Math.round(Number(el && el.until));
    return Number.isFinite(n) && n >= elementStep(el) ? n : null;
}

/** Whether the element is shown at step `k` of its slide. */
export function visibleAtStep(el, k) {
    const until = elementUntil(el);
    return elementStep(el) <= k && (until === null || k <= until);
}

/** Number of steps of a slide (1 when nothing builds up). An element that
 *  disappears after step M makes a step M + 1 where it is gone. */
export function slideStepCount(slide) {
    return (slide && slide.elements || []).reduce((max, el) => {
        const until = elementUntil(el);
        return Math.max(max, elementStep(el), until !== null ? until + 1 : 1);
    }, 1);
}
