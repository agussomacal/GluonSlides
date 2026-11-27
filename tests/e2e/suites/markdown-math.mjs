// Math in text boxes is not touched by Markdown: the \\ row breaks of
// aligned equations, * and _ inside formulas reach KaTeX unchanged, while
// Markdown around the math (bold, lists, tables) still works.
import { launchBrowser, BASE_URL } from '../helpers.mjs';

const browser = await launchBrowser();
const page = await browser.newPage();
const errors = [];
page.on('pageerror', e => errors.push(e.message));
const out = [];
const check = (n, c, x = '') => out.push(`${c ? 'PASS' : 'FAIL'} ${n}${x !== '' ? ' — ' + x : ''}`);

await page.goto(`${BASE_URL}/index.html`);
await page.waitForTimeout(500);
const render = (text) => page.evaluate(async (text) => {
    const { renderMarkdownAndKatex } = await import('/core/render.js');
    const div = document.createElement('div');
    document.body.appendChild(div);
    renderMarkdownAndKatex(div, text);
    const tex = [...div.querySelectorAll('annotation[encoding="application/x-tex"]')].map(a => a.textContent);
    const result = { html: div.innerHTML, tex, errors: div.querySelectorAll('.katex-error').length, text: div.textContent };
    div.remove();
    return result;
}, text);

let r = await render('$$\\begin{aligned} a_k &= b_k \\\\ c_j &= d^*_j \\end{aligned}$$');
check('aligned rows keep their \\\\ (two rows)', r.tex.length === 1 && r.tex[0].includes('b_k \\\\ c_j') && r.errors === 0, JSON.stringify(r.tex));

r = await render('Inline $x*y*z$ and $a_k + b_k$, then **bold**');
check('* and _ inside inline math are left alone', r.tex[0] === 'x*y*z' && r.tex[1] === 'a_k + b_k' && !/<em>/.test(r.html.replace(/<em>bold<\/em>/, '')), JSON.stringify(r.tex));
check('Markdown outside math still works', /<strong>bold<\/strong>/.test(r.html));

r = await render('- item $\\frac{1}{2}$\n- second');
check('math inside a list item', r.tex[0] === '\\frac{1}{2}' && (r.html.match(/<li>/g) || []).length === 2);

r = await render('| a | b |\n|---|---|\n| $x_1$ | $y^*$ |');
check('math inside a table', r.tex.join(',') === 'x_1,y^*' && /<table>/.test(r.html), JSON.stringify(r.tex));

r = await render('Price: 5\\$ and 6\\$ each');
check('escaped dollars are not math', r.tex.length === 0, JSON.stringify(r.tex));

r = await render('Cost $\\$5 + x_1$ total');
check('an escaped dollar inside math stays in the formula', r.tex[0] === '\\$5 + x_1', JSON.stringify(r.tex));

r = await render('Text with <b>html</b> & a token-like word GLMATH7X');
check('text that looks like a token is kept', r.text.includes('GLMATH7X'));

// Exports: KaTeX's fonts embedded (\mathbb{R} in its AMS font, offline too), no override
const exp = await page.evaluate(async () => {
    await (await import('/ui/project.js')).openSampleProject();
    const html = await (await import('/export/html.js')).getExportHtmlString();
    return { ams: /KaTeX_AMS[^}]*url\(data:font\/woff2;base64,/.test(html), override: html.includes('.katex .mathbb {') };
});
check('export: KaTeX fonts embedded, \\mathbb drawn by KaTeX', exp.ams && !exp.override, JSON.stringify(exp));

console.log(out.join('\n'));
console.log('--- errors ---\n' + (errors.join('\n') || '(none)'));
await browser.close();
