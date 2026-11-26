// "A new version is available": shown when the backend reports a newer
// release, with Download / Skip this version / Don't check / ×; the start
// screen shows the version and a checkbox for the check. GitHub is faked.
import { launchBrowser, BASE_URL } from '../helpers.mjs';

const browser = await launchBrowser();
const out = [];
const check = (n, c, x = '') => out.push(`${c ? 'PASS' : 'FAIL'} ${n}${x !== '' ? ' — ' + x : ''}`);
const errors = [];

async function start(update) {
    const page = await browser.newPage({ viewport: { width: 1300, height: 850 } });
    page.on('pageerror', e => errors.push(e.message));
    await page.addInitScript((update) => {
        window.__calls = [];
        const ok = (o = {}) => Promise.resolve({ success: true, ...o });
        window.pywebview = { api: {
            get_version: () => ok({ version: '0.2.1' }),
            check_for_update: () => ok(update),
            set_update_preferences: (check, skipped) => { window.__calls.push(['prefs', check, skipped]); return ok(); },
            open_url: (url) => { window.__calls.push(['open', url]); return ok(); },
            get_startup_file: () => ok({ path: null }),
            get_recent_projects: () => ok({ projects: [] }),
            get_inspector_settings: () => ok({ settings: null }), save_inspector_settings: () => ok(),
            list_system_fonts: () => ok({ families: [] }),
        } };
        window.dispatchEvent(new Event('pywebviewready'));
    }, update);
    await page.goto(`${BASE_URL}/index.html`);
    await page.waitForTimeout(700);
    return page;
}

const NEWER = { current: '0.2.1', newer: true, check: true, version: '0.3.0', url: 'https://github.com/x/releases/tag/v0.3.0' };

let page = await start(NEWER);
check('a newer release: the notice shows the versions', await page.isVisible('#update-notice')
    && (await page.textContent('#update-notice')).includes('0.3.0 is available') && (await page.textContent('#update-notice')).includes('You have 0.2.1'));
check('start screen: version and the checkbox (on)', (await page.textContent('#welcome-footer')).includes('GluonSlides 0.2.1') && await page.isChecked('#update-check-toggle'));
await page.click('#update-notice [data-update="download"]');
check('Download opens the release page, closes the notice', JSON.stringify(await page.evaluate(() => window.__calls)) === JSON.stringify([['open', NEWER.url]]) && !(await page.$('#update-notice')));
await page.close();

page = await start(NEWER);
await page.click('#update-notice [data-update="skip"]');
check('Skip this version remembers 0.3.0', JSON.stringify(await page.evaluate(() => window.__calls)) === '[["prefs",null,"0.3.0"]]');
await page.close();

page = await start(NEWER);
await page.click('#update-notice [data-update="never"]');
check('"Don\'t check" turns the check off and unticks the box', JSON.stringify(await page.evaluate(() => window.__calls)) === '[["prefs",false,null]]' && !(await page.isChecked('#update-check-toggle')));
await page.close();

page = await start(NEWER);
await page.click('#update-notice [data-update="close"]');
check('× just closes it', !(await page.$('#update-notice')) && (await page.evaluate(() => window.__calls)).length === 0);
await page.click('#update-check-toggle');
check('the checkbox turns the check off', JSON.stringify(await page.evaluate(() => window.__calls)) === '[["prefs",false,null]]');
await page.close();

page = await start({ current: '0.2.1', newer: false, check: true });
check('up to date: no notice', !(await page.$('#update-notice')));
await page.close();

console.log(out.join('\n'));
console.log('--- errors ---\n' + (errors.join('\n') || '(none)'));
await browser.close();
