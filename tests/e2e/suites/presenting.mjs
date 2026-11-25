// Presenting: build steps, speaker notes, the in-app Present mode and
// the exported HTML viewer (keys, steps, black screen, go to slide).
import { launchBrowser, BASE_URL } from '../helpers.mjs';

const browser = await launchBrowser();
const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
const errors = [];
page.on('pageerror', e => errors.push(e.message));
const out = [];
const check = (n, c, x = '') => out.push(`${c ? 'PASS' : 'FAIL'} ${n}${x !== '' ? ' — ' + x : ''}`);

const app = (fn, arg) => page.evaluate(fn, arg);
const getState = () => app(async () => {
    const { state } = await import('/core/state.js');
    return JSON.parse(JSON.stringify({ slides: state.slides, current: state.currentSlideIndex }));
});

await page.goto(`${BASE_URL}/index.html`);
await app(async () => {
    await (await import('/ui/project.js')).openSampleProject();
    const { state } = await import('/core/state.js');
    // Slide 1: the sample text + two shapes that build up; slide 2: plain.
    state.slides[0].elements.push(
        { type: 'shape', id: 90, x: 100, y: 600, width: 300, height: 200, bg: '#ff0000' },
        { type: 'shape', id: 91, x: 500, y: 600, width: 300, height: 200, bg: '#00ff00', step: 3 },
    );
    state.slides.push({ id: 50, title: 'Two', elements: [{ type: 'text', id: 92, x: 100, y: 100, width: 800, height: 200, content: 'Second slide' }] });
    (await import('/editor/editor.js')).renderEditor();
});

// ---------- Editing steps ----------
await page.click('[data-element-id="90"]');
await page.fill('[data-prop="step"]', '2');
await page.waitForTimeout(150);
let st = await getState();
check('"Appears at step" sets step', st.slides[0].elements.find(e => e.id === 90).step === 2);
check('step badge on the canvas', await page.getAttribute('[data-element-id="90"]', 'data-step') === '2'
    && await page.$eval('[data-element-id="90"]', n => getComputedStyle(n, '::after').content) === '"2"');
await page.fill('[data-prop="step"]', '1');
await page.waitForTimeout(150);
st = await getState();
check('step 1 is not stored (shown from the start)', !('step' in st.slides[0].elements.find(e => e.id === 90)));
check('no badge at step 1', await page.getAttribute('[data-element-id="90"]', 'data-step') === null);
await page.fill('[data-prop="step"]', '2');
await page.waitForTimeout(150);

// ---------- Speaker notes ----------
await page.keyboard.press('Escape');
await app(async () => {
    const { setSelectedElementIndices } = await import('/core/state.js');
    setSelectedElementIndices([], null);
    (await import('/editor/editor.js')).renderEditor();
});
check('notes field when nothing is selected', await page.isVisible('#slide-notes'));
check('hint says the slide has 3 steps', (await page.textContent('#properties-body')).includes('3 steps'));
await page.click('#slide-notes');
await page.keyboard.type('Mention the red box.\nThen the green one.');
await page.waitForTimeout(150);
st = await getState();
check('notes typed into the slide', st.slides[0].notes === 'Mention the red box.\nThen the green one.', JSON.stringify(st.slides[0].notes));
const saved = await app(async () => (await import('/core/state.js')).serializeProject());
check('notes and steps saved in .gl', saved.includes('.notes\n\tMention the red box.\n\tThen the green one.')
    && /id:90 step:2 /.test(saved) && /id:91 step:3 /.test(saved));
await page.fill('#slide-notes', '');
await page.waitForTimeout(100);
st = await getState();
check('clearing the notes removes them', !('notes' in st.slides[0]));
await page.fill('#slide-notes', 'Mention the red box.');

// ---------- In-app Present mode ----------
await page.click('[data-action="present"]');
const frameHandle = await page.waitForSelector('.present-frame', { timeout: 10000 });
const fr = await frameHandle.contentFrame();
await fr.waitForFunction(() => window.GluonViewer);
const pos = () => fr.evaluate(() => window.GluonViewer.position());
const hidden = () => fr.evaluate(() => [...document.querySelectorAll('.slide.active [data-step]')]
    .filter(n => n.classList.contains('step-hidden')).map(n => n.dataset.step).join(','));

