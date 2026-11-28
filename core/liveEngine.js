// ============================================================
// core/liveEngine.js — Variables, formulas and plots that work the same
// in the editor and in an exported HTML file. No imports: the export
// (export/html.js) inlines this file into the presentation.
//
//   formatValue(v, fmt)            12.3456 / '%.2f' -> '12.35'
//   compileFormula(code, lang)     { evaluate(vars) -> (x -> y), names, error }
//   plotSvg(spec, vars)            the <svg> of a plot (axes, ticks, curves)
//   plotLayout(spec)               where its drawing area is (labels around it)
//   liveUpdate(root, vars)         after a slider moved: the values shown in
//                                  text (data-glvar) and the plots redrawn
//   bindSliders(root, vars, cb)    sliders (input[data-glslider]) set vars
//
// Formulas are read by a small parser for each language (lang:python,
// lang:latex) into one expression tree, evaluated by a closure tree:
// nothing ever goes through eval / Function, so a shared .gl file or an
// exported HTML can only compute numbers.
// ============================================================

// ---------- numbers ----------

/** A value as text: a printf-style format (%.2f %.3e %.4g %d %.1%), else a short number. */
export function formatValue(v, fmt) {
    if (typeof v !== 'number') return String(v ?? '');
    if (!Number.isFinite(v)) return Number.isNaN(v) ? 'NaN' : (v > 0 ? '∞' : '−∞');
    const m = String(fmt || '').match(/^%?(\.(\d+))?([fegd%])$/);
    let s;
    if (m) {
        const p = m[2] !== undefined ? Number(m[2]) : 2;
        switch (m[3]) {
            case 'f': s = v.toFixed(p); break;
            case 'e': s = v.toExponential(p); break;
            case 'g': s = String(Number(v.toPrecision(Math.max(1, p)))); break;
            case 'd': s = String(Math.round(v)); break;
            case '%': s = `${(v * 100).toFixed(p)}%`; break;
            default: s = String(v);
        }
    } else {
        s = Number.isInteger(v) ? String(v) : String(Number(v.toPrecision(6)));
    }
    return s.replace(/^-/, '−');
}

// ---------- math functions ----------

function erf(x) {
    // Abramowitz & Stegun 7.1.26 (error < 1.5e-7)
    const s = Math.sign(x);
    const a = Math.abs(x);
    const t = 1 / (1 + 0.3275911 * a);
    const y = 1 - (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-a * a);
    return s * y;
}

function gamma(z) {
    // Lanczos approximation
    if (z < 0.5) return Math.PI / (Math.sin(Math.PI * z) * gamma(1 - z));
    const g = 7;
    const c = [0.99999999999980993, 676.5203681218851, -1259.1392167224028, 771.32342877765313,
        -176.61502916214059, 12.507343278686905, -0.13857109526572012, 9.9843695780195716e-6, 1.5056327351493116e-7];
    z -= 1;
    let x = c[0];
    for (let i = 1; i < g + 2; i++) x += c[i] / (z + i);
    const t = z + g + 0.5;
    return Math.sqrt(2 * Math.PI) * Math.pow(t, z + 0.5) * Math.exp(-t) * x;
}

