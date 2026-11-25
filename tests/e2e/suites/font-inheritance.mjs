import { launchBrowser, BASE_URL, OUT_DIR, FIXTURES_DIR, REPO_DIR } from '../helpers.mjs';
const b = await launchBrowser();
const p = await b.newPage({ viewport: { width: 1400, height: 900 } });
await p.goto(`${BASE_URL}/index.html`); await p.waitForTimeout(400);
await p.evaluate(async () => (await import('/ui/project.js')).openSampleProject());
await p.click('#slide-canvas .canvas-element');
await p.click('[data-prop="fontFamily"]');
await p.click('.select-menu-item[data-value="monospace"]');
await p.waitForTimeout(150);
const r = await p.evaluate(() => {
    const ff = (el) => el ? getComputedStyle(el).fontFamily : null;
    return {
        canvasText: ff(document.querySelector('#slide-canvas .element-text p')),
        thumbText: ff(document.querySelector('.thumb-element p')),
        math: ff(document.querySelector('#slide-canvas .katex .mord')),
        toolbarButton: ff(document.querySelector('.toolbar-btn')),
        panelSelect: ff(document.querySelector('[data-prop="fontFamily"]')),
    };
});
const ui = '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif';
console.log(JSON.stringify(r, null, 1));
console.log((r.canvasText === 'monospace' ? 'PASS' : 'FAIL') + ' canvas text uses the chosen font');
console.log((r.thumbText === 'monospace' ? 'PASS' : 'FAIL') + ' thumbnail too');
console.log((r.math && r.math.includes('KaTeX') ? 'PASS' : 'FAIL') + ' math keeps KaTeX fonts');
console.log((r.toolbarButton === ui && r.panelSelect === ui ? 'PASS' : 'FAIL') + ' UI font unchanged on buttons/selects');
await b.close();
