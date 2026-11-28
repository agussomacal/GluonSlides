// ============================================================
// ui/colorPicker.js — Color fields with the project's theme colors.
//
// colorField() renders a swatch button carrying the color value
// (e.g. "@accent/40") in its `value`. Clicking it opens a popover:
// theme colors first, None, a custom color, and an opacity slider
// (kept separate from the color). Choosing sets the button's value and
// fires a normal `change` event, so the properties panel and the
// project settings handle it like any other control. Colours that can
// follow a variable (an object's, a plot layer's) also get "ƒ Follow a
// variable": each colour key's colours (=runcol['adam']) and a formula.
// ============================================================

import { palette, parseColor, formatColor, resolveColor, colorLabel, baseToHex } from '../core/colors.js';
import { escapeHtml } from '../core/render.js';

const POPOVER_ID = 'color-popover';
let current = null; // { container, attr, key, allowNone }

/**
 * A color field. `attrs` are its identifying data attributes, e.g.
 * { 'data-prop': 'bg' } or { 'data-default': 'text.fontColor' }.
 */
export function colorField(attrs, value, { allowNone = true } = {}) {
    const attrHtml = Object.entries(attrs).map(([k, v]) => `${k}="${escapeHtml(v)}"`).join(' ');
    return `
        <button type="button" class="prop-control color-field" ${attrHtml}
                value="${escapeHtml(value ?? '')}" data-allow-none="${allowNone ? 'yes' : 'no'}">
            ${swatchInner(value)}
        </button>`;
}

// colour settings that can follow a variable (core/bindings.js COLOR_KEYS; a plot layer's: data-allow-formula)
const FORMULA_PROPS = ['bg', 'borderCol', 'fontColor', 'stroke', 'fill', 'accent'];

/** The colour a formula gives now ('' if none). */
function formulaColor(value) {
    const v = evalColor ? evalColor(String(value).replace(/^=\s*/, '')) : null;
    return v && !v.error ? v.value : '';
}

function swatchInner(value) {
    // a formula: the colour it gives now, and the formula
    if (typeof value === 'string' && value.trim().startsWith('=')) {
        const now = formulaColor(value);
        return `<span class="color-swatch${now ? '' : ' color-none'}"><span style="background:${escapeHtml(now || 'transparent')}"></span></span>`
            + `<span class="color-name color-formula-name" title="Follows a variable">ƒ ${escapeHtml(value.trim().slice(1).trim())}</span>`;
    }
    const css = resolveColor(value);
    const none = !css || css === 'transparent' || css === 'none';
    return `<span class="color-swatch${none ? ' color-none' : ''}"><span style="background:${none ? 'transparent' : escapeHtml(css)}"></span></span>`
        + `<span class="color-name">${escapeHtml(colorLabel(value))}</span>`;
}

/** The field the popover edits (it may have been redrawn since). */
function currentField() {
    if (!current) return null;
    return current.container.querySelector(`.color-field[${current.attr}="${CSS.escape(current.key)}"]`);
}

/**
 * Sets the field's value and fires `change`. The popover is redrawn
 * (selection marks) unless a control in it is being dragged (opacity
 * slider, native color chooser), which a redraw would interrupt.
 */
function apply(value, { redraw = true } = {}) {
    const field = currentField();
    if (!field) return;
    field.value = value;
    if (String(value).trim().startsWith('=')) field.innerHTML = swatchInner(value);
    field.innerHTML = swatchInner(value);
    field.dispatchEvent(new Event('change', { bubbles: true }));
    if (redraw) renderPopover();
}

function close() {
    const pop = document.getElementById(POPOVER_ID);
    if (pop) pop.remove();
    current = null;
}