let p = await pos();
check('Present starts at the current slide, step 1', p.slide === 0 && p.step === 1 && p.steps === 3 && p.total === 2, JSON.stringify(p));
check('later steps hidden at first', await hidden() === '2,3', await hidden());
check('the app frame uses local KaTeX fonts (works offline)', await fr.evaluate(() => [...document.styleSheets].some(s => {
    try { return [...s.cssRules].some(r => r.cssText.includes('libs/fonts/KaTeX')); } catch { return false; }
})));
await page.keyboard.press('ArrowRight');
check('→ reveals step 2', (await pos()).step === 2 && await hidden() === '3');
await page.keyboard.press('Space');
check('Space reveals step 3', (await pos()).step === 3 && await hidden() === '');
await page.mouse.click(700, 450);
p = await pos();
check('click goes to the next slide after the last step', p.slide === 1 && p.step === 1, JSON.stringify(p));
await page.keyboard.press('ArrowLeft');
p = await pos();
check('← back to the previous slide shows it complete', p.slide === 0 && p.step === 3 && await hidden() === '');
await page.keyboard.press('ArrowLeft');
check('← hides the last step again', (await pos()).step === 2 && await hidden() === '3');
await page.keyboard.press('b');
check('B: black screen', await fr.evaluate(() => document.querySelector('.gluon-blank').classList.contains('black')));
await page.keyboard.press('ArrowRight');
check('a key on the black screen only removes it', !(await fr.evaluate(() => document.querySelector('.gluon-blank').classList.contains('black'))) && (await pos()).step === 2);
await page.keyboard.press('2');
await page.keyboard.press('Enter');
check('number + Enter: go to that slide', (await pos()).slide === 1);
await page.keyboard.press('End');
await page.keyboard.press('Home');
check('Home: first slide', (await pos()).slide === 0 && (await pos()).step === 1);
await page.keyboard.press('End');
await page.keyboard.press('Escape');
await page.waitForTimeout(150);
st = await getState();
check('Esc leaves, the editor shows the slide the talk ended on', !(await page.$('#present-overlay')) && st.current === 1);

await page.keyboard.press('F5');
await (await (await page.waitForSelector('.present-frame')).contentFrame()).waitForFunction(() => window.GluonViewer);
const fr2 = await (await page.$('.present-frame')).contentFrame();
check('F5: from the first slide', (await fr2.evaluate(() => window.GluonViewer.position())).slide === 0);
await page.keyboard.press('Escape');
await page.waitForTimeout(100);
await page.keyboard.press('Shift+F5');
await page.waitForSelector('.present-frame');
const fr3 = await (await page.$('.present-frame')).contentFrame();
await fr3.waitForFunction(() => window.GluonViewer);
check('Shift+F5: from the current slide', (await fr3.evaluate(() => window.GluonViewer.position())).slide === 0);
await page.keyboard.press('Escape');

// ---------- Exported HTML ----------
const html = await app(async () => (await import('/export/html.js')).getExportHtmlString());
check('export: steps and viewer included', html.includes('data-steps="3"') && html.includes('data-step="2"') && html.includes('window.GluonViewer'));
check('export: KaTeX fonts from the CDN', html.includes('cdn.jsdelivr.net/npm/katex'));
const viewer = await browser.newPage({ viewport: { width: 1000, height: 700 } });
viewer.on('pageerror', e => errors.push('export: ' + e.message));
await viewer.setContent(html);
await viewer.waitForFunction(() => window.GluonViewer);
const scale = await viewer.$eval('.slide.active', n => n.getBoundingClientRect().width);
check('export: slide scaled to fit the window', Math.abs(scale - 1000) < 2, String(scale));
await viewer.keyboard.press('ArrowRight');
check('export: → reveals the next step', (await viewer.evaluate(() => window.GluonViewer.position())).step === 2);
await viewer.emulateMedia({ media: 'print' });
const printHidden = await viewer.$$eval('.slide', ns => ns.filter(n => getComputedStyle(n).display === 'none').length
    + [...document.querySelectorAll('[data-step]')].filter(n => getComputedStyle(n).visibility === 'hidden').length);
check('export: printing (PDF) shows every slide and step', printHidden === 0, String(printHidden));
await viewer.close();

console.log(out.join('\n'));
console.log('--- errors ---\n' + (errors.join('\n') || '(none)'));
await browser.close();
