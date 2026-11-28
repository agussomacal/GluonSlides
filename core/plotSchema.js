// ============================================================
// core/plotSchema.js — What each plot layer is and takes: the one
// description the layer cards (elements/plot), the suggestions in the
// source view (editor/inspector/completions.js) and the checks for
// unknown settings all read. The drawing itself is core/liveEngine.js.
//
// A setting: { key, type, label, help, def?, options? }
//   type: text | color | bool | number | int (both may also be "=" and a
//   formula of the variables; int is rounded to the nearest) | formula (a
//   number or a formula of the variables) | condition (true/false of the
//   variables) | select | file | column (a column of the layer's data file)
// ============================================================

import { COLORMAP_NAMES } from './liveEngine.js';

const label = { key: 'label', type: 'text', label: 'Label', help: 'In the legend (Markdown and math)' };
const color = { key: 'color', type: 'color', label: 'Colour', help: 'A colour or a theme colour' };
const hidden = { key: 'hidden', type: 'bool', label: 'Hidden', help: 'Not drawn (kept in the file)', def: 'no' };
const group = { key: 'group', type: 'column', label: 'One per value of', help: 'Long format (run, step, loss): a line (points, bars, histogram) per value of this column, coloured, named in the legend' };
const show = { key: 'show', type: 'text', label: 'Only show', help: 'With "One per value of": the values shown — written (adam, sgd) or "=" and a variable (=pick, a choice)' };
const visible = { key: 'visible', type: 'condition', label: 'Visible when', help: 'A condition on the variables (e.g. model == \'Gaussian\'): drawn only while it is true' };
const lang = { key: 'lang', type: 'select', label: 'Written in', help: "This layer's formula language (else the plot's)", options: [['', "the plot's"], ['python', 'Python'], ['latex', 'LaTeX']] };
const width = { key: 'width', type: 'number', label: 'Width', help: 'Line width in pixels', def: 3 };
const dash = { key: 'dash', type: 'select', label: 'Line', options: [['', 'solid'], ['dashed', 'dashed'], ['dotted', 'dotted']] };
const opacity = (def) => ({ key: 'opacity', type: 'number', label: 'Opacity', help: '0 (none) to 1 (solid)', def });
const from = (def, help = 'From (a number or a formula of the variables)') => ({ key: 'from', type: 'formula', label: 'From', help, def });
const to = (def, help = 'To (a number or a formula of the variables)') => ({ key: 'to', type: 'formula', label: 'To', help, def });
const samples = { key: 'samples', type: 'int', label: 'Points', help: 'Points computed', def: 400 };
const data = { key: 'data', type: 'file', label: 'Data file', help: 'A CSV in the project (else the rows written in the formula box)' };
const original = { key: 'original', type: 'text', label: 'Original', help: 'The file the copy in data/ follows', hiddenField: true };
const colormap = (def) => ({ key: 'colormap', type: 'select', label: 'Colour map', options: [...(def ? [] : [['', 'one colour']]), ...COLORMAP_NAMES.map(n => [n, n])], def });
const resolution = (def) => ({ key: 'resolution', type: 'int', label: 'Cells across', help: 'Grid cells computed across the plot', def });