export const FUNCTIONS = {
    exp: Math.exp, log: (x, b) => (b === undefined ? Math.log(x) : Math.log(x) / Math.log(b)),
    ln: Math.log, log10: Math.log10, log2: Math.log2, log1p: Math.log1p, expm1: Math.expm1,
    sqrt: Math.sqrt, cbrt: Math.cbrt, abs: Math.abs, fabs: Math.abs,
    sin: Math.sin, cos: Math.cos, tan: Math.tan, asin: Math.asin, acos: Math.acos, atan: Math.atan,
    arcsin: Math.asin, arccos: Math.acos, arctan: Math.atan, atan2: Math.atan2, arctan2: Math.atan2,
    sinh: Math.sinh, cosh: Math.cosh, tanh: Math.tanh, asinh: Math.asinh, acosh: Math.acosh, atanh: Math.atanh,
    arcsinh: Math.asinh, arccosh: Math.acosh, arctanh: Math.atanh,
    sec: (x) => 1 / Math.cos(x), csc: (x) => 1 / Math.sin(x), cot: (x) => 1 / Math.tan(x),
    floor: Math.floor, ceil: Math.ceil, round: Math.round, trunc: Math.trunc, sign: Math.sign,
    min: (...a) => Math.min(...a), max: (...a) => Math.max(...a), pow: Math.pow, power: Math.pow, hypot: Math.hypot,
    erf, erfc: (x) => 1 - erf(x), gamma, factorial: (n) => gamma(n + 1),
    clip: (x, a, b) => Math.min(Math.max(x, a), b),
    where: (c, a, b) => (c ? a : b),
    heaviside: (x, h0 = 0.5) => (x > 0 ? 1 : x < 0 ? 0 : h0),
    sinc: (x) => (x === 0 ? 1 : Math.sin(Math.PI * x) / (Math.PI * x)),
    degrees: (x) => x * 180 / Math.PI, radians: (x) => x * Math.PI / 180, deg2rad: (x) => x * Math.PI / 180,
    mod: (a, b) => ((a % b) + b) % b, float: Number, int: Math.trunc,
};
// Random numbers (histograms sampled from a formula): a seeded generator, so a
// slider moving the distribution moves the same draws instead of new noise.
function mulberry32(seed) {
    let a = (Number(seed) || 1) >>> 0;
    return () => {
        a = (a + 0x6D2B79F5) >>> 0;
        let t = a;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}
let rng = mulberry32(1);
/** np.random.seed(n): the generator starts again at n. */
export function reseed(seed) {
    rng = mulberry32(seed);
}

/** Runs `fn` with the random generator started at `seed`. */
export function seeded(seed, fn) {
    const previous = rng;
    rng = mulberry32(seed);
    try {
        return fn();
    } finally {
        rng = previous;
    }
}
const normal = (mu = 0, sigma = 1) => {
    const u = 1 - rng();
    const v = rng();
    return mu + sigma * Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
};
Object.assign(FUNCTIONS, {
    rand: () => rng(), random: () => rng(), uniform: (a = 0, b = 1) => a + (b - a) * rng(),
    normal, gauss: normal, randn: () => normal(),
    lognormal: (mu = 0, sigma = 1) => Math.exp(normal(mu, sigma)),
    exponential: (scale = 1) => -scale * Math.log(1 - rng()), expovariate: (rate = 1) => -Math.log(1 - rng()) / rate,
    poisson: (lam = 1) => {
        if (lam > 50) return Math.max(0, Math.round(normal(lam, Math.sqrt(lam))));
        const l = Math.exp(-lam);
        let k = 0;
        let p = 1;
        do { k++; p *= rng(); } while (p > l);
        return k - 1;
    },
    binomial: (n = 1, p = 0.5) => { let k = 0; for (let i = 0; i < n; i++) if (rng() < p) k++; return k; },
    randint: (a, b) => a + Math.floor(rng() * (b - a + 1)),
});

/** Names a formula can call, and the constants (suggestions in the formula editors). */
export function formulaNames() {
    return { functions: Object.keys(FUNCTIONS).sort(), constants: Object.keys(CONSTANTS).filter(k => !['True', 'False', 'infty'].includes(k)) };
}

const CONSTANTS = { pi: Math.PI, e: Math.E, tau: 2 * Math.PI, inf: Infinity, nan: NaN, True: 1, False: 0, infty: Infinity };

// ---------- the expression tree and its evaluation ----------
// Nodes: {t:'num', v} {t:'name', n} {t:'neg', a} {t:'not', a}
//        {t:'op', op, a, b} {t:'call', f, args} {t:'if', c, a, b}

class FormulaError extends Error {
    constructor(message, line) {
        super(message);
        this.line = line;
    }
}

const BINARY = {
    '+': (a, b) => a + b, '-': (a, b) => a - b, '*': (a, b) => a * b, '/': (a, b) => a / b,
    '//': (a, b) => Math.floor(a / b), '%': (a, b) => ((a % b) + b) % b, '**': Math.pow,
    '<': (a, b) => (a < b ? 1 : 0), '<=': (a, b) => (a <= b ? 1 : 0), '>': (a, b) => (a > b ? 1 : 0),
    '>=': (a, b) => (a >= b ? 1 : 0), '==': (a, b) => (a === b ? 1 : 0), '!=': (a, b) => (a !== b ? 1 : 0),
};

/** A function (env -> number) for a node. */
function compileNode(node) {
    switch (node.t) {
        case 'num': { const v = node.v; return () => v; }
        case 'name': {
            const n = node.n;
            return (env) => {
                if (n in env) return env[n];
                if (n in CONSTANTS) return CONSTANTS[n];
                throw new FormulaError(`unknown name: ${n}`);
            };
        }
        case 'neg': { const a = compileNode(node.a); return (env) => -a(env); }
        case 'not': { const a = compileNode(node.a); return (env) => (a(env) ? 0 : 1); }
        case 'and': { const a = compileNode(node.a); const b = compileNode(node.b); return (env) => (a(env) ? b(env) : 0); }
        case 'or': { const a = compileNode(node.a); const b = compileNode(node.b); return (env) => (a(env) || b(env)); }
        case 'if': {
            const c = compileNode(node.c); const a = compileNode(node.a); const b = compileNode(node.b);
            return (env) => (c(env) ? a(env) : b(env));
        }
        case 'op': {
            const f = BINARY[node.op];
            const a = compileNode(node.a); const b = compileNode(node.b);
            return (env) => f(a(env), b(env));
        }
        case 'call': {
            const f = FUNCTIONS[node.f];
            if (!f) throw new FormulaError(`unknown function: ${node.f}`);
            const args = node.args.map(compileNode);
            if (args.length === 1) { const a = args[0]; return (env) => f(a(env)); }
            return (env) => f(...args.map(a => a(env)));
        }
        default: throw new FormulaError('cannot read this formula');
    }
}

function namesIn(node, out = new Set()) {
    if (!node || typeof node !== 'object') return out;
    if (node.t === 'name') out.add(node.n);
    for (const k of ['a', 'b', 'c']) if (node[k]) namesIn(node[k], out);
    (node.args || []).forEach(a => namesIn(a, out));
    return out;
}

// ---------- lang:python ----------

const PY_TOKEN = /\s*(?:(\d+(?:_\d+)*(?:\.\d*)?(?:[eE][-+]?\d+)?|\.\d+(?:[eE][-+]?\d+)?)|([A-Za-z_][A-Za-z0-9_]*(?:\.[A-Za-z_][A-Za-z0-9_]*)*)|(\*\*|\/\/|<=|>=|==|!=|[-+*/%()<>,=]))/y;
const PY_MODULES = /^(?:(?:np|numpy)\.random\.|random\.|math\.|np\.|numpy\.|scipy\.special\.|special\.|sp\.|cmath\.)/;

function tokenizePython(src, line) {
    const out = [];
    let i = 0;
    PY_TOKEN.lastIndex = 0;
    while (i < src.length) {
        if (/^\s*$/.test(src.slice(i))) break;
        PY_TOKEN.lastIndex = i;
        const m = PY_TOKEN.exec(src);
        if (!m) throw new FormulaError(`can't read “${src.slice(i).trim().slice(0, 12)}”`, line);
        if (m[1] !== undefined) out.push({ k: 'num', v: Number(m[1].replace(/_/g, '')) });
        else if (m[2] !== undefined) {
            const word = m[2].replace(PY_MODULES, '');
            out.push(['and', 'or', 'not', 'if', 'else'].includes(word) ? { k: 'op', v: word } : { k: 'name', v: word });
        } else out.push({ k: 'op', v: m[3] });
        i = PY_TOKEN.lastIndex;
    }
    return out;
}

function parsePythonExpr(tokens, line) {
    let p = 0;
    const peek = () => tokens[p];
    const isOp = (v) => tokens[p] && tokens[p].k === 'op' && tokens[p].v === v;
    const expect = (v) => {
        if (!isOp(v)) throw new FormulaError(`expected “${v}”`, line);
        p++;
    };
    const ternary = () => {
        const a = orExpr();
        if (isOp('if')) {
            p++;
            const c = orExpr();
            expect('else');
            const b = ternary();
            return { t: 'if', c, a, b };
        }
        return a;
    };
    const orExpr = () => {
        let a = andExpr();
        while (isOp('or')) { p++; a = { t: 'or', a, b: andExpr() }; }
        return a;
    };
    const andExpr = () => {
        let a = notExpr();
        while (isOp('and')) { p++; a = { t: 'and', a, b: notExpr() }; }
        return a;
    };
    const notExpr = () => {
        if (isOp('not')) { p++; return { t: 'not', a: notExpr() }; }
        return compare();
    };
    const compare = () => {
        let a = sum();
        while (peek() && peek().k === 'op' && ['<', '<=', '>', '>=', '==', '!='].includes(peek().v)) {
            const op = tokens[p++].v;
            a = { t: 'op', op, a, b: sum() };
        }
        return a;
    };
    const sum = () => {
        let a = product();
        while (isOp('+') || isOp('-')) { const op = tokens[p++].v; a = { t: 'op', op, a, b: product() }; }
        return a;
    };
    const product = () => {
        let a = unary();
        while (isOp('*') || isOp('/') || isOp('//') || isOp('%')) { const op = tokens[p++].v; a = { t: 'op', op, a, b: unary() }; }
        return a;
    };
    const unary = () => {
        if (isOp('-')) { p++; return { t: 'neg', a: unary() }; }
        if (isOp('+')) { p++; return unary(); }
        return power();
    };
    const power = () => {
        const base = atom();
        if (isOp('**')) { p++; return { t: 'op', op: '**', a: base, b: unary() }; }
        return base;
    };
    const atom = () => {
        const tok = tokens[p];
        if (!tok) throw new FormulaError('the formula ends too early', line);
        if (tok.k === 'num') { p++; return { t: 'num', v: tok.v }; }
        if (tok.k === 'name') {
            p++;
            if (isOp('(')) {
                p++;
                const args = [];
                if (!isOp(')')) {
                    args.push(ternary());
                    while (isOp(',')) { p++; args.push(ternary()); }
                }
                expect(')');
                if (!FUNCTIONS[tok.v]) throw new FormulaError(`unknown function: ${tok.v}`, line);
                return { t: 'call', f: tok.v, args };
            }
            return { t: 'name', n: tok.v };
        }
        if (isOp('(')) {
            p++;
            const e = ternary();
            expect(')');
            return e;
        }
        throw new FormulaError(`unexpected “${tok.v}”`, line);
    };
    const tree = ternary();
    if (p < tokens.length) throw new FormulaError(`unexpected “${tokens[p].v}”`, line);
    return tree;
}

/** Statements of lang:python: [{ name | null, tree }]. */
function parsePython(code) {
    const statements = [];
    let pending = '';
    let pendingLine = 0;
    String(code || '').split('\n').forEach((raw, i) => {
        const text = raw.replace(/#.*$/, '').trim();
        if (!text && !pending) return;
        if (!pending) pendingLine = i + 1;
        pending = pending ? `${pending} ${text}` : text;
        const depth = (pending.match(/\(/g) || []).length - (pending.match(/\)/g) || []).length;
        if (depth > 0 || /[\\,+\-*/]$/.test(pending)) { pending = pending.replace(/\\$/, ''); return; }
        statements.push(pythonStatement(pending, pendingLine));
        pending = '';
    });
    if (pending) statements.push(pythonStatement(pending, pendingLine));
    return statements;
}

function pythonStatement(text, line) {
    const m = text.match(/^(?:return\s+)?(?:([A-Za-z_][A-Za-z0-9_]*)\s*=(?!=))?\s*([\s\S]+)$/);
    const name = m && m[1] ? m[1] : null;
    const body = m ? m[2] : text;
    return { name, tree: parsePythonExpr(tokenizePython(body, line), line), line };
}

// ---------- lang:latex ----------

const GREEK = ['alpha', 'beta', 'gamma', 'delta', 'epsilon', 'varepsilon', 'zeta', 'eta', 'theta', 'vartheta', 'iota', 'kappa',
    'lambda', 'mu', 'nu', 'xi', 'rho', 'varrho', 'sigma', 'varsigma', 'tau', 'upsilon', 'phi', 'varphi', 'chi', 'psi', 'omega',
    'Gamma', 'Delta', 'Theta', 'Lambda', 'Xi', 'Pi', 'Sigma', 'Upsilon', 'Phi', 'Psi', 'Omega', 'ell'];
const LATEX_FUNCS = { sin: 'sin', cos: 'cos', tan: 'tan', sec: 'sec', csc: 'csc', cot: 'cot', arcsin: 'asin', arccos: 'acos',
    arctan: 'atan', sinh: 'sinh', cosh: 'cosh', tanh: 'tanh', exp: 'exp', ln: 'log', log: 'log', lg: 'log10',
    max: 'max', min: 'min', erf: 'erf', sgn: 'sign', operatorname: null };
const LATEX_IGNORE = new Set([',', ';', ':', '!', ' ', 'quad', 'qquad', 'displaystyle', 'textstyle', 'limits', 'left', 'right',
    'big', 'Big', 'bigg', 'Bigg', 'bigl', 'bigr', 'Bigl', 'Bigr', 'mathrm_space']);

function tokenizeLatex(src, line) {
    const out = [];
    let i = 0;
    while (i < src.length) {
        const ch = src[i];
        if (/\s/.test(ch)) { i++; continue; }
        if (ch === '\\') {
            const m = src.slice(i + 1).match(/^([A-Za-z]+|.)/);
            if (!m) throw new FormulaError('a lone \\ at the end', line);
            i += 1 + m[1].length;
            if (LATEX_IGNORE.has(m[1])) continue;
            if (m[1] === '{' || m[1] === '}') { out.push({ k: 'op', v: m[1] === '{' ? '(' : ')' }); continue; }
            if (m[1] === '\\') { out.push({ k: 'op', v: ';' }); continue; }
            out.push({ k: 'cmd', v: m[1] });
            continue;
        }
        const num = src.slice(i).match(/^(\d+(?:\.\d*)?|\.\d+)/);
        if (num) { out.push({ k: 'num', v: Number(num[1]) }); i += num[1].length; continue; }
        if (/[A-Za-z]/.test(ch)) { out.push({ k: 'letter', v: ch }); i++; continue; }
        if ('+-*/^_(){}[]|=,<>!'.includes(ch)) { out.push({ k: 'op', v: ch }); i++; continue; }
        throw new FormulaError(`can't read “${ch}”`, line);
    }
    return out;
}

function parseLatexExpr(tokens, line) {
    let p = 0;
    let absDepth = 0;
    const tok = () => tokens[p];
    const isOp = (v) => tokens[p] && tokens[p].k === 'op' && tokens[p].v === v;
    const isCmd = (v) => tokens[p] && tokens[p].k === 'cmd' && tokens[p].v === v;
    const expect = (v) => {
        if (!isOp(v)) throw new FormulaError(`expected “${v}”`, line);
        p++;
    };
    const group = () => {           // {…} or one token
        if (isOp('{')) { p++; const e = sum(); expect('}'); return e; }
        return atomNoImplicit();
    };
    const textGroup = () => {       // {name} as text
        expect('{');
        let s = '';
        while (tok() && !isOp('}')) { const t = tokens[p++]; s += t.k === 'num' ? String(t.v) : t.v; }
        expect('}');
        return s;
    };
    const sum = () => {
        let a = term();
        while (isOp('+') || isOp('-')) { const op = tokens[p++].v; a = { t: 'op', op, a, b: term() }; }
        return a;
    };
    const startsFactor = () => {
        const t = tok();
        if (!t) return false;
        if (t.k === 'num' || t.k === 'letter') return true;
        if (t.k === 'cmd') return !['cdot', 'times', 'div', 'right'].includes(t.v);
        if (t.k === 'op') return t.v === '(' || t.v === '[' || t.v === '{' || (t.v === '|' && absDepth === 0);
        return false;
    };
    const term = (stopAtFunction = false) => {
        let a = unary();
        for (;;) {
            if (isCmd('cdot') || isCmd('times') || isOp('*')) { p++; a = { t: 'op', op: '*', a, b: unary() }; continue; }
            if (isCmd('div') || isOp('/')) { p++; a = { t: 'op', op: '/', a, b: unary() }; continue; }
            if (startsFactor()) {
                if (stopAtFunction && tok().k === 'cmd' && tok().v in LATEX_FUNCS) break;
                a = { t: 'op', op: '*', a, b: power() };
                continue;
            }
            break;
        }
        return a;
    };
    const unary = () => {
        if (isOp('-')) { p++; return { t: 'neg', a: unary() }; }
        if (isOp('+')) { p++; return unary(); }
        return power();
    };
    const power = () => {
        let base = atom();
        if (isOp('^')) {
            p++;
            const exp = isOp('-') ? (p++, { t: 'neg', a: group() }) : group();
            if (base.t === 'name' && base.n === 'e') return { t: 'call', f: 'exp', args: [exp] };
            base = { t: 'op', op: '**', a: base, b: exp };
        }
        if (isOp('!')) { p++; base = { t: 'call', f: 'factorial', args: [base] }; }
        return base;
    };
    const subscript = (name) => {
        if (!isOp('_')) return name;
        p++;
        if (isOp('{')) return `${name}_${textGroup()}`;
        const t = tokens[p++];
        if (!t) throw new FormulaError('a _ at the end', line);
        return `${name}_${t.k === 'num' ? t.v : t.v}`;
    };
    const fnArgument = () => {
        if (isOp('(') || isOp('[')) {
            const close = isOp('(') ? ')' : ']';
            p++;
            const args = [sum()];
            while (isOp(',')) { p++; args.push(sum()); }
            expect(close);
            return args;
        }
        return [term(true)];
    };
    const atomNoImplicit = () => {
        const t = tok();
        if (!t) throw new FormulaError('the formula ends too early', line);
        if (t.k === 'num') { p++; return { t: 'num', v: t.v }; }
        if (t.k === 'letter') { p++; return { t: 'name', n: subscript(t.v) }; }
        return atom();
    };
    const atom = () => {
        const t = tok();
        if (!t) throw new FormulaError('the formula ends too early', line);
        if (t.k === 'num' || t.k === 'letter') return atomNoImplicit();
        if (t.k === 'op') {
            if (t.v === '(' || t.v === '[' || t.v === '{') {
                const close = { '(': ')', '[': ']', '{': '}' }[t.v];
                p++;
                const e = sum();
                expect(close);
                return e;
            }
            if (t.v === '|') {
                p++;
                absDepth++;
                const e = sum();
                absDepth--;
                expect('|');
                return { t: 'call', f: 'abs', args: [e] };
            }
            throw new FormulaError(`unexpected “${t.v}”`, line);
        }
        // a command
        p++;
        const c = t.v;
        if (c === 'frac' || c === 'dfrac' || c === 'tfrac') return { t: 'op', op: '/', a: group(), b: group() };
        if (c === 'sqrt') {
            if (isOp('[')) {
                p++;
                const n = sum();
                expect(']');
                return { t: 'op', op: '**', a: group(), b: { t: 'op', op: '/', a: { t: 'num', v: 1 }, b: n } };
            }
            return { t: 'call', f: 'sqrt', args: [group()] };
        }
        if (c === 'pi') return { t: 'name', n: 'pi' };
        if (c === 'infty') return { t: 'num', v: Infinity };
        if (c === 'mathrm' || c === 'text' || c === 'mathit' || c === 'operatorname') {
            const name = subscript(textGroup());
            if (FUNCTIONS[name] && (isOp('(') || isOp('['))) return { t: 'call', f: name, args: fnArgument() };
            return { t: 'name', n: name };
        }
        if (c in LATEX_FUNCS) {
            let exponent = null;
            if (isOp('^')) { p++; exponent = group(); }
            const call = { t: 'call', f: LATEX_FUNCS[c], args: fnArgument() };
            return exponent ? { t: 'op', op: '**', a: call, b: exponent } : call;
        }
        if (GREEK.includes(c)) return { t: 'name', n: subscript(c) };
        throw new FormulaError(`\\${c} isn't understood in a formula`, line);
    };
    const tree = sum();
    if (p < tokens.length) throw new FormulaError(`unexpected “${tokens[p].v}”`, line);
    return tree;
}

/** Statements of lang:latex: lines (or \\) of "name = …", "f(x) = …" or a bare expression. */
function parseLatex(code) {
    const statements = [];
    String(code || '').replace(/\$/g, '').split('\n').forEach((raw, i) => {
        raw.split(/\\\\/).forEach(part => {
            const text = part.replace(/%.*$/, '').trim();
            if (!text) return;
            const tokens = tokenizeLatex(text, i + 1);
            const eq = tokens.findIndex(t => t.k === 'op' && t.v === '=');
            let name = null;
            let rhs = tokens;
            if (eq >= 0) {
                const lhs = tokens.slice(0, eq);
                rhs = tokens.slice(eq + 1);
                // "y =", "\sigma_2 =": a name; "f(x) =" or anything else: the output
                if (lhs.length && (lhs[0].k === 'letter' || lhs[0].k === 'cmd') && !lhs.some(t => t.k === 'op' && t.v === '(')) {
                    const tree = parseLatexExpr(lhs, i + 1);
                    if (tree.t === 'name') name = tree.n;
                }
            }
            statements.push({ name, tree: parseLatexExpr(rhs, i + 1), line: i + 1 });
        });
    });
    return statements;
}

// ---------- formulas ----------

export const LANGUAGES = ['python', 'latex'];
const PARSERS = { python: parsePython, latex: parseLatex };
const formulaCache = new Map();

/**
 * Reads a formula once: { evaluate(vars) -> (x -> y), names, error }.
 * The result is the variable `y` if a line sets it, else the last line.
 */
export function compileFormula(code, lang = 'python') {
    const key = `${lang}\u0000${code}`;
    if (formulaCache.has(key)) return formulaCache.get(key);
    let result;
    try {
        const parse = PARSERS[lang];
        if (!parse) throw new FormulaError(`unknown language: ${lang} (${LANGUAGES.join(', ')})`);
        const statements = parse(code);
        if (!statements.length) throw new FormulaError('no formula');
        const steps = statements.map(s => ({ name: s.name, run: compileNode(s.tree), line: s.line }));
        const outIndex = (() => {
            for (let i = steps.length - 1; i >= 0; i--) if (steps[i].name === 'y') return i;
            return steps.length - 1;
        })();
        const names = new Set();
        statements.forEach(s => namesIn(s.tree, names));
        statements.forEach(s => s.name && names.delete(s.name));
        names.delete('x');
        Object.keys(CONSTANTS).forEach(n => names.delete(n));
        result = {
            error: null,
            names: [...names],
            /** Runs every line on `env` (names set there): the last line's value. */
            exec(env) {
                let out = NaN;
                for (const step of steps) {
                    try {
                        out = step.run(env);
                    } catch (e) {
                        if (e instanceof FormulaError && e.line === undefined) e.line = step.line;
                        throw e;
                    }
                    if (step.name) env[step.name] = out;
                }
                return out;
            },
            evaluate(vars) {
                return (x) => {
                    const env = Object.assign(Object.create(null), vars, { x });
                    let out = NaN;
                    for (let i = 0; i <= outIndex; i++) {
                        const step = steps[i];
                        let v;
                        try {
                            v = step.run(env);
                        } catch (e) {
                            if (e instanceof FormulaError && e.line === undefined) e.line = step.line;
                            throw e;
                        }
                        if (step.name) env[step.name] = v;
                        if (i === outIndex) out = v;
                    }
                    return typeof out === 'number' ? out : Number(out);
                };
            },
        };
    } catch (e) {
        result = { error: e.line ? `line ${e.line}: ${e.message}` : e.message, names: [], evaluate: null, exec: null };
    }
    if (formulaCache.size > 500) formulaCache.clear();
    formulaCache.set(key, result);
    return result;
}

// ---------- plots ----------
//
// A plot is a frame (axes, ranges, labels) holding layers, one per
// ".kind key:value …" line of its body, followed by that layer's formula
// or data rows:
//   curve       y = f(x)
//   fill        the area between y = f(x) and y0 (default 0), from:a to:b
//   parametric  x = f(t), y = g(t), from:… to:… (default 0 to 2π)
//   vline hline point text   markers at values (x:mu, y:…, label:…)
//   points line             data: a CSV's columns (data:{data/run.csv} x:step y:loss yerr:std)
//                           or rows written in the body ("1, 0.5")
//   hist        a column of data, or samples of a formula (samples:2000 seed:1),
//               in bins:30 (density:yes: area 1)
//   bar         categories (or numbers) and values, from data or rows
//   heatmap contour quiver  z = f(x, y) as colours / level lines; u, v as arrows

export const LAYER_KINDS = ['curve', 'fill', 'parametric', 'vline', 'hline', 'point', 'text', 'points', 'line', 'hist', 'bar', 'heatmap', 'contour', 'quiver'];
const GRID_KINDS = new Set(['heatmap', 'contour', 'quiver']);
const LINE_KINDS = new Set(['curve', 'parametric', 'line', 'contour', 'vline', 'hline']);
export const PALETTE = ['#2563eb', '#dc2626', '#16a34a', '#d97706', '#7c3aed', '#0891b2'];

const num = (v, d) => (v === '' || v === null || v === undefined || !Number.isFinite(Number(v)) ? d : Number(v));
const isSet = (v) => v !== '' && v !== null && v !== undefined && Number.isFinite(Number(v));
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

function parseLayerParams(text) {
    const out = {};
    for (const [, k, v] of String(text || '').matchAll(/([A-Za-z]+):("(?:[^"\\]|\\.)*"|\{[^}]*\}|\S+)/g)) {
        // inside quotes only \" and \\ are escapes (as in .gl): "$\mu$" keeps its backslash
        let value = v.startsWith('"') ? v.slice(1, -1).replace(/\\(["\\])/g, '$1') : v;
        if (value.startsWith('{') && value.endsWith('}')) value = value.slice(1, -1);
        out[k] = value;
    }
    return out;
}

/** A plot's body as layers: [{ kind, code, lang, line, ...params }]. */
export function parseLayers(text, lang = 'python') {
    const layers = [];
    let current = null;
    String(text || '').split('\n').forEach((raw, i) => {
        const m = raw.match(/^\s*\.([a-z]+)\b(.*)$/);
        if (m && LAYER_KINDS.includes(m[1])) {
            current = { lang, ...parseLayerParams(m[2]), kind: m[1], code: '', line: i + 1 };
            layers.push(current);
            return;
        }
        if (!current) {
            if (!raw.trim() || raw.trim().startsWith('#')) return; // comments before the first layer
            current = { kind: 'curve', code: '', lang, line: i + 1 };
            layers.push(current);
        }
        current.code += (current.code ? '\n' : '') + raw;
    });
    const needsCode = (l) => ['curve', 'fill', 'parametric', 'heatmap', 'contour', 'quiver'].includes(l.kind);
    return layers.filter(l => !needsCode(l) || l.code.trim());
}

/** The curves only (older callers). */
export function parseCurves(text, lang = 'python') {
    return parseLayers(text, lang).filter(l => l.kind === 'curve');
}

/** Margins around a plot's drawing area (labels, ticks, colour bar), in pixels. */
export function plotLayout(spec) {
    const fs = num(spec.fontSize, 24);
    const bar = (spec.layers || []).some(l => l.kind === 'heatmap' && l.colorbar !== 'no');
    // axes:none — only the drawing; axes:zero — axes through the origin, numbers next to them
    const bare = spec.axes === 'none' || spec.axes === 'zero';
    const left = (bare ? fs * 0.5 : fs * 3.4) + (spec.ylabel ? fs * 1.6 : 0);
    const bottom = (bare ? fs * 0.5 : fs * 2) + (spec.xlabel ? fs * 1.6 : 0);
    const top = fs * (bare ? 0.5 : 0.8) + (spec.title ? fs * 1.8 : 0);
    const right = fs * (bare ? 0.5 : 1.2) + (bar ? fs * 4.4 : 0);
    const w = Math.max(10, num(spec.width, 800) - left - right);
    const h = Math.max(10, num(spec.height, 500) - top - bottom);
    return { left, top, right, bottom, w, h, fs, bar };
}

// ---------- evaluating layers ----------

class LayerError extends Error {}

/** A formula of a layer, checked: its compiled form, or a LayerError naming what's wrong. */
function formulaOf(layer, coords, vars) {
    const f = compileFormula(layer.code || '', layer.lang || 'python');
    if (f.error) throw new LayerError(f.error);
    const missing = f.names.filter(n => !coords.includes(n) && !(n in vars) && !(n in CONSTANTS));
    if (missing.length) throw new LayerError(`unknown name${missing.length > 1 ? 's' : ''}: ${missing.join(', ')} (a slider sets one; or Project settings → Variables)`);
    return f;
}

/** A parameter that may be a formula (x:mu, from:a-1): its number, else `fallback`. */
function paramValue(layer, key, vars, fallback) {
    const v = layer[key];
    if (v === undefined || v === '') return fallback;
    if (isSet(v)) return Number(v);
    const f = compileFormula(String(v), layer.lang || 'python');
    if (f.error) throw new LayerError(`${key}: ${f.error}`);
    const missing = f.names.filter(n => !(n in vars) && !(n in CONSTANTS));
    if (missing.length) throw new LayerError(`${key}: unknown name ${missing.join(', ')}`);
    return Number(f.exec(Object.assign(Object.create(null), vars)));
}

/** Rows of a data layer: its file's (layer.table, given by the page) or the rows in its body. */
function tableOf(layer) {
    if (layer.tableError) throw new LayerError(layer.tableError);
    if (layer.table && Array.isArray(layer.table.rows)) return layer.table;
    if (layer.data) throw new LayerError(`${layer.data}: not read yet`);
    const lines = String(layer.code || '').split('\n').map(l => l.replace(/#.*$/, '').trim()).filter(Boolean);
    const split = (l) => (/[,;\t]/.test(l) ? l.split(/\s*[,;\t]\s*/) : l.split(/\s+/));
    const rows = lines.map(split);
    if (!rows.length) return { header: null, rows: [] };
    const numeric = (c) => c !== '' && Number.isFinite(Number(c));
    // a header: a first row of names only (a row like "Adam, 3" is data)
    const header = rows.length > 1 && rows[0].every(c => !numeric(c)) && rows[1].some(numeric) ? rows.shift() : null;
    return { header, rows };
}

/** A column of a table by name (the header) or number (from 1). */
function columnOf(table, which, fallback) {
    let i = fallback;
    if (which !== undefined && which !== '') {
        if (isSet(which)) i = Number(which) - 1;
        else {
            i = (table.header || []).findIndex(h => String(h).trim() === String(which).trim());
            if (i < 0) throw new LayerError(`no column “${which}”${table.header ? ` (columns: ${table.header.join(', ')})` : ''}`);
        }
    }
    return table.rows.map(r => r[i]);
}

const numbers = (col) => col.map(v => (v === undefined || v === '' ? NaN : Number(v)));

/** Grows an extent { x: [lo, hi], y: [lo, hi] } with a point. */
function grow(ext, axis, v) {
    if (!Number.isFinite(v)) return;
    const e = ext[axis];
    if (v < e[0]) e[0] = v;
    if (v > e[1]) e[1] = v;
}

function sampleXs(xr, n, log) {
    const out = [];
    for (let i = 0; i <= n; i++) {
        const t = i / n;
        out.push(log ? Math.pow(10, Math.log10(xr[0]) + (Math.log10(xr[1]) - Math.log10(xr[0])) * t) : xr[0] + (xr[1] - xr[0]) * t);
    }
    return out;
}

function evalPointsLayer(layer, vars, ext) {
    const table = tableOf(layer);
    const ys = numbers(columnOf(table, layer.y, table.rows[0] && table.rows[0].length > 1 ? 1 : 0));
    const xs = table.rows[0] && table.rows[0].length > 1 ? numbers(columnOf(table, layer.x, 0)) : ys.map((_, i) => i + 1);
    const err = layer.yerr ? numbers(columnOf(table, layer.yerr, 2)) : null;
    xs.forEach((x, i) => {
        grow(ext, 'x', x);
        grow(ext, 'y', ys[i] - (err ? err[i] || 0 : 0));
        grow(ext, 'y', ys[i] + (err ? err[i] || 0 : 0));
    });
    return { xs, ys, err };
}

/** First pass: layers that don't need the x range (data, markers, samples). */
function evalFirst(layer, vars, ext, spec) {
    switch (layer.kind) {
        case 'points':
        case 'line':
            return evalPointsLayer(layer, vars, ext);
        case 'vline': {
            const x = paramValue(layer, 'x', vars, NaN);
            grow(ext, 'x', x);
            return { x };
        }
        case 'hline': {
            const y = paramValue(layer, 'y', vars, NaN);
            grow(ext, 'y', y);
            return { y };
        }
        case 'point':
        case 'text': {
            const x = paramValue(layer, 'x', vars, NaN);
            const y = paramValue(layer, 'y', vars, NaN);
            grow(ext, 'x', x);
            grow(ext, 'y', y);
            return { x, y };
        }
        case 'parametric': {
            const f = formulaOf(layer, ['t'], vars);
            const t0 = paramValue(layer, 'from', vars, 0);
            const t1 = paramValue(layer, 'to', vars, 2 * Math.PI);
            const n = Math.max(20, Math.min(5000, num(layer.samples, num(spec.samples, 400))));
            const pts = [];
            for (let i = 0; i <= n; i++) {
                const env = Object.assign(Object.create(null), vars, { t: t0 + (t1 - t0) * i / n });
                f.exec(env);
                if (!('x' in env) || !('y' in env)) throw new LayerError('a parametric curve sets x = … and y = … (in t)');
                pts.push([Number(env.x), Number(env.y)]);
                grow(ext, 'x', Number(env.x));
                grow(ext, 'y', Number(env.y));
            }
            return { pts };
        }
        case 'hist': {
            let values;
            // rows of numbers (a file, or written in the body), else samples of a formula
            const inline = !layer.data && !layer.table ? tableOf(layer) : null;
            const allNumbers = inline && inline.rows.length && inline.rows.every(r => r.every(c => isSet(c)));
            if (layer.samples !== undefined || (inline && !allNumbers)) {
                const f = formulaOf(layer, ['i'], vars);
                const n = Math.max(1, Math.min(200000, Math.round(num(layer.samples, 1000))));
                values = seeded(num(layer.seed, 1), () => {
                    const out = new Array(n);
                    for (let i = 0; i < n; i++) out[i] = Number(f.exec(Object.assign(Object.create(null), vars, { i })));
                    return out;
                });
            } else {
                const table = tableOf(layer);
                values = numbers(columnOf(table, layer.column, 0));
            }
            values = values.filter(Number.isFinite);
            if (!values.length) throw new LayerError('no values to count');
            let lo = Infinity;
            let hi = -Infinity;
            values.forEach(v => { if (v < lo) lo = v; if (v > hi) hi = v; });
            return { values, lo, hi };
        }
        case 'heatmap':
        case 'contour':
        case 'quiver':
            // computed by a script: their extent counts for the ranges
            if (layer.gridData && layer.gridData.extent) {
                const [x0, x1, y0, y1] = layer.gridData.extent;
                grow(ext, 'x', x0); grow(ext, 'x', x1); grow(ext, 'y', y0); grow(ext, 'y', y1);
            }
            if (layer.arrowsData) layer.arrowsData.forEach(([x, y]) => { grow(ext, 'x', x); grow(ext, 'y', y); });
            return {};
        case 'bar': {
            const table = tableOf(layer);
            const two = table.rows[0] && table.rows[0].length > 1;
            const ys = numbers(columnOf(table, layer.y, two ? 1 : 0));
            const keys = two ? columnOf(table, layer.x, 0).map(k => String(k ?? '').trim()) : ys.map((_, i) => String(i + 1));
            const categorical = keys.some(k => !isSet(k));
            ys.forEach(y => { grow(ext, 'y', y); grow(ext, 'y', 0); });
            if (!categorical) keys.forEach(k => grow(ext, 'x', Number(k)));
            return { keys, ys, categorical };
        }
        default:
            return null;
    }
}

/** Second pass: layers sampled over the x range (curves, fills, histogram bins). */
function evalSecond(layer, first, vars, ext, xr, spec, frozen) {
    const n = Math.max(20, Math.min(4000, num(layer.samples, num(spec.samples, 400))));
    if (layer.kind === 'fill' && layer.table) {
        // computed by a script: rows of x, top, bottom
        const top = [];
        const bottom = [];
        layer.table.rows.forEach(([x, y1, y2]) => {
            top.push([Number(x), Number(y1)]);
            bottom.push([Number(x), Number(y2 ?? 0)]);
            grow(ext, 'y', Number(y1));
            grow(ext, 'y', Number(y2 ?? 0));
        });
        return { pts: top, bottom };
    }
    if (layer.kind === 'curve' || layer.kind === 'fill') {
        const f = formulaOf(layer, ['x'], vars);
        const a = layer.kind === 'fill' ? paramValue(layer, 'from', vars, xr[0]) : xr[0];
        const b = layer.kind === 'fill' ? paramValue(layer, 'to', vars, xr[1]) : xr[1];
        const lo = Math.max(Math.min(a, b), xr[0]);
        const hi = Math.min(Math.max(a, b), xr[1]);
        const top = [];
        const bottom = [];
        if (hi > lo) {
            sampleXs([lo, hi], n, spec.xscale === 'log' && lo > 0).forEach(x => {
                const env = Object.assign(Object.create(null), vars, { x });
                const last = f.exec(env);
                const y = Number('y' in env ? env.y : last);
                top.push([x, y]);
                grow(ext, 'y', y);
                if (layer.kind === 'fill') {
                    const y0 = Number('y0' in env ? env.y0 : 0);
                    bottom.push([x, y0]);
                    grow(ext, 'y', y0);
                }
            });
        }
        return { pts: top, bottom };
    }
    if (layer.kind === 'hist') {
        const bins = Math.max(1, Math.min(500, Math.round(num(layer.bins, 30))));
        const fixedRange = isSet(spec.xmin) && isSet(spec.xmax);
        const from = paramValue(layer, 'from', vars, fixedRange || frozen ? xr[0] : first.lo);
        const to = paramValue(layer, 'to', vars, fixedRange || frozen ? xr[1] : (first.hi > first.lo ? first.hi : first.lo + 1));
        const width = (to - from) / bins;
        const counts = new Array(bins).fill(0);
        first.values.forEach(v => {
            if (v < from || v > to) return;
            counts[Math.min(bins - 1, Math.floor((v - from) / width))] += 1;
        });
        const density = layer.density === 'yes';
        const total = first.values.length;
        const heights = counts.map(c => (density ? c / (total * width) : c));
        heights.forEach(hh => grow(ext, 'y', hh));
        grow(ext, 'y', 0);
        return { from, width, heights };
    }
    return first;
}

/** Third pass: layers over the x × y area (heatmap, contour, quiver). */
function evalGrid(layer, vars, xr, yr, L) {
    // computed by a script: the values on a grid over `extent`, or the arrows
    if (layer.arrowsData) {
        const n = layer.arrowsData.length;
        const nx = Math.max(2, Math.round(Math.sqrt(n * L.w / L.h)));
        return { arrows: layer.arrowsData, nx, ny: Math.max(2, Math.round(n / nx)) };
    }
    if (layer.gridData) {
        const g = layer.gridData;
        let lo = Infinity;
        let hi = -Infinity;
        g.z.forEach(v => { if (Number.isFinite(v)) { if (v < lo) lo = v; if (v > hi) hi = v; } });
        // a heatmap's values are cells; contour lines go through the points
        return { z: g.z, cols: g.cols, rows: g.rows, nx: layer.kind === 'contour' ? g.cols - 1 : g.cols, ny: layer.kind === 'contour' ? g.rows - 1 : g.rows, lo, hi, extent: g.extent };
    }
    const f = formulaOf(layer, ['x', 'y'], vars);
    const aspect = L.h / L.w;
    if (layer.kind === 'quiver') {
        const nx = Math.max(2, Math.min(60, Math.round(num(layer.grid, 16))));
        const ny = Math.max(2, Math.round(nx * aspect));
        const arrows = [];
        for (let j = 0; j < ny; j++) {
            for (let i = 0; i < nx; i++) {
                const x = xr[0] + (xr[1] - xr[0]) * (i + 0.5) / nx;
                const y = yr[0] + (yr[1] - yr[0]) * (j + 0.5) / ny;
                const env = Object.assign(Object.create(null), vars, { x, y });
                f.exec(env);
                if (!('u' in env) || !('v' in env)) throw new LayerError('arrows set u = … and v = … (in x and y)');
                arrows.push([x, y, Number(env.u), Number(env.v)]);
            }
        }
        return { arrows, nx, ny };
    }
    const nx = Math.max(4, Math.min(400, Math.round(num(layer.resolution, layer.kind === 'contour' ? 100 : 120))));
    const ny = Math.max(4, Math.round(nx * aspect));
    // heatmap: cell centres; contour: the corners of the cells
    const corners = layer.kind === 'contour';
    const cols = corners ? nx + 1 : nx;
    const rows = corners ? ny + 1 : ny;
    const z = new Float64Array(cols * rows);
    let lo = Infinity;
    let hi = -Infinity;
    for (let j = 0; j < rows; j++) {
        for (let i = 0; i < cols; i++) {
            const x = xr[0] + (xr[1] - xr[0]) * (corners ? i / nx : (i + 0.5) / nx);
            const y = yr[0] + (yr[1] - yr[0]) * (corners ? j / ny : (j + 0.5) / ny);
            const env = Object.assign(Object.create(null), vars, { x, y });
            const last = f.exec(env);
            const v = Number('z' in env ? env.z : last);
            z[j * cols + i] = v;
            if (Number.isFinite(v)) { if (v < lo) lo = v; if (v > hi) hi = v; }
        }
    }
    return { z, cols, rows, nx, ny, lo, hi };
}

/** The range of an axis: what the plot sets, else frozen (found once), else from the layers. */
function axisRange(min, max, frozen, ext, log, fallback) {
    let lo = isSet(min) ? Number(min) : null;
    let hi = isSet(max) ? Number(max) : null;
    if (lo !== null && hi !== null && hi > lo) return [lo, hi];
    let a = frozen ? frozen[0] : ext[0];
    let b = frozen ? frozen[1] : ext[1];
    if (!Number.isFinite(a) || !Number.isFinite(b)) [a, b] = fallback;
    if (log) {
        a = Math.max(a, 1e-12);
        b = Math.max(b, a * 10);
    }
    if (!frozen) {
        if (b - a < 1e-12) { a -= 1; b += 1; }
        if (log) { a /= 1.3; b *= 1.3; } else { const pad = (b - a) * 0.06; a -= pad; b += pad; }
    }
    return [lo !== null ? lo : a, hi !== null ? hi : b];
}

/**
 * Everything a plot shows, computed for these variables: { xr, yr, results,
 * categories, z }. `frozen` ({ x, y, z }) keeps ranges found once (at the
 * starting values) so the axes don't jump while a slider moves.
 */
function evaluatePlot(spec, vars, frozen = null) {
    const layers = spec.layers || [];
    const L = plotLayout(spec);
    const ext = { x: [Infinity, -Infinity], y: [Infinity, -Infinity] };
    const results = layers.map(() => ({}));
    const fail = (i, e) => { results[i] = { error: e instanceof LayerError || e instanceof FormulaError ? (e.line ? `line ${e.line}: ${e.message}` : e.message) : String(e.message || e) }; };
    layers.forEach((layer, i) => {
        if (layer.hidden === 'yes') { results[i] = { hidden: true }; return; }
        try {
            results[i] = evalFirst(layer, vars, ext, spec) || {};
        } catch (e) { fail(i, e); }
    });
    // a categorical axis: the bars' keys
    let categories = null;
    layers.forEach((layer, i) => {
        const r = results[i];
        if (layer.kind === 'bar' && r.categorical && !categories) categories = r.keys;
    });
    if (categories) { grow(ext, 'x', -0.5); grow(ext, 'x', categories.length - 0.5); }
    layers.forEach((layer, i) => {
        if (layer.kind === 'hist' && results[i].values) { grow(ext, 'x', results[i].lo); grow(ext, 'x', results[i].hi); }
    });
    const xlog = spec.xscale === 'log';
    const ylog = spec.yscale === 'log';
    let xr = axisRange(spec.xmin, spec.xmax, frozen && frozen.x, ext.x, xlog, xlog ? [0.1, 10] : [-5, 5]);
    const xBelowZero = xlog && !(xr[0] > 0);
    if (xBelowZero) xr = xr[1] > 0 ? [xr[1] / 1000, xr[1]] : [0.1, 10];
    layers.forEach((layer, i) => {
        if (results[i].error || results[i].hidden || GRID_KINDS.has(layer.kind)) return;
        try {
            results[i] = evalSecond(layer, results[i], vars, ext, xr, spec, frozen) || results[i];
        } catch (e) { fail(i, e); }
    });
    let yr = axisRange(spec.ymin, spec.ymax, frozen && frozen.y, ext.y, ylog, ylog ? [0.1, 10] : [-1, 1]);
    // a log axis over 0 or negatives: from a thousandth of its end (or 0.1 to 10)
    const positive = (r) => (r[0] > 0 ? r : r[1] > 0 ? [r[1] / 1000, r[1]] : [0.1, 10]);
    const notes = [];
    if (xBelowZero) notes.push('log x axis: values above 0 only');
    if (ylog && !(yr[0] > 0)) notes.push('log y axis: values above 0 only');
    if (ylog) yr = positive(yr);
    // bars and histograms stand on 0
    const fromZero = layers.some((l, i) => (l.kind === 'bar' || l.kind === 'hist') && !results[i].error);
    if (fromZero && !frozen && !isSet(spec.ymin) && !ylog && ext.y[0] >= 0) yr = [0, yr[1]];
    if (spec.aspect === 'equal' && !xlog && !ylog) {
        const ux = (xr[1] - xr[0]) / L.w;
        const uy = (yr[1] - yr[0]) / L.h;
        if (ux > uy) { const c = (yr[0] + yr[1]) / 2; const half = ux * L.h / 2; yr = [c - half, c + half]; }
        else { const c = (xr[0] + xr[1]) / 2; const half = uy * L.w / 2; xr = [c - half, c + half]; }
    }
    const z = {};
    layers.forEach((layer, i) => {
        if (!GRID_KINDS.has(layer.kind) || results[i].hidden) return;
        try {
            const r = evalGrid(layer, vars, xr, yr, L);
            results[i] = r;
            if (layer.kind !== 'quiver') {
                const zr = [isSet(layer.zmin) ? Number(layer.zmin) : (frozen && frozen.z && frozen.z[i] ? frozen.z[i][0] : r.lo),
                    isSet(layer.zmax) ? Number(layer.zmax) : (frozen && frozen.z && frozen.z[i] ? frozen.z[i][1] : r.hi)];
                if (!(zr[1] > zr[0])) zr[1] = zr[0] + 1;
                r.zr = zr;
                z[i] = zr;
            }
        } catch (e) { fail(i, e); }
    });
    return { xr, yr, results, categories, z, L, notes };
}

/** Each layer's error for these variables ('' when it draws): what the layer cards show. */
export function plotErrors(spec, vars, frozen = null) {
    return evaluatePlot(expandPlot(spec, vars), vars || {}, frozen).results.map(r => (r && r.error) || '');
}

// ---------- plots written as scripts (lang:matplotlib, core/mplEngine.js) ----------

const SCRIPT_LANGUAGES = {};

/** A language whose plots are a script: `run(code, vars)` -> { layers, settings }. */
export function registerScriptLanguage(name, run) {
    SCRIPT_LANGUAGES[name] = run;
}

export function isScriptLanguage(name) {
    return Boolean(SCRIPT_LANGUAGES[name]);
}

/** A plot written as a script, as layers and settings for these values (its error in scriptError). */
export function expandPlot(spec, vars) {
    if (!spec || spec.script === undefined || !SCRIPT_LANGUAGES[spec.lang]) return spec;
    try {
        const { layers, settings } = SCRIPT_LANGUAGES[spec.lang](spec.script, vars || {});
        const set = Object.fromEntries(Object.entries(settings || {}).filter(([, v]) => v !== undefined && v !== null));
        return { ...spec, ...set, layers };
    } catch (e) {
        return { ...spec, layers: [], scriptError: e.line ? `line ${e.line}: ${e.message}` : e.message };
    }
}

/** Ranges found at these values, to keep while sliders move: { x, y, z }. */
export function autoRanges(spec, vars) {
    const r = evaluatePlot(expandPlot(spec, vars), vars, null);
    return { x: r.xr, y: r.yr, z: r.z };
}

// ---------- drawing ----------

function niceStep(range, count) {
    const raw = range / Math.max(1, count);
    const p = Math.pow(10, Math.floor(Math.log10(raw)));
    const f = raw / p;
    return (f < 1.5 ? 1 : f < 3 ? 2 : f < 7 ? 5 : 10) * p;
}

const SUPERSCRIPT = { '-': '⁻', 0: '⁰', 1: '¹', 2: '²', 3: '³', 4: '⁴', 5: '⁵', 6: '⁶', 7: '⁷', 8: '⁸', 9: '⁹' };

function piLabel(v) {
    const r = v / Math.PI;
    for (const d of [1, 2, 3, 4, 6]) {
        const n = Math.round(r * d);
        if (Math.abs(r * d - n) < 1e-6) {
            if (n === 0) return '0';
            const sign = n < 0 ? '−' : '';
            const a = Math.abs(n);
            return d === 1 ? `${sign}${a === 1 ? '' : a}π` : `${sign}${a === 1 ? '' : a}π/${d}`;
        }
    }
    return v.toFixed(2).replace(/^-/, '−');
}

/** Ticks of an axis: [{ v, text }]. */
function axisTicks(range, count, kind) {
    const [min, max] = range;
    if (!(max > min)) return [];
    if (kind === 'log') {
        const out = [];
        for (let k = Math.ceil(Math.log10(min) - 1e-9); k <= Math.floor(Math.log10(max) + 1e-9); k++) {
            out.push({ v: Math.pow(10, k), text: k >= 0 && k <= 3 ? String(Math.pow(10, k)) : `10${String(k).split('').map(c => SUPERSCRIPT[c]).join('')}` });
        }
        if (out.length >= 2) return out;
    }
    if (kind === 'pi') {
        const step = Math.PI * niceStep((max - min) / Math.PI, count);
        const candidates = [0.25, 0.5, 1, 2, 5, 10].map(k => k * Math.PI).filter(s => s >= step * 0.7);
        const s = candidates[0] || step;
        const out = [];
        for (let v = Math.ceil(min / s - 1e-9) * s; v <= max + s * 1e-9; v += s) out.push({ v, text: piLabel(v) });
        return out;
    }
    const step = niceStep(max - min, count);
    const digits = Math.max(0, -Math.floor(Math.log10(step) + 1e-9));
    const out = [];
    for (let v = Math.ceil(min / step - 1e-9) * step; v <= max + step * 1e-9; v += step) {
        const val = Math.abs(v) < step * 1e-9 ? 0 : v;
        const a = Math.abs(val);
        const text = a !== 0 && (a >= 1e5 || a < 1e-3) ? val.toExponential(1) : val.toFixed(digits);
        out.push({ v: val, text: text.replace(/^-/, '−') });
    }
    return out;
}

const COLORMAPS = {
    viridis: ['#440154', '#482878', '#3e4989', '#31688e', '#26828e', '#1f9e89', '#35b779', '#6ece58', '#b5de2b', '#fde725'],
    magma: ['#000004', '#1c1044', '#4f127b', '#812581', '#b5367a', '#e55964', '#fb8761', '#fec287', '#fcfdbf'],
    coolwarm: ['#3b4cc0', '#6889ee', '#9abbff', '#c9d7f0', '#edd1c2', '#f7a889', '#e26952', '#b40426'],
    blues: ['#f7fbff', '#c6dbef', '#6baed6', '#2171b5', '#08306b'],
    gray: ['#000000', '#ffffff'],
};
export const COLORMAP_NAMES = Object.keys(COLORMAPS);

function hexRgb(h) {
    return [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16));
}

/** [r, g, b] of colour map `name` at t in 0..1. */
function colormap(name, t) {
    const stops = COLORMAPS[name] || COLORMAPS.viridis;
    const x = Math.min(1, Math.max(0, Number.isFinite(t) ? t : 0)) * (stops.length - 1);
    const i = Math.min(stops.length - 2, Math.floor(x));
    const a = hexRgb(stops[i]);
    const b = hexRgb(stops[i + 1]);
    const f = x - i;
    return a.map((c, k) => Math.round(c + (b[k] - c) * f));
}

/** A heatmap's colours as a PNG (needs a page: none in a plain script). */
function heatmapImage(r, cmap) {
    if (typeof document === 'undefined') return '';
    const canvas = document.createElement('canvas');
    canvas.width = r.cols;
    canvas.height = r.rows;
    const g = canvas.getContext('2d');
    if (!g) return '';
    const img = g.createImageData(r.cols, r.rows);
    for (let j = 0; j < r.rows; j++) {
        for (let i = 0; i < r.cols; i++) {
            const v = r.z[j * r.cols + i];
            const at = ((r.rows - 1 - j) * r.cols + i) * 4; // y goes up
            if (!Number.isFinite(v)) { img.data[at + 3] = 0; continue; }
            const [cr, cg, cb] = colormap(cmap, (v - r.zr[0]) / (r.zr[1] - r.zr[0]));
            img.data[at] = cr; img.data[at + 1] = cg; img.data[at + 2] = cb; img.data[at + 3] = 255;
        }
    }
    g.putImageData(img, 0, 0);
    return canvas.toDataURL('image/png');
}

// marching squares: corner bits (v0 bottom-left, v1 bottom-right, v2 top-right, v3 top-left) -> edge pairs
const MS = [[], [[3, 0]], [[0, 1]], [[3, 1]], [[1, 2]], [[3, 0], [1, 2]], [[0, 2]], [[3, 2]], [[2, 3]], [[0, 2]], [[0, 1], [2, 3]], [[1, 2]], [[1, 3]], [[0, 1]], [[3, 0]], []];

/** Level lines of a grid at `levels`: [[level, [[x1, y1, x2, y2], ...]], ...] in data units. */
function contourSegments(r, xr, yr, levels) {
    const dx = (xr[1] - xr[0]) / r.nx;
    const dy = (yr[1] - yr[0]) / r.ny;
    const at = (i, j) => r.z[j * r.cols + i];
    return levels.map(L => {
        const segs = [];
        for (let j = 0; j < r.ny; j++) {
            for (let i = 0; i < r.nx; i++) {
                const v = [at(i, j), at(i + 1, j), at(i + 1, j + 1), at(i, j + 1)];
                if (v.some(c => !Number.isFinite(c))) continue;
                const idx = (v[0] > L ? 1 : 0) | (v[1] > L ? 2 : 0) | (v[2] > L ? 4 : 0) | (v[3] > L ? 8 : 0);
                if (!MS[idx].length) continue;
                const x0 = xr[0] + i * dx;
                const y0 = yr[0] + j * dy;
                const corner = [[x0, y0], [x0 + dx, y0], [x0 + dx, y0 + dy], [x0, y0 + dy]];
                const edge = (e) => {
                    const a = e;
                    const b = (e + 1) % 4;
                    const t = (L - v[a]) / ((v[b] - v[a]) || 1e-12);
                    return [corner[a][0] + (corner[b][0] - corner[a][0]) * t, corner[a][1] + (corner[b][1] - corner[a][1]) * t];
                };
                MS[idx].forEach(([e1, e2]) => { const p = edge(e1); const q = edge(e2); segs.push([p[0], p[1], q[0], q[1]]); });
            }
        }
        return [L, segs];
    });
}

/** Pieces of level lines chained into lines: [[x, y], ...] each (continuous strokes, smaller files). */
function chainSegments(segs) {
    const key = (x, y) => `${Math.round(x * 1e6)},${Math.round(y * 1e6)}`;
    const ends = new Map();
    segs.forEach((s, i) => {
        [key(s[0], s[1]), key(s[2], s[3])].forEach(k => { if (!ends.has(k)) ends.set(k, []); ends.get(k).push(i); });
    });
    const used = new Uint8Array(segs.length);
    const lines = [];
    const extend = (line, atEnd) => {
        for (;;) {
            const [x, y] = atEnd ? line[line.length - 1] : line[0];
            const next = (ends.get(key(x, y)) || []).find(i => !used[i]);
            if (next === undefined) return;
            used[next] = 1;
            const s = segs[next];
            const p = key(s[0], s[1]) === key(x, y) ? [s[2], s[3]] : [s[0], s[1]];
            if (atEnd) line.push(p); else line.unshift(p);
        }
    };
    segs.forEach((s, i) => {
        if (used[i]) return;
        used[i] = 1;
        const line = [[s[0], s[1]], [s[2], s[3]]];
        extend(line, true);
        extend(line, false);
        lines.push(line);
    });
    return lines;
}

const DASH = { dashed: (w) => `${w * 3} ${w * 2}`, dotted: (w) => `${w} ${w * 1.6}` };

/**
 * The plot as SVG for these variables. spec: { width, height, xmin, xmax,
 * ymin, ymax (empty: from the layers), xscale, yscale (log), xticks, yticks
 * (pi), aspect (equal), grid, fontSize, fontFamily, color, samples,
 * layers: [{ kind, code, lang, color, width, dash, opacity, …, table }],
 * auto: { x, y, z } (ranges found once, kept while sliders move) }.
 */
export function plotSvg(spec0, vars) {
    const spec = expandPlot(spec0, vars);
    const W = num(spec.width, 800);
    const H = num(spec.height, 500);
    const ev = evaluatePlot(spec, vars || {}, spec.auto || null);
    const { xr, yr, results, categories, L } = ev;
    const xlog = spec.xscale === 'log';
    const ylog = spec.yscale === 'log';
    const tx = (v) => (xlog ? Math.log10(v) : v);
    const ty = (v) => (ylog ? Math.log10(v) : v);
    const X = (x) => L.left + (tx(x) - tx(xr[0])) / (tx(xr[1]) - tx(xr[0])) * L.w;
    const Y = (y) => L.top + (1 - (ty(y) - ty(yr[0])) / (ty(yr[1]) - ty(yr[0]))) * L.h;
    const ok = (x, y) => Number.isFinite(x) && Number.isFinite(y) && (!xlog || x > 0) && (!ylog || y > 0);
    const colour = spec.color || '#0f172a';
    const font = esc(spec.fontFamily || 'sans-serif');
    const fs = L.fs * 0.8;
    const layers = spec.layers || [];
    const colourOf = (layer, i) => layer.color || PALETTE[i % PALETTE.length];
    const parts = [];
    const clip = `glc${Math.random().toString(36).slice(2, 9)}`;
    parts.push(`<defs><clipPath id="${clip}"><rect x="${L.left}" y="${L.top}" width="${L.w}" height="${L.h}"/></clipPath></defs>`);
    const xt = categories ? categories.map((c, i) => ({ v: i, text: c })) : axisTicks(xr, Math.max(2, Math.round(L.w / (L.fs * 5))), xlog ? 'log' : spec.xticks === 'pi' ? 'pi' : '');
    const yt = axisTicks(yr, Math.max(2, Math.round(L.h / (L.fs * 3))), ylog ? 'log' : spec.yticks === 'pi' ? 'pi' : '');
    if (spec.grid !== 'no' && spec.axes !== 'none') {
        const g = [];
        xt.forEach(t => { if (t.v >= xr[0] && t.v <= xr[1]) g.push(`M${X(t.v).toFixed(1)} ${L.top}V${L.top + L.h}`); });
        yt.forEach(t => g.push(`M${L.left} ${Y(t.v).toFixed(1)}H${L.left + L.w}`));
        parts.push(`<path d="${g.join('')}" stroke="${esc(colour)}" stroke-opacity="0.12" stroke-width="1" fill="none"/>`);
    }
    const body = [];        // drawn inside the clip
    const over = [];        // markers' labels: outside the clip
    const errors = [];
    const order = ['heatmap', 'fill', 'hist', 'bar', 'contour', 'curve', 'parametric', 'line', 'quiver', 'points', 'vline', 'hline', 'point', 'text'];
    const indices = layers.map((_, i) => i).sort((a, b) => order.indexOf(layers[a].kind) - order.indexOf(layers[b].kind));
    const polyline = (pts) => {
        let d = '';
        let pen = false;
        const far = (yr[1] - yr[0]) * 50;
        pts.forEach(([x, y]) => {
            if (!ok(x, y) || (!ylog && (y > yr[1] + far || y < yr[0] - far))) { pen = false; return; }
            d += `${pen ? 'L' : 'M'}${X(x).toFixed(1)} ${Y(y).toFixed(1)}`;
            pen = true;
        });
        return d;
    };
    const stroke = (layer, c, defaultWidth = 3) => {
        const w = num(layer.width, defaultWidth);
        const dash = DASH[layer.dash] ? ` stroke-dasharray="${DASH[layer.dash](w)}"` : '';
        return `fill="none" stroke="${esc(c)}" stroke-width="${w}" stroke-linejoin="round" stroke-linecap="round"${dash}`;
    };
    indices.forEach(i => {
        const layer = layers[i];
        const r = results[i] || {};
        const c = colourOf(layer, i);
        if (r.hidden) return;
        if (r.error) { errors.push(`${layers.length > 1 ? `${layer.kind} ${i + 1}: ` : ''}${r.error}`); return; }
        switch (layer.kind) {
            case 'curve':
            case 'parametric':
                body.push(`<path d="${polyline(r.pts || [])}" ${stroke(layer, c)}/>`);
                break;
            case 'fill': {
                const top = (r.pts || []).filter(([x, y]) => ok(x, y));
                const bottom = (r.bottom || []).filter(([x, y]) => ok(x, y)).reverse();
                if (top.length > 1) {
                    const d = [...top, ...bottom].map(([x, y], k) => `${k ? 'L' : 'M'}${X(x).toFixed(1)} ${Y(Math.max(Math.min(y, yr[1] + (yr[1] - yr[0])), yr[0] - (yr[1] - yr[0]))).toFixed(1)}`).join('') + 'Z';
                    body.push(`<path d="${d}" fill="${esc(c)}" fill-opacity="${num(layer.opacity, 0.3)}" stroke="none"/>`);
                }
                break;
            }
            case 'hist': {
                const rects = (r.heights || []).map((h, k) => {
                    const x0 = X(r.from + k * r.width);
                    const x1 = X(r.from + (k + 1) * r.width);
                    const y0 = Y(ylog ? Math.max(yr[0], 1e-12) : 0);
                    const y1 = Y(ylog ? Math.max(h, 1e-12) : h);
                    return h > 0 ? `<rect x="${Math.min(x0, x1).toFixed(1)}" y="${Math.min(y0, y1).toFixed(1)}" width="${Math.abs(x1 - x0).toFixed(1)}" height="${Math.abs(y0 - y1).toFixed(1)}"/>` : '';
                }).join('');
                body.push(`<g fill="${esc(c)}" fill-opacity="${num(layer.opacity, 0.55)}" stroke="${esc(c)}" stroke-opacity="0.9" stroke-width="1">${rects}</g>`);
                break;
            }
            case 'bar': {
                const width = num(layer.barwidth, 0.8);
                const offset = num(layer.offset, 0);
                const rects = (r.ys || []).map((y, k) => {
                    const at = r.categorical ? (categories ? categories.indexOf(r.keys[k]) : k) : Number(r.keys[k]);
                    if (!Number.isFinite(at) || at < 0 || !Number.isFinite(y)) return '';
                    const x0 = X(at + offset - width / 2);
                    const x1 = X(at + offset + width / 2);
                    const y0 = Y(0);
                    const y1 = Y(y);
                    return `<rect x="${Math.min(x0, x1).toFixed(1)}" y="${Math.min(y0, y1).toFixed(1)}" width="${Math.abs(x1 - x0).toFixed(1)}" height="${Math.abs(y0 - y1).toFixed(1)}"/>`;
                }).join('');
                body.push(`<g fill="${esc(c)}" fill-opacity="${num(layer.opacity, 0.85)}">${rects}</g>`);
                break;
            }
            case 'line':
                body.push(`<path d="${polyline((r.xs || []).map((x, k) => [x, r.ys[k]]))}" ${stroke(layer, c, 2.5)}/>`);
                if (layer.markers === 'yes') body.push(`<g fill="${esc(c)}">${(r.xs || []).map((x, k) => (ok(x, r.ys[k]) ? `<circle cx="${X(x).toFixed(1)}" cy="${Y(r.ys[k]).toFixed(1)}" r="${num(layer.size, 4)}"/>` : '')).join('')}</g>`);
                break;
            case 'points': {
                const size = num(layer.size, 5);
                const bars = r.err ? (r.xs || []).map((x, k) => {
                    const e = r.err[k];
                    if (!ok(x, r.ys[k]) || !Number.isFinite(e)) return '';
                    return `M${X(x).toFixed(1)} ${Y(r.ys[k] - e).toFixed(1)}V${Y(r.ys[k] + e).toFixed(1)}M${(X(x) - size).toFixed(1)} ${Y(r.ys[k] - e).toFixed(1)}h${size * 2}M${(X(x) - size).toFixed(1)} ${Y(r.ys[k] + e).toFixed(1)}h${size * 2}`;
                }).join('') : '';
                if (bars) body.push(`<path d="${bars}" stroke="${esc(c)}" stroke-width="1.5" fill="none"/>`);
                body.push(`<g fill="${esc(c)}">${(r.xs || []).map((x, k) => (ok(x, r.ys[k]) ? `<circle cx="${X(x).toFixed(1)}" cy="${Y(r.ys[k]).toFixed(1)}" r="${size}"/>` : '')).join('')}</g>`);
                break;
            }
            case 'heatmap': {
                const href = heatmapImage(r, layer.colormap);
                const [ix0, ix1, iy0, iy1] = r.extent || [xr[0], xr[1], yr[0], yr[1]];
                const px0 = X(ix0);
                const px1 = X(ix1);
                const py0 = Y(iy1);
                const py1 = Y(iy0);
                if (href) body.push(`<image href="${href}" x="${Math.min(px0, px1).toFixed(1)}" y="${Math.min(py0, py1).toFixed(1)}" width="${Math.abs(px1 - px0).toFixed(1)}" height="${Math.abs(py1 - py0).toFixed(1)}" preserveAspectRatio="none" opacity="${num(layer.opacity, 1)}"/>`);
                if (layer.colorbar !== 'no' && L.bar) {
                    const bx = L.left + L.w + L.fs * 0.9;
                    const bw = L.fs * 0.8;
                    const gid = `${clip}g${i}`;
                    const stops = Array.from({ length: 11 }, (_, k) => `<stop offset="${k / 10}" stop-color="rgb(${colormap(layer.colormap, 1 - k / 10).join(',')})"/>`).join('');
                    parts.push(`<defs><linearGradient id="${gid}" x1="0" y1="0" x2="0" y2="1">${stops}</linearGradient></defs>`);
                    over.push(`<rect x="${bx}" y="${L.top}" width="${bw}" height="${L.h}" fill="url(#${gid})" stroke="${esc(colour)}" stroke-opacity="0.4"/>`);
                    axisTicks(r.zr, 5, '').forEach(t => {
                        if (t.v < r.zr[0] || t.v > r.zr[1]) return;
                        const yy = L.top + (1 - (t.v - r.zr[0]) / (r.zr[1] - r.zr[0])) * L.h;
                        over.push(`<text x="${bx + bw + fs * 0.4}" y="${(yy + fs * 0.35).toFixed(1)}" font-size="${fs.toFixed(1)}" font-family="${font}" fill="${esc(colour)}">${t.text}</text>`);
                    });
                }
                break;
            }
            case 'contour': {
                // at:"0.5, 1, 2": those values; levels:N: N levels across the range
                const levels = layer.at !== undefined && layer.at !== '' ? String(layer.at).split(/[,;\s]+/).map(v => paramValue({ v, lang: layer.lang }, 'v', vars, NaN)).filter(Number.isFinite)
                    : (() => { const n = Math.max(1, Math.round(Number(layer.levels) || 10)); return Array.from({ length: n }, (_, k) => r.zr[0] + (r.zr[1] - r.zr[0]) * (k + 0.5) / n); })();
                contourSegments(r, r.extent ? [r.extent[0], r.extent[1]] : xr, r.extent ? [r.extent[2], r.extent[3]] : yr, levels).forEach(([level, segs]) => {
                    if (!segs.length) return;
                    const lc = layer.colormap ? `rgb(${colormap(layer.colormap, (level - r.zr[0]) / (r.zr[1] - r.zr[0])).join(',')})` : c;
                    const d = chainSegments(segs).map(line => line.map(([x, y], k) => `${k ? 'L' : 'M'}${X(x).toFixed(1)} ${Y(y).toFixed(1)}`).join('')).join('');
                    body.push(`<path d="${d}" ${stroke(layer, lc, 2)}/>`);
                });
                break;
            }
            case 'quiver': {
                const cell = Math.min(L.w / r.nx, L.h / r.ny);
                const px = (a) => [a[2] * L.w / (xr[1] - xr[0]), -a[3] * L.h / (yr[1] - yr[0])];
                let longest = 0;
                r.arrows.forEach(a => { const [u, v] = px(a); const m = Math.hypot(u, v); if (Number.isFinite(m) && m > longest) longest = m; });
                const k = isSet(layer.scale) ? Number(layer.scale) : (longest ? cell * 0.85 / longest : 0);
                const d = r.arrows.map(a => {
                    const [u, v] = px(a).map(q => q * k);
                    const m = Math.hypot(u, v);
                    if (!Number.isFinite(m) || m < 0.5) return '';
                    const x1 = X(a[0]) - u / 2;
                    const y1 = Y(a[1]) - v / 2;
                    const x2 = x1 + u;
                    const y2 = y1 + v;
                    const hl = Math.min(m * 0.35, cell * 0.3);
                    const ang = Math.atan2(v, u);
                    const h1 = [x2 - hl * Math.cos(ang - 0.45), y2 - hl * Math.sin(ang - 0.45)];
                    const h2 = [x2 - hl * Math.cos(ang + 0.45), y2 - hl * Math.sin(ang + 0.45)];
                    return `M${x1.toFixed(1)} ${y1.toFixed(1)}L${x2.toFixed(1)} ${y2.toFixed(1)}M${h1[0].toFixed(1)} ${h1[1].toFixed(1)}L${x2.toFixed(1)} ${y2.toFixed(1)}L${h2[0].toFixed(1)} ${h2[1].toFixed(1)}`;
                }).join('');
                body.push(`<path d="${d}" ${stroke(layer, c, 2)}/>`);
                break;
            }
            case 'vline':
                if (ok(r.x, yr[0]) && r.x >= xr[0] && r.x <= xr[1]) {
                    body.push(`<path d="M${X(r.x).toFixed(1)} ${L.top}V${L.top + L.h}" ${stroke({ dash: 'dashed', ...layer }, c, 2)}/>`);
                    if (layer.label) over.push(`<text x="${(X(r.x) + fs * 0.3).toFixed(1)}" y="${(L.top + fs * 1.1).toFixed(1)}" font-size="${fs.toFixed(1)}" font-family="${font}" fill="${esc(c)}">${esc(layer.label)}</text>`);
                }
                break;
            case 'hline':
                if (ok(xr[0], r.y) && r.y >= yr[0] && r.y <= yr[1]) {
                    body.push(`<path d="M${L.left} ${Y(r.y).toFixed(1)}H${L.left + L.w}" ${stroke({ dash: 'dashed', ...layer }, c, 2)}/>`);
                    if (layer.label) over.push(`<text x="${(L.left + L.w - fs * 0.3).toFixed(1)}" y="${(Y(r.y) - fs * 0.4).toFixed(1)}" text-anchor="end" font-size="${fs.toFixed(1)}" font-family="${font}" fill="${esc(c)}">${esc(layer.label)}</text>`);
                }
                break;
            case 'point':
                if (ok(r.x, r.y)) {
                    body.push(`<circle cx="${X(r.x).toFixed(1)}" cy="${Y(r.y).toFixed(1)}" r="${num(layer.size, 7)}" fill="${esc(c)}"/>`);
                    if (layer.label) over.push(`<text x="${(X(r.x) + fs * 0.6).toFixed(1)}" y="${(Y(r.y) - fs * 0.5).toFixed(1)}" font-size="${fs.toFixed(1)}" font-family="${font}" fill="${esc(c)}">${esc(layer.label)}</text>`);
                }
                break;
            case 'text':
                if (ok(r.x, r.y)) over.push(`<text x="${X(r.x).toFixed(1)}" y="${Y(r.y).toFixed(1)}" text-anchor="${{ left: 'start', center: 'middle', right: 'end' }[layer.align] || 'start'}" font-size="${(num(layer.size, fs)).toFixed(1)}" font-family="${font}" fill="${esc(layer.color || colour)}">${esc(layer.label || layer.code || '')}</text>`);
                break;
            default:
                errors.push(`unknown layer: .${layer.kind}`);
        }
    });
    parts.push(`<g clip-path="url(#${clip})">${body.join('')}</g>`);
    // axes (zero lines when inside), ticks
    const labels = [];
    if (spec.axes === 'zero') {
        // through the origin (or the nearest edge), with arrows; numbers next to them
        const ax = categories || xlog ? yr[0] : Math.min(Math.max(0, yr[0]), yr[1]);
        const ay = xlog ? xr[0] : Math.min(Math.max(0, xr[0]), xr[1]);
        const Y0 = Y(ylog ? yr[0] : ax);
        const X0 = X(xlog ? xr[0] : ay);
        const a = L.fs * 0.35;
        parts.push(`<path d="M${L.left} ${Y0.toFixed(1)}H${L.left + L.w}M${(L.left + L.w - a).toFixed(1)} ${(Y0 - a / 2).toFixed(1)}L${L.left + L.w} ${Y0.toFixed(1)}L${(L.left + L.w - a).toFixed(1)} ${(Y0 + a / 2).toFixed(1)}M${X0.toFixed(1)} ${L.top + L.h}V${L.top}M${(X0 - a / 2).toFixed(1)} ${(L.top + a).toFixed(1)}L${X0.toFixed(1)} ${L.top}L${(X0 + a / 2).toFixed(1)} ${(L.top + a).toFixed(1)}" stroke="${esc(colour)}" stroke-opacity="0.8" stroke-width="1.5" fill="none"/>`);
        const tick = L.fs * 0.2;
        xt.forEach(t => {
            if (t.v <= xr[0] || t.v >= xr[1] || (!xlog && Math.abs(t.v - ay) < 1e-12)) return;
            labels.push(`<text x="${X(t.v).toFixed(1)}" y="${(Y0 + fs * 1.3).toFixed(1)}" text-anchor="middle">${esc(t.text)}</text>`);
            parts.push(`<path d="M${X(t.v).toFixed(1)} ${(Y0 - tick).toFixed(1)}V${(Y0 + tick).toFixed(1)}" stroke="${esc(colour)}" stroke-opacity="0.8"/>`);
        });
        yt.forEach(t => {
            if (t.v <= yr[0] || t.v >= yr[1] || (!ylog && Math.abs(t.v - ax) < 1e-12)) return;
            labels.push(`<text x="${(X0 - fs * 0.4).toFixed(1)}" y="${(Y(t.v) + fs * 0.35).toFixed(1)}" text-anchor="end">${esc(t.text)}</text>`);
            parts.push(`<path d="M${(X0 - tick).toFixed(1)} ${Y(t.v).toFixed(1)}H${(X0 + tick).toFixed(1)}" stroke="${esc(colour)}" stroke-opacity="0.8"/>`);
        });
    } else if (spec.axes !== 'none') {
        parts.push(`<path d="M${L.left} ${L.top}V${L.top + L.h}H${L.left + L.w}" stroke="${esc(colour)}" stroke-opacity="0.7" stroke-width="1.5" fill="none"/>`);
        if (!ylog && yr[0] < 0 && yr[1] > 0) parts.push(`<path d="M${L.left} ${Y(0).toFixed(1)}H${L.left + L.w}" stroke="${esc(colour)}" stroke-opacity="0.35" stroke-width="1" fill="none"/>`);
        if (!xlog && !categories && xr[0] < 0 && xr[1] > 0) parts.push(`<path d="M${X(0).toFixed(1)} ${L.top}V${L.top + L.h}" stroke="${esc(colour)}" stroke-opacity="0.35" stroke-width="1" fill="none"/>`);
        xt.forEach(t => { if (t.v >= xr[0] - 1e-9 && t.v <= xr[1] + 1e-9) labels.push(`<text x="${X(t.v).toFixed(1)}" y="${(L.top + L.h + fs * 1.4).toFixed(1)}" text-anchor="middle">${esc(t.text)}</text>`); });
        yt.forEach(t => labels.push(`<text x="${(L.left - fs * 0.5).toFixed(1)}" y="${(Y(t.v) + fs * 0.35).toFixed(1)}" text-anchor="end">${esc(t.text)}</text>`));
    }
    parts.push(`<g fill="${esc(colour)}" font-size="${fs.toFixed(1)}" font-family="${font}">${labels.join('')}</g>`);
    parts.push(over.join(''));
    if (spec.scriptError) errors.unshift(spec.scriptError);
    if (ev.notes && ev.notes.length) {
        parts.push(`<g class="gl-plot-notes" font-size="${(fs * 0.85).toFixed(1)}" font-family="${font}" fill="${esc(colour)}" fill-opacity="0.6">${ev.notes.map((n, k) => `<text x="${L.left + L.w - fs * 0.5}" y="${L.top + L.h - fs * (0.6 + k * 1.2)}" text-anchor="end">${esc(n)}</text>`).join('')}</g>`);
    }
    if (errors.length) {
        parts.push(`<g font-size="${fs.toFixed(1)}" font-family="${font}" fill="#dc2626">${errors.slice(0, 4).map((e, k) => `<text x="${L.left + fs}" y="${L.top + fs * (1.5 + k * 1.3)}">${esc(e)}</text>`).join('')}</g>`);
    }
    return `<svg class="gl-plot-svg" xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" style="position:absolute;left:0;top:0;overflow:visible">${parts.join('')}</svg>`;
}

/** How a layer shows in a legend: 'line', 'area' or 'dot'. */
export function legendStyle(kind) {
    if (LINE_KINDS.has(kind)) return 'line';
    if (kind === 'points' || kind === 'point') return 'dot';
    return 'area';
}

// ---------- live values in a page ----------

/** Objects whose settings are formulas (data-glbind, core/bindings.js): moved, sized, turned, shown for these values. */
function liveBindings(root, vars) {
    root.querySelectorAll('[data-glbind]').forEach(node => {
        let formulas;
        try { formulas = JSON.parse(node.getAttribute('data-glbind')); } catch (e) { return; }
        Object.entries(formulas).forEach(([key, code]) => {
            const f = compileFormula(String(code), 'python');
            if (f.error || f.names.some(n => !(n in vars))) return;
            let v;
            try { v = f.exec(Object.assign(Object.create(null), vars)); } catch (e) { return; }
            v = typeof v === 'boolean' ? (v ? 1 : 0) : Number(v);
            if (!Number.isFinite(v)) return;
            const px = `${Math.round(v * 1000) / 1000}px`;
            switch (key) {
                case 'x': node.style.left = px; break;
                case 'y': node.style.top = px; break;
                case 'width': node.style.width = px; break;
                case 'height': node.style.height = px; break;
                case 'rotate': node.style.transform = v ? `rotate(${v}deg)` : ''; break;
                case 'opacity': node.style.opacity = String(Math.max(0, Math.min(1, v))); break;
                case 'visible': node.classList.toggle('gl-off', !v); break;
                case 'fontSize': node.style.fontSize = px; break;
                case 'borderWidth': node.style.borderWidth = px; break;
                default: break; // other settings: their starting value (they need the whole object redrawn)
            }
        });
    });
}

/** Shows the variables' current values in `root` and redraws its plots. */
export function liveUpdate(root, vars) {
    if (!root) return;
    liveBindings(root, vars);
    root.querySelectorAll('[data-glvar]').forEach(node => {
        if (node.tagName === 'INPUT') return;
        const name = node.getAttribute('data-glvar');
        if (!(name in vars)) return;
        const text = formatValue(vars[name], node.getAttribute('data-glfmt') || '');
        if (node.classList.contains('gl-var')) node.textContent = text;
        else node.innerHTML = `<span class="mord">${esc(text)}</span>`; // inside KaTeX math
    });
    root.querySelectorAll('input[data-glslider]').forEach(input => {
        const name = input.getAttribute('data-glslider');
        if (name in vars && input !== document.activeElement && Number(input.value) !== Number(vars[name])) input.value = vars[name];
    });
    root.querySelectorAll('[data-gl-plot]').forEach(box => {
        let spec;
        try {
            spec = JSON.parse(box.getAttribute('data-gl-plot'));
        } catch (e) {
            return;
        }
        const old = box.querySelector('svg.gl-plot-svg');
        const holder = document.createElement('div');
        holder.innerHTML = plotSvg(spec, vars);
        if (old) old.replaceWith(holder.firstChild);
        else box.prepend(holder.firstChild);
    });
}

/**
 * Sliders in `root` (input[data-glslider]) set their variable; `onChange(name,
 * value)` after each move. One set of listeners on `root`, so sliders added
 * later (the presenter view's copies of a slide) work too. Clicks and keys
 * on a slider stay there (they don't change slide or start a drag).
 */
export function bindSliders(root, vars, onChange) {
    if (!root || root._glSliders) return;
    root._glSliders = true;
    const slider = (e) => (e.target && e.target.matches && e.target.matches('input[data-glslider]') ? e.target : null);
    ['pointerdown', 'mousedown', 'click', 'dblclick', 'keydown', 'wheel', 'touchstart'].forEach(t => root.addEventListener(t, (e) => {
        if (slider(e)) e.stopPropagation();
    }));
    root.addEventListener('input', (e) => {
        const input = slider(e);
        if (!input) return;
        const name = input.getAttribute('data-glslider');
        vars[name] = Number(input.value);
        onChange(name, vars[name]);
    });
    // A clicked slider keeps the arrow keys until Esc or Enter (or a click
    // elsewhere): they let go of it, without ending the slide show. (In
    // full screen the browser keeps Esc for leaving full screen: Enter then.)
    root.addEventListener('keydown', (e) => {
        const input = slider(e);
        if (input && (e.key === 'Escape' || e.key === 'Enter')) {
            e.preventDefault();
            input.blur();
        }
    });
}
