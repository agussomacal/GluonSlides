// The start window: recent projects must appear however and whenever
// the Python bridge becomes ready.
//
// pywebview sets up its bridge in two steps: first `window.pywebview`
// with an EMPTY `api` object, later the api functions are added and the
// `pywebviewready` event fires. If the page starts in between, it must
// wait instead of giving up. Each scenario below fakes one timing.
import { launchBrowser, BASE_URL } from '../helpers.mjs';

const browser = await launchBrowser();
const out = [];
const errors = [];
const check = (n, c, x = '') => out.push(`${c ? 'PASS' : 'FAIL'} ${n}${x !== '' ? ' — ' + x : ''}`);

/**
 * Opens the start window with a fake bridge.
 *   stage1Ms  when window.pywebview (empty api) appears (null: at once)
 *   stage2Ms  when the functions are added (null: never)
 *   event     whether pywebviewready is dispatched at stage 2
 *   slowMs    how long get_recent_projects takes to answer
 *   failFirst get_recent_projects throws the first time
 */
async function openStart({ stage1Ms = null, stage2Ms = 0, event = true, slowMs = 0, failFirst = false, recents = null } = {}) {
    const page = await browser.newPage({ viewport: { width: 1300, height: 850 } });
    page.on('pageerror', e => errors.push('pageerror: ' + e.message));
    await page.addInitScript((cfg) => {
        const files = { '/p/Deck/Deck.gl': '.project {Deck}\n.slide {Hello} id:1\n' };
        window.__calls = [];
        let failed = false;
        const ok = (o = {}) => Promise.resolve({ success: true, ...o });
        const functions = {
            get_recent_projects: () => {
                window.__calls.push('get_recent_projects');
                if (cfg.failFirst && !failed) { failed = true; return Promise.reject(new Error('bridge not ready')); }
                const projects = cfg.recents || [{ name: 'Deck', path: '/p/Deck/Deck.gl' }, { name: 'Thesis', path: '/p/Thesis/Thesis.gl' }];
                return new Promise(r => setTimeout(() => r({ success: true, projects }), cfg.slowMs));
            },
            add_recent_project: () => ok(),
            load_project_at: (p) => files[p] ? ok({ path: p, content: files[p] }) : Promise.resolve({ success: false, error: 'not found' }),
            load_project: () => { window.__calls.push('load_project'); return Promise.resolve({ success: false, error: 'Cancelled' }); },
            load_text_file: () => Promise.resolve({ success: false }),
            save_text_file: () => ok(),
            save_project_data: () => ok(),
            get_inspector_settings: () => ok({ settings: null }),
            save_inspector_settings: () => ok(),
            list_project_fonts: () => ok({ fonts: [] }),
            list_system_fonts: () => ok({ families: [] }),
        };
        const stage1 = () => { window.pywebview = { api: {} }; };
        const stage2 = () => {
            if (!window.pywebview) stage1();
            Object.assign(window.pywebview.api, functions);
            if (cfg.event) window.dispatchEvent(new CustomEvent('pywebviewready'));
        };
        if (cfg.stage1Ms === null) stage1(); else setTimeout(stage1, cfg.stage1Ms);
        if (cfg.stage2Ms !== null) setTimeout(stage2, cfg.stage2Ms);
    }, { stage1Ms, stage2Ms, event, slowMs, failFirst, recents });
    await page.goto(`${BASE_URL}/index.html`);
    return page;
}

const recentNames = (page) => page.$$eval('#project-list .project-item', ns => ns.map(n => n.querySelector('span')?.textContent || n.textContent.trim()));
// A real recent project shows its path (messages like "Loading" don't).
const waitForRecents = (page, ms = 6000) => page.waitForFunction(
    () => document.querySelectorAll('#project-list .project-item-path').length > 0, null, { timeout: ms },
).then(() => true, () => false);

// 1. Bridge complete before the page starts
let page = await openStart({ stage2Ms: 0 });
check('bridge ready at start: recents listed', await waitForRecents(page) && (await recentNames(page)).join(',') === 'Deck,Thesis', (await recentNames(page)).join(','));
await page.close();

// 2. The intermittent case: empty api object at start, functions later
page = await openStart({ stage1Ms: null, stage2Ms: 800 });
check('empty api at start, ready 0.8 s later: recents listed', await waitForRecents(page), (await recentNames(page)).join(','));
await page.close();

// 3. Same, but the ready event is missed (only the functions appear)
page = await openStart({ stage1Ms: null, stage2Ms: 800, event: false });
check('functions appear without the ready event: recents listed', await waitForRecents(page), (await recentNames(page)).join(','));
await page.close();

// 4. No bridge object yet when the page starts
page = await openStart({ stage1Ms: 500, stage2Ms: 1200 });
check('bridge appears after the page starts: recents listed', await waitForRecents(page), (await recentNames(page)).join(','));
await page.close();

// 5. Slow answer: a loading message first, then the list
page = await openStart({ stage2Ms: 0, slowMs: 1500 });
await page.waitForTimeout(300);
const during = await page.textContent('#project-list');
check('slow answer: "Loading" shown meanwhile', during.includes('Loading'), during.trim());
check('slow answer: list arrives', await waitForRecents(page));
await page.close();

// 6. First call fails (bridge hiccup): retried
page = await openStart({ stage2Ms: 0, failFirst: true });
check('first call fails: retried and listed', await waitForRecents(page), (await page.evaluate(() => window.__calls)).join(','));
await page.close();

// 7. No bridge at all (browser preview): ends with "no recent projects"
page = await openStart({ stage1Ms: 999999, stage2Ms: null });
await page.waitForTimeout(3500);
const none = (await page.textContent('#project-list')).trim();
check('no bridge: says there are no recent projects', none.includes('No recent projects'), none);
await page.close();

// 8. Clicking a recent project opens it
page = await openStart({ stage2Ms: 0 });
await waitForRecents(page);
await page.click('#project-list .project-item >> text=Deck');
await page.waitForTimeout(400);
check('clicking a recent project opens it', await page.isVisible('#editor-view') && (await page.textContent('.thumb-label-row')).includes('Hello'));
await page.close();

// 9. "Open Project File..." pressed before the bridge is ready: waits for
//    it and shows the file dialog (does not fall back to the sample)
page = await openStart({ stage1Ms: null, stage2Ms: 1000 });
await page.click('[data-action="open-project"]');
await page.waitForTimeout(1800);
check('Open before the bridge is ready: file dialog, not the sample', (await page.evaluate(() => window.__calls)).includes('load_project') && !(await page.isVisible('#editor-view')));
await page.close();

// 10. Names in the list are shown as text, never as HTML
page = await openStart({ stage2Ms: 0, recents: [{ name: '<img src=x onerror="window.__xss=1">', path: '/p/X/X.gl' }] });
await waitForRecents(page);
check('recent names are escaped', (await page.evaluate(() => window.__xss)) === undefined && (await recentNames(page))[0].startsWith('<img'));
await page.close();

console.log(out.join('\n'));
console.log('--- errors ---\n' + (errors.join('\n') || '(none)'));
await browser.close();
