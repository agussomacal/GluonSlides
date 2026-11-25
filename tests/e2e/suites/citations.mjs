// Citations: BibTeX accents and names, \cite / \citet / \citep and page
// notes in both styles, the reference list, unknown keys (highlight,
// sidebar count, dialog, export warning) and \cite{ autocomplete on the
// canvas and in the .gl inspector.
import { launchBrowser, BASE_URL } from '../helpers.mjs';

const browser = await launchBrowser();
const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
const errors = [];
page.on('pageerror', e => errors.push(e.message));
const out = [];
const check = (n, c, x = '') => out.push(`${c ? 'PASS' : 'FAIL'} ${n}${x !== '' ? ' — ' + x : ''}`);

const BIB = String.raw`
@article{goedel1931,
  author  = {G{\"o}del, Kurt},
  title   = {{\"U}ber formal unentscheidbare S{\"a}tze},
  journal = {Monatshefte f{\"u}r Mathematik},
  volume  = 38, number = 1, pages = {173--198}, year = 1931
}
@book{knuth1984,
  author    = {Donald E. Knuth},
  title     = {The \TeX book},
  publisher = {Addison--Wesley},
  year      = {1984}
}
@inproceedings{vaswani2017,
  author    = {Vaswani, Ashish and Shazeer, Noam and Parmar, Niki and others},
  title     = {Attention Is All You Need},
  booktitle = {NeurIPS},
  year      = {2017}
}`;

await page.goto(`${BASE_URL}/index.html`);
await page.evaluate(async (bib) => {
    await (await import('/ui/project.js')).openSampleProject();
    const { state } = await import('/core/state.js');
    const { setBibSource } = await import('/core/citations.js');
    state.slides[0].elements = [
        { type: 'text', id: 10, x: 100, y: 100, width: 1600, height: 200, content: String.raw`As \citet{goedel1931} showed \cite[p.~5]{knuth1984,goedel1931}; see \citep{vaswani2017} and \cite{nobody}.` },
        { type: 'text', id: 11, x: 100, y: 400, width: 1600, height: 500, content: String.raw`\printbibliography` },
    ];
    state.citestyle = 'numeric';
    setBibSource(bib);
    (await import('/editor/editor.js')).renderEditor();
}, BIB);

const text = (id) => page.$eval(`[data-element-id="${id}"]`, n => n.textContent.replace(/\s+/g, ' ').trim());

// ---------- Numeric style ----------
let t10 = await text(10);
check('numeric: \\citet gives author + number', t10.startsWith('As Gödel [1] showed'), t10);
check('numeric: several keys and a page note in one bracket, sorted', t10.includes('[1, 2, p. 5]'), t10);
check('numeric: \\citep', t10.includes('see [3]'), t10);
check('unknown key highlighted as [? key]', t10.includes('[? nobody]') && await page.$eval('[data-element-id="10"] .cite-missing', n => getComputedStyle(n).color) === 'rgb(185, 28, 28)');
let refs = await text(11);
check('reference list: accents decoded, initials, volume(number), pages', refs.includes('Gödel, K. (1931). Über formal unentscheidbare Sätze. Monatshefte für Mathematik, 38(1), 173–198.'), refs);
check('reference list: \\TeX, en dash, et al.', refs.includes('Knuth, D. E. (1984). The TeXbook. Addison–Wesley.') && refs.includes('Vaswani, A., Shazeer, N., Parmar, N., et al. (2017).'), refs);
check('reference list: numbered in citation order, unknown key flagged', await page.$$eval('[data-element-id="11"] li', ls => ls.length) === 4
    && await page.$eval('[data-element-id="11"] ol', n => n.getAttribute('start') === null || n.getAttribute('start') === '1'));

// ---------- Author-year style ----------
await page.selectOption('#citestyle-select', 'authoryear');
await page.waitForTimeout(150);
t10 = await text(10);
check('author-year: \\citet', t10.startsWith('As Gödel (1931) showed'), t10);
check('author-year: several keys with a page note', t10.includes('(Knuth, 1984; Gödel, 1931, p. 5)'), t10);
check('author-year: three or more authors → et al.', t10.includes('see (Vaswani et al., 2017)'), t10);
await page.selectOption('#citestyle-select', 'numeric');
await page.waitForTimeout(150);

