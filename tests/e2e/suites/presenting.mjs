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
// Printing (the vector PDF): one page per build step, like presenting.
await viewer.emulateMedia({ media: 'print' });
const printed = await viewer.$$eval('.slide', ns => ns.filter(n => n.getClientRects().length > 0).map(n => [...n.querySelectorAll('[data-step]')].map(x => x.dataset.step).join('+') || '-'));
check('export: printing gives one page per step (3 steps + 1 slide = 4 pages)', printed.join(' | ') === '- | 2 | 2+3 | -', printed.join(' | '));
const pdf = await viewer.pdf({ printBackground: true, preferCSSPageSize: true });
const pdfPages = (pdf.toString('latin1').match(/\/Type\s*\/Page[^s]/g) || []).length;
check('export: the PDF has 4 pages', pdfPages === 4, String(pdfPages));
await viewer.close();

// Raster PDF (when no headless browser is found): same pages
const rasterPages = await app(async () => {
    const { state } = await import('/core/state.js');
    let pages = null;
    window.pywebview = { api: {
        save_text_file: () => Promise.resolve({ success: true, path: '/tmp/x.html' }),
        print_html_to_pdf: () => Promise.resolve({ success: false, error: 'no browser' }),
        save_direct_pdf_from_images: (folder, name, images) => { pages = images.length; return Promise.resolve({ success: true, path: '/tmp/x.pdf' }); },
    } };
    state.projectFolder = '/tmp';
    await (await import('/export/pdf.js')).exportProjectPdf();
    delete window.pywebview;
    state.projectFolder = null;
    return pages;
});
check('raster PDF: one image per step too', rasterPages === 4, String(rasterPages));

// ---------- Presenter view in the app, with an audience window ----------
// The fake bridge plays backend/presentation.py: the "audience window" is
// an iframe on the page; control/event messages go through it as Python would.
await app(async () => {
    const audience = { calls: [] };
    window.__audience = audience;
    const remote = (detail) => window.dispatchEvent(new CustomEvent('gluon-remote', { detail }));
    Object.assign(window.pywebview = window.pywebview || {}, {});
    window.pywebview.api = Object.assign(window.pywebview.api || {}, {
        screen_count: () => Promise.resolve({ success: true, count: 2 }),
        open_audience_window: (html) => {
            audience.calls.push('open');
            const f = document.createElement('iframe');
            f.id = 'fake-audience';
            f.style.cssText = 'position:fixed;left:0;top:0;width:480px;height:270px;z-index:20000';
            f.srcdoc = html;
            document.body.appendChild(f);
            window.addEventListener('message', (e) => { if (e.source === f.contentWindow) remote(e.data); });
            return Promise.resolve({ success: true, fullscreen: true });
        },
        audience_control: (m) => {
            audience.calls.push('control');
            document.getElementById('fake-audience')?.contentWindow.postMessage(m, '*');
            return Promise.resolve({ success: true });
        },
        close_audience_window: () => {
            audience.calls.push('close');
            document.getElementById('fake-audience')?.remove();
            return Promise.resolve({ success: true });
        },
    });
    (await import('/editor/editor.js')).selectSlide(0);
});
await page.click('[data-action="present"]'); // two screens: presenter view directly
await page.waitForSelector('#fake-audience');
const pv = await (await page.waitForSelector('.present-frame')).contentFrame();
await pv.waitForFunction(() => window.GluonViewer && window.GluonViewer.mode === 'presenter');
const aud = await (await page.$('#fake-audience')).contentFrame();
await aud.waitForFunction(() => window.GluonViewer);
const apos = () => aud.evaluate(() => window.GluonViewer.position());
const ppos = () => pv.evaluate(() => window.GluonViewer.position());
check('two screens: Present opens the presenter view + audience window', (await pv.evaluate(() => window.GluonViewer.mode)) === 'presenter');
check('presenter view shows the notes', (await pv.textContent('.gp-notes-text')) === 'Mention the red box.');
check('the audience never gets the notes', !(await aud.evaluate(() => document.getElementById('gluon-notes').textContent.includes('red box'))));
check('next pane shows the next step', await pv.$eval('[data-stage="next"] .gp-copy', n => [...n.querySelectorAll('[data-step]')].filter(x => x.classList.contains('step-hidden')).map(x => x.dataset.step).join(',')) === '3');
check('position and step shown', (await pv.textContent('.gp-pos')).includes('Slide 1 / 2 · step 1 / 3'));
await pv.focus('body');
await page.keyboard.press('ArrowRight');
await page.waitForTimeout(200);
check('→ in the presenter view moves the audience', (await apos()).step === 2 && (await ppos()).step === 2, JSON.stringify(await apos()));
// (the overlay is in the full-screen layer, above the fake window: click via the DOM)
await aud.evaluate(() => document.querySelector('.slide.active').dispatchEvent(new MouseEvent('click', { bubbles: true, button: 0 })));
await page.waitForTimeout(200);
check('a click in the audience window moves the presenter view', (await ppos()).step === 3 && (await apos()).step === 3, JSON.stringify(await ppos()));
await pv.click('[data-gp="black"]');
await page.waitForTimeout(200);
check('Black: the audience goes black, the presenter still sees the slide', await aud.evaluate(() => document.querySelector('.gluon-blank').classList.contains('black'))
    && await pv.$eval('[data-stage="current"]', n => n.classList.contains('blanked')));
