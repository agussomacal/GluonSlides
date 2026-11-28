// ============================================================
// elements/animation/animation.js — An animation: variables that move by
// themselves while presenting, all in step (core/liveEngine.js plays it).
// In the editor it is a small dashed chip saying what it does; in the
// slide show and the exports it is invisible. It starts when its slide is
// shown, or at its build step (step:2: the second click), and stops after
// `until`, when it ends, or when the slide is left; the variables keep the
// values they reached. The PDF shows each step as the animations end there.
//
//   .element.animation id:20 duration:3 easing:inout repeat:once step:2
//   	mu: -2 -> 2
//   	sigma: 1 -> 0.5
//   	phase = 2*pi*t/4
//
// A line "name: from -> to" goes from one value to the other over the
// duration (with the easing; repeat: once, loop, bounce); "name = …" is a
// formula of t (seconds) and p (the eased progress, 0 to 1).
// ============================================================

import { state, markDirty, activeElements } from '../../core/state.js';
import { ElementRegistry } from '../../core/registry.js';
import { escapeHtml } from '../../core/render.js';
import { parseTracks, animationAt, animationPlayer, liveUpdate, formatValue, EASINGS } from '../../core/liveEngine.js';
import { allVariables, setLiveValue } from '../../core/variables.js';
import { liveApplyToCanvas } from '../../core/bindings.js';

const REPEATS = [['once', 'once'], ['loop', 'loop'], ['bounce', 'back and forth']];
const EASING_LABELS = { linear: 'steady', in: 'speeding up', out: 'slowing down', inout: 'smooth (in and out)' };

const specOf = (el) => ({ tracks: el.tracks || '', duration: el.duration, easing: el.easing || 'linear', repeat: el.repeat || 'once', afterwards: el.afterwards || 'keep' });

function summary(el) {
    const tracks = parseTracks(el.tracks);
    const lines = tracks.filter(t => !t.error).map(t => (t.formula !== undefined ? `${t.name} = ${t.formula}` : `${t.name}: ${t.from} → ${t.to}`));
    const d = Number(el.duration) > 0 ? `${el.duration} s` : 'no end';
    const rep = el.repeat && el.repeat !== 'once' ? ` · ${el.repeat === 'bounce' ? 'back and forth' : 'loop'}` : '';
    return { lines, when: `${d}${rep}${Number(el.step) > 1 ? ` · from step ${el.step}` : ''}` };
}

function chipMarkup(el) {
    const { lines, when } = summary(el);
    const fs = Math.max(12, Math.min(26, (Number(el.height) || 80) / Math.max(2.4, lines.length + 1.4)));
    return `<div class="gl-animation-chip" style="position:absolute; inset:0; display:flex; flex-direction:column; justify-content:center; gap:2px; padding:4px 10px; font:${fs}px/1.25 ui-monospace, Menlo, monospace; border:2px dashed #7c3aed; border-radius:10px; background:rgba(124,58,237,0.08); color:#6d28d9; overflow:hidden; box-sizing:border-box;">
        <div style="font-weight:700;">▶ ${escapeHtml(lines[0] || 'no variable yet')}</div>
        ${lines.slice(1, 4).map(l => `<div>${escapeHtml(l)}</div>`).join('')}${lines.length > 4 ? '<div>…</div>' : ''}
        <div style="opacity:0.75; font-size:0.85em;">${escapeHtml(when)}</div></div>`;
}

// ---------- preview in the editor ----------

let preview = null; // { player, el }

function showValues(values) {
    Object.entries(values).forEach(([k, v]) => setLiveValue(k, v));
    const canvas = document.getElementById('slide-canvas');
    const vars = allVariables();
    liveUpdate(canvas, vars);
    liveApplyToCanvas(canvas, vars);
}

function stopPreview(redraw = true) {
    if (!preview) return;
    preview.player.stopAll();
    preview = null;
    document.querySelectorAll('[data-anim-op="preview"]').forEach(b => { b.textContent = '▶ Preview'; });
    if (redraw) import('../../editor/editor.js').then(m => m.redrawCanvas());
}