function renderPopover() {
    const field = currentField();
    const pop = document.getElementById(POPOVER_ID);
    if (!field || !pop) return;
    const { base, alpha } = parseColor(field.value);
    const theme = palette().map(p => `
        <button type="button" class="color-chip${base === `@${p.name}` ? ' selected' : ''}" data-theme="${escapeHtml(p.name)}"
                title="${escapeHtml(p.name)} (${escapeHtml(p.color)})" style="background:${escapeHtml(p.color)}"></button>`).join('');
    const customHex = baseToHex(base) || '#000000';
    const isNone = !base || base === 'transparent' || base === 'none';
    pop.innerHTML = `
        <div class="color-pop-title">Theme colors</div>
        <div class="color-chips">
            ${theme}
            ${current.allowNone ? `<button type="button" class="color-chip color-none${isNone ? ' selected' : ''}" data-none title="None"></button>` : ''}
        </div>
        <div class="color-pop-row">
            <label class="color-custom" title="Pick any color">
                <input type="color" value="${customHex}" data-custom>
                <span>＋ Custom…</span>
            </label>
            <input type="text" class="color-hex" value="${base.startsWith('#') ? escapeHtml(base) : ''}" placeholder="#rrggbb" spellcheck="false" data-hex>
        </div>
        <div class="color-pop-title">Opacity</div>
        <div class="color-pop-row">
            <input type="range" min="0" max="100" step="5" value="${alpha}" data-alpha ${isNone ? 'disabled' : ''}>
            <span class="color-alpha-value">${alpha}%</span>
        </div>
        ${current.formulas ? followSection(field.value) : ''}
        <button type="button" class="link-btn color-edit-theme" data-edit-theme>Edit theme colors…</button>`;
    const input = pop.querySelector('[data-color-follow]');
    if (input && attachInput) attachInput(input);
}