/** kind -> { label, icon, formula (what its lines hold, or null), coords (names the formula gets), outputs, params } */
export const LAYERS = {
    curve: { label: 'Curve', icon: '〰', formula: 'y = … in x (helper lines first)', coords: ['x'], outputs: ['y'], params: [label, color, width, dash, samples, lang, visible, hidden] },
    fill: { label: 'Area', icon: '◭', formula: 'y = … the top (y0 = … the bottom, else 0)', coords: ['x'], outputs: ['y', 'y0'], params: [label, color, opacity(0.3), from('', 'From (else the plot’s x range)'), to('', 'To (else the plot’s x range)'), samples, lang, visible, hidden] },
    parametric: { label: 'Parametric', icon: '➰', formula: 'x = … and y = … in t', coords: ['t'], outputs: ['x', 'y'], params: [label, color, width, dash, from(0), to('2*pi'), samples, lang, visible, hidden] },
    vline: { label: 'Vertical line', icon: '│', formula: null, params: [{ key: 'x', type: 'formula', label: 'At x', help: 'A number or a formula of the variables' }, { ...label, help: 'Shown next to it' }, color, width, { ...dash, options: [['dashed', 'dashed'], ['solid', 'solid'], ['dotted', 'dotted']] }, visible, hidden] },
    hline: { label: 'Horizontal line', icon: '─', formula: null, params: [{ key: 'y', type: 'formula', label: 'At y', help: 'A number or a formula of the variables' }, { ...label, help: 'Shown next to it' }, color, width, { ...dash, options: [['dashed', 'dashed'], ['solid', 'solid'], ['dotted', 'dotted']] }, visible, hidden] },
    point: { label: 'Point', icon: '•', formula: null, params: [{ key: 'x', type: 'formula', label: 'x' }, { key: 'y', type: 'formula', label: 'y' }, { ...label, help: 'Shown next to it' }, color, { key: 'size', type: 'number', label: 'Size', def: 7 }, visible, hidden] },
    text: { label: 'Text', icon: 'T', formula: null, params: [{ ...label, label: 'Text', help: 'The text shown' }, { key: 'x', type: 'formula', label: 'x' }, { key: 'y', type: 'formula', label: 'y' }, color, { key: 'align', type: 'select', label: 'Align', options: [['', 'left'], ['center', 'centre'], ['right', 'right']] }, { key: 'size', type: 'number', label: 'Size' }, visible, hidden] },
    points: { label: 'Points', icon: '⁘', formula: 'rows: x, y (or x, y, error), if no data file', rows: true, params: [label, color, data, { key: 'x', type: 'column', label: 'x column' }, { key: 'y', type: 'column', label: 'y column' }, { key: 'yerr', type: 'column', label: 'Error bars' }, { key: 'size', type: 'number', label: 'Size', def: 5 }, group, show, original, visible, hidden] },
    line: { label: 'Line (data)', icon: '📈', formula: 'rows: x, y, if no data file', rows: true, params: [label, color, data, { key: 'x', type: 'column', label: 'x column' }, { key: 'y', type: 'column', label: 'y column' }, width, dash, { key: 'markers', type: 'bool', label: 'Points', def: 'no' }, group, show, original, visible, hidden] },
    hist: { label: 'Histogram', icon: '▙', formula: 'y = … drawn samples times (e.g. normal(mu, 1)), or rows of numbers', coords: ['i'], outputs: ['y'], rows: true, params: [label, color, data, { key: 'column', type: 'column', label: 'Column' }, { key: 'samples', type: 'int', label: 'Samples', help: 'Draws of the formula', def: 1000 }, { key: 'seed', type: 'int', label: 'Seed', help: 'The same seed, the same draws', def: 1 }, { key: 'bins', type: 'int', label: 'Bins', def: 30 }, { key: 'density', type: 'bool', label: 'Density (area 1)', def: 'no' }, from('', 'From (else the x range)'), to('', 'To (else the x range)'), opacity(0.55), lang, group, show, original, visible, hidden] },
    bar: { label: 'Bars', icon: '▮', formula: 'rows: name, value (or number, value), if no data file', rows: true, params: [label, color, data, { key: 'x', type: 'column', label: 'Names column' }, { key: 'y', type: 'column', label: 'Values column' }, { key: 'barwidth', type: 'number', label: 'Bar width', help: 'Of the space for each bar', def: 0.8 }, { key: 'offset', type: 'number', label: 'Offset', help: 'To put sets side by side (e.g. −0.2 and 0.2)', def: 0 }, opacity(0.85), group, show, original, visible, hidden] },
    heatmap: { label: 'Heatmap', icon: '▦', formula: 'z = … in x and y', coords: ['x', 'y'], outputs: ['z'], params: [label, colormap('viridis'), { key: 'zmin', type: 'number', label: 'z from', help: 'Else found once' }, { key: 'zmax', type: 'number', label: 'z to', help: 'Else found once' }, { key: 'colorbar', type: 'bool', label: 'Colour bar', def: 'yes' }, resolution(120), opacity(1), lang, visible, hidden] },
    contour: { label: 'Contour lines', icon: '◎', formula: 'z = … in x and y', coords: ['x', 'y'], outputs: ['z'], params: [label, color, colormap(''), { key: 'levels', type: 'int', label: 'Levels', help: 'How many, across the range', def: 10 }, { key: 'at', type: 'text', label: 'At values', help: 'e.g. 0.5, 1, 2 (instead of Levels)' }, width, dash, resolution(100), lang, visible, hidden] },
    quiver: { label: 'Arrows', icon: '↗', formula: 'u = … and v = … in x and y', coords: ['x', 'y'], outputs: ['u', 'v'], params: [label, color, { key: 'grid', type: 'int', label: 'Arrows across', def: 16 }, { key: 'scale', type: 'number', label: 'Scale', help: 'Else the longest arrow fits a cell' }, width, lang, visible, hidden] },
};

/** The settings of a kind, by key. */
export function paramOf(kind, key) {
    return ((LAYERS[kind] || {}).params || []).find(p => p.key === key) || null;
}

/** Settings written on a layer that its kind doesn't take. */
export function unknownParams(kind, params) {
    const known = new Set(((LAYERS[kind] || {}).params || []).map(p => p.key));
    return Object.keys(params).filter(k => !known.has(k));
}
