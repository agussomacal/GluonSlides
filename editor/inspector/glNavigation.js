// ============================================================
// editor/inspector/glNavigation.js — Pure helpers mapping between
// .gl text lines and { slideId, elementId } targets. No DOM, no
// state: easy to test in isolation.
// ============================================================

/** `.element.*` or `.macro.*` directive line (already trimmed). */
function isElementLine(trimmed) {
    return trimmed.startsWith('.element.') || trimmed.startsWith('.macro.');
}

export function parseIdValue(raw) {
    if (raw === undefined || raw === null || raw === '') return null;
    const num = Number(raw);
    return Number.isFinite(num) ? num : String(raw);
}

function extractIdFromDirective(line) {
    const m = String(line ?? '').match(/(?:^|\s)id:(?:"([^"]*)"|(\S+))/);
    if (!m) return null;
    return parseIdValue(m[1] !== undefined ? m[1] : m[2]);
}

function hasIdParam(line, targetId) {
    return targetId !== null && extractIdFromDirective(line) === targetId;
}

/**
 * Line index of the directive for `elementId` inside `slideId` (or of
 * the slide itself when no element is given). Falls back to the slide
 * line, then to line 0; returns -1 only when no target was requested.
 */
export function findGlTargetLine(glText, { slideId = null, elementId = null } = {}) {
    const lines = String(glText ?? '').split('\n');
    const normSlideId = parseIdValue(slideId);
    const normElementId = parseIdValue(elementId);

    let slideLineIndex = -1;
    let inTargetSlide = normSlideId === null;

    for (let i = 0; i < lines.length; i++) {
        const trimmed = lines[i].trimStart();

        if (trimmed.startsWith('.slide')) {
            if (normSlideId === null) continue;
            if (hasIdParam(trimmed, normSlideId)) {
                slideLineIndex = i;
                inTargetSlide = true;
                if (normElementId === null) return i;
            } else if (inTargetSlide) {
                break;
            }
            continue;
        }

        if (normElementId !== null && inTargetSlide
            && isElementLine(trimmed) && hasIdParam(trimmed, normElementId)) {
            return i;
        }
    }

    if (slideLineIndex !== -1) return slideLineIndex;
    return normElementId !== null || normSlideId !== null ? 0 : -1;
}

/** The { slideId, elementId } that the given line belongs to, or null. */
export function findTargetAtLine(glText, lineIdx) {
    const lines = String(glText ?? '').split('\n');
    if (lineIdx < 0 || lines.length === 0) return null;
    const clamped = Math.min(lineIdx, lines.length - 1);

    let slideId = null;
    let elementId = null;
    for (let i = 0; i <= clamped; i++) {
        const trimmed = lines[i].trimStart();
        if (trimmed.startsWith('.slide')) {
            slideId = extractIdFromDirective(trimmed);
            elementId = null;
        } else if (trimmed.startsWith('.define')) {
            // Definitions are not on a slide.
            slideId = null;
            elementId = null;
        } else if (isElementLine(trimmed)) {
            // Elements inside definitions have no id; keep the enclosing one.
            const id = extractIdFromDirective(trimmed);
            if (id !== null) elementId = id;
        }
    }

    if (slideId === null && elementId === null) return null;
    return { slideId, elementId };
}

export function formatTargetLabel(target = {}, lineIdx = -1) {
    const parts = [];
    if (target.slideId !== null && target.slideId !== undefined) parts.push(`slide id:${target.slideId}`);
    if (target.elementId !== null && target.elementId !== undefined) parts.push(`element id:${target.elementId}`);
    const desc = parts.length ? ` (${parts.join(', ')})` : '';
    return lineIdx >= 0 ? `Line ${lineIdx + 1}${desc}` : 'Full file';
}
