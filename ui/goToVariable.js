// ============================================================
// ui/goToVariable.js — Ctrl+click on a variable's name (in the source
// view, a plot's formula or script editor, Project settings): goes to
// where it is defined. The one that wins is shown, as for its value: a
// slider (selected on its slide), else the file it comes from or the
// value written in the project (Project settings → Variables, its row
// marked).
// ============================================================

import { state, forEachElementDeep, flashSaveIndicator } from '../core/state.js';
import { valuesOfFile, INPUT_TYPES } from '../core/variables.js';
import { parseTracks } from '../core/liveEngine.js';
import { revealElement } from '../editor/navigate.js';
import { openProjectSettings } from './projectSettings.js';

/** Where variable `name` is defined: { kind: 'slider', id, type } (an input or an animation) | { kind: 'file', file } | { kind: 'written' } | null. */
export function variableSource(name) {
    let input = null;
    let animation = null;
    const visit = (els) => forEachElementDeep(els || [], el => {
        if (!input && INPUT_TYPES.includes(el.type) && el.var === name) input = el;
        if (!animation && el.type === 'animation' && parseTracks(el.tracks).some(t => t.name === name)) animation = el;
        // a colour key: its colours (runcol.adam) and the keys on (runcol.shown)
        if (!input && el.type === 'colorkey' && el.var && (name === el.var || name.startsWith(`${el.var}.`))) input = el;
    });
    (state.slides || []).forEach(s => visit(s.elements));
    (state.masters || []).forEach(m => visit(m.elements));
    if (input) return { kind: 'slider', id: input.id, type: input.type };
    if (animation) return { kind: 'slider', id: animation.id, type: 'animation' };
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
        flashSaveIndicator(`${name}: set by this ${{ slider: 'slider', checkbox: 'checkbox', numberbox: 'number box', textbox: 'text box', choice: 'choice', animation: 'animation', colorkey: 'colour key' }[src.type] || 'input'}`);
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
