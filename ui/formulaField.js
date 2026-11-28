// ============================================================
// ui/formulaField.js — Number fields of the properties panel that take a
// formula of the variables: typing "=" starts one (core/bindings.js).
// The field then shows the formula (marked ƒ), what it gives now (or
// what is wrong) under it, and suggests the variables and functions as
// you type, and every one right after "=", an operator or a bracket, or
// with Ctrl+Space (↑ ↓, Enter or Tab to take one, Esc to close). A plain number
// typed in replaces the formula. Ctrl+click on a variable's name goes
// to its definition.
// ============================================================

import { ElementRegistry } from '../core/registry.js';
import { evaluateFormula, BINDABLE_COMMON } from '../core/bindings.js';
import { allVariables } from '../core/variables.js';
import { formulaNames, formatValue } from '../core/liveEngine.js';
import { escapeHtml } from '../core/render.js';

let menu = null;
let menuItems = [];
let menuIndex = 0;
let menuField = null;

function bindableKeys(el) {
    const def = ElementRegistry.get(el.type);
    const own = (def && def.gl && def.gl.numericProps) || [];
    return new Set([...BINDABLE_COMMON, ...own].filter(k => k !== 'step' && k !== 'until'));
}

function showResult(field) {
    const box = field.parentElement.querySelector('.formula-result');
    if (!box) return;
    const text = field.value.trim();
    const isFormula = text.startsWith('=') || (field.hasAttribute('data-formula-only') && text);
    field.classList.toggle('has-formula', Boolean(isFormula));
    if (!isFormula) { box.textContent = ''; box.classList.remove('error'); return; }
    const r = evaluateFormula(text.replace(/^=\s*/, ''));
    box.classList.toggle('error', Boolean(r.error));
    box.textContent = r.error ? r.error
        : field.hasAttribute('data-formula-only') ? (r.value ? 'shown now' : 'hidden now')
            : `= ${formatValue(r.value)} now`;
}

function closeMenu() {
    if (menu) menu.remove();
    menu = null;
    menuField = null;
}

function wordBefore(field) {
    const upto = field.value.slice(0, field.selectionStart ?? field.value.length);
    const m = upto.match(/[A-Za-z_][A-Za-z0-9_]*$/);
    return m ? m[0] : '';
}

