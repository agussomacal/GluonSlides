// LaTeX-style commands in text (core/textCommands.js): \textcolor with CSS,
// xcolor, theme and mixed colours, \highlight, \textbf / \emph / ...,
// macros from macros.tex that use them, math left to KaTeX; and the
// format bar over selected words while editing (editor/formatBar.js).
import { launchBrowser, BASE_URL } from '../helpers.mjs';

const browser = await launchBrowser();
const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
const errors = [];
page.on('pageerror', e => errors.push(e.message));
const out = [];
const check = (n, c, x = '') => out.push(`${c ? 'PASS' : 'FAIL'} ${n}${x !== '' ? ' — ' + x : ''}`);
const app = (fn, arg) => page.evaluate(fn, arg);

await page.goto(`${BASE_URL}/index.html`);
await app(async () => { await (await import('/ui/project.js')).openSampleProject(); });
await page.waitForTimeout(300);
const render = (text) => app(async (text) => {
    const { renderMarkdownAndKatex } = await import('/core/render.js');
    const div = document.createElement('div');
    document.body.appendChild(div);
    renderMarkdownAndKatex(div, text);
    const spans = [...div.querySelectorAll('span[style]')].filter(s => !s.closest('.katex')).map(s => [s.textContent, s.style.color, s.style.backgroundColor]);
    const r = { html: div.innerHTML, spans, text: div.textContent, tex: [...div.querySelectorAll('annotation')].map(a => a.textContent) };
    div.remove();
    return r;
}, text);

let r = await render('A \\textcolor{red}{red **bold** word} and \\textcolor{#00aa00}{green}.');
check('\\textcolor with a name and with #hex; Markdown inside', r.spans[0][0] === 'red bold word' && r.spans[0][1] === 'red' && /<strong>bold<\/strong>/.test(r.html) && r.spans[1][1] === 'rgb(0, 170, 0)', JSON.stringify(r.spans));
check('the commands themselves are not shown', !r.text.includes('textcolor') && !r.text.includes('{'), r.text);

await app(async () => { const { state } = await import('/core/state.js'); state.palette = [{ name: 'accent', color: '#f59e0b' }]; });
r = await render('\\textcolor{@accent}{theme} \\textcolor{red!50}{pink} \\textcolor{red!50!blue}{purple} \\highlight{yellow}{marked}');
check('theme colour, xcolor mixes, highlight', r.spans[0][1] === 'rgb(245, 158, 11)' && r.spans[1][1] === 'rgb(255, 128, 128)' && r.spans[2][1] === 'rgb(128, 0, 128)' && ['yellow', 'rgb(255, 255, 0)'].includes(r.spans[3][2]), JSON.stringify(r.spans));

r = await render('\\textbf{B} \\emph{E} \\underline{U} \\texttt{T} \\textcolor{blue}{\\textbf{nested}}');
check('\\textbf \\emph \\underline \\texttt, nested', /<strong>B<\/strong>/.test(r.html) && /<em>E<\/em>/.test(r.html) && /<u>U<\/u>/.test(r.html) && /<code>T<\/code>/.test(r.html) && /<span style="color:\s*blue;?"><strong>nested<\/strong><\/span>/.test(r.html), r.html.slice(0, 300));

r = await render('Math $\\textcolor{red}{x} + \\textbf{y}$ stays math');
check('inside $…$ KaTeX does the work', r.tex[0] === '\\textcolor{red}{x} + \\textbf{y}' && r.spans.length === 0, JSON.stringify(r.tex));

r = await render('\\textcolor{red;background:url(x)}{bad} \\textcolor{notacolour}{plain} \\textcolor{red}{unclosed');
check('unsafe or unknown colours: just the text; unclosed: left as typed', r.spans.length === 0 && r.text.startsWith('bad plain') && r.text.includes('\\textcolor{red}{unclosed'), r.text);

await app(async () => {
    const { state, parseTexMacros } = await import('/core/state.js');
    state.rawTexMacros = '\\newcommand{\\important}[1]{\\textcolor{red}{\\textbf{#1}}}\n\\newcommand{\\R}{\\mathbb{R}}\n\\newcommand{\\warn}[1]{\\important{!} #1}';
    state.projectMacros = parseTexMacros(state.rawTexMacros);
});
r = await render('An \\important{idea}, \\warn{careful}, and $x \\in \\R$; \\R alone stays.');
check('your macros that use text commands work in text', r.spans[0][0] === 'idea' && r.spans[0][1] === 'red' && /<strong>idea<\/strong>/.test(r.html) && r.spans[1][0] === '!', JSON.stringify(r.spans));
check('math-only macros are left to math', r.tex[0] === 'x \\in \\R' && r.text.includes('\\R alone'), r.text);

// ---------- The format bar ----------
await app(async () => {
    const { state } = await import('/core/state.js');
    state.slides = [{ id: 1, title: 'S', elements: [{ type: 'text', id: 5, x: 200, y: 200, width: 900, height: 200, content: 'Make this word red', fontSize: 40, textAlign: 'left', verticalAlign: 'top' }] }];
    state.masters = [];
    (await import('/editor/editor.js')).selectSlide(0);
});
await page.waitForTimeout(200);
const box = await page.$('#slide-canvas .element-text');
await box.dblclick();
await page.waitForTimeout(200);
await app(() => {
    const el = document.querySelector('#slide-canvas .element-text[contenteditable="true"]');
    const node = [...el.childNodes].find(n => n.nodeType === 3 && n.textContent.includes('word')) || el.firstChild;
    const i = node.textContent.indexOf('word');
    const range = document.createRange();
    range.setStart(node, i);
    range.setEnd(node, i + 4);
    const sel = window.getSelection();
    sel.removeAllRanges();
    sel.addRange(range);
});
await page.waitForTimeout(150);
check('selecting words while editing shows the format bar', await page.isVisible('.format-bar'));
await page.click('.format-bar [data-color="red"]');
await page.waitForTimeout(100);
const typed = await app(() => document.querySelector('#slide-canvas .element-text').innerText);
check('a colour wraps the selection, still editing', typed.includes('Make this \\textcolor{red}{word} red')
    && await app(() => document.querySelector('#slide-canvas .element-text').classList.contains('editing-mode')), typed);
await page.keyboard.press('Escape');
await page.waitForTimeout(200);
const content = await app(async () => (await import('/core/state.js')).state.slides[0].elements[0].content);
check('…saved in the text, and drawn red', content === 'Make this \\textcolor{red}{word} red'
    && await app(() => document.querySelector('#slide-canvas .element-text span[style*="color"]')?.textContent === 'word'), content);

console.log(out.join('\n'));
console.log('--- errors ---\n' + (errors.join('\n') || '(none)'));
await browser.close();