/** "ƒ Follow a variable": each colour key's colours to click, and a formula of the variables. */
function followSection(value) {
    const vars = allVars ? allVars() : {};
    const keys = Object.keys(vars).filter(n => n.endsWith('.shown') && Array.isArray(vars[n])).map(n => n.slice(0, -6));
    const formula = typeof value === 'string' && value.trim().startsWith('=') ? value.trim() : '';
    const rows = keys.map(k => `<div class="color-key-row"><code>${escapeHtml(k)}</code>${Object.keys(vars).filter(n => n.startsWith(`${k}.`) && n !== `${k}.shown`).map(n => {
        const key = n.slice(k.length + 1);
        const f = `=${k}['${key.replace(/\\/g, '\\\\').replace(/'/g, "\\'")}']`;
        return `<button type="button" class="color-chip${formula === f ? ' selected' : ''}" data-follow="${escapeHtml(f)}" title="${escapeHtml(`${key}: ${f}`)}" style="background:${escapeHtml(String(vars[n]))}"></button>`;
    }).join('')}</div>`).join('');
    return `<div class="color-pop-title">ƒ Follow a variable</div>
        ${rows || '<p class="color-follow-hint">A <b>🎨 Colour key</b> (Interactive ▾) gives each run a colour to pick here.</p>'}
        <div class="prop-group color-follow"><input type="text" class="prop-control" data-color-follow data-color-formula spellcheck="false" value="${escapeHtml(formula || '=')}" placeholder="=runcol[pick]" title="A colour from the variables: =runcol[pick], =palette(2), =cmap(err, 0, 1)"></div>`;
}

/** Shows a field's value again (a formula set from outside: the panel). */
export function refreshColorField(field, value) {
    field.value = value;
    field.innerHTML = swatchInner(value);
}

// set by the page (no import cycle: bindings and variables import this file's users)
let evalColor = null;
let allVars = null;
let attachInput = null;
/** Lets the picker show and take colour formulas. */
export function enableColorFormulas({ evaluateColor, allVariables, attachFormulaInput }) {
    evalColor = evaluateColor;
    allVars = allVariables;
    attachInput = attachFormulaInput;
}

/** Puts the popover below its field (above when there is no room). */
function place(pop, field) {
    const r = field.getBoundingClientRect();
    const left = Math.min(r.left, window.innerWidth - pop.offsetWidth - 8);
    const below = window.innerHeight - r.bottom - 8;
    pop.style.left = `${Math.max(8, left)}px`;
    pop.style.top = pop.offsetHeight > below && r.top > below
        ? `${Math.max(8, r.top - pop.offsetHeight - 4)}px`
        : `${r.bottom + 4}px`;
}

function open(field) {
    close();
    const container = field.closest('#properties-body, .project-settings') || document.body;
    // data-color-key: any other field, named uniquely (e.g. a plot layer's colour)
    const attr = ['data-color-key', 'data-prop', 'data-default', 'data-style-field', 'data-table-style'].find(a => field.hasAttribute(a));
    const formulas = Boolean(evalColor) && (field.dataset.allowFormula === 'yes' || (attr === 'data-prop' && FORMULA_PROPS.includes(field.getAttribute(attr)) && Boolean(container.closest && container.closest('#properties-body'))));
    current = { container, attr, key: field.getAttribute(attr), allowNone: field.dataset.allowNone !== 'no', formulas };
    const pop = document.createElement('div');
    pop.id = POPOVER_ID;
    pop.className = 'color-popover';
    document.body.appendChild(pop);
    renderPopover();

    place(pop, field);

    pop.addEventListener('click', (e) => {
        const field2 = currentField();
        if (!field2) return;
        const { alpha } = parseColor(field2.value);
        const chip = e.target.closest('[data-theme]');
        if (chip) apply(formatColor(`@${chip.dataset.theme}`, alpha));
        const follow = e.target.closest('[data-follow]');
        if (follow) apply(follow.dataset.follow);
        if (e.target.closest('[data-none]')) apply('transparent');
        if (e.target.closest('[data-edit-theme]')) {
            close();
            document.dispatchEvent(new CustomEvent('open-project-settings', { detail: { tab: 'colors' } }));
        }
    });
    pop.addEventListener('input', (e) => {
        const field2 = currentField();
        if (!field2) return;
        const { base, alpha } = parseColor(field2.value);
        if (e.target.matches('[data-custom]')) {
            apply(formatColor(e.target.value, alpha), { redraw: false });
            pop.querySelectorAll('.color-chip.selected').forEach(c => c.classList.remove('selected'));
            pop.querySelector('[data-alpha]').disabled = false;
        }
        if (e.target.matches('[data-alpha]')) {
            pop.querySelector('.color-alpha-value').textContent = `${e.target.value}%`;
            apply(formatColor(base, Number(e.target.value)), { redraw: false });
        }
    });
    // a formula typed: kept on Enter (the suggestion list closed) or when leaving the field
    pop.addEventListener('keydown', (e) => {
        if (!e.target.matches('[data-color-follow]') || e.key !== 'Enter' || e.defaultPrevented) return;
        e.preventDefault();
        const v = e.target.value.trim();
        if (v.replace(/^=\s*/, '')) apply(v.startsWith('=') ? v : `=${v}`);
    });
    pop.addEventListener('change', (e) => {
        if (e.target.matches('[data-color-follow]')) {
            const v = e.target.value.trim().replace(/^=\s*/, '');
            if (v) apply(`=${v}`, { redraw: false });
            return;
        }
        if (!e.target.matches('[data-hex]')) return;
        const v = e.target.value.trim();
        if (!/^#[0-9a-fA-F]{6}$/.test(v)) return;
        const { alpha } = parseColor(currentField()?.value);
        apply(formatColor(v.toLowerCase(), alpha));
    });
}

export function initColorPicker() {
    document.addEventListener('click', (e) => {
        const field = e.target.closest('.color-field');
        if (field) {
            e.preventDefault();
            if (current && currentField() === field) close();
            else open(field);
        }
    });
    document.addEventListener('mousedown', (e) => {
        const pop = document.getElementById(POPOVER_ID);
        if (pop && !pop.contains(e.target) && !e.target.closest('.color-field')) close();
    }, true);
    // Follow the field when its panel scrolls; close once it is out of view.
    document.addEventListener('scroll', (e) => {
        const pop = document.getElementById(POPOVER_ID);
        if (!pop || pop.contains(e.target)) return;
        const field = currentField();
        const scroller = field && field.closest('.properties-sidebar, .settings-content');
        const r = field && field.getBoundingClientRect();
        const b = scroller ? scroller.getBoundingClientRect() : { top: 0, bottom: window.innerHeight };
        if (field && r.bottom > b.top && r.top < b.bottom) place(pop, field);
        else close();
    }, true);
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && current) {
            e.stopPropagation();
            close();
        }
    }, true);
}
