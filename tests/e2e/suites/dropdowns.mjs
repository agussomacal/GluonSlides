import { launchBrowser, BASE_URL, OUT_DIR, FIXTURES_DIR, REPO_DIR } from '../helpers.mjs';
const OUT = OUT_DIR;
const browser = await launchBrowser();
const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
const errors = [];
page.on('pageerror', e => errors.push(e.message));
const out = [];
const check = (n, c, x = '') => out.push(`${c ? 'PASS' : 'FAIL'} ${n}${x !== '' ? ' — ' + x : ''}`);
await page.goto(`${BASE_URL}/index.html`);
await page.waitForTimeout(400);
await page.evaluate(async () => (await import('/ui/project.js')).openSampleProject());
await page.click('#slide-canvas .canvas-element');
await page.waitForTimeout(150);
const el0 = () => page.evaluate(async () => JSON.parse(JSON.stringify((await import('/core/state.js')).state.slides[0].elements[0])));

// Border style: mouse
await page.click('[data-prop="borderStyle"]');
await page.waitForTimeout(100);
const items = await page.$$eval('.select-menu .select-menu-item', ns => ns.map(n => [n.textContent, n.classList.contains('selected')]));
check('custom list opens with all options', items.map(i => i[0]).join(',') === 'Solid,Dashed,Dotted,None', JSON.stringify(items));
check('current option highlighted', items.find(i => i[1])?.[0] === 'Solid');
const menuBg = await page.$eval('.select-menu', n => getComputedStyle(n).backgroundColor);
check('list uses the dark style', menuBg === 'rgb(5, 9, 17)', menuBg);
await page.screenshot({ path: `${OUT}/selectmenu.png`, clip: { x: 1000, y: 300, width: 400, height: 600 } });
await page.click('.select-menu-item:text-is("Dashed")');
check('picking applies the value', (await el0()).borderStyle === 'dashed');
check('list closes after picking', (await page.$$('.select-menu')).length === 0);

// Keyboard: open, ArrowDown, Enter
await page.click('[data-prop="textAlign"]');
await page.keyboard.press('ArrowDown');
await page.keyboard.press('Enter');
check('keyboard: ArrowDown + Enter', (await el0()).textAlign === 'right', (await el0()).textAlign);

// Esc closes without changing
await page.click('[data-prop="verticalAlign"]');
await page.keyboard.press('ArrowDown');
await page.keyboard.press('Escape');
check('Esc closes without changing', (await el0()).verticalAlign === 'center' && (await page.$$('.select-menu')).length === 0);

// Toolbar select (grid)
await page.click('#grid-size-select');
await page.click('.select-menu-item:text-is("40px")');
check('Grid select works', await page.evaluate(async () => (await import('/core/state.js')).state.gridSize) === 40);

// Click outside closes
await page.click('#citestyle-select');
check('opens for the citation style too', (await page.$$('.select-menu')).length === 1);
await page.mouse.click(700, 500);
check('click outside closes', (await page.$$('.select-menu')).length === 0);

console.log(out.join('\n'));
console.log('--- errors ---\n' + (errors.join('\n') || '(none)'));
await browser.close();