// ---------- Missing keys: sidebar count, dialog, export ----------
check('sidebar shows ⚠ 1 on the Bibliography button', (await page.textContent('#bib-warning')).trim() === '⚠ 1' && await page.isVisible('#bib-warning'));
await page.click('[data-action="open-bib"]');
check('dialog lists the missing key', (await page.textContent('#bib-missing')).includes('nobody') && await page.isVisible('#bib-missing'));
await page.fill('#bib-textarea', BIB + '\n@misc{nobody, author={No Body}, title={Found}, year=2020}');
await page.click('[data-action="save-bib"]');
await page.waitForTimeout(200);
check('adding the entry clears the warning', !(await page.isVisible('#bib-warning')) && (await text(10)).includes('[4]'), await text(10));
const dialogs = [];
page.on('dialog', d => { dialogs.push(d.message()); d.dismiss(); });
await page.evaluate(async () => {
    const { state } = await import('/core/state.js');
    state.slides[0].elements[0].content += String.raw` \cite{ghost}`;
    (await import('/editor/editor.js')).renderEditor();
    window.pywebview = { api: {
        save_text_file: () => Promise.resolve({ success: true, path: '/tmp/x.html' }),
        open_file_with_system: () => Promise.resolve({ success: true }),
    } };
    state.projectFolder = '/tmp';
});
await page.evaluate(async () => (await import('/export/index.js')).projectExportHtml());
await page.waitForTimeout(200);
check('export warns about missing keys', dialogs.some(m => m.includes('ghost') && m.includes('bibliography.bib')), dialogs.join(' | '));

// ---------- Autocomplete on the canvas ----------
await page.dblclick('[data-element-id="11"]');
await page.waitForTimeout(150);
await page.keyboard.press('Control+End');
await page.keyboard.type(String.raw` \cite{`);
await page.waitForTimeout(150);
let menu = await page.$$eval('.cite-menu-item', ns => ns.map(n => n.querySelector('.cite-menu-key').textContent));
check('canvas: \\cite{ lists the bibliography', menu.length === 4 && menu.includes('goedel1931'), menu.join(','));
await page.keyboard.type('att'); // matches the title "Attention…"
await page.waitForTimeout(100);
menu = await page.$$eval('.cite-menu-item', ns => ns.map(n => n.querySelector('.cite-menu-key').textContent));
check('canvas: typing filters by key, author or title', menu.join(',') === 'vaswani2017', menu.join(','));
await page.keyboard.press('Enter');
await page.waitForTimeout(100);
let content = await page.evaluate(async () => (await import('/core/state.js')).state.slides[0].elements[1].content);
check('canvas: Enter inserts the key and closes the brace', content.endsWith(String.raw`\cite{vaswani2017}`) && !(await page.$('.cite-menu')), JSON.stringify(content));
check('canvas: still editing the text box', await page.$eval('[data-element-id="11"]', n => n.classList.contains('editing-mode')));
await page.keyboard.press('Backspace'); // remove "}"
await page.keyboard.type(',kn');
await page.waitForTimeout(100);
await page.keyboard.press('Tab');
content = await page.evaluate(async () => (await import('/core/state.js')).state.slides[0].elements[1].content);
check('canvas: after a comma, Tab inserts the next key', content.endsWith(String.raw`\cite{vaswani2017,knuth1984}`), JSON.stringify(content));
await page.keyboard.type(String.raw` \citet{`);
await page.waitForTimeout(100);
await page.keyboard.press('Escape');
check('canvas: Esc closes the list but keeps editing', !(await page.$('.cite-menu')) && await page.$eval('[data-element-id="11"]', n => n.classList.contains('editing-mode')));
await page.keyboard.press('Escape');
await page.waitForTimeout(100);

// ---------- Autocomplete in the .gl inspector ----------
await page.evaluate(async () => (await import('/editor/inspector/index.js')).openGlInspector());
await page.waitForTimeout(300);
await page.evaluate(() => {
    const cm = document.querySelector('.CodeMirror').CodeMirror;
    const line = cm.getValue().split('\n').findIndex(l => l.startsWith('\tAs '));
    cm.focus();
    cm.setCursor({ line, ch: cm.getLine(line).length });
});
await page.keyboard.type(String.raw` \cite{g`);
await page.waitForTimeout(200);
const hints = await page.$$eval('.CodeMirror-hint', ns => ns.map(n => n.textContent));
check('inspector: \\cite{ suggests keys with author and year', hints.length >= 1 && hints[0].startsWith('goedel1931') && hints[0].includes('Gödel (1931)'), hints.join(' | '));
await page.keyboard.press('Enter');
const line = await page.evaluate(() => { const cm = document.querySelector('.CodeMirror').CodeMirror; return cm.getLine(cm.getCursor().line); });
check('inspector: Enter inserts the key and the brace', line.endsWith(String.raw`\cite{goedel1931}`), line);

console.log(out.join('\n'));
console.log('--- errors ---\n' + (errors.join('\n') || '(none)'));
await browser.close();
