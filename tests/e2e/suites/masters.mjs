// Master slides: creating and editing one on the canvas, drawn under
// every slide (canvas, thumbnails, exports, PDF), fields with each
// slide's values, master:none and several masters, renaming/deleting,
// the .gl format, undo, and slide shortcuts disabled while editing one.
import { launchBrowser, BASE_URL } from '../helpers.mjs';

const browser = await launchBrowser();
const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
const errors = [];
page.on('pageerror', e => errors.push(e.message));
const out = [];
const check = (n, c, x = '') => out.push(`${c ? 'PASS' : 'FAIL'} ${n}${x !== '' ? ' — ' + x : ''}`);
const app = (fn, arg) => page.evaluate(fn, arg);
const st = () => app(async () => JSON.parse(JSON.stringify((await import('/core/state.js')).state, (k, v) => (k.startsWith('_') || k === 'undoStack' || k === 'redoStack' ? undefined : v))));

await page.goto(`${BASE_URL}/index.html`);
await app(async () => {
    await (await import('/ui/project.js')).openSampleProject();
    const { state } = await import('/core/state.js');
    state.slides = [
        { id: 1, title: 'Title', elements: [{ type: 'text', id: 2, x: 200, y: 300, width: 1500, height: 200, content: '# Big title' }] },
        { id: 3, title: 'One', elements: [{ type: 'text', id: 4, x: 200, y: 200, width: 800, height: 100, content: 'First' }] },
        { id: 5, title: 'Two', elements: [] },
    ];
    state.masters = [];
    state.nextId = 10;
    (await import('/editor/editor.js')).selectSlide(1);
});

// ---------- Creating the first master ----------
check('slide panel offers to create a master', await page.isVisible('[data-action="edit-master"]'));
await page.click('[data-action="edit-master"]');
let s = await st();
check('a master "Default" is created and opened', s.masters.length === 1 && s.masters[0].name === 'Default' && s.editingMasterIndex === 0);
check('banner and coloured frame while editing it', await page.isVisible('.master-banner') && await page.$eval('#slide-canvas', n => n.classList.contains('editing-master')));
check('the slide\'s own elements are not on the canvas', !(await page.$('#slide-canvas [data-element-id="4"]')));

// Add a footer and a logo shape to the master
await page.click('[data-category="fields"] > .toolbar-btn');
await page.click('[data-category="fields"] .toolbar-menu [data-variant="slidenumber"]');
await page.click('[data-category="shapes"] > .toolbar-btn');
await page.click('[data-category="shapes"] .toolbar-menu [data-variant="rect"]');
s = await st();
check('elements are added to the master, not the slide', s.masters[0].elements.length === 2 && s.slides[1].elements.length === 1, JSON.stringify(s.masters[0].elements.map(e => e.type)));
const numberId = s.masters[0].elements[0].id;
const logoId = s.masters[0].elements[1].id;
check('master elements have their own unique ids', ![2, 4].includes(numberId) && numberId !== logoId && numberId >= 10);
check('fields on the master show the current slide\'s value', (await page.textContent(`#slide-canvas [data-element-id="${numberId}"]`)).trim() === '2');

// Slide shortcuts are off: Delete with nothing selected keeps the slides; arrows don't change slide
await app(async () => { const m = await import('/core/state.js'); m.setSelectedElementIndices([], null); (await import('/editor/editor.js')).renderEditor(); });
await page.mouse.click(700, 700);
await page.keyboard.press('Delete');
await page.keyboard.press('ArrowDown');
s = await st();
check('editing a master: Delete/arrows don\'t touch the slides', s.slides.length === 3 && s.currentSlideIndex === 1 && s.editingMasterIndex === 0);

// Rename
await page.fill('#master-name', 'Corporate');
await page.press('#master-name', 'Tab');
s = await st();
check('renaming the master', s.masters[0].name === 'Corporate');

await page.keyboard.press('Escape');
s = await st();
check('Esc leaves the master', s.editingMasterIndex === null && !(await page.$('.master-banner')));

