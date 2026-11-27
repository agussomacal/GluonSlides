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
check('the format bar goes away after use', await app(() => getComputedStyle(document.querySelector('.format-bar')).display === 'none'));
check('a colour wraps the selection, still editing', typed.includes('Make this \\textcolor{red}{word} red')
    && await app(() => document.querySelector('#slide-canvas .element-text').classList.contains('editing-mode')), typed);
await page.keyboard.press('Escape');
await page.waitForTimeout(200);
const content = await app(async () => (await import('/core/state.js')).state.slides[0].elements[0].content);
check('…saved in the text, and drawn red', content === 'Make this \\textcolor{red}{word} red'
    && await app(() => document.querySelector('#slide-canvas .element-text span[style*="color"]')?.textContent === 'word'), content);

// ---------- Double-clicking words; Markdown first ----------
/** Screen point of `word` in the shown text of the canvas text box. */
const wordAt = (word) => app((w) => {
    const root = document.querySelector('#slide-canvas .element-text');
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    for (let n = walker.nextNode(); n; n = walker.nextNode()) {
        const i = n.textContent.indexOf(w);
        if (i < 0) continue;
        const r = document.createRange();
        r.setStart(n, i); r.setEnd(n, i + w.length);
        const b = r.getBoundingClientRect();
        return { x: b.x + b.width / 2, y: b.y + b.height / 2 };
    }
    return null;
}, word);
const selected = () => app(() => window.getSelection().toString());
const shown = () => app(() => document.querySelector('#slide-canvas .element-text').innerText);

let p = await wordAt('Make');
await page.mouse.dblclick(p.x, p.y);
await page.waitForTimeout(200);
check('double-click on a word: editing, that word selected in the source', await selected() === 'Make'
    && await app(() => document.querySelector('#slide-canvas .element-text').classList.contains('editing-mode')), await selected());
check('…with the format bar', await page.isVisible('.format-bar'));
await page.click('.format-bar [data-md="bold"]', { timeout: 1500 }).catch(() => {});
await page.waitForTimeout(100);
check('bold is Markdown: **…**', (await shown()).startsWith('**Make** this'), await shown());

p = await wordAt('this');
await page.mouse.dblclick(p.x, p.y);
await page.waitForTimeout(200);
check('double-click while editing: the word stays selected, the text unchanged', await selected() === 'this' && (await shown()).startsWith('**Make** this'), JSON.stringify([await selected(), await shown()]));
check('…and the format bar shows', await page.isVisible('.format-bar'));
await page.click(".format-bar [data-md=\"italic\"]", { timeout: 1500 }).catch(() => {});
await page.waitForTimeout(100);
check('italic is Markdown: *…*', (await shown()).startsWith('**Make** *this*'), await shown());

// ✕ takes the Markdown marks off too
await app(() => {
    const el = document.querySelector('#slide-canvas .element-text');
    const n = [...el.childNodes].find(x => x.nodeType === 3);
    const r = document.createRange();
    r.setStart(n, 0); r.setEnd(n, '**Make**'.length);
    window.getSelection().removeAllRanges();
    window.getSelection().addRange(r);
});
await page.waitForTimeout(150);
await page.click('.format-bar [data-cmd="plain"]');
await page.waitForTimeout(100);
check('✕ removes **…**', (await shown()).startsWith('Make *this*'), await shown());
await page.keyboard.press('Escape');
await page.waitForTimeout(200);

// a table cell: double-click a word, it is selected; again inside, it stays
await app(async () => {
    const { state } = await import('/core/state.js');
    state.slides[0].elements = [{ type: 'table', id: 8, x: 200, y: 500, width: 900, height: 200, fontSize: 40,
        rows: [['alpha beta', 'gamma'], ['delta', 'epsilon']] }];
    (await import('/editor/editor.js')).renderEditor();
});
await page.waitForTimeout(200);
const cellWord = (w) => app((w) => {
    for (const td of document.querySelectorAll('#slide-canvas td, #slide-canvas th')) {
        const walker = document.createTreeWalker(td, NodeFilter.SHOW_TEXT);
        for (let n = walker.nextNode(); n; n = walker.nextNode()) {
            const i = n.textContent.indexOf(w);
            if (i < 0) continue;
            const r = document.createRange();
            r.setStart(n, i); r.setEnd(n, i + w.length);
            const b = r.getBoundingClientRect();
            return { x: b.x + b.width / 2, y: b.y + b.height / 2 };
        }
    }
    return null;
}, w);
p = await cellWord('beta');
if (p) {
    await page.mouse.dblclick(p.x, p.y);
    await page.waitForTimeout(200);
    check('table cell: the double-clicked word selected', await selected() === 'beta', await selected());
    p = await cellWord('alpha');
    await page.mouse.dblclick(p.x, p.y);
    await page.waitForTimeout(200);
    check('table cell: double-click inside the cell being edited selects a word', await selected() === 'alpha', await selected());
    await page.keyboard.press('Escape');
} else {
    check('table cell shown', false, await app(() => document.querySelector('#slide-canvas').innerHTML.slice(0, 300)));
}

console.log(out.join('\n'));
console.log('--- errors ---\n' + (errors.join('\n') || '(none)'));
await browser.close();
