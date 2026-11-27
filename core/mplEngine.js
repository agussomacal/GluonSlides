// ============================================================
// core/mplEngine.js — Plots written with matplotlib and numpy (lang:
// matplotlib). The script is read by this small reader of a part of
// Python, with numpy-style arrays, and each plt.… / ax.… call becomes one
// of the layers core/liveEngine.js draws. Nothing runs as Python or as
// JavaScript code: a shared file or an exported presentation can only
// compute numbers. The export inlines this file after liveEngine.js
// (its imports are then names already there).
//
//   x = np.linspace(-5, 5, 400)
//   plt.hist(np.random.normal(mu, 1, 2000), bins=40, density=True, alpha=0.4, label='samples')
//   plt.plot(x, np.exp(-(x - mu)**2 / 2) / np.sqrt(2*np.pi), 'C0', lw=2, label=r'$\mathcal{N}(\mu, 1)$')
//   plt.axvline(mu, ls='--'); plt.xlabel('$x$'); plt.legend()
//
// Supported: assignments (also a, b = …, +=), for / if / elif / else,
// list comprehensions, f-strings, keyword arguments, import lines; numpy:
// arrays with element-wise arithmetic and comparisons, linspace, arange,
// meshgrid, the math functions, sum / mean / std / min / max / cumsum…,
// np.random.*; matplotlib: plot, scatter, errorbar, fill_between, hist,
// bar, axvline, axhline, text, imshow, pcolormesh, contour(f), quiver,
// and the axes' settings (xlim, xlabel, title, xscale, legend, grid,
// axis('off' / 'equal')…). Anything else is said, with its line.
// ============================================================

import { FUNCTIONS, reseed, seeded, registerScriptLanguage, COLORMAP_NAMES } from './liveEngine.js';

class ScriptError extends Error {
    constructor(message, line) {
        super(message);
        this.line = line;
    }
}

const MAX_ELEMENTS = 2000000;   // no array (or loop) bigger than this
const MAX_STEPS = 200000;       // statements run, loops included

// ---------- arrays ----------

class NDArray {
    constructor(data, shape) {
        this.data = data instanceof Float64Array ? data : Float64Array.from(data, Number);
        this.shape = shape || [this.data.length];
        if (this.data.length > MAX_ELEMENTS) throw new ScriptError(`an array of ${this.data.length} numbers is too big for a slide`);
    }
    get size() { return this.data.length; }
}

const isArr = (v) => v instanceof NDArray;
const own = (obj, name) => Object.prototype.hasOwnProperty.call(obj, name);
const isNum = (v) => typeof v === 'number' || typeof v === 'boolean';

/** A number, a list of numbers, nested lists (2D) or an array, as an array. */
function toArr(v) {
    if (isArr(v)) return v;
    if (isNum(v)) return new NDArray([Number(v)], []);
    if (Array.isArray(v)) {
        if (v.length && (Array.isArray(v[0]) || isArr(v[0]))) {
            const rows = v.map(r => toArr(r).data);
            const cols = rows[0].length;
            const out = new Float64Array(rows.length * cols);
            rows.forEach((r, i) => out.set(r.subarray(0, cols), i * cols));
            return new NDArray(out, [rows.length, cols]);
        }
        return new NDArray(v.map(x => Number(isArr(x) ? x.data[0] : x)));
    }
    throw new ScriptError(`not a number or an array: ${typeName(v)}`);
}

function typeName(v) {
    if (v === null || v === undefined) return 'None';
    if (isArr(v)) return `array of shape (${v.shape.join(', ')})`;
    if (Array.isArray(v)) return v.tuple ? 'tuple' : 'list';
    if (typeof v === 'string') return 'text';
    if (typeof v === 'function') return 'a function';
    if (typeof v === 'object') return v.__name || 'an object';
    return typeof v;
}

/** Element-wise f over numbers and arrays (an array of the right shape broadcasts). */
function elementwise(args, f) {
    if (!args.some(a => isArr(a) || Array.isArray(a))) return f(...args.map(Number));
    const arrs = args.map(a => (isArr(a) || Array.isArray(a) ? toArr(a) : a));
    const big = arrs.filter(isArr).reduce((m, a) => (a.size > m.size ? a : m));
    const n = big.size;
    const out = new Float64Array(n);
    const getters = arrs.map(a => {
        if (!isArr(a)) { const v = Number(a); return () => v; }
        if (a.size === n) return (i) => a.data[i];
        if (a.size === 1) { const v = a.data[0]; return () => v; }
        // a row repeated over a 2D array (or a column)
        if (big.shape.length === 2 && a.size === big.shape[1]) return (i) => a.data[i % big.shape[1]];
        if (big.shape.length === 2 && a.size === big.shape[0]) return (i) => a.data[Math.floor(i / big.shape[1])];
        throw new ScriptError(`shapes (${a.shape.join(', ')}) and (${big.shape.join(', ')}) don't match`);
    });
    for (let i = 0; i < n; i++) out[i] = f(...getters.map(g => g(i)));
    return new NDArray(out, big.shape.slice());
}

const OPERATORS = {
    '+': (a, b) => a + b, '-': (a, b) => a - b, '*': (a, b) => a * b, '/': (a, b) => a / b,
    '//': (a, b) => Math.floor(a / b), '%': (a, b) => ((a % b) + b) % b, '**': Math.pow,
    '<': (a, b) => (a < b ? 1 : 0), '<=': (a, b) => (a <= b ? 1 : 0), '>': (a, b) => (a > b ? 1 : 0),
    '>=': (a, b) => (a >= b ? 1 : 0), '==': (a, b) => (a === b ? 1 : 0), '!=': (a, b) => (a !== b ? 1 : 0),
    '&': (a, b) => (a && b ? 1 : 0), '|': (a, b) => (a || b ? 1 : 0),
};

function binary(op, a, b) {
    // lists and texts: + joins, * repeats (as in Python)
    if (op === '+' && typeof a === 'string' && typeof b === 'string') return a + b;
    if (op === '+' && Array.isArray(a) && Array.isArray(b)) return [...a, ...b];
    if (op === '*' && Array.isArray(a) && isNum(b)) return Array.from({ length: Math.max(0, b) }, () => a).flat();
    if (op === '*' && typeof a === 'string' && isNum(b)) return a.repeat(Math.max(0, b));
    if (op === '==' && (typeof a === 'string' || typeof b === 'string')) return a === b;
    if (op === '!=' && (typeof a === 'string' || typeof b === 'string')) return a !== b;
    if (op === '@') return matmul(a, b);
    if (typeof a === 'string' || typeof b === 'string') throw new ScriptError(`can't use ${op} with text`);
    const f = OPERATORS[op];
    if (!f) throw new ScriptError(`unknown operator ${op}`);
    const r = elementwise([a, b], f);
    return ['<', '<=', '>', '>=', '==', '!='].includes(op) && isNum(r) ? Boolean(r) : r;
}

function matmul(a, b) {
    const A = toArr(a);
    const B = toArr(b);
    if (A.shape.length === 1 && B.shape.length === 1) { let s = 0; A.data.forEach((v, i) => { s += v * B.data[i]; }); return s; }
    throw new ScriptError('@ is only for two 1D arrays here');
}

// ---------- numpy ----------

const reduceArr = (f, start) => (a, axis) => {
    const A = toArr(a);
    if (axis === undefined || axis === null || A.shape.length < 2) {
        let acc = start;
        A.data.forEach(v => { acc = f(acc, v); });
        return acc;
    }
    const [r, c] = A.shape;
    const out = [];
    if (axis === 0) for (let j = 0; j < c; j++) { let acc = start; for (let i = 0; i < r; i++) acc = f(acc, A.data[i * c + j]); out.push(acc); }
    else for (let i = 0; i < r; i++) { let acc = start; for (let j = 0; j < c; j++) acc = f(acc, A.data[i * c + j]); out.push(acc); }
    return new NDArray(out);
};
const sum = reduceArr((s, v) => s + v, 0);
const amin = reduceArr((m, v) => Math.min(m, v), Infinity);
const amax = reduceArr((m, v) => Math.max(m, v), -Infinity);
const mean = (a, axis) => { const s = sum(a, axis); const A = toArr(a); return isArr(s) ? elementwise([s], v => v / (axis === 0 ? A.shape[0] : A.shape[1])) : s / A.size; };
const std = (a) => { const A = toArr(a); const m = mean(A); let s = 0; A.data.forEach(v => { s += (v - m) ** 2; }); return Math.sqrt(s / A.size); };