/** At the start of a term (after =, an operator, a bracket, a comma or a space): every name is offered. */
function atTermStart(field) {
    const upto = field.value.slice(0, field.selectionStart ?? field.value.length);
    return /(^=?|[=+\-*/%(,<>&|!\s])$/.test(upto);
}

function openMenu(field, { all = false } = {}) {
    const text = field.value;
    if (!(text.trim().startsWith('=') || field.hasAttribute('data-formula-only'))) { closeMenu(); return; }
    const typed = wordBefore(field);
    if (!typed && !all && !atTermStart(field)) { closeMenu(); return; }
    const vars = allVariables();
    const { functions, constants } = formulaNames();
    menuItems = [
        ...Object.keys(vars).sort().map(n => ({ insert: n, label: n, note: formatValue(vars[n]) })),
        ...functions.map(n => ({ insert: `${n}(`, label: `${n}(…)`, note: '' })),
        ...constants.map(n => ({ insert: n, label: n, note: '' })),
    ].filter(it => it.insert.toLowerCase().startsWith(typed.toLowerCase()) && it.insert !== typed).slice(0, 60);
    // a whole name typed (n, mu): no list, so Enter keeps the formula instead of taking a longer name
    if (typed && (typed in vars || constants.includes(typed))) { closeMenu(); return; }
    if (!menuItems.length) { closeMenu(); return; }
    if (!menu) {
        menu = document.createElement('div');
        menu.className = 'formula-menu';
        menu.addEventListener('mousedown', (e) => {
            e.preventDefault();
            const row = e.target.closest('[data-i]');
            if (row) accept(Number(row.dataset.i));
        });
        document.body.appendChild(menu);
    }
    menuField = field;
    menuIndex = 0;
    menu.innerHTML = menuItems.map((it, i) => `<div data-i="${i}" class="${i === 0 ? 'active' : ''}">${escapeHtml(it.label)}<span>${escapeHtml(it.note)}</span></div>`).join('');
    const r = field.getBoundingClientRect();
    menu.style.left = `${Math.max(8, Math.min(r.left, window.innerWidth - 240))}px`;
    menu.style.top = `${r.bottom + 2}px`;
}

function accept(i) {
    const field = menuField;
    const it = menuItems[i];
    if (!field || !it) return;
    const at = field.selectionStart ?? field.value.length;
    const typed = wordBefore(field);
    field.value = field.value.slice(0, at - typed.length) + it.insert + field.value.slice(at);
    const caret = at - typed.length + it.insert.length;
    field.setSelectionRange(caret, caret);
    closeMenu();
    field.dispatchEvent(new Event('input', { bubbles: true }));
}

/**
 * A field that takes a formula: its value now (or what is wrong) under it
 * (a .formula-result next to it), the names suggested, Ctrl+click on a
 * variable goes to its definition. Used by the panel and by Follow a
 * variable… (ui/followVariable.js).
 */
export function attachFormulaInput(field) {
    field.title = field.title || 'A number, or "=" and a formula of the variables (e.g. =100 + 50*mu)';
    if (!field.parentElement.querySelector('.formula-result')) field.insertAdjacentHTML('afterend', '<div class="formula-result"></div>');
    showResult(field);
    field.addEventListener('input', () => { setTimeout(() => showResult(field), 0); openMenu(field); });
    // leaving the field: its own list closes (not one another field has opened since)
    field.addEventListener('blur', () => setTimeout(() => { if (menuField === field) closeMenu(); }, 100));
    // a field holding just "=" (or a condition being started): the names right away
    field.addEventListener('focus', () => { if (/^=?\s*$/.test(field.value) && (field.value.trim() === '=' || field.hasAttribute('data-formula-only'))) openMenu(field, { all: true }); });
    field.addEventListener('keydown', (e) => {
        // Ctrl+Space: every name, whatever is typed
        if (e.key === ' ' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); openMenu(field, { all: true }); return; }
        if (!menu || menuField !== field) return;
        if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
            e.preventDefault();
            menuIndex = (menuIndex + (e.key === 'ArrowDown' ? 1 : -1) + menuItems.length) % menuItems.length;
            menu.querySelectorAll('[data-i]').forEach((row, i) => row.classList.toggle('active', i === menuIndex));
        } else if (e.key === 'Enter' || e.key === 'Tab') {
            e.preventDefault();
            accept(menuIndex);
        } else if (e.key === 'Escape') {
            e.preventDefault();
            closeMenu();
        }
    });
    // Ctrl+click on a variable's name in the formula: its definition
    field.addEventListener('mousedown', (e) => {
        if (!(e.ctrlKey || e.metaKey)) return;
        setTimeout(() => {
            const at = field.selectionStart ?? 0;
            const left = field.value.slice(0, at).match(/[A-Za-z_]\w*$/);
            const right = field.value.slice(at).match(/^\w*/);
            const word = `${left ? left[0] : ''}${right ? right[0] : ''}`;
            if (word && word in allVariables()) import('./goToVariable.js').then(m => m.goToVariable(word));
        }, 0);
    });

}

/** Makes the panel's number fields take formulas (called after the panel is drawn). */
export function enhanceFormulaFields(panel, el) {
    if (!panel || !el) return;
    const keys = bindableKeys(el);
    panel.querySelectorAll('input[data-prop]').forEach(field => {
        const key = field.dataset.prop;
        if (!keys.has(key) || field.type === 'checkbox') return;
        if (field.type === 'number') {
            field.type = 'text';
            field.setAttribute('inputmode', 'decimal');
            field.spellcheck = false;
        }
        const formula = el.formulas && el.formulas[key];
        if (formula && !field.hasAttribute('data-formula-only')) field.value = `=${formula}`;
        if (formula) {
            const label = field.closest('.prop-group')?.querySelector('label');
            if (label && !label.querySelector('.formula-badge')) label.insertAdjacentHTML('beforeend', '<span class="formula-badge" title="Given by a formula of the variables">ƒ</span>');
        }
        attachFormulaInput(field);
    });
}
