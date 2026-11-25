// Shared bits for the end-to-end suites (see tests/README.md).
//
// Each suite is a standalone script: it opens the app in a headless
// Chrome/Chromium (driven by playwright-core), acts like a user and
// prints one line per check: "PASS <name>" or "FAIL <name> — details".
// run.mjs starts the web server and runs every suite.

import { existsSync, mkdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';

const HERE = dirname(fileURLToPath(import.meta.url));

/** Repository root (the app is served from here). */
export const REPO_DIR = resolve(HERE, '..', '..');

/** Where run.mjs serves the app (override with BASE_URL). */
export const BASE_URL = process.env.BASE_URL || 'http://127.0.0.1:8765';

/** Screenshots written by suites (ignored by git). */
export const OUT_DIR = join(HERE, 'output');
mkdirSync(OUT_DIR, { recursive: true });

/** Test .gl files kept in the repository. */
export const FIXTURES_DIR = join(HERE, 'fixtures');

const CHROME_CANDIDATES = [
    process.env.CHROME_PATH,
    '/usr/bin/google-chrome',
    '/usr/bin/google-chrome-stable',
    '/usr/bin/chromium',
    '/usr/bin/chromium-browser',
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/Applications/Chromium.app/Contents/MacOS/Chromium',
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
].filter(Boolean);

/** Path of an installed Chrome/Chromium (set CHROME_PATH to choose one). */
export function chromePath() {
    const found = CHROME_CANDIDATES.find(p => existsSync(p));
    if (!found) {
        throw new Error('No Chrome/Chromium found. Install one or set CHROME_PATH to its executable.');
    }
    return found;
}

/** A headless browser for one suite. */
export function launchBrowser() {
    return chromium.launch({ executablePath: chromePath(), headless: true });
}
