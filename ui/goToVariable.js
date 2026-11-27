// ============================================================
// ui/goToVariable.js — Ctrl+click on a variable's name (in the source
// view, a plot's formula or script editor, Project settings): goes to
// where it is defined. The one that wins is shown, as for its value: a
// slider (selected on its slide), else the file it comes from or the
// value written in the project (Project settings → Variables, its row
// marked).
// ============================================================

import { state, forEachElementDeep, flashSaveIndicator } from '../core/state.js';
import { valuesOfFile } from '../core/variables.js';
import { revealElement } from '../editor/navigate.js';
import { openProjectSettings } from './projectSettings.js';

/** Where variable `name` is defined: { kind: 'slider', id } | { kind: 'file', file } | { kind: 'written' } | null. */
export function variableSource(name) {
    let slider = null;
    const visit = (els) => forEachElementDeep(els || [], el => {
        if (!slider && el.type === 'slider' && el.var === name) slider = el;
    });
    (state.slides || []).forEach(s => visit(s.elements));
    (state.masters || []).forEach(m => visit(m.elements));
    if (slider) return { kind: 'slider', id: slider.id };
    const file = [...(state.varFiles || [])].reverse().find(f => { const v = valuesOfFile(f.file); return v && name in v; });
    if (file) return { kind: 'file', file: file.file };
    if (state.vars && name in state.vars) return { kind: 'written' };
    return null;
}

/** Shows the definition of `name`. False when there is no variable of that name. */
export function goToVariable(name) {
    const src = variableSource(name);
    if (!src) return false;
    if (src.kind === 'slider') {
        revealElement(src.id);
        flashSaveIndicator(`${name}: set by this slider`);
        return true;
    }
    openProjectSettings('variables');
    requestAnimationFrame(() => {
        const row = src.kind === 'file'
            ? document.querySelector(`[data-var-file-name="${CSS.escape(src.file)}"]`)
            : document.querySelector(`[data-var-name="${CSS.escape(name)}"]`);
        if (!row) return;
        row.scrollIntoView({ block: 'center' });
        row.classList.add('find-flash');
        setTimeout(() => row.classList.remove('find-flash'), 1400);
        if (src.kind === 'written') row.querySelector('[data-var-value]')?.focus();
    });
    return true;
}