// ---------- On every slide ----------
const onCanvas = async () => app((ids) => ids.map(id => {
    const n = document.querySelector(`#slide-canvas [data-element-id="${id}"], #slide-canvas [data-master-element="${id}"]`);
    return n ? n.textContent.trim() || 'shape' : null;
}), [numberId, logoId]);
check('slide 2 shows the master under its elements, with its number', JSON.stringify(await onCanvas()) === '["2","shape"]', JSON.stringify(await onCanvas()));
check('master elements are under the slide\'s own and not clickable', await app((id) => {
    const canvas = document.getElementById('slide-canvas');
    const m = canvas.querySelector(`[data-master-element="${id}"]`);
    const own = canvas.querySelector('[data-element-id="4"]');
    return getComputedStyle(m).pointerEvents === 'none' && (m.compareDocumentPosition(own) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0;
}, numberId));
await app(async () => (await import('/editor/editor.js')).selectSlide(2));
check('slide 3 shows it with number 3', JSON.stringify(await onCanvas()) === '["3","shape"]');
const thumbNumbers = await page.$$eval('#slides-thumb-list .thumb-container', cs => cs.map(c => c.querySelector('.slide-thumb').textContent.replace(/\s+/g, ' ').trim()));
check('thumbnails show the master with each slide\'s number', thumbNumbers[0] === '1 Big title' && thumbNumbers[1] === '2 First' && thumbNumbers[2] === '3', JSON.stringify(thumbNumbers));

// ---------- master:none and a second master ----------
await app(async () => (await import('/editor/editor.js')).selectSlide(0));
await page.selectOption('#slide-master', 'none');
s = await st();
check('Master: None on the title slide', s.slides[0].master === 'none' && JSON.stringify(await onCanvas()) === '[null,null]');
await app(async () => (await import('/editor/editor.js')).selectSlide(2));
await page.click('[data-action="new-master"]');
s = await st();
check('＋ creates a second master used by this slide, opened for editing', s.masters.length === 2 && s.slides[2].master === s.masters[1].name && s.editingMasterIndex === 1);
await page.click('[data-category="shapes"] > .toolbar-btn');
await page.click('[data-category="shapes"] .toolbar-menu [data-variant="ellipse"]');
await page.click('[data-action="exit-master"]');
s = await st();
const ellipseId = s.masters[1].elements[0].id;
check('slide 3 shows the second master, not the first', JSON.stringify(await onCanvas()) === '[null,null]' && Boolean(await page.$(`#slide-canvas [data-master-element="${ellipseId}"]`)));

// ---------- .gl format ----------
const saved = await app(async () => (await import('/core/state.js')).serializeProject());
check('.gl: .master blocks before the slides', /\.master \{Corporate\} id:\d+\n\.element\.text id:\d+ .*\n\t\\slidenumber/.test(saved) && saved.indexOf('.master {Corporate}') < saved.indexOf('.slide {Title}'), saved.slice(0, 600));
check('.gl: master:none / master:Name on slides, nothing for the default', /\.slide \{Title\} id:1 master:none/.test(saved) && /\.slide \{One\} id:3\n/.test(saved) && new RegExp(`\\.slide \\{Two\\} id:5 master:"?${s.masters[1].name}`).test(saved), saved.split('\n').filter(l => l.startsWith('.slide')).join(' | '));
const back = await app(async (txt) => {
    const m = await import('/core/state.js');
    const p = m.parseProjectContent(txt);
    return { masters: p.masters.map(x => `${x.name}:${x.elements.length}`), slides: p.slides.map(x => x.master || '-'), again: (await import('/core/gl/glformat.js')).serializeGl({ ...p, projectName: p.name }) };
}, saved);
check('.gl: read back', JSON.stringify(back.masters) === JSON.stringify(['Corporate:2', `${s.masters[1].name}:1`]) && back.slides.join(',') === `none,-,${s.masters[1].name}`, JSON.stringify(back));

// ---------- Export and PDF ----------
const html = await app(async () => (await import('/export/html.js')).getExportHtmlString());
const ev = await browser.newPage();
await ev.setContent(html);
const exp = await ev.$$eval('.slide-wrapper > .slide', ss => ss.map(sl => sl.querySelectorAll('.el').length));
check('export: master elements on each slide (none on the title slide)', JSON.stringify(exp) === '[1,3,1]', JSON.stringify(exp));
check('export: slide number from the master', (await ev.$eval('#slide-1', n => n.textContent)).includes('2'));
await ev.close();

// ---------- Undo, delete ----------
await app(async () => (await import('/editor/editor.js')).selectSlide(1));
await page.click('[data-action="edit-master"]');
await page.click('[data-action="delete-master"]');
s = await st();
check('deleting the first master: its slides use the remaining one', s.masters.length === 1 && s.slides[1].master === undefined && s.editingMasterIndex === null);
await page.keyboard.press('Control+z');
await page.waitForTimeout(100);
s = await st();
check('undo brings the master back', s.masters.length === 2 && s.masters[0].name === 'Corporate', JSON.stringify(s.masters.map(m => m.name)));

console.log(out.join('\n'));
console.log('--- errors ---\n' + (errors.join('\n') || '(none)'));
await browser.close();