function startPreview(el) {
    stopPreview(false);
    const vars = { ...allVariables() };
    const names = parseTracks(el.tracks).filter(t => !t.error).map(t => t.name);
    const player = animationPlayer(vars, () => {
        showValues(Object.fromEntries(names.map(n => [n, vars[n]])));
        if (!player.isRunning()) setTimeout(() => stopPreview(true), 0);
    });
    preview = { player, el };
    player.start('preview', specOf(el));
    document.querySelectorAll('[data-anim-op="preview"]').forEach(b => { b.textContent = '■ Stop'; });
}

// ---------- the panel's lines ----------

function writeTracks(el, rows) {
    el.tracks = rows.filter(r => r.name).map(r => (r.mode === 'formula' ? `${r.name} = ${r.formula || '0'}` : `${r.name}: ${r.from || '0'} -> ${r.to || '0'}`)).join('\n');
}

function rowsOf(el) {
    return parseTracks(el.tracks).filter(t => !t.error).map(t => (t.formula !== undefined
        ? { name: t.name, mode: 'formula', formula: t.formula } : { name: t.name, mode: 'range', from: t.from, to: t.to }));
}

function selected() {
    const el = activeElements()[state.selectedElementIndex];
    return el && el.type === 'animation' ? el : null;
}

function initPanel() {
    const panel = document.getElementById('properties-body');
    if (!panel || panel._animPanel) return;
    panel._animPanel = true;
    panel.addEventListener('change', (e) => {
        const f = e.target.closest('[data-anim-field]');
        const el = selected();
        if (!f || !el) return;
        const rows = rowsOf(el);
        const i = Number(f.dataset.row);
        if (!rows[i]) return;
        rows[i][f.dataset.animField] = f.value.trim();
        writeTracks(el, rows);
        markDirty();
        document.dispatchEvent(new CustomEvent('slide-content-changed'));
    });
    panel.addEventListener('input', (e) => {
        const scrub = e.target.closest('[data-anim-scrub]');
        const el = selected();
        if (!scrub || !el) return;
        stopPreview(false);
        const t = Number(scrub.value);
        const { values } = animationAt(specOf(el), t, allVariables());
        showValues(values);
        const out = panel.querySelector('[data-anim-time]');
        if (out) out.textContent = `t = ${t.toFixed(2)} s · ${Object.entries(values).map(([k, v]) => `${k} = ${formatValue(v)}`).join(', ')}`;
    });
    panel.addEventListener('click', (e) => {
        const op = e.target.closest('[data-anim-op]');
        const el = selected();
        if (!op || !el) return;
        const rows = rowsOf(el);
        switch (op.dataset.animOp) {
            case 'add': {
                const vars = Object.keys(allVariables());
                rows.push({ name: vars.find(v => !rows.some(r => r.name === v)) || 'v', mode: 'range', from: '0', to: '1' });
                writeTracks(el, rows);
                break;
            }
            case 'remove': rows.splice(Number(op.dataset.row), 1); writeTracks(el, rows); break;
            case 'preview':
                if (preview) stopPreview(true); else startPreview(el);
                return;
            default: return;
        }
        markDirty();
        document.dispatchEvent(new CustomEvent('slide-content-changed'));
    });
}

