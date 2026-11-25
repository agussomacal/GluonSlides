// Runs the end-to-end suites: starts a local web server for the app,
// runs every suite (or the ones named on the command line) and prints a
// summary. Exit code 1 if any check fails or a suite crashes.
//
//   npm test                      all suites
//   npm test -- macros paths      only these
//   npm test -- --verbose         also print every check

import { spawn } from 'node:child_process';
import { readdirSync } from 'node:fs';
import { createServer } from 'node:net';
import { join } from 'node:path';
import { REPO_DIR } from './helpers.mjs';

const SUITES_DIR = join(REPO_DIR, 'tests', 'e2e', 'suites');
const args = process.argv.slice(2);
const verbose = args.includes('--verbose');
const wanted = args.filter(a => !a.startsWith('--'));

/** A free TCP port on localhost. */
function freePort() {
    return new Promise((resolvePort, reject) => {
        const srv = createServer();
        srv.unref();
        srv.on('error', reject);
        srv.listen(0, '127.0.0.1', () => {
            const { port } = srv.address();
            srv.close(() => resolvePort(port));
        });
    });
}

async function waitForServer(url, timeoutMs = 10000) {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
        try {
            const res = await fetch(url);
            if (res.ok) return;
        } catch {
            // not up yet
        }
        await new Promise(r => setTimeout(r, 150));
    }
    throw new Error(`Web server did not start at ${url}`);
}

function runSuite(file, baseUrl) {
    return new Promise((resolveRun) => {
        const child = spawn(process.execPath, [join(SUITES_DIR, file)], {
            cwd: REPO_DIR,
            env: { ...process.env, BASE_URL: baseUrl },
        });
        let output = '';
        child.stdout.on('data', d => { output += d; });
        child.stderr.on('data', d => { output += d; });
        const timer = setTimeout(() => child.kill('SIGKILL'), 180000);
        child.on('close', (code) => {
            clearTimeout(timer);
            resolveRun({ code, output });
        });
    });
}

/** Counts PASS/FAIL lines and page errors reported after "--- errors ---". */
function summarize({ code, output }) {
    const lines = output.split('\n');
    const passed = lines.filter(l => l.startsWith('PASS ')).length;
    const failed = lines.filter(l => l.startsWith('FAIL '));
    const errIdx = lines.indexOf('--- errors ---');
    const pageErrors = errIdx >= 0
        ? lines.slice(errIdx + 1).filter(l => l.trim() && l.trim() !== '(none)')
        : [];
    const crashed = code !== 0 && failed.length === 0;
    return { passed, failed, pageErrors, crashed, ok: code === 0 && !failed.length && !pageErrors.length };
}

const suites = readdirSync(SUITES_DIR)
    .filter(f => f.endsWith('.mjs'))
    .filter(f => !wanted.length || wanted.includes(f.replace(/\.mjs$/, '')))
    .sort();
if (!suites.length) {
    console.error(`No suites match: ${wanted.join(', ')}`);
    process.exit(1);
}

const port = await freePort();
const baseUrl = `http://127.0.0.1:${port}`;
const python = process.platform === 'win32' ? 'python' : 'python3';
const server = spawn(python, ['-m', 'http.server', String(port), '--bind', '127.0.0.1'], {
    cwd: REPO_DIR, stdio: 'ignore',
});

let allOk = true;
let total = 0;
try {
    await waitForServer(`${baseUrl}/index.html`);
    console.log(`Serving the app at ${baseUrl}; running ${suites.length} suite(s)\n`);
    for (const file of suites) {
        const name = file.replace(/\.mjs$/, '');
        const started = Date.now();
        const result = await runSuite(file, baseUrl);
        const s = summarize(result);
        total += s.passed;
        allOk = allOk && s.ok;
        const secs = ((Date.now() - started) / 1000).toFixed(1);
        const status = s.ok ? 'ok  ' : 'FAIL';
        console.log(`${status} ${name.padEnd(17)} ${String(s.passed).padStart(3)} passed`
            + `${s.failed.length ? `, ${s.failed.length} failed` : ''}  (${secs}s)`);
        if (verbose) result.output.split('\n').filter(l => /^(PASS|FAIL) /.test(l)).forEach(l => console.log(`       ${l}`));
        s.failed.forEach(l => console.log(`       ${l}`));
        s.pageErrors.forEach(l => console.log(`       page error: ${l}`));
        if (s.crashed) console.log(result.output.split('\n').slice(-15).map(l => `       ${l}`).join('\n'));
    }
} finally {
    server.kill();
}

console.log(`\n${allOk ? 'All suites passed' : 'Some suites FAILED'} (${total} checks passed)`);
process.exit(allOk ? 0 : 1);
