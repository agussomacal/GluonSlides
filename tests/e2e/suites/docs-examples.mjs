// The examples in docs/gluon-format.md are real: every ```gl block is
// read by the app's parser (fragments wrapped in a .project / .slide),
// and every parameter written on an .element line is one the element
// type actually reads, so the reference can't document a key that
// doesn't exist. Complete files are also saved and read back unchanged.
import { readFileSync } from 'node:fs';
import { launchBrowser, BASE_URL } from '../helpers.mjs';

const browser = await launchBrowser();
const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
const errors = [];
page.on('pageerror', e => errors.push(e.message));
const out = [];
const check = (n, c, x = '') => out.push(`${c ? 'PASS' : 'FAIL'} ${n}${x !== '' ? ' — ' + x : ''}`);

const doc = readFileSync('docs/gluon-format.md', 'utf8');
const blocks = [...doc.matchAll(/```gl\n([\s\S]*?)```/g)].map(m => m[1]);
check('the reference has examples', blocks.length >= 15, String(blocks.length));

await page.goto(`${BASE_URL}/index.html`);
// the element types register as the page starts: wait for all of them
const TYPES = ['text', 'shape', 'figure', 'path', 'columns', 'table', 'group', 'macro'];
let registered = [];
for (let tries = 0; tries < 50 && registered.length < TYPES.length; tries++) {
    registered = await page.evaluate(async (types) => {
        const { ElementRegistry } = await import('/core/registry.js');
        return types.filter(t => ElementRegistry.get(t));
    }, TYPES);
    if (registered.length < TYPES.length) await page.waitForTimeout(100);
}
check('the element types are registered', registered.length === TYPES.length, `${registered.join(',')} ${errors.join(' | ')}`);

const results = await page.evaluate(async (blocks) => {
    const { parseProjectContent, applyProjectData, serializeProject } = await import('/core/state.js');
    const { ElementRegistry } = await import('/core/registry.js');
    const HEAD = ['id', 'name', 'style', 'step', 'until', 'locked', 'rotate'];
    const res = [];
    for (const [i, raw] of blocks.entries()) {
        let text = raw;
        const first = text.split('\n').find(l => l.trim() && !l.startsWith('#')) || '';
        const complete = /^\.(project|import)\b/.test(first);
        if (!complete) {
            if (/^\.(element|macro)\./.test(first)) text = `.project {T}\n.slide {S} id:9000\n${text}`;
            else text = `.project {T}\n${text}`;
        }
        if (!/^\.slide\b/m.test(text)) text += '\n.slide {S} id:9001\n';
        const r = { i, first: first.slice(0, 50), errors: [] };
        try {
            const p = parseProjectContent(text);
            r.slides = p.slides.length;
            if (complete) {
                // saved and read again: the same slides and elements
                applyProjectData(p);
                const again = parseProjectContent(serializeProject());
                const strip = (x) => JSON.stringify(x.slides.map(s => ({ t: s.title, n: s.elements.length, ty: s.elements.map(e => e.type) })));
                if (strip(again) !== strip(p)) r.errors.push('changed after saving and reading again');
            }
        } catch (e) {
            r.errors.push(e.message);
        }
        // every key on an .element.<type> line is read by that type
        for (const line of text.split('\n')) {
            const m = line.trim().match(/^\.element\.(\w+)\s+(.*)$/);
            if (!m) continue;
            const def = ElementRegistry.get(m[1]);
            if (!def) { r.errors.push(`unknown type ${m[1]}`); continue; }
            const known = new Set([...HEAD, ...(def.gl.props || [])]);
            for (const [, key] of m[2].matchAll(/(\w+):/g)) {
                if (!known.has(key)) r.errors.push(`${m[1]} doesn't read "${key}"`);
            }
        }
        res.push(r);
    }
    return res;
}, blocks);

for (const r of results) check(`example ${r.i + 1} (${r.first})`, r.errors.length === 0, r.errors.join('; '));

console.log(out.join('\n'));
console.log('--- errors ---\n' + (errors.join('\n') || '(none)'));
await browser.close();
