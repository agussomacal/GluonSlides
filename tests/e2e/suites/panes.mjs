// The side panes can be hidden (toolbar ◧ / ◨, Ctrl+Alt+1 / 2) to make room
// for the slide; the canvas then grows to fill the space, and the choice is
// remembered on the next start.
import { launchBrowser, BASE_URL } from '../helpers.mjs';

const browser = await launchBrowser();
const out = [];
const check = (n, c, x = '') => out.push(`${c ? 'PASS' : 'FAIL'} ${n}${x !== '' ? ' — ' + x : ''}`);
const errors = [];

const PROJECT = `.project {Panes} version:2 width:1920 height:1080 nextid:5
.slide {First} id:1
.element.text id:2 x:100 y:100 width:800 height:200
	Room to see
`;

const context = await browser.newContext({ viewport: { width: 1300, height: 850 } });
async function start() {
    const page = await context.newPage();
    page.on('pageerror', e => errors.push(e.message));
    await page.addInitScript((project) => {
        const ok = (o = {}) => Promise.resolve({ success: true, ...o });
        window.pywebview = { api: {
            get_startup_file: () => ok({ path: '/home/me/Panes.gl' }),
            load_project_at: () => ok({ content: project }),
            get_recent_projects: () => ok({ projects: [] }), add_recent_project: () => ok(),
            get_inspector_settings: () => ok({ settings: null }), save_inspector_settings: () => ok(),
            list_project_fonts: () => ok({ fonts: [] }), list_system_fonts: () => ok({ families: [] }),
            load_text_file: () => Promise.resolve({ success: false }), save_text_file: () => ok(),
            save_project_data: () => ok(), load_figure_data_uri: () => ok({ data_uri: '' }),
            read_clipboard: () => ok(), take_dropped_paths: () => ok({ paths: [] }),
        } };
        window.dispatchEvent(new Event('pywebviewready'));
    }, PROJECT);
    await page.goto(`${BASE_URL}/index.html`);
    await page.waitForTimeout(800);
    return page;
}
const canvasWidth = (page) => page.$eval('#slide-canvas', c => c.getBoundingClientRect().width);

let page = await start();
check('both panes shown at first', await page.isVisible('.slides-sidebar') && await page.isVisible('.properties-sidebar'));
const w0 = await canvasWidth(page);

await page.click('[data-action="toggle-pane"][data-arg="properties"]');
await page.waitForTimeout(200);
check('◨ hides the properties pane', !(await page.isVisible('.properties-sidebar')) && await page.isVisible('.slides-sidebar'));
const w1 = await canvasWidth(page);
check('the slide grows into the freed space', w1 > w0 + 50, `${Math.round(w0)} -> ${Math.round(w1)}`);
check('the button now offers to show it', (await page.getAttribute('[data-action="toggle-pane"][data-arg="properties"]', 'title')).startsWith('Show'));

await page.keyboard.press('Control+Alt+Digit1');
await page.waitForTimeout(200);
check('Ctrl+Alt+1 hides the slides pane', !(await page.isVisible('.slides-sidebar')));
const w2 = await canvasWidth(page);
check('…and the slide grows again', w2 > w1 + 50, `${Math.round(w1)} -> ${Math.round(w2)}`);
const r = await page.$eval('#slide-canvas', c => { const a = c.getBoundingClientRect(), b = document.getElementById('workspace-area').getBoundingClientRect(); return [a.left - b.left, b.right - a.right]; });
check('the slide stays centred', Math.abs(r[0] - r[1]) <= 2, JSON.stringify(r.map(Math.round)));
await page.close();

// ---------- widths: drag the inner edge ----------
page = await start();
await page.keyboard.press('Control+Alt+Digit1'); // (both were left hidden above)
await page.keyboard.press('Control+Alt+Digit2');
await page.waitForTimeout(200);
const paneW = (sel) => page.$eval(sel, n => n.getBoundingClientRect().width);
const handle = async (name) => page.$eval(`.pane-resizer[data-pane="${name}"]`, n => { const r = n.getBoundingClientRect(); return [r.x + r.width / 2, r.y + 200]; });
let [hx, hy] = await handle('slides');
const before = await paneW('.slides-sidebar');
await page.mouse.move(hx, hy); await page.mouse.down();
await page.mouse.move(hx + 120, hy, { steps: 5 }); await page.mouse.up();
await page.waitForTimeout(200);
const wider = await paneW('.slides-sidebar');
check('dragging the slides pane edge widens it', Math.abs(wider - before - 120) < 6, `${Math.round(before)} -> ${Math.round(wider)}`);
[hx, hy] = await handle('properties');
const pBefore = await paneW('.properties-sidebar');
await page.mouse.move(hx, hy); await page.mouse.down();
await page.mouse.move(hx + 80, hy, { steps: 5 }); await page.mouse.up();
await page.waitForTimeout(200);
check('…and the properties pane narrower from its left edge', Math.abs(pBefore - (await paneW('.properties-sidebar')) - 80) < 6);
await page.close();
page = await start();
await page.waitForTimeout(200);
check('widths are remembered', Math.abs((await paneW('.slides-sidebar')) - wider) < 3);
[hx, hy] = await handle('slides');
await page.mouse.move(hx, hy); await page.mouse.down();
await page.mouse.move(40, hy, { steps: 5 }); await page.mouse.up();
await page.waitForTimeout(200);
check('dragged nearly shut: the pane is hidden', !(await page.isVisible('.slides-sidebar')));
await page.keyboard.press('Control+Alt+Digit1');
await page.waitForTimeout(200);
check('shown again: at the width it had', Math.abs((await paneW('.slides-sidebar')) - wider) < 3);
await page.dblclick('.pane-resizer[data-pane="slides"]');
await page.waitForTimeout(200);
check('double-click: the usual width', Math.abs((await paneW('.slides-sidebar')) - 260) < 3, await paneW('.slides-sidebar'));
await page.keyboard.press('Control+Alt+Digit1');
await page.keyboard.press('Control+Alt+Digit2');
await page.close();

page = await start();
check('hidden panes are remembered', !(await page.isVisible('.slides-sidebar')) && !(await page.isVisible('.properties-sidebar')));
await page.keyboard.press('Control+Alt+Digit1');
await page.keyboard.press('Control+Alt+Digit2');
await page.waitForTimeout(200);
check('and come back with the shortcuts', await page.isVisible('.slides-sidebar') && await page.isVisible('.properties-sidebar'));
await page.close();

console.log(out.join('\n'));
console.log('--- errors ---\n' + (errors.join('\n') || '(none)'));
await browser.close();