function linspace(a, b, n = 50, endpoint = true) {
    n = Math.round(n);
    const end = endpoint === false ? n : n - 1;
    return new NDArray(Array.from({ length: n }, (_, i) => a + (b - a) * (end ? i / end : 0)));
}

function arange(a, b, step = 1) {
    if (b === undefined) { b = a; a = 0; }
    const n = Math.max(0, Math.ceil((b - a) / step));
    if (n > MAX_ELEMENTS) throw new ScriptError('arange: too many numbers');
    return new NDArray(Array.from({ length: n }, (_, i) => a + i * step));
}

function meshgrid(x, y) {
    const X = toArr(x);
    const Y = toArr(y);
    const r = Y.size;
    const c = X.size;
    const xs = new Float64Array(r * c);
    const ys = new Float64Array(r * c);
    for (let i = 0; i < r; i++) for (let j = 0; j < c; j++) { xs[i * c + j] = X.data[j]; ys[i * c + j] = Y.data[i]; }
    const out = [new NDArray(xs, [r, c]), new NDArray(ys, [r, c])];
    out.tuple = true;
    return out;
}

const sizeOf = (size) => (size === undefined || size === null ? null : Array.isArray(size) ? size.reduce((a, b) => a * b, 1) : Math.round(size));
const shapeOf = (size) => (Array.isArray(size) ? size.map(Number) : [Math.round(size)]);
/** A random draw with parameters `names` (positional or by name) and an optional size. */
const draws = (names, f) => {
    const g = (...args) => {
        const kw = args.length && args[args.length - 1] && args[args.length - 1].__kwargs ? args.pop() : {};
        const params = names.map((n, i) => (kw[n] !== undefined ? Number(kw[n]) : args[i] !== undefined ? Number(args[i]) : undefined));
        const size = kw.size !== undefined ? kw.size : args[names.length];
        const n = sizeOf(size);
        if (n === null) return f(...params);
        if (n > MAX_ELEMENTS) throw new ScriptError('too many random draws');
        return new NDArray(Array.from({ length: n }, () => f(...params)), shapeOf(size));
    };
    g.__kw = true;
    return g;
};

const RANDOM = {
    __name: 'np.random',
    normal: draws(['loc', 'scale'], (loc, scale) => FUNCTIONS.normal(loc ?? 0, scale ?? 1)),
    randn: (...shape) => { const n = shape.length ? shape.reduce((a, b) => a * b, 1) : null; return n === null ? FUNCTIONS.normal() : new NDArray(Array.from({ length: n }, () => FUNCTIONS.normal()), shape.length > 1 ? shape : undefined); },
    rand: (...shape) => { const n = shape.length ? shape.reduce((a, b) => a * b, 1) : null; return n === null ? FUNCTIONS.rand() : new NDArray(Array.from({ length: n }, () => FUNCTIONS.rand()), shape.length > 1 ? shape : undefined); },
    uniform: draws(['low', 'high'], (low, high) => FUNCTIONS.uniform(low ?? 0, high ?? 1)),
    exponential: draws(['scale'], (scale) => FUNCTIONS.exponential(scale ?? 1)),
    poisson: draws(['lam'], (lam) => FUNCTIONS.poisson(lam ?? 1)),
    binomial: draws(['n', 'p'], (n, p) => FUNCTIONS.binomial(n ?? 1, p ?? 0.5)),
    lognormal: draws(['mean', 'sigma'], (m, sg) => FUNCTIONS.lognormal(m ?? 0, sg ?? 1)),
    randint: draws(['low', 'high'], (low, high) => { if (high === undefined) { high = low; low = 0; } return Math.floor(low + FUNCTIONS.rand() * (high - low)); }),
    seed: (n) => { reseed(Math.round(Number(n)) || 1); return null; },
    default_rng: (seedValue) => { if (seedValue !== undefined) reseed(Math.round(Number(seedValue)) || 1); return RANDOM; },
};
RANDOM.random = RANDOM.rand;
RANDOM.standard_normal = (size) => RANDOM.normal(0, 1, size);
RANDOM.seed.__params = ['seed'];

const ufunc = (f) => (...args) => elementwise(args, f);

const NP = { __name: 'np', random: RANDOM, pi: Math.PI, e: Math.E, inf: Infinity, nan: NaN, newaxis: null };
['exp', 'log', 'log10', 'log2', 'log1p', 'expm1', 'sqrt', 'cbrt', 'sin', 'cos', 'tan', 'arcsin', 'arccos', 'arctan', 'sinh', 'cosh', 'tanh',
    'arcsinh', 'arccosh', 'arctanh', 'floor', 'ceil', 'trunc', 'sign', 'sinc', 'degrees', 'radians', 'deg2rad', 'erf', 'erfc', 'gamma'].forEach(n => {
    if (FUNCTIONS[n]) NP[n] = ufunc((v) => FUNCTIONS[n](v));
});
Object.assign(NP, {
    abs: ufunc(Math.abs), absolute: ufunc(Math.abs), round: ufunc((v, d = 0) => Math.round(v * 10 ** d) / 10 ** d),
    arctan2: ufunc(Math.atan2), hypot: ufunc(Math.hypot), power: ufunc(Math.pow), mod: ufunc((a, b) => ((a % b) + b) % b),
    maximum: ufunc(Math.max), minimum: ufunc(Math.min), clip: ufunc((v, a, b) => Math.min(Math.max(v, a), b)),
    where: ufunc((c, a, b) => (c ? a : b)), heaviside: ufunc((v, h0) => (v > 0 ? 1 : v < 0 ? 0 : h0)),
    isfinite: ufunc((v) => (Number.isFinite(v) ? 1 : 0)), isnan: ufunc((v) => (Number.isNaN(v) ? 1 : 0)),
    linspace, arange, meshgrid,
    array: (v) => toArr(v), asarray: (v) => toArr(v),
    zeros: (n) => new NDArray(new Float64Array(sizeOf(n)), shapeOf(n)), ones: (n) => new NDArray(new Float64Array(sizeOf(n)).fill(1), shapeOf(n)),
    full: (n, v) => new NDArray(new Float64Array(sizeOf(n)).fill(Number(v)), shapeOf(n)),
    zeros_like: (a) => new NDArray(new Float64Array(toArr(a).size), toArr(a).shape.slice()), ones_like: (a) => new NDArray(new Float64Array(toArr(a).size).fill(1), toArr(a).shape.slice()),
    sum, mean, std, min: amin, max: amax, amin, amax,
    median: (a) => { const d = Array.from(toArr(a).data).sort((x, y) => x - y); const m = d.length >> 1; return d.length % 2 ? d[m] : (d[m - 1] + d[m]) / 2; },
    cumsum: (a) => { let s = 0; return new NDArray(Array.from(toArr(a).data, v => (s += v))); },
    diff: (a) => { const d = toArr(a).data; return new NDArray(Array.from({ length: Math.max(0, d.length - 1) }, (_, i) => d[i + 1] - d[i])); },
    concatenate: (list) => new NDArray(list.flatMap(a => Array.from(toArr(a).data))),
    append: (a, b) => new NDArray([...toArr(a).data, ...toArr(b).data]),
    flip: (a) => new NDArray(Array.from(toArr(a).data).reverse()),
    sort: (a) => new NDArray(Array.from(toArr(a).data).sort((x, y) => x - y)),
    argmax: (a) => { const d = toArr(a).data; let k = 0; d.forEach((v, i) => { if (v > d[k]) k = i; }); return k; },
    argmin: (a) => { const d = toArr(a).data; let k = 0; d.forEach((v, i) => { if (v < d[k]) k = i; }); return k; },
    dot: matmul,
    trapz: (y, x) => { const Y = toArr(y).data; const X = x === undefined ? null : toArr(x).data; let s = 0; for (let i = 1; i < Y.length; i++) s += (Y[i] + Y[i - 1]) / 2 * (X ? X[i] - X[i - 1] : 1); return s; },
    polyval: (p, x) => elementwise([x], (v) => toArr(p).data.reduce((acc, c) => acc * v + c, 0)),
    interp: (x, xp, fp) => { const XP = toArr(xp).data; const FP = toArr(fp).data; return elementwise([x], (v) => { if (v <= XP[0]) return FP[0]; for (let i = 1; i < XP.length; i++) if (v <= XP[i]) return FP[i - 1] + (FP[i] - FP[i - 1]) * (v - XP[i - 1]) / (XP[i] - XP[i - 1]); return FP[FP.length - 1]; }); },
    histogram: (a, kw = {}) => { void a; void kw; throw new ScriptError('np.histogram: use plt.hist'); },
});
NP.trapezoid = NP.trapz;
// keyword arguments by name (np.linspace(0, 1, num=50)); others are said to be unsupported
const PARAMS = {
    linspace: ['start', 'stop', 'num', 'endpoint'], arange: ['start', 'stop', 'step'], sum: ['a', 'axis'], mean: ['a', 'axis'],
    min: ['a', 'axis'], max: ['a', 'axis'], amin: ['a', 'axis'], amax: ['a', 'axis'], std: ['a'], clip: ['a', 'a_min', 'a_max'],
    round: ['a', 'decimals'], zeros: ['shape'], ones: ['shape'], full: ['shape', 'fill_value'], array: ['object'], meshgrid: ['x', 'y'],
    trapz: ['y', 'x'], trapezoid: ['y', 'x'], interp: ['x', 'xp', 'fp'], where: ['condition', 'x', 'y'],
};
Object.entries(PARAMS).forEach(([k, names]) => { if (NP[k]) NP[k].__params = names; });

