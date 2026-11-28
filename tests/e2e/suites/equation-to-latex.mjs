// "Convert to LaTeX" on a picture (elements/figure/toLatex.js): offered in
// the right-click menu for pictures only; without the component it asks
// before downloading it; the picture becomes a LaTeX text box keeping its
// id, place, step and name; undo brings the picture back.
import { launchBrowser, BASE_URL } from '../helpers.mjs';

const browser = await launchBrowser();
const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
const errors = [];
page.on('pageerror', e => errors.push(e.message));
const out = [];
const check = (n, c, x = '') => out.push(`${c ? 'PASS' : 'FAIL'} ${n}${x !== '' ? ' — ' + x : ''}`);
const app = (fn, arg) => page.evaluate(fn, arg);

// A fake backend: the component missing until install_extra is called.
await page.addInitScript(() => {
    const ok = (o = {}) => Promise.resolve({ success: true, ...o });
    window.__calls = [];
    window.__installed = false;
    window.pywebview = { api: {
        read_equation: (folder, el) => {
            window.__calls.push(['read', folder, el.filePath]);
            if (!window.__installed) return Promise.resolve({ success: false, needs_extra: 'equations', extra_message: 'Needs 220 MB. Download?' });
            return ok({ sure: -0.2, unsure: true, element: { type: 'text', content: '$\\displaystyle a+b=c$', fontSize: 40,
                fontColor: '#000000', textAlign: 'center', verticalAlign: 'center', name: 'Recognised equation',
                x: 0, y: 0, width: 10, height: 10, bg: 'transparent', borderCol: 'transparent', borderWidth: 0, borderStyle: 'solid' } });
        },
        install_extra: (name) => { window.__calls.push(['install', name]); window.__installed = true; return ok(); },
        import_progress: () => ok({ stage: '' }),
        load_figure_data_uri: () => ok({ data_uri: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==' }),
        get_recent_projects: () => ok({ projects: [] }),
        get_inspector_settings: () => ok({ settings: null }),
        save_inspector_settings: () => ok(),
        list_project_fonts: () => ok({ fonts: [] }),
        list_system_fonts: () => ok({ families: [] }),
        save_project_data: () => ok(),
        save_text_file: () => ok(),
        load_text_file: () => Promise.resolve({ success: false }),
    } };
});
await page.goto(`${BASE_URL}/index.html`);
await app(async () => {
    await (await import('/ui/project.js')).openSampleProject();
    const { state, resetHistory } = await import('/core/state.js');
    state.projectFolder = '/home/me/talk';
    state.slides = [{ id: 1, title: 'One', elements: [
        { id: 5, type: 'figure', x: 100, y: 200, width: 600, height: 120, filePath: 'figures/eq.png', step: 2, bg: 'transparent', borderCol: 'transparent', borderWidth: 0, borderStyle: 'solid' },
        { id: 6, type: 'figure', x: 800, y: 200, width: 300, height: 300, filePath: 'figures/plot.pdf', bg: 'transparent', borderCol: 'transparent', borderWidth: 0, borderStyle: 'solid' },
        { id: 7, type: 'shape', kind: 'rect', x: 100, y: 600, width: 200, height: 100, bg: '#93c5fd', borderCol: 'transparent', borderWidth: 0, borderStyle: 'solid' },
    ] }];
    state.nextId = 10;
    (await import('/editor/editor.js')).selectSlide(0);
    resetHistory();
});
await page.waitForTimeout(200);

const menuItems = async (id) => {
    const box = await page.locator(`#slide-canvas [data-element-id="${id}"]`).boundingBox();
    await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2, { button: 'right' });
    await page.waitForTimeout(50);
    const items = await app(() => [...document.querySelectorAll('#gl-context-menu.open button')].map(b => b.textContent.trim()));
    await page.keyboard.press('Escape');
    return items;
};
const S = () => app(async () => JSON.parse(JSON.stringify((await import('/core/state.js')).state.slides[0].elements)));

check('a PNG picture: "Convert to LaTeX" in the menu', (await menuItems(5)).some(t => t.includes('Convert to LaTeX')));
check('a PDF picture: not offered', !(await menuItems(6)).some(t => t.includes('Convert to LaTeX')));
check('a shape: Go to Gluon file and Follow a variable, no Convert to LaTeX', JSON.stringify(await menuItems(7)) === JSON.stringify(['📄Go to Gluon file', 'ƒFollow a variable…']), JSON.stringify(await menuItems(7)));

// Without the component: asks; Cancel leaves the picture.
const clickConvert = async () => {
    const box = await page.locator('#slide-canvas [data-element-id="5"]').boundingBox();
    await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2, { button: 'right' });
    await page.locator('#gl-context-menu.open button', { hasText: 'Convert to LaTeX' }).click();
    await page.waitForTimeout(100);
};
await clickConvert();
check('without the component: asks first', await page.locator('#equation-extra-modal').isVisible()
    && (await page.locator('#equation-extra-modal').textContent()).includes('Needs 220 MB'));
await page.locator('#equation-extra-modal [data-extra="no"]').click();
await page.waitForTimeout(100);
check('Cancel: nothing downloaded, the picture stays', !(await app(() => window.__calls.some(c => c[0] === 'install'))) && (await S())[0].type === 'figure');

await clickConvert();
await page.locator('#equation-extra-modal [data-extra="yes"]').click();
await page.waitForTimeout(300);
const els = await S();
const t = els[0];
check('Download: installed, then read', JSON.stringify(await app(() => window.__calls.map(c => c[0]))) === '["read","read","install","read"]', JSON.stringify(await app(() => window.__calls)));
check('the picture became the LaTeX text box', t.type === 'text' && t.content === '$\\displaystyle a+b=c$', JSON.stringify(t));
check('…in its place, with its id and step', t.id === 5 && t.x === 100 && t.y === 200 && t.width === 600 && t.height === 120 && t.step === 2, JSON.stringify(t));
check('the dialog is gone', !(await page.locator('#equation-extra-modal').count()));
check('drawn on the canvas as math', await app(() => !!document.querySelector('#slide-canvas [data-element-id="5"] .katex, #slide-canvas [data-element-id="5"] mjx-container, #slide-canvas [data-element-id="5"] math')));

await app(async () => (await import('/core/state.js')).undo());
await page.waitForTimeout(100);
check('undo: the picture is back', (await S())[0].type === 'figure');

// From the panel too
await app(async () => (await import('/core/state.js')).setSelectedElementIndices([0], 0));
await app(async () => (await import('/editor/editor.js')).renderEditor());
await page.waitForTimeout(100);
const btn = page.locator('[data-element-action="toLatex"]');
check('the figure panel has the button', await btn.count() === 1);
await btn.click();
await page.waitForTimeout(300);
check('the panel button converts it', (await S())[0].type === 'text');

console.log(out.join('\n'));
console.log('--- errors ---\n' + (errors.join('\n') || '(none)'));
await browser.close();