ElementRegistry.register({
    type: 'animation', label: 'Add Animation', icon: '⏱️', className: 'element-animation', category: 'interactive',

    gl: {
        props: ['x', 'y', 'width', 'height', 'duration', 'easing', 'repeat', 'afterwards'],
        numericProps: ['x', 'y', 'width', 'height', 'duration'],
        body: 'tracks',
    },

    defaults() {
        const scale = state.slideWidth / 1920;
        const name = Object.keys(allVariables())[0] || 'v';
        return {
            type: 'animation', x: 0, y: 0, width: Math.round(420 * scale), height: Math.round(110 * scale),
            duration: 2, easing: 'inout', repeat: 'once', tracks: `${name}: 0 -> 1`,
            bg: 'transparent', borderCol: 'transparent', borderWidth: 0, borderStyle: 'solid',
        };
    },

    renderDom(domEl, el) {
        domEl.innerHTML = chipMarkup(el);
    },

    // invisible when presenting and in the exports: it only moves its variables
    exportStyle: () => 'display:none;',
    exportInner(el) {
        return `<div data-glanim="${escapeHtml(JSON.stringify(specOf(el)))}"></div>`;
    },

    properties(el) {
        initPanel();
        const vars = allVariables();
        const names = Object.keys(vars).sort();
        const rows = rowsOf(el).map((r, i) => `
            <div class="anim-row">
                <input class="prop-control" list="anim-var-names" value="${escapeHtml(r.name)}" data-anim-field="name" data-row="${i}" spellcheck="false" title="The variable">
                <select class="prop-control" data-anim-field="mode" data-row="${i}">
                    <option value="range" ${r.mode === 'range' ? 'selected' : ''}>from → to</option>
                    <option value="formula" ${r.mode === 'formula' ? 'selected' : ''}>= formula of t</option>
                </select>
                ${r.mode === 'formula'
        ? `<input class="prop-control anim-wide" value="${escapeHtml(r.formula || '')}" data-anim-field="formula" data-row="${i}" spellcheck="false" placeholder="e.g. 2*sin(2*pi*t/3)" title="t: seconds; p: progress 0→1 (eased)">`
        : `<input class="prop-control" value="${escapeHtml(r.from ?? '')}" data-anim-field="from" data-row="${i}" spellcheck="false" title="From (a number or a formula)">
                   <input class="prop-control" value="${escapeHtml(r.to ?? '')}" data-anim-field="to" data-row="${i}" spellcheck="false" title="To (a number or a formula)">`}
                <button type="button" class="prop-reset" data-anim-op="remove" data-row="${i}" title="Remove">✕</button>
            </div>`).join('');
        const d = Number(el.duration) > 0 ? Number(el.duration) : 10;
        return `
            <div class="prop-divider"></div>
            <div class="prop-group">
                <label>What moves</label>
                <div class="anim-rows">${rows || '<p class="prop-hint"><em>Nothing yet.</em></p>'}</div>
                <datalist id="anim-var-names">${names.map(n => `<option value="${escapeHtml(n)}">`).join('')}</datalist>
                <button type="button" class="btn btn-secondary" data-anim-op="add">＋ A variable</button>
            </div>
            <div class="prop-row">
                <div class="prop-group"><label title="Seconds (empty: it goes on until the slide is left)">Duration (s)</label><input type="number" class="prop-control" min="0" step="0.1" value="${el.duration ?? ''}" placeholder="no end" data-prop="duration"></div>
                <div class="prop-group"><label>Pace</label><select class="prop-control" data-prop="easing">${EASINGS.map(k => `<option value="${k}" ${(el.easing || 'linear') === k ? 'selected' : ''}>${EASING_LABELS[k]}</option>`).join('')}</select></div>
            </div>
            <div class="prop-row">
                <div class="prop-group"><label>Repeat</label><select class="prop-control" data-prop="repeat">${REPEATS.map(([k, t]) => `<option value="${k}" ${(el.repeat || 'once') === k ? 'selected' : ''}>${t}</option>`).join('')}</select></div>
                <div class="prop-group"><label title="When it stops (its slide left, or after its last step)">Afterwards</label><select class="prop-control" data-prop="afterwards">
                    <option value="keep" ${(el.afterwards || 'keep') === 'keep' ? 'selected' : ''}>keep the values</option>
                    <option value="reset" ${el.afterwards === 'reset' ? 'selected' : ''}>back to the start</option></select></div>
            </div>
            <div class="prop-group">
                <button type="button" class="btn btn-secondary" data-anim-op="preview">${preview ? '■ Stop' : '▶ Preview'}</button>
                <input type="range" min="0" max="${d}" step="${d / 200}" value="0" data-anim-scrub style="width:100%; margin-top:6px;" title="Look at a moment of it">
                <div class="prop-hint" data-anim-time>Drag to look at a moment.</div>
            </div>
            <p class="prop-hint">Invisible when presenting: it starts when the slide shows, or at <em>Appears at step</em> (a click), and stops after <em>Disappears after step</em>, at its end, or when the slide is left. Moving one of its variables by hand (a slider) stops it. The PDF shows where it ends at each step.</p>`;
    },
});