// ---------- matplotlib ----------

const CYCLE = ['#1f77b4', '#ff7f0e', '#2ca02c', '#d62728', '#9467bd', '#8c564b', '#e377c2', '#7f7f7f', '#bcbd22', '#17becf'];
const SHORT = { b: '#1f77b4', g: '#2ca02c', r: '#d62728', c: '#17becf', m: '#e377c2', y: '#bcbd22', k: '#000000', w: '#ffffff' };
const TAB = { blue: '#1f77b4', orange: '#ff7f0e', green: '#2ca02c', red: '#d62728', purple: '#9467bd', brown: '#8c564b', pink: '#e377c2', gray: '#7f7f7f', grey: '#7f7f7f', olive: '#bcbd22', cyan: '#17becf' };
const CMAPS = { viridis: 'viridis', magma: 'magma', inferno: 'magma', plasma: 'magma', cividis: 'viridis', coolwarm: 'coolwarm', RdBu: 'coolwarm', RdBu_r: 'coolwarm', bwr: 'coolwarm', seismic: 'coolwarm', Blues: 'blues', Blues_r: 'blues', gray: 'gray', Greys: 'gray', binary: 'gray', hot: 'magma', jet: 'viridis' };

function colourOf(c, alpha) {
    if (c === undefined || c === null) return undefined;
    let hex;
    if (Array.isArray(c) || isArr(c)) {
        const v = Array.from(isArr(c) ? c.data : c).map(Number);
        hex = `rgb(${v.slice(0, 3).map(x => Math.round(x <= 1 ? x * 255 : x)).join(',')})`;
        if (v.length > 3 && alpha === undefined) alpha = v[3];
    } else {
        const s = String(c).trim();
        const m = s.match(/^C(\d)$/);
        hex = m ? CYCLE[Number(m[1])] : SHORT[s] || (s.startsWith('tab:') ? TAB[s.slice(4)] : null) || (/^(#|[a-z])/i.test(s) ? s : null);
        if (/^0?\.\d+$|^[01]$/.test(s)) { const g = Math.round(Number(s) * 255); hex = `rgb(${g},${g},${g})`; }
        if (!hex) throw new ScriptError(`unknown colour: ${s}`);
    }
    if (alpha === undefined || alpha === null || Number(alpha) >= 1) return hex;
    if (hex.startsWith('#') && hex.length === 7) return `rgba(${[1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16)).join(',')},${Number(alpha)})`;
    if (hex.startsWith('rgb(')) return hex.replace('rgb(', 'rgba(').replace(')', `,${Number(alpha)})`);
    return hex;
}

const DASHES = { '-': '', solid: '', '--': 'dashed', dashed: 'dashed', ':': 'dotted', dotted: 'dotted', '-.': 'dashed', dashdot: 'dashed', '': '', None: '', none: '' };

/** A format string like 'r--', 'o', 'k:o' -> { color, dash, marker, line } */
function parseFmt(fmt) {
    const out = { line: true, marker: false };
    let s = String(fmt || '');
    const c = s.match(/C\d|[bgrcmykw]/);
    if (c) { out.color = c[0].startsWith('C') ? CYCLE[Number(c[0][1])] : SHORT[c[0]]; s = s.replace(c[0], ''); }
    const ls = s.match(/--|-\.|-|:/);
    if (ls) { out.dash = DASHES[ls[0]]; s = s.replace(ls[0], ''); }
    if (/[o.,v^<>sp*hHDd+x|_1-4]/.test(s)) out.marker = true;
    if (!ls && out.marker) out.line = false;
    return out;
}

const plainList = (v) => (isArr(v) ? Array.from(v.data) : Array.isArray(v) ? v.map(x => (isArr(x) ? Array.from(x.data) : x)) : [v]);

/** A figure being drawn: the layers and the axes' settings plt / ax calls make. */
function newFigure() {
    const fig = { layers: [], settings: { grid: 'no', legend: 'no' }, cycle: 0, lastHeatmap: null };
    const next = () => CYCLE[fig.cycle++ % CYCLE.length];
    const width = (kw, def) => (kw.lw ?? kw.linewidth ?? kw.linewidths) !== undefined ? Number(kw.lw ?? kw.linewidth ?? kw.linewidths) * 2 : def;
    const label = (kw) => (kw.label !== undefined && kw.label !== null && !String(kw.label).startsWith('_') ? String(kw.label) : undefined);
    const xy = (args) => {
        if (args.length >= 2 && typeof args[1] !== 'string') return [plainList(args[0]), plainList(args[1]), args.slice(2)];
        const y = plainList(args[0]);
        return [y.map((_, i) => i), y, args.slice(1)];
    };
    const rows = (...cols) => cols[0].map((_, i) => cols.map(c => c[i]));
    const add = (layer) => { fig.layers.push(layer); return layer; };
    const gridOf = (args, kind) => {
        let X;
        let Y;
        let Z;
        if (args.length >= 3) [X, Y, Z] = args.map(toArr);
        else Z = toArr(args[0]);
        if (Z.shape.length !== 2) throw new ScriptError(`${kind}: Z must be 2D (use np.meshgrid)`);
        const [r, c] = Z.shape;
        let extent;
        if (X && Y) {
            const xs = X.data;
            const ys = Y.data;
            extent = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
        }
        return { z: Z.data, rows: r, cols: c, extent };
    };
    const api = {
        __name: 'plt',
        plot(...args) {
            const kw = popKw(args);
            const [xs, ys, rest] = xy(args);
            const f = parseFmt(typeof rest[0] === 'string' ? rest[0] : '');
            const color = colourOf(kw.color ?? kw.c ?? f.color, kw.alpha) || colourOf(next(), kw.alpha);
            const dash = DASHES[kw.ls ?? kw.linestyle] ?? f.dash ?? '';
            const marker = kw.marker !== undefined ? kw.marker !== 'None' && kw.marker !== '' : f.marker;
            const kind = f.line || kw.ls || kw.linestyle ? 'line' : 'points';
            return add({ kind, table: { header: null, rows: rows(xs, ys) }, color, width: width(kw, 3), dash, markers: marker ? 'yes' : 'no', size: kw.ms ?? kw.markersize, label: label(kw) });
        },
        scatter(x, y, ...rest) {
            const kw = popKw(rest);
            const s = kw.s !== undefined && isNum(kw.s) ? Math.sqrt(Number(kw.s)) * 1.2 : 5;
            return add({ kind: 'points', table: { header: null, rows: rows(plainList(x), plainList(y)) }, color: colourOf(kw.color ?? (typeof kw.c === 'string' ? kw.c : undefined), kw.alpha) || colourOf(next(), kw.alpha), size: s, label: label(kw) });
        },
        errorbar(x, y, ...rest) {
            const kw = popKw(rest);
            const xs = plainList(x);
            const ys = plainList(y);
            const err = kw.yerr === undefined ? xs.map(() => 0) : isNum(kw.yerr) ? xs.map(() => Number(kw.yerr)) : plainList(kw.yerr);
            const f = parseFmt(kw.fmt ?? (typeof rest[0] === 'string' ? rest[0] : 'o'));
            const color = colourOf(kw.color ?? kw.c ?? f.color, kw.alpha) || colourOf(next(), kw.alpha);
            if (f.line && !/^o$/.test(kw.fmt || '')) add({ kind: 'line', table: { header: null, rows: rows(xs, ys) }, color, width: width(kw, 2), dash: f.dash || '' });
            return add({ kind: 'points', table: { header: null, rows: rows(xs, ys, err) }, yerr: 3, color, size: kw.ms ?? kw.markersize ?? 5, label: label(kw) });
        },
        fill_between(x, y1, y2 = 0, ...rest) {
            const kw = popKw(rest);
            const xs = plainList(x);
            const a = isNum(y1) ? xs.map(() => Number(y1)) : plainList(y1);
            const b = isNum(y2) ? xs.map(() => Number(y2)) : plainList(y2);
            let r = rows(xs, a, b);
            if (kw.where !== undefined) { const w = plainList(kw.where); r = r.filter((_, i) => w[i]); }
            return add({ kind: 'fill', table: { header: null, rows: r }, color: colourOf(kw.color ?? kw.facecolor) || colourOf(next()), opacity: kw.alpha ?? 0.3, label: label(kw) });
        },
        hist(x, ...rest) {
            const kw = popKw(rest);
            const bins = kw.bins ?? rest[0] ?? 10;
            if (!isNum(bins)) throw new ScriptError('hist: bins as a number (bin edges aren\'t supported yet)');
            const range = kw.range ? plainList(kw.range) : null;
            return add({ kind: 'hist', table: { header: null, rows: plainList(x).map(v => [v]) }, bins, density: kw.density ? 'yes' : 'no', from: range ? range[0] : undefined, to: range ? range[1] : undefined, color: colourOf(kw.color ?? kw.facecolor) || colourOf(next()), opacity: kw.alpha ?? 0.85, label: label(kw) });
        },
        bar(x, height, ...rest) {
            const kw = popKw(rest);
            const xs = plainList(x).map(v => (typeof v === 'string' ? v : Number(v)));
            const hs = isNum(height) ? xs.map(() => Number(height)) : plainList(height);
            return add({ kind: 'bar', table: { header: null, rows: rows(xs.map(String), hs) }, barwidth: kw.width ?? rest[0] ?? 0.8, color: colourOf(kw.color) || colourOf(next()), opacity: kw.alpha ?? 0.85, label: label(kw) });
        },
        axvline(x = 0, ...rest) {
            const kw = popKw(rest);
            return add({ kind: 'vline', x: Number(x), color: colourOf(kw.color ?? kw.c ?? 'k', kw.alpha), width: width(kw, 2), dash: DASHES[kw.ls ?? kw.linestyle] ?? 'solid', label: label(kw) });
        },
        axhline(y = 0, ...rest) {
            const kw = popKw(rest);
            return add({ kind: 'hline', y: Number(y), color: colourOf(kw.color ?? kw.c ?? 'k', kw.alpha), width: width(kw, 2), dash: DASHES[kw.ls ?? kw.linestyle] ?? 'solid', label: label(kw) });
        },
        text(x, y, s, ...rest) {
            const kw = popKw(rest);
            const ha = kw.ha ?? kw.horizontalalignment;
            return add({ kind: 'text', x: Number(x), y: Number(y), label: String(s), color: colourOf(kw.color ?? kw.c), size: kw.fontsize !== undefined ? Number(kw.fontsize) * 1.6 : undefined, align: ha === 'center' ? 'center' : ha === 'right' ? 'right' : '' });
        },
        imshow(Z, ...rest) {
            const kw = popKw(rest);
            const A = toArr(Z);
            if (A.shape.length !== 2) throw new ScriptError('imshow: a 2D array');
            const [r, c] = A.shape;
            let z = A.data;
            // origin 'upper' (the default): the first row is at the top
            if (kw.origin !== 'lower') {
                z = new Float64Array(r * c);
                for (let i = 0; i < r; i++) z.set(A.data.subarray((r - 1 - i) * c, (r - i) * c), i * c);
            }
            const extent = kw.extent ? plainList(kw.extent).map(Number) : [-0.5, c - 0.5, -0.5, r - 0.5];
            fig.lastHeatmap = add({ kind: 'heatmap', gridData: { z, rows: r, cols: c, extent }, colormap: CMAPS[kw.cmap] || 'viridis', zmin: kw.vmin, zmax: kw.vmax, colorbar: 'no', opacity: kw.alpha });
            return fig.lastHeatmap;
        },
        pcolormesh(...args) {
            const kw = popKw(args);
            fig.lastHeatmap = add({ kind: 'heatmap', gridData: gridOf(args, 'pcolormesh'), colormap: CMAPS[kw.cmap] || 'viridis', zmin: kw.vmin, zmax: kw.vmax, colorbar: 'no', opacity: kw.alpha });
            return fig.lastHeatmap;
        },
        contourf(...args) {
            const kw = popKw(args);
            fig.lastHeatmap = add({ kind: 'heatmap', gridData: gridOf(args.slice(0, 3), 'contourf'), colormap: CMAPS[kw.cmap] || 'viridis', zmin: kw.vmin, zmax: kw.vmax, colorbar: 'no', opacity: kw.alpha });
            return fig.lastHeatmap;
        },
        contour(...args) {
            const kw = popKw(args);
            const levels = kw.levels ?? (args.length > 3 ? args[3] : args.length === 2 ? args[1] : undefined);
            const layer = { kind: 'contour', gridData: gridOf(args.slice(0, args.length >= 3 ? 3 : 1), 'contour'), width: width(kw, 2), dash: DASHES[kw.linestyles] ?? '' };
            if (levels !== undefined) {
                if (isNum(levels)) layer.levels = levels;
                else layer.at = plainList(levels).join(',');
            }
            if (kw.colors !== undefined) layer.color = colourOf(Array.isArray(kw.colors) ? kw.colors[0] : kw.colors);
            else if (kw.cmap) layer.colormap = CMAPS[kw.cmap] || 'viridis';
            else layer.color = '#000000';
            return add(layer);
        },
        quiver(...args) {
            const kw = popKw(args);
            if (args.length < 4) throw new ScriptError('quiver: X, Y, U, V');
            const [X, Y, U, V] = args.map(a => toArr(a).data);
            return add({ kind: 'quiver', arrowsData: Array.from(X, (x, i) => [x, Y[i], U[i], V[i]]), color: colourOf(kw.color ?? 'k'), width: width(kw, 2) });
        },
        colorbar() { if (fig.lastHeatmap) fig.lastHeatmap.colorbar = 'yes'; return null; },
        xlim(a, b) { [a, b] = Array.isArray(a) ? a : [a, b]; fig.settings.xmin = a; fig.settings.xmax = b; return null; },
        ylim(a, b) { [a, b] = Array.isArray(a) ? a : [a, b]; fig.settings.ymin = a; fig.settings.ymax = b; return null; },
        xlabel(s) { fig.settings.xlabel = String(s); return null; },
        ylabel(s) { fig.settings.ylabel = String(s); return null; },
        title(s) { fig.settings.title = String(s); return null; },
        xscale(s) { fig.settings.xscale = s === 'log' ? 'log' : ''; return null; },
        yscale(s) { fig.settings.yscale = s === 'log' ? 'log' : ''; return null; },
        legend() { fig.settings.legend = 'yes'; return null; },
        grid(on = true) { fig.settings.grid = on === false ? 'no' : 'yes'; return null; },
        axis(what) {
            if (what === 'off' || what === false) fig.settings.axes = 'none';
            else if (what === 'equal' || what === 'scaled' || what === 'image') fig.settings.aspect = 'equal';
            else if (Array.isArray(what)) { [fig.settings.xmin, fig.settings.xmax, fig.settings.ymin, fig.settings.ymax] = what; }
            return null;
        },
        set_aspect(a) { if (a === 'equal') fig.settings.aspect = 'equal'; return null; },
        set_axis_off() { fig.settings.axes = 'none'; return null; },
        loglog() { fig.settings.xscale = 'log'; fig.settings.yscale = 'log'; return api.plot(...arguments); },
        semilogy() { fig.settings.yscale = 'log'; return api.plot(...arguments); },
        semilogx() { fig.settings.xscale = 'log'; return api.plot(...arguments); },
        subplots(...args) {
            const kw = popKw(args);
            if ((args[0] && args[0] !== 1) || (args[1] && args[1] !== 1) || (kw.nrows && kw.nrows !== 1) || (kw.ncols && kw.ncols !== 1)) throw new ScriptError('subplots: one plot per element (place several plots on the slide)');
            const out = [FIGURE, api];
            out.tuple = true;
            return out;
        },
        figure() { return FIGURE; },
        gca() { return api; },
        show() { return null; },
        tight_layout() { return null; },
        savefig() { return null; },
        close() { return null; },
        xticks() { return null; },
        yticks() { return null; },
        set: (...args) => {
            const kw = popKw(args);
            const map = { xlim: 'xlim', ylim: 'ylim', xlabel: 'xlabel', ylabel: 'ylabel', title: 'title', xscale: 'xscale', yscale: 'yscale', aspect: 'set_aspect' };
            Object.entries(kw).forEach(([k, v]) => { if (map[k]) api[map[k]](...(Array.isArray(v) ? v : [v])); });
            return null;
        },
    };
    // the Axes' names for the same settings
    ['xlim', 'ylim', 'xlabel', 'ylabel', 'title', 'xscale', 'yscale'].forEach(n => { api[`set_${n}`] = api[n]; });
    // matplotlib calls take keyword arguments (each reads those it knows, ignores the rest)
    Object.values(api).forEach(f => { if (typeof f === 'function') f.__kw = true; });
    const FIGURE = { __name: 'figure', colorbar: api.colorbar, tight_layout: () => null, savefig: () => null, suptitle: api.title, add_subplot: () => api, gca: () => api, show: () => null };
    Object.values(FIGURE).forEach(f => { if (typeof f === 'function') f.__kw = true; });
    return { fig, api };
}

function popKw(args) {
    return args.length && args[args.length - 1] && args[args.length - 1].__kwargs ? args.pop() : {};
}

// ---------- the reader: tokens ----------

const KEYWORDS = new Set(['and', 'or', 'not', 'in', 'if', 'elif', 'else', 'for', 'True', 'False', 'None', 'import', 'from', 'as', 'pass', 'is', 'lambda', 'def', 'return', 'while', 'break', 'continue']);

function tokenize(src) {
    const tokens = [];
    const indents = [0];
    let depth = 0;
    const lines = String(src || '').replace(/\r\n?/g, '\n').split('\n');
    let i = 0;
    let pendingLine = null;
    let continued = false;
    for (let ln = 0; ln < lines.length; ln++) {
        const line = lines[ln];
        let pos = 0;
        if (depth === 0 && !continued) {
            const body = line.replace(/#.*$/, '');
            if (!body.trim()) continue;
            const ind = line.match(/^[ \t]*/)[0].replace(/\t/g, '    ').length;
            if (ind > indents[indents.length - 1]) { indents.push(ind); tokens.push({ t: 'INDENT', line: ln + 1 }); }
            while (ind < indents[indents.length - 1]) { indents.pop(); tokens.push({ t: 'DEDENT', line: ln + 1 }); }
            if (ind !== indents[indents.length - 1]) throw new ScriptError('the indentation doesn\'t match an outer block', ln + 1);
            pos = line.match(/^[ \t]*/)[0].length;
        }
        while (pos < line.length) {
            const rest = line.slice(pos);
            const ws = rest.match(/^[ \t]+/);
            if (ws) { pos += ws[0].length; continue; }
            if (rest[0] === '#') break;
            if (/^\\\s*$/.test(rest)) { pos = line.length; break; }
            const str = rest.match(/^([rRfFbB]{0,2})("""|'''|"|')/);
            if (str) {
                const prefix = str[1].toLowerCase();
                const q = str[2];
                let j = str[0].length;
                let text = '';
                let closed = false;
                while (j < rest.length) {
                    if (rest.startsWith(q, j)) { closed = true; j += q.length; break; }
                    if (rest[j] === '\\' && !prefix.includes('r')) {
                        const nx = rest[j + 1];
                        text += { n: '\n', t: '\t', '\\': '\\', "'": "'", '"': '"' }[nx] ?? `\\${nx}`;
                        j += 2;
                        continue;
                    }
                    text += rest[j];
                    j++;
                }
                if (!closed) throw new ScriptError('a text isn\'t closed (strings over several lines aren\'t supported)', ln + 1);
                tokens.push({ t: 'str', v: text, f: prefix.includes('f'), line: ln + 1 });
                pos += j;
                continue;
            }
            const numM = rest.match(/^(\d[\d_]*\.?[\d_]*(?:[eE][-+]?\d+)?|\.\d[\d_]*(?:[eE][-+]?\d+)?)j?/);
            if (numM) { tokens.push({ t: 'num', v: Number(numM[1].replace(/_/g, '')), line: ln + 1 }); pos += numM[0].length; continue; }
            const name = rest.match(/^[A-Za-z_][A-Za-z0-9_]*/);
            if (name) { tokens.push({ t: KEYWORDS.has(name[0]) ? 'kw' : 'name', v: name[0], line: ln + 1 }); pos += name[0].length; continue; }
            const op = rest.match(/^(\*\*=|\/\/=|\*\*|\/\/|==|!=|<=|>=|\+=|-=|\*=|\/=|->|[-+*/%@()[\]{},:;.=<>&|~])/);
            if (!op) throw new ScriptError(`can't read “${rest.slice(0, 10)}”`, ln + 1);
            if ('([{'.includes(op[0])) depth++;
            if (')]}'.includes(op[0])) depth = Math.max(0, depth - 1);
            tokens.push({ t: 'op', v: op[0], line: ln + 1 });
            pos += op[0].length;
        }
        continued = line.replace(/#.*$/, '').trimEnd().endsWith('\\');
        if (depth === 0 && !continued) tokens.push({ t: 'NL', line: ln + 1 });
        pendingLine = ln + 1;
        i++;
    }
    void i;
    while (indents.length > 1) { indents.pop(); tokens.push({ t: 'DEDENT', line: pendingLine || 1 }); }
    tokens.push({ t: 'EOF', line: pendingLine || 1 });
    return tokens;
}

// ---------- the reader: statements and expressions ----------

function parse(src) {
    const tokens = tokenize(src);
    let p = 0;
    const peek = () => tokens[p];
    const at = (t, v) => tokens[p].t === t && (v === undefined || tokens[p].v === v);
    const isOp = (v) => at('op', v);
    const isKw = (v) => at('kw', v);
    const fail = (msg) => { throw new ScriptError(msg, peek().line); };
    const expect = (t, v) => { if (!at(t, v)) fail(`expected “${v || t}”${peek().v !== undefined ? `, not “${peek().v}”` : ''}`); return tokens[p++]; };

    function block() {
        if (at('NL')) {
            p++;
            if (!at('INDENT')) fail('expected an indented block after “:”');
            p++;
            const body = [];
            while (!at('DEDENT') && !at('EOF')) body.push(...statement());
            if (at('DEDENT')) p++;
            return body;
        }
        return simpleStatements();
    }

    function statement() {
        const line = peek().line;
        if (isKw('for')) {
            p++;
            const target = targetList();
            expect('kw', 'in');
            const iter = expression();
            expect('op', ':');
            return [{ s: 'for', target, iter, body: block(), line }];
        }
        if (isKw('if')) {
            p++;
            const branches = [];
            const test = expression();
            expect('op', ':');
            branches.push({ test, body: block() });
            let orelse = null;
            while (isKw('elif') || isKw('else')) {
                if (isKw('elif')) { p++; const t = expression(); expect('op', ':'); branches.push({ test: t, body: block() }); }
                else { p++; expect('op', ':'); orelse = block(); break; }
            }
            return [{ s: 'if', branches, orelse, line }];
        }
        if (isKw('while') || isKw('def') || isKw('lambda')) fail(`${peek().v} isn't supported in plot scripts`);
        return simpleStatements();
    }

    function simpleStatements() {
        const out = [simple()];
        while (isOp(';')) { p++; if (at('NL') || at('EOF')) break; out.push(simple()); }
        if (at('NL')) p++;
        else if (!at('EOF') && !at('DEDENT')) fail(`unexpected “${peek().v}”`);
        return out;
    }

    function simple() {
        const line = peek().line;
        if (isKw('import') || isKw('from')) {
            // import numpy as np / import matplotlib.pyplot as plt / from math import …
            const names = [];
            while (!at('NL') && !at('EOF') && !isOp(';')) names.push(tokens[p++].v);
            return { s: 'import', text: names.join(' '), line };
        }
        if (isKw('pass')) { p++; return { s: 'pass', line }; }
        const first = exprList();
        if (isOp('=')) {
            const targets = [first];
            let value;
            while (isOp('=')) { p++; value = exprList(); targets.push(value); }
            targets.pop();
            return { s: 'assign', targets, value, line };
        }
        const aug = peek().t === 'op' && ['+=', '-=', '*=', '/=', '**=', '//='].includes(peek().v) ? tokens[p++].v : null;
        if (aug) return { s: 'aug', target: first, op: aug.slice(0, -1), value: expression(), line };
        return { s: 'expr', value: first, line };
    }

    function targetList() {
        const items = [primary()];
        while (isOp(',')) { p++; if (isKw('in')) break; items.push(primary()); }
        return items.length === 1 ? items[0] : { e: 'tuple', items };
    }

    function exprList() {
        const first = expression();
        if (!isOp(',')) return first;
        const items = [first];
        while (isOp(',')) { p++; if (at('NL') || isOp('=') || at('EOF') || isOp(')')) break; items.push(expression()); }
        return { e: 'tuple', items };
    }

    function expression() {
        const a = orTest();
        if (isKw('if')) {
            p++;
            const test = orTest();
            expect('kw', 'else');
            return { e: 'ifexp', test, a, b: expression() };
        }
        return a;
    }
    function orTest() { let a = andTest(); while (isKw('or')) { p++; a = { e: 'or', a, b: andTest() }; } return a; }
    function andTest() { let a = notTest(); while (isKw('and')) { p++; a = { e: 'and', a, b: notTest() }; } return a; }
    function notTest() { if (isKw('not')) { p++; return { e: 'not', a: notTest() }; } return comparison(); }
    function comparison() {
        let a = bitOr();
        for (;;) {
            if (peek().t === 'op' && ['<', '<=', '>', '>=', '==', '!='].includes(peek().v)) { const op = tokens[p++].v; a = { e: 'bin', op, a, b: bitOr() }; continue; }
            if (isKw('in')) { p++; a = { e: 'in', a, b: bitOr() }; continue; }
            if (isKw('is')) { p++; const neg = isKw('not') ? (p++, true) : false; a = { e: 'is', a, b: bitOr(), neg }; continue; }
            if (isKw('not') && tokens[p + 1].t === 'kw' && tokens[p + 1].v === 'in') { p += 2; a = { e: 'not', a: { e: 'in', a, b: bitOr() } }; continue; }
            return a;
        }
    }
    function bitOr() { let a = bitAnd(); while (isOp('|')) { p++; a = { e: 'bin', op: '|', a, b: bitAnd() }; } return a; }
    function bitAnd() { let a = arith(); while (isOp('&')) { p++; a = { e: 'bin', op: '&', a, b: arith() }; } return a; }
    function arith() { let a = term(); while (isOp('+') || isOp('-')) { const op = tokens[p++].v; a = { e: 'bin', op, a, b: term() }; } return a; }
    function term() { let a = factor(); while (isOp('*') || isOp('/') || isOp('//') || isOp('%') || isOp('@')) { const op = tokens[p++].v; a = { e: 'bin', op, a, b: factor() }; } return a; }
    function factor() {
        if (isOp('-')) { p++; return { e: 'neg', a: factor() }; }
        if (isOp('+')) { p++; return factor(); }
        if (isOp('~')) { p++; return { e: 'not', a: factor() }; }
        return power();
    }
    function power() {
        const base = primary();
        if (isOp('**')) { p++; return { e: 'bin', op: '**', a: base, b: factor() }; }
        return base;
    }
    function primary() {
        let a = atom();
        for (;;) {
            if (isOp('.')) { p++; a = { e: 'attr', a, name: expect('name').v }; continue; }
            if (isOp('(')) {
                p++;
                const args = [];
                const kwargs = [];
                while (!isOp(')')) {
                    if (at('name') && tokens[p + 1].t === 'op' && tokens[p + 1].v === '=') {
                        const k = tokens[p].v;
                        p += 2;
                        kwargs.push([k, expression()]);
                    } else if (isOp('*') || isOp('**')) fail('*args and **kwargs aren\'t supported');
                    else args.push(expression());
                    if (!isOp(',')) break;
                    p++;
                }
                expect('op', ')');
                a = { e: 'call', f: a, args, kwargs, line: tokens[p - 1].line };
                continue;
            }
            if (isOp('[')) {
                p++;
                const idx = [];
                do {
                    if (isOp(',')) p++;
                    idx.push(sliceItem());
                } while (isOp(','));
                expect('op', ']');
                a = { e: 'index', a, idx };
                continue;
            }
            return a;
        }
    }
    function sliceItem() {
        const parts = [null, null, null];
        let k = 0;
        let isSlice = false;
        if (!isOp(':')) parts[0] = expression();
        while (isOp(':')) { p++; isSlice = true; k++; if (!isOp(':') && !isOp(']') && !isOp(',')) parts[k] = expression(); }
        return isSlice ? { slice: parts } : parts[0];
    }
    function atom() {
        const tok = peek();
        if (tok.t === 'num') { p++; return { e: 'num', v: tok.v }; }
        if (tok.t === 'str') {
            const parts = [];
            while (at('str')) parts.push(tokens[p++]);
            return { e: 'str', parts };
        }
        if (tok.t === 'kw' && ['True', 'False', 'None'].includes(tok.v)) { p++; return { e: 'const', v: { True: true, False: false, None: null }[tok.v] }; }
        if (tok.t === 'name') { p++; return { e: 'name', n: tok.v, line: tok.line }; }
        if (isOp('(')) {
            p++;
            if (isOp(')')) { p++; return { e: 'tuple', items: [] }; }
            const first = expression();
            if (isKw('for')) { const comp = comprehension(first); expect('op', ')'); return comp; }
            if (isOp(',')) {
                const items = [first];
                while (isOp(',')) { p++; if (isOp(')')) break; items.push(expression()); }
                expect('op', ')');
                return { e: 'tuple', items };
            }
            expect('op', ')');
            return first;
        }
        if (isOp('[')) {
            p++;
            if (isOp(']')) { p++; return { e: 'list', items: [] }; }
            const first = expression();
            if (isKw('for')) { const comp = comprehension(first); expect('op', ']'); return comp; }
            const items = [first];
            while (isOp(',')) { p++; if (isOp(']')) break; items.push(expression()); }
            expect('op', ']');
            return { e: 'list', items };
        }
        if (isOp('{')) fail('dictionaries aren\'t supported in plot scripts');
        fail(tok.t === 'EOF' ? 'the script ends too early' : `unexpected “${tok.v ?? tok.t}”`);
        return null;
    }
    function comprehension(item) {
        expect('kw', 'for');
        const target = targetList();
        expect('kw', 'in');
        const iter = orTest();
        const test = isKw('if') ? (p++, orTest()) : null;
        return { e: 'comp', item, target, iter, test };
    }

    const body = [];
    while (!at('EOF')) {
        if (at('NL')) { p++; continue; }
        if (at('DEDENT') || at('INDENT')) fail('unexpected indentation');
        body.push(...statement());
    }
    return body;
}

// ---------- running ----------

/** f-string: {expr} and {expr:.2f} replaced. */
function formatF(text, evalExpr) {
    return text.replace(/\{\{|\}\}|\{([^{}:!]+)(?:![rs])?(?::([^{}]*))?\}/g, (m, expr, spec) => {
        if (m === '{{') return '{';
        if (m === '}}') return '}';
        const v = evalExpr(expr);
        return formatSpec(v, spec);
    });
}

function formatSpec(v, spec) {
    if (!spec) return isNum(v) ? String(Number.isInteger(Number(v)) ? Number(v) : Number(Number(v).toPrecision(12))) : String(v);
    const m = spec.match(/^[<>^]?\+?(\d*)(?:\.(\d+))?([fegd%])?$/);
    if (!m || !isNum(v)) return String(v);
    const d = m[2] !== undefined ? Number(m[2]) : 6;
    switch (m[3]) {
        case 'f': return Number(v).toFixed(d);
        case 'e': return Number(v).toExponential(d);
        case 'g': return String(Number(Number(v).toPrecision(Math.max(1, d))));
        case 'd': return String(Math.round(v));
        case '%': return `${(Number(v) * 100).toFixed(d)}%`;
        default: return String(v);
    }
}

const BUILTINS = {
    range: (a, b, step = 1) => {
        if (b === undefined) { b = a; a = 0; }
        const n = Math.max(0, Math.ceil((b - a) / step));
        if (n > MAX_ELEMENTS) throw new ScriptError('range: too long');
        return Array.from({ length: n }, (_, i) => a + i * step);
    },
    len: (v) => (isArr(v) ? v.shape[0] : v === null || v === undefined ? 0 : v.length),
    abs: (v) => elementwise([v], Math.abs),
    min: (...a) => (a.length === 1 ? amin(a[0]) : Math.min(...a.map(Number))),
    max: (...a) => (a.length === 1 ? amax(a[0]) : Math.max(...a.map(Number))),
    sum: (v) => sum(v),
    round: (v, d = 0) => Math.round(Number(v) * 10 ** d) / 10 ** d,
    float: (v) => Number(v), int: (v) => Math.trunc(Number(v)), str: (v) => (isNum(v) ? formatSpec(v) : String(v)), bool: (v) => Boolean(v),
    list: (v) => (isArr(v) ? Array.from(v.data) : [...(v || [])]),
    tuple: (v) => { const t = isArr(v) ? Array.from(v.data) : [...(v || [])]; t.tuple = true; return t; },
    enumerate: (v) => plainIter(v).map((x, i) => { const t = [i, x]; t.tuple = true; return t; }),
    zip: (...vs) => { const its = vs.map(plainIter); const n = Math.min(...its.map(x => x.length)); return Array.from({ length: n }, (_, i) => { const t = its.map(x => x[i]); t.tuple = true; return t; }); },
    reversed: (v) => [...plainIter(v)].reverse(),
    sorted: (v) => [...plainIter(v)].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0)),
    print: () => null,
};

function plainIter(v) {
    if (isArr(v)) {
        if (v.shape.length === 2) {
            const [r, c] = v.shape;
            return Array.from({ length: r }, (_, i) => new NDArray(v.data.slice(i * c, (i + 1) * c)));
        }
        return Array.from(v.data);
    }
    if (Array.isArray(v)) return v;
    if (typeof v === 'string') return [...v];
    throw new ScriptError(`can't go through ${typeName(v)}`);
}

function attrOf(obj, name) {
    if (name.startsWith('_')) throw new ScriptError(`.${name} isn't available`);
    if (isArr(obj)) {
        const ARR = {
            shape: () => { const t = obj.shape.slice(); t.tuple = true; return t; },
            size: () => obj.size, T: () => { if (obj.shape.length < 2) return obj; const [r, c] = obj.shape; const out = new Float64Array(r * c); for (let i = 0; i < r; i++) for (let j = 0; j < c; j++) out[j * r + i] = obj.data[i * c + j]; return new NDArray(out, [c, r]); },
            sum: () => (axis) => sum(obj, axis), mean: () => (axis) => mean(obj, axis), std: () => () => std(obj), min: () => (axis) => amin(obj, axis), max: () => (axis) => amax(obj, axis),
            cumsum: () => () => NP.cumsum(obj), flatten: () => () => new NDArray(obj.data.slice()), ravel: () => () => new NDArray(obj.data.slice()),
            copy: () => () => new NDArray(obj.data.slice(), obj.shape.slice()), tolist: () => () => Array.from(obj.data),
            reshape: () => (...shape) => { const s = (Array.isArray(shape[0]) ? shape[0] : shape).map(Number); const n = s.reduce((a, b) => a * b, 1); if (s.includes(-1)) { const known = s.filter(v => v !== -1).reduce((a, b) => a * b, 1); s[s.indexOf(-1)] = obj.size / known; } else if (n !== obj.size) throw new ScriptError('reshape: the size doesn\'t match'); return new NDArray(obj.data.slice(), s); },
        };
        if (ARR[name]) return ARR[name]();
        throw new ScriptError(`arrays have no .${name} here`);
    }
    if (Array.isArray(obj)) {
        if (name === 'append') return (v) => { obj.push(v); return null; };
        if (name === 'extend') return (v) => { obj.push(...plainIter(v)); return null; };
        if (name === 'index') return (v) => obj.indexOf(v);
        throw new ScriptError(`lists have no .${name} here`);
    }
    if (typeof obj === 'string') {
        const STR = { format: (...a) => { let k = 0; return obj.replace(/\{(\d*)(?::([^{}]*))?\}/g, (m, i, spec) => formatSpec(a[i === '' ? k++ : Number(i)], spec)); }, upper: () => obj.toUpperCase(), lower: () => obj.toLowerCase(), strip: () => obj.trim(), replace: (a, b) => obj.split(a).join(b), join: (list) => plainIter(list).map(String).join(obj) };
        if (STR[name]) return STR[name];
        throw new ScriptError(`texts have no .${name} here`);
    }
    if (obj && typeof obj === 'object' && !Array.isArray(obj) && own(obj, name)) return obj[name];
    throw new ScriptError(`${typeName(obj)} has no .${name}${obj && (obj.__name === 'plt' || obj.__name === 'figure') ? ' (not supported yet)' : ''}`);
}

function indexOf(obj, idx) {
    const one = idx.length === 1 ? idx[0] : null;
    if (Array.isArray(obj) || typeof obj === 'string') {
        if (one && one.slice) {
            const [a, b, st] = one.slice;
            const n = obj.length;
            const step = st ?? 1;
            const norm = (v, d) => (v === null || v === undefined ? d : v < 0 ? Math.max(0, n + v) : Math.min(n, v));
            const start = norm(a, step > 0 ? 0 : n - 1);
            const stop = norm(b, step > 0 ? n : -1);
            const out = [];
            for (let i = start; step > 0 ? i < stop : i > stop; i += step) out.push(obj[i]);
            return typeof obj === 'string' ? out.join('') : out;
        }
        const i = Number(one);
        const v = obj[i < 0 ? obj.length + i : i];
        if (v === undefined) throw new ScriptError('index out of range');
        return v;
    }
    if (!isArr(obj)) throw new ScriptError(`can't index ${typeName(obj)}`);
    // boolean mask
    if (one !== null && (isArr(one) || Array.isArray(one)) && !one.slice) {
        const mask = toArr(one).data;
        if (mask.length === obj.size) return new NDArray(obj.data.filter((_, i) => mask[i]));
        return new NDArray(Array.from(toArr(one).data, i => obj.data[i < 0 ? obj.size + i : i]));
    }
    const axisIndex = (spec, n) => {
        if (spec && spec.slice) {
            const [a, b, st] = spec.slice;
            const step = st ?? 1;
            const norm = (v, d) => (v === null || v === undefined ? d : v < 0 ? Math.max(0, n + v) : Math.min(n, v));
            const out = [];
            for (let i = norm(a, step > 0 ? 0 : n - 1); step > 0 ? i < norm(b, n) : i > norm(b, -1); i += step) out.push(i);
            return out;
        }
        const i = Math.trunc(Number(spec));
        const k = i < 0 ? n + i : i;
        if (k < 0 || k >= n) throw new ScriptError('index out of range');
        return k;
    };
    if (obj.shape.length === 1) {
        const r = axisIndex(idx[0], obj.size);
        return Array.isArray(r) ? new NDArray(r.map(i => obj.data[i])) : obj.data[r];
    }
    const [rows, cols] = obj.shape;
    const ri = axisIndex(idx[0], rows);
    const ci = idx.length > 1 ? axisIndex(idx[1], cols) : Array.from({ length: cols }, (_, i) => i);
    if (!Array.isArray(ri) && !Array.isArray(ci)) return obj.data[ri * cols + ci];
    if (!Array.isArray(ri)) return new NDArray(ci.map(j => obj.data[ri * cols + j]));
    if (!Array.isArray(ci)) return new NDArray(ri.map(i => obj.data[i * cols + ci]));
    const out = new Float64Array(ri.length * ci.length);
    ri.forEach((i, a) => ci.forEach((j, b) => { out[a * ci.length + b] = obj.data[i * cols + j]; }));
    return new NDArray(out, [ri.length, ci.length]);
}

const truthy = (v) => (isArr(v) ? (() => { if (v.size !== 1) throw new ScriptError('the truth of an array of several numbers is ambiguous (use .any() / .all())'); return Boolean(v.data[0]); })() : Array.isArray(v) || typeof v === 'string' ? v.length > 0 : Boolean(v));

/** Runs a script with the variables: { layers, settings }. */
export function runMatplotlib(code, vars) {
    const tree = parse(code);
    const { fig, api } = newFigure();
    const MODULES = { np: NP, numpy: NP, plt: api, math: NP, pyplot: api };
    const env = Object.assign(Object.create(null), vars || {});
    const aliases = { np: NP, plt: api, math: NP };
    let steps = 0;

    const get = (name, line) => {
        if (name in env) return env[name];
        if (own(aliases, name)) return aliases[name];
        if (own(BUILTINS, name)) return BUILTINS[name];
        throw new ScriptError(`unknown name: ${name}`, line);
    };

    const evalExpr = (n) => {
        switch (n.e) {
            case 'num': return n.v;
            case 'const': return n.v;
            case 'str': return n.parts.map(part => (part.f ? formatF(part.v, (src) => evalExpr(parseExpression(src, part.line))) : part.v)).join('');
            case 'name': return get(n.n, n.line);
            case 'tuple': { const t = n.items.map(evalExpr); t.tuple = true; return t; }
            case 'list': return n.items.map(evalExpr);
            case 'neg': { const a = evalExpr(n.a); return isNum(a) ? -a : elementwise([a], v => -v); }
            case 'not': { const a = evalExpr(n.a); return isArr(a) ? elementwise([a], v => (v ? 0 : 1)) : !truthy(a); }
            case 'and': { const a = evalExpr(n.a); return truthy(a) ? evalExpr(n.b) : a; }
            case 'or': { const a = evalExpr(n.a); return truthy(a) ? a : evalExpr(n.b); }
            case 'ifexp': return truthy(evalExpr(n.test)) ? evalExpr(n.a) : evalExpr(n.b);
            case 'bin': return binary(n.op, evalExpr(n.a), evalExpr(n.b));
            case 'in': { const b = evalExpr(n.b); const a = evalExpr(n.a); return typeof b === 'string' ? b.includes(a) : plainIter(b).includes(a); }
            case 'is': { const r = evalExpr(n.a) === evalExpr(n.b); return n.neg ? !r : r; }
            case 'attr': return attrOf(evalExpr(n.a), n.name);
            case 'index': return indexOf(evalExpr(n.a), n.idx.map(i => (i && i.slice ? { slice: i.slice.map(x => (x ? evalExpr(x) : null)) } : evalExpr(i))));
            case 'call': {
                const f = evalExpr(n.f);
                if (typeof f !== 'function') throw new ScriptError(`${typeName(f)} can't be called`, n.line);
                const args = n.args.map(evalExpr);
                if (n.kwargs.length) {
                    const kw = Object.fromEntries(n.kwargs.map(([k, v]) => [k, evalExpr(v)]));
                    if (f.__params) {
                        Object.entries(kw).forEach(([k, v]) => {
                            const at = f.__params.indexOf(k);
                            if (at < 0) throw new ScriptError(`${k}= isn't supported here`, n.line);
                            while (args.length < at) args.push(undefined);
                            args[at] = v;
                        });
                    } else if (f.__kw) {
                        Object.defineProperty(kw, '__kwargs', { value: true });
                        args.push(kw);
                    } else {
                        throw new ScriptError(`keyword arguments (${Object.keys(kw).join(', ')}=) aren't supported for this function`, n.line);
                    }
                }
                try {
                    return f(...args);
                } catch (e) {
                    if (e instanceof ScriptError && e.line === undefined) e.line = n.line;
                    throw e;
                }
            }
            case 'comp': {
                const out = [];
                for (const v of plainIter(evalExpr(n.iter))) {
                    if (++steps > MAX_STEPS) throw new ScriptError('too many steps');
                    assign(n.target, v);
                    if (!n.test || truthy(evalExpr(n.test))) out.push(evalExpr(n.item));
                }
                return out;
            }
            default: throw new ScriptError('can\'t read this');
        }
    };

    function assign(target, value) {
        if (target.e === 'name') { env[target.n] = value; return; }
        if (target.e === 'tuple' || target.e === 'list') {
            const vals = plainIter(value);
            if (vals.length !== target.items.length) throw new ScriptError(`${target.items.length} names for ${vals.length} values`);
            target.items.forEach((t, i) => assign(t, vals[i]));
            return;
        }
        if (target.e === 'index') {
            const obj = evalExpr(target.a);
            const idx = target.idx.map(evalExpr);
            if (Array.isArray(obj)) { obj[idx[0] < 0 ? obj.length + idx[0] : idx[0]] = value; return; }
            if (isArr(obj) && obj.shape.length === 1 && isNum(idx[0])) { obj.data[idx[0] < 0 ? obj.size + idx[0] : idx[0]] = Number(value); return; }
            throw new ScriptError('this assignment isn\'t supported');
        }
        throw new ScriptError('can\'t assign to this');
    }

    const run = (stmts) => {
        for (const st of stmts) {
            if (++steps > MAX_STEPS) throw new ScriptError('too many steps (a loop too long?)', st.line);
            try {
                switch (st.s) {
                    case 'import': {
                        const m = st.text.match(/^import\s+([\w.]+)(?:\s+as\s+(\w+))?$/) || st.text.match(/^from\s+([\w.]+)\s+import\s+(.+)$/);
                        if (!m) break;
                        if (st.text.startsWith('import')) {
                            const mod = MODULES[m[1].split('.').pop()] || (m[1] === 'matplotlib.pyplot' ? api : null);
                            if (!mod) throw new ScriptError(`only numpy, math and matplotlib.pyplot (not ${m[1]})`);
                            aliases[m[2] || m[1].split('.')[0]] = mod;
                        } else {
                            const mod = MODULES[m[1].split('.').pop()];
                            if (!mod) throw new ScriptError(`only numpy, math and matplotlib.pyplot (not ${m[1]})`);
                            m[2].split(',').map(x => x.trim()).forEach(part => {
                                const [n, alias] = part.split(/\s+as\s+/);
                                if (n === '*') return;
                                if (!own(mod, n)) throw new ScriptError(`${m[1]} has no ${n} here`);
                                aliases[alias || n] = mod[n];
                            });
                        }
                        break;
                    }
                    case 'pass': break;
                    case 'expr': evalExpr(st.value); break;
                    case 'assign': { const v = evalExpr(st.value); st.targets.forEach(t => assign(t, v)); break; }
                    case 'aug': assign(st.target, binary(st.op, evalExpr(st.target), evalExpr(st.value))); break;
                    case 'for': for (const v of plainIter(evalExpr(st.iter))) { assign(st.target, v); run(st.body); } break;
                    case 'if': {
                        const hit = st.branches.find(b => truthy(evalExpr(b.test)));
                        if (hit) run(hit.body); else if (st.orelse) run(st.orelse);
                        break;
                    }
                    default: break;
                }
            } catch (e) {
                if (e instanceof ScriptError) { if (e.line === undefined) e.line = st.line; throw e; }
                throw new ScriptError(e.message, st.line);
            }
        }
    };
    // the same draws every time (np.random.seed changes them)
    seeded(1, () => run(tree));
    return { layers: fig.layers, settings: fig.settings };
}

/** An expression of an f-string's {…}. */
function parseExpression(src, line) {
    const tree = parse(src);
    if (tree.length !== 1 || tree[0].s !== 'expr') throw new ScriptError(`can't read {${src}}`, line);
    return tree[0].value;
}

/** Names offered in a matplotlib script (suggestions). */
export function matplotlibNames() {
    const { api } = newFigure();
    return {
        np: Object.keys(NP).filter(k => !k.startsWith('_')).sort(),
        random: Object.keys(RANDOM).filter(k => !k.startsWith('_')).sort(),
        plt: Object.keys(api).filter(k => !k.startsWith('_')).sort(),
        builtins: Object.keys(BUILTINS),
        colormaps: Object.keys(CMAPS),
    };
}

void COLORMAP_NAMES;
registerScriptLanguage('matplotlib', runMatplotlib);
