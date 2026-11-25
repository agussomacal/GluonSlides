// The .gl format: every test file in tests/e2e/fixtures/ (and, when
// present locally, the projects in Slides/) must parse, keep its content,
// and round-trip: saving what was read and reading it again gives the
// same text.
import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { join, relative } from 'node:path';
import { launchBrowser, BASE_URL, FIXTURES_DIR, REPO_DIR } from '../helpers.mjs';

function glFiles(dir) {
    if (!existsSync(dir)) return [];
    return readdirSync(dir, { withFileTypes: true }).flatMap(e => {
        const p = join(dir, e.name);
        if (e.isDirectory()) return glFiles(p);
        return e.name.endsWith('.gl') && e.name !== 'macros.gl' ? [p] : [];
    });
}

const browser = await launchBrowser();
const page = await browser.newPage();
const errors = [];
page.on('pageerror', e => errors.push('pageerror: ' + e.message));
const out = [];
const check = (n, c, x = '') => out.push(`${c ? 'PASS' : 'FAIL'} ${n}${x !== '' ? ' — ' + x : ''}`);
await page.goto(`${BASE_URL}/index.html`);
await page.waitForTimeout(400);

const parse = (text) => page.evaluate(async (text) => {
    const m = await import('/core/gl/glformat.js');
    try {
        const p = m.parseGl(text);
        const s1 = m.serializeGl({ ...p, projectName: p.name });
        const s2 = m.serializeGl({ ...m.parseGl(s1), projectName: p.name });
        return { project: JSON.parse(JSON.stringify(p)), stable: s1 === s2, saved: s1 };
    } catch (e) {
        return { error: e.message };
    }
}, text);

// Round-trip of every file
const files = [...glFiles(FIXTURES_DIR), ...glFiles(join(REPO_DIR, 'Slides'))];
for (const file of files) {
    const r = await parse(readFileSync(file, 'utf8'));
    check(`${relative(REPO_DIR, file)} round-trips`, r.stable === true, r.error || `${r.project?.slides.length} slides`);
}

// What the feature fixture must contain after reading
const all = await parse(readFileSync(join(FIXTURES_DIR, 'everything.gl'), 'utf8'));
const p = all.project;
const s1 = p.slides[0].elements;
const s2 = p.slides[1].elements;
check('imports', JSON.stringify(p.imports) === '["macros.gl"]');
check('palette in order', p.palette.map(c => c.name).join(',') === 'primary,accent,dark,light');
check('project defaults (typed numbers)', p.defaults.text.fontSize === 32 && p.defaults.text.fontFamily === 'EB Garamond' && p.defaults.path.stroke === '@dark');
check('named styles', p.styles.text.title.fontSize === 64 && p.styles.shape.card.bg === '@light');
check('macro definition in the project file', p.macros.length === 1 && p.macros[0].name === 'badge' && p.macros[0].children.map(c => c.name).join(',') === 'dot,label');
check('text body: escaped dot line and blank line kept',
    s1[0].content === 'Results with **Markdown** and math $E = mc^2$\n.a line starting with a dot (escaped in the file)\n\n# a heading after a blank line',
    JSON.stringify(s1[0].content));
check('style reference on elements', s1[0].style === 'title' && s1[1].style === 'card');
check('theme color with opacity', s1[2].bg === '@accent/40');
check('path points', JSON.stringify(s1[3].points) === '[[0,1],[0.5,0],[1,0.6]]' && s1[3].curve === 'smooth');
check('group children', s2[0].type === 'group' && s2[0].children.length === 2 && s2[0].children[1].content === 'Inside a group');
check('macro instance with overrides + extra', s2[2].type === 'macro' && s2[2].ref === 'badge'
    && JSON.stringify(s2[2].overrides) === JSON.stringify([{ target: 'label', props: {}, body: 'Hot' }, { target: 'dot', props: { bg: '@primary/80' } }])
    && s2[2].extras.length === 1);
check('speaker notes', p.slides[0].notes === 'Speaker notes: start with the **result**.\n.a notes line starting with a dot' && p.slides[1].notes === undefined, JSON.stringify(p.slides[0].notes));
check('master slide', p.masters.length === 1 && p.masters[0].name === 'Footer' && p.masters[0].elements[0].content === '\\slidenumber / \\totalslides'
    && p.slides[0].master === 'none' && p.slides[1].master === undefined);
check('sections', p.slides[0].section === undefined && p.slides[1].section === 'Building blocks');
check('author and date', p.author === 'Ada Lovelace' && p.date === 'today');
check('sections and header written back', all.saved.includes('.section {Building blocks}\n\n.slide {Groups and macros}') && all.saved.includes('author:"Ada Lovelace" date:today'));
check('build steps', s1[0].step === undefined && s1[2].step === 2 && s1[3].step === 3);
check('notes and steps written back', all.saved.includes('.slide {Title} id:1 master:none\n.notes\n\tSpeaker notes') && all.saved.includes('id:4 step:2 x:600'));
check('escaped dot written back escaped', all.saved.includes('\t\\.a line starting with a dot'));

// Old files: unindented bodies are read as bodies
const legacy = await parse(readFileSync(join(FIXTURES_DIR, 'legacy-unindented.gl'), 'utf8'));
check('legacy: unindented body read', legacy.project.slides[0].elements[0].content === 'Body text written without indentation,\nas older versions of the app saved it.\n- a list item');
check('legacy: saved with indentation', legacy.saved.includes('\tBody text written without indentation,'));

// Friendly errors
const bad = await parse('.project {X}\n.element.text id:1 x:0 y:0 width:1 height:1\n');
check('error for element before any slide', /before any \.slide/.test(bad.error || ''), bad.error);

console.log(out.join('\n'));
console.log('--- errors ---\n' + (errors.join('\n') || '(none)'));
await browser.close();
