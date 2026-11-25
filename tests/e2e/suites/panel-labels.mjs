import { launchBrowser, BASE_URL, OUT_DIR, FIXTURES_DIR, REPO_DIR } from '../helpers.mjs';
const OUT = OUT_DIR;
const browser = await launchBrowser();
const page = await browser.newPage({ viewport: { width: 1400, height: 1000 } });
const out = [];
const check = (n, c, x = '') => out.push(`${c ? 'PASS' : 'FAIL'} ${n}${x !== '' ? ' — ' + x : ''}`);
await page.goto(`${BASE_URL}/index.html`);
await page.waitForTimeout(400);
await page.evaluate(async () => {
    await (await import('/ui/project.js')).createProject('L');
    (await import('/editor/editor.js')).addElement('text');
});
await page.waitForTimeout(150);
const layout = () => page.evaluate(() => ({
    labelHeights: [...document.querySelectorAll('#properties-body .prop-group label')].map(l => Math.round(l.getBoundingClientRect().height)),
    controlTops: [...document.querySelectorAll('#properties-body [data-prop]')].map(c => Math.round(c.getBoundingClientRect().top)),
}));
const before = await layout();
check('all labels one line, same height', new Set(before.labelHeights).size === 1, JSON.stringify([...new Set(before.labelHeights)]));
await page.screenshot({ path: `${OUT}/labels-default.png`, clip: { x: 1120, y: 340, width: 280, height: 560 } });
await page.fill('[data-prop="fontSize"]', '48');
await page.waitForTimeout(100);
const typing = await layout();
check('typing an override: fields do not move', JSON.stringify(typing.controlTops) === JSON.stringify(before.controlTops));
check('↺ appears while typing', await page.$('[data-reset-prop="fontSize"]') !== null);
await page.evaluate(async () => (await import('/editor/editor.js')).renderEditor());
const after = await layout();
check('after redraw: fields still in place', JSON.stringify(after.controlTops) === JSON.stringify(before.controlTops));
const sizeLabel = await page.$eval('[data-prop="fontSize"]', c => {
    const l = c.closest('.prop-group').querySelector('label');
    const r = l.querySelector('.prop-reset').getBoundingClientRect(); const lr = l.getBoundingClientRect();
    return { resetInside: r.right <= lr.right + 1 && r.top >= lr.top - 1, title: l.querySelector('.prop-label-text').title };
});
check('↺ on the label line, label text has a full title', sizeLabel.resetInside && sizeLabel.title === 'Font Size', JSON.stringify(sizeLabel));
await page.screenshot({ path: `${OUT}/labels-override.png`, clip: { x: 1120, y: 340, width: 280, height: 560 } });
console.log(out.join('\n'));
await browser.close();