await pv.focus('body');
await page.keyboard.press('ArrowRight');
await page.waitForTimeout(200);
check('next key un-blanks first', !(await aud.evaluate(() => document.querySelector('.gluon-blank').classList.contains('black'))) && (await apos()).step === 3);
const t1 = await pv.textContent('.gp-timer');
await page.keyboard.press('t');
check('T pauses the timer', await pv.$eval('.gp-timer', n => n.classList.contains('paused')), t1);
await page.keyboard.press('ArrowRight');
await page.waitForTimeout(200);
check('both on slide 2', (await apos()).slide === 1 && (await ppos()).slide === 1);
check('last slide: next pane says the end', (await pv.textContent('[data-stage="next"]')).includes('End of presentation'));
await page.keyboard.press('Escape');
await page.waitForTimeout(200);
check('Esc closes both and the editor shows slide 2', !(await page.$('#present-overlay')) && !(await page.$('#fake-audience'))
    && (await getState()).current === 1 && (await app(() => window.__audience.calls.includes('close'))));

// S during a one-screen show switches to the presenter view
await app(() => { window.pywebview.api.screen_count = () => Promise.resolve({ success: true, count: 1 }); });
await page.click('[data-action="present"]');
const one = await (await page.waitForSelector('.present-frame')).contentFrame();
await one.waitForFunction(() => window.GluonViewer);
check('one screen: Present shows the slides', (await one.evaluate(() => window.GluonViewer.mode)) === 'audience' && !(await page.$('#fake-audience')));
await page.keyboard.press('s');
await page.waitForSelector('#fake-audience');
await page.waitForFunction(() => {
    const f = document.querySelector('.present-frame');
    return f && f.contentWindow.GluonViewer && f.contentWindow.GluonViewer.mode === 'presenter';
});
const sw = await (await page.$('.present-frame')).contentFrame();
check('S switches to the presenter view at the same slide', (await sw.evaluate(() => window.GluonViewer.position())).slide === 1);
await sw.click('[data-gp="exit"]');
await page.waitForTimeout(200);
check('End button closes the presentation', !(await page.$('#present-overlay')) && !(await page.$('#fake-audience')));

// ---------- present/audience.html (the audience window page) ----------
const shell = await browser.newPage({ viewport: { width: 800, height: 450 } });
shell.on('pageerror', e => errors.push('audience: ' + e.message));
const deck = await app(async () => (await import('/export/html.js')).getExportHtmlString({ localAssets: true, notes: false }));
await shell.addInitScript((html) => {
    window.__events = [];
    setTimeout(() => {
        window.pywebview = { api: {
            get_audience_html: () => Promise.resolve({ success: true, html }),
            audience_event: (m) => { window.__events.push(m); return Promise.resolve({ success: true }); },
        } };
        window.dispatchEvent(new CustomEvent('pywebviewready'));
    }, 300);
}, deck);
await shell.goto(`${BASE_URL}/present/audience.html`);
const shellFrame = await (await shell.waitForSelector('iframe')).contentFrame();
await shellFrame.waitForFunction(() => window.GluonViewer, null, { timeout: 5000 });
check('audience page loads the presentation once the bridge is ready', !(await shell.$('#waiting')));
await shell.evaluate(() => window.gluonAudience({ type: 'gluon-control', action: 'goto', slide: 1, step: 1 }));
await shell.waitForTimeout(100);
check('audience page: the app moves it (gluonAudience)', (await shellFrame.evaluate(() => window.GluonViewer.position())).slide === 1);
check('audience page: reports its position back', (await shell.evaluate(() => window.__events.some(m => m.type === 'gluon-position' && m.slide === 1))));
await shellFrame.focus('body');
await shell.keyboard.press('Escape');
await shell.waitForTimeout(100);
check('audience page: Esc is reported (ends the show)', await shell.evaluate(() => window.__events.some(m => m.type === 'gluon-exit')));
await shell.close();

// ---------- Exported HTML: S opens the presenter view in a new window ----------
const { writeFileSync, mkdirSync } = await import('node:fs');
const { OUT_DIR } = await import('../helpers.mjs');
mkdirSync(OUT_DIR, { recursive: true });
const file = `${OUT_DIR}/presenting-export.html`;
writeFileSync(file, html);
const ctx = await browser.newContext({ viewport: { width: 1000, height: 600 } });
const audPage = await ctx.newPage();
audPage.on('pageerror', e => errors.push('export audience: ' + e.message));
await audPage.goto(`file://${file}`);
await audPage.waitForFunction(() => window.GluonViewer);
const [popup] = await Promise.all([ctx.waitForEvent('page'), audPage.keyboard.press('s')]);
popup.on('pageerror', e => errors.push('export presenter: ' + e.message));
await popup.waitForFunction(() => window.GluonViewer && window.GluonViewer.mode === 'presenter');
check('export: S opens the presenter view in a new window', true);
check('export: presenter window shows the notes', (await popup.textContent('.gp-notes-text')) === 'Mention the red box.');
await popup.keyboard.press('ArrowRight');
await popup.waitForTimeout(200);
check('export: presenter window moves the slides window', (await audPage.evaluate(() => window.GluonViewer.position())).step === 2);
await audPage.keyboard.press('ArrowRight');
await audPage.waitForTimeout(200);
check('export: the slides window moves the presenter window', (await popup.evaluate(() => window.GluonViewer.position())).step === 3);
await ctx.close();

console.log(out.join('\n'));
console.log('--- errors ---\n' + (errors.join('\n') || '(none)'));
await browser.close();
