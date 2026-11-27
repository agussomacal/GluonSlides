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

const FUNCTIONS = {
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
const PY_MODULES = /^(?:math|np|numpy|scipy\.special|special|sp|cmath)\./;

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
        result = { error: e.line ? `line ${e.line}: ${e.message}` : e.message, names: [], evaluate: null };
    }
    if (formulaCache.size > 500) formulaCache.clear();
    formulaCache.set(key, result);
    return result;
}

// ---------- plots ----------

/**
 * The curves of a plot's text: ".curve key:value …" lines, each followed by
 * its formula lines (text before any .curve is a first curve).
 * -> [{ code, lang, color, width, dash, label, line }]
 */
export function parseCurves(text, lang = 'python') {
    const curves = [];
    let current = null;
    String(text || '').split('\n').forEach((raw, i) => {
        const m = raw.match(/^\s*\.curve\b(.*)$/);
        if (m) {
            current = { code: '', lang, line: i + 1 };
            for (const [, k, v] of m[1].matchAll(/([A-Za-z]+):("(?:[^"\\]|\\.)*"|\S+)/g)) {
                // inside quotes only \" and \\ are escapes (as in .gl): "$\mu$" keeps its backslash
                current[k] = v.startsWith('"') ? v.slice(1, -1).replace(/\\(["\\])/g, '$1') : v;
            }
            curves.push(current);
            return;
        }
        if (!current) {
            if (!raw.trim()) return;
            current = { code: '', lang, line: i + 1 };
            curves.push(current);
        }
        current.code += (current.code ? '\n' : '') + raw;
    });
    return curves.filter(c => c.code.trim());
}

const num = (v, d) => (v === '' || v === null || v === undefined || !Number.isFinite(Number(v)) ? d : Number(v));
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** Margins around a plot's drawing area (labels and ticks go there), in pixels. */
export function plotLayout(spec) {
    const fs = num(spec.fontSize, 24);
    const left = fs * 3.4 + (spec.ylabel ? fs * 1.6 : 0);
    const bottom = fs * 2 + (spec.xlabel ? fs * 1.6 : 0);
    const top = fs * 0.8;
    const right = fs * 1.2;
    const w = Math.max(10, num(spec.width, 800) - left - right);
    const h = Math.max(10, num(spec.height, 500) - top - bottom);
    return { left, top, right, bottom, w, h, fs };
}

function niceStep(range, count) {
    const raw = range / Math.max(1, count);
    const p = Math.pow(10, Math.floor(Math.log10(raw)));
    const f = raw / p;
    return (f < 1.5 ? 1 : f < 3 ? 2 : f < 7 ? 5 : 10) * p;
}

function ticks(min, max, count) {
    if (!(max > min)) return [];
    const step = niceStep(max - min, count);
    const out = [];
    for (let v = Math.ceil(min / step - 1e-9) * step; v <= max + step * 1e-9; v += step) out.push(Math.abs(v) < step * 1e-9 ? 0 : v);
    return { values: out, step };
}

function tickText(v, step) {
    const digits = Math.max(0, -Math.floor(Math.log10(step) + 1e-9));
    const a = Math.abs(v);
    if (a !== 0 && (a >= 1e5 || a < 1e-3)) return v.toExponential(1).replace(/^-/, '−');
    return v.toFixed(digits).replace(/^-/, '−');
}

/** Sampled curves of a plot: [{ points: [[x, y]...] | null, error }] for these variables. */
export function sampleCurves(spec, vars) {
    const xmin = num(spec.xmin, -5);
    const xmax = num(spec.xmax, 5);
    const n = Math.max(20, Math.min(4000, Math.round(num(spec.samples, 400))));
    return (spec.curves || []).map(c => {
        const f = compileFormula(c.code || '', c.lang || spec.lang || 'python');
        if (f.error) return { points: null, error: f.error };
        const missing = f.names.filter(name => !(name in vars) && !(name in CONSTANTS));
        if (missing.length) return { points: null, error: `unknown name${missing.length > 1 ? 's' : ''}: ${missing.join(', ')} (a slider sets one; or Project settings → Variables)` };
        let fx;
        try {
            fx = f.evaluate(vars);
        } catch (e) {
            return { points: null, error: e.message };
        }
        const points = [];
        try {
            for (let i = 0; i <= n; i++) {
                const x = xmin + (xmax - xmin) * i / n;
                points.push([x, fx(x)]);
            }
        } catch (e) {
            return { points: null, error: e.line ? `line ${e.line}: ${e.message}` : e.message };
        }
        return { points, error: null };
    });
}

/** The y range a plot shows: its own, else the curves' (with a margin). */
export function yRange(spec, sampled) {
    let ymin = num(spec.ymin, null);
    let ymax = num(spec.ymax, null);
    if (ymin !== null && ymax !== null && ymax > ymin) return [ymin, ymax];
    let lo = Infinity;
    let hi = -Infinity;
    sampled.forEach(s => (s.points || []).forEach(([, y]) => {
        if (Number.isFinite(y)) { lo = Math.min(lo, y); hi = Math.max(hi, y); }
    }));
    if (!Number.isFinite(lo)) { lo = -1; hi = 1; }
    if (hi - lo < 1e-12) { lo -= 1; hi += 1; }
    const pad = (hi - lo) * 0.06;
    return [ymin !== null ? ymin : lo - pad, ymax !== null ? ymax : hi + pad];
}

const DASH = { dashed: (w) => `${w * 3} ${w * 2}`, dotted: (w) => `${w} ${w * 1.6}` };

/**
 * The plot as SVG for these variables. spec: { width, height, xmin, xmax,
 * ymin, ymax (none: from the curves), grid, fontSize, fontFamily, color,
 * samples, lang, curves: [{ code, lang, color, width, dash }], yAuto }
 * (yAuto: the range found once, kept while sliders move).
 */
export function plotSvg(spec, vars) {
    const L = plotLayout(spec);
    const W = num(spec.width, 800);
    const H = num(spec.height, 500);
    const xmin = num(spec.xmin, -5);
    const xmax = num(spec.xmax, 5) > xmin ? num(spec.xmax, 5) : xmin + 1;
    const sampled = sampleCurves(spec, vars || {});
    const [ymin, ymax] = spec.yAuto && (num(spec.ymin, null) === null || num(spec.ymax, null) === null) ? spec.yAuto : yRange(spec, sampled);
    const X = (x) => L.left + (x - xmin) / (xmax - xmin) * L.w;
    const Y = (y) => L.top + (1 - (y - ymin) / (ymax - ymin)) * L.h;
    const colour = spec.color || '#0f172a';
    const font = esc(spec.fontFamily || 'sans-serif');
    const fs = L.fs * 0.8;
    const parts = [];
    const clip = `glc${Math.abs(Math.round(W * 7 + H * 13 + xmin * 31 + ymax * 17)) % 100000}${Math.random().toString(36).slice(2, 6)}`;
    parts.push(`<defs><clipPath id="${clip}"><rect x="${L.left}" y="${L.top}" width="${L.w}" height="${L.h}"/></clipPath></defs>`);
    const tx = ticks(xmin, xmax, Math.max(2, Math.round(L.w / (L.fs * 5))));
    const ty = ticks(ymin, ymax, Math.max(2, Math.round(L.h / (L.fs * 3))));
    if (spec.grid !== 'no') {
        const g = [];
        tx.values.forEach(v => g.push(`M${X(v).toFixed(1)} ${L.top}V${L.top + L.h}`));
        ty.values.forEach(v => g.push(`M${L.left} ${Y(v).toFixed(1)}H${L.left + L.w}`));
        parts.push(`<path d="${g.join('')}" stroke="${esc(colour)}" stroke-opacity="0.12" stroke-width="1" fill="none"/>`);
    }
    // the axes at zero when it is inside, else at the edge
    parts.push(`<path d="M${L.left} ${L.top}V${L.top + L.h}H${L.left + L.w}" stroke="${esc(colour)}" stroke-opacity="0.7" stroke-width="1.5" fill="none"/>`);
    if (ymin < 0 && ymax > 0) parts.push(`<path d="M${L.left} ${Y(0).toFixed(1)}H${L.left + L.w}" stroke="${esc(colour)}" stroke-opacity="0.35" stroke-width="1" fill="none"/>`);
    if (xmin < 0 && xmax > 0) parts.push(`<path d="M${X(0).toFixed(1)} ${L.top}V${L.top + L.h}" stroke="${esc(colour)}" stroke-opacity="0.35" stroke-width="1" fill="none"/>`);
    const labels = [];
    tx.values.forEach(v => labels.push(`<text x="${X(v).toFixed(1)}" y="${(L.top + L.h + fs * 1.4).toFixed(1)}" text-anchor="middle">${tickText(v, tx.step)}</text>`));
    ty.values.forEach(v => labels.push(`<text x="${(L.left - fs * 0.5).toFixed(1)}" y="${(Y(v) + fs * 0.35).toFixed(1)}" text-anchor="end">${tickText(v, ty.step)}</text>`));
    parts.push(`<g fill="${esc(colour)}" font-size="${fs.toFixed(1)}" font-family="${font}">${labels.join('')}</g>`);
    const errors = [];
    const far = (ymax - ymin) * 50;
    sampled.forEach((s, i) => {
        const c = spec.curves[i] || {};
        if (s.error) { errors.push(`${spec.curves.length > 1 ? `curve ${i + 1}: ` : ''}${s.error}`); return; }
        let d = '';
        let pen = false;
        s.points.forEach(([x, y]) => {
            if (!Number.isFinite(y) || y > ymax + far || y < ymin - far) { pen = false; return; }
            d += `${pen ? 'L' : 'M'}${X(x).toFixed(1)} ${Y(y).toFixed(1)}`;
            pen = true;
        });
        const w = num(c.width, 3);
        const dash = DASH[c.dash] ? ` stroke-dasharray="${DASH[c.dash](w)}"` : '';
        parts.push(`<path d="${d}" clip-path="url(#${clip})" fill="none" stroke="${esc(c.color || PALETTE[i % PALETTE.length])}" stroke-width="${w}" stroke-linejoin="round" stroke-linecap="round"${dash}/>`);
    });
    if (errors.length) {
        parts.push(`<g font-size="${fs.toFixed(1)}" font-family="${font}" fill="#dc2626">${errors.slice(0, 4).map((e, i) => `<text x="${L.left + fs}" y="${L.top + fs * (1.5 + i * 1.3)}">${esc(e)}</text>`).join('')}</g>`);
    }
    return `<svg class="gl-plot-svg" xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" style="position:absolute;left:0;top:0;overflow:visible">${parts.join('')}</svg>`;
}

export const PALETTE = ['#2563eb', '#dc2626', '#16a34a', '#d97706', '#7c3aed', '#0891b2'];

// ---------- live values in a page ----------

/** Shows the variables' current values in `root` and redraws its plots. */
export function liveUpdate(root, vars) {
    if (!root) return;
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
    // Let go: the arrow keys change slide again.
    root.addEventListener('change', (e) => { const input = slider(e); if (input) input.blur(); });
}
