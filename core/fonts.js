// ============================================================
// core/fonts.js — Fonts for text elements.
//
//   Generic      sans-serif, serif, monospace (the reader's defaults)
//   Built-in     open fonts shipped in libs/fonts (dependencies.yaml)
//   Project      font files in <project>/fonts/ (travel with the project)
//   This computer  installed fonts (listed by the Python side)
//
// Built-in and project fonts are registered with @font-face; exports
// embed every non-generic font the project uses, so the HTML/PDF look
// the same on any computer.
// ============================================================

import { state, pyApi } from './state.js';

const FONT_DIR = 'libs/fonts';

export const GENERIC_FONTS = [
    { family: 'sans-serif', label: 'Sans-serif (default)' },
    { family: 'serif', label: 'Serif (default)' },
    { family: 'monospace', label: 'Monospace (default)' },
];

// id = Fontsource file prefix; italic: whether italic files exist.
export const BUILTIN_FONTS = [
    { family: 'Inter', id: 'inter', category: 'sans-serif' },
    { family: 'Roboto', id: 'roboto', category: 'sans-serif' },
    { family: 'Lato', id: 'lato', category: 'sans-serif' },
    { family: 'Open Sans', id: 'open-sans', category: 'sans-serif' },
    { family: 'Source Sans 3', id: 'source-sans-3', category: 'sans-serif' },
    { family: 'Montserrat', id: 'montserrat', category: 'sans-serif' },
    { family: 'Merriweather', id: 'merriweather', category: 'serif' },
    { family: 'Source Serif 4', id: 'source-serif-4', category: 'serif' },
    { family: 'EB Garamond', id: 'eb-garamond', category: 'serif' },
    { family: 'Playfair Display', id: 'playfair-display', category: 'serif' },
    { family: 'Computer Modern', id: 'katex-main', category: 'serif' },
    { family: 'Fira Code', id: 'fira-code', category: 'monospace', italic: false },
    { family: 'JetBrains Mono', id: 'jetbrains-mono', category: 'monospace' },
];

const GENERIC = new Set(GENERIC_FONTS.map(f => f.family));
let projectFaces = [];     // [{ family, weight, style, data_uri, file, license }]
let systemFamilies = null; // [family] once loaded
const systemLicenses = new Map(); // family -> licence info (cache)

const BUNDLED_LICENSE = {
    name: 'Open licence (SIL OFL / Apache), bundled with GluonSlides',
    url: 'https://openfontlicense.org',
    open: true,
    embeddable: true,
};

/**
 * Licence of a font: { name, url, open, embeddable, source } or null
 * for the generic defaults. Fonts from this computer are looked up by
 * the Python side (cached).
 */
export async function fontLicense(family) {
    if (!family || GENERIC.has(family)) return null;
    if (BUILTIN_FONTS.some(f => f.family === family)) return { ...BUNDLED_LICENSE, source: 'built-in' };
    const face = projectFaces.find(f => f.family === family);
    if (face) return { ...(face.license || {}), source: 'project' };
    if (systemLicenses.has(family)) return systemLicenses.get(family);
    const api = pyApi();
    let info = { name: '', url: '', open: false, embeddable: true, source: 'system', unknown: true };
    if (api && typeof api.system_font_license === 'function') {
        try {
            const res = await api.system_font_license(family);
            if (res && res.success) info = { ...res.license, source: 'system' };
        } catch (e) {
            // keep "unknown"
        }
    }
    systemLicenses.set(family, info);
    return info;
}

// What the last export embedded (see fontExportReport).
let exportReport = { skipped: [], notOpen: [] };

/** Files of a built-in font: [{ weight, style, url }]. */
function builtinFaces(font) {
    if (font.id === 'katex-main') {
        return [
            { weight: 400, style: 'normal', url: `${FONT_DIR}/KaTeX_Main-Regular.woff2` },
            { weight: 400, style: 'italic', url: `${FONT_DIR}/KaTeX_Main-Italic.woff2` },
            { weight: 700, style: 'normal', url: `${FONT_DIR}/KaTeX_Main-Bold.woff2` },
            { weight: 700, style: 'italic', url: `${FONT_DIR}/KaTeX_Main-BoldItalic.woff2` },
        ];
    }
    const styles = font.italic === false ? ['normal'] : ['normal', 'italic'];
    return [400, 700].flatMap(weight => styles.map(style => ({
        weight, style, url: `${FONT_DIR}/${font.id}-latin-${weight}-${style}.woff2`,
    })));
}

function fontFaceRule(family, { weight, style, url }) {
    const name = family.replace(/["\\]/g, '');
    return `@font-face { font-family: "${name}"; src: url("${url}"); font-weight: ${weight}; font-style: ${style}; font-display: swap; }`;
}

function projectFamilies() {
    return [...new Set(projectFaces.map(f => f.family))].sort((a, b) => a.localeCompare(b));
}

/** (Re)registers built-in and project fonts with the page. */
function installFontFaces() {
    let tag = document.getElementById('gl-font-faces');
    if (!tag) {
        tag = document.createElement('style');
        tag.id = 'gl-font-faces';
        document.head.appendChild(tag);
    }
    tag.textContent = [
        ...BUILTIN_FONTS.flatMap(f => builtinFaces(f).map(face => fontFaceRule(f.family, face))),
        ...projectFaces.map(f => fontFaceRule(f.family, { weight: f.weight, style: f.style, url: f.data_uri })),
    ].join('\n');
}

/**
 * CSS font-family value for a chosen font: the quoted name plus a
 * fallback of the same kind (used on the canvas and in exports).
 */
export function fontStack(family) {
    const name = String(family || 'sans-serif').trim();
    if (GENERIC.has(name)) return name;
    const builtin = BUILTIN_FONTS.find(f => f.family === name);
    const fallback = builtin ? builtin.category : 'sans-serif';
    return `"${name.replace(/["\\;{}<>]/g, '')}", ${fallback}`;
}

/** Font choices for the dropdown: [{ label, fonts: [{ family, label }] }]. */
export function fontGroups() {
    const groups = [
        { label: 'Default', fonts: GENERIC_FONTS },
        { label: 'Built-in', fonts: BUILTIN_FONTS.map(f => ({ family: f.family, label: f.family })) },
    ];
    const project = projectFamilies();
    if (project.length) groups.push({ label: 'Project fonts', fonts: project.map(f => ({ family: f, label: f })) });
    if (systemFamilies && systemFamilies.length) {
        groups.push({ label: 'This computer', fonts: systemFamilies.map(f => ({ family: f, label: f })) });
    }
    return groups;
}

export function systemFontsLoaded() {
    return systemFamilies !== null;
}

/** Loads <project>/fonts/ (call when a project opens or fonts are added). */
export async function loadProjectFonts() {
    const api = pyApi();
    projectFaces = [];
    if (api && state.projectFolder && typeof api.list_project_fonts === 'function') {
        try {
            const res = await api.list_project_fonts(state.projectFolder);
            if (res && res.success) projectFaces = res.fonts || [];
        } catch (e) {
            console.warn('Could not load project fonts:', e);
        }
    }
    installFontFaces();
}

/** Asks for font files and copies them into <project>/fonts/. */
export async function importProjectFonts() {
    const api = pyApi();
    if (!api || !state.projectFolder) return { success: false, error: 'Open a project first.' };
    const res = await api.import_font_files(state.projectFolder);
    if (res && res.success) {
        projectFaces = res.fonts || [];
        installFontFaces();
    }
    return res || { success: false, error: 'Import failed' };
}

/** Lists fonts installed on this computer (once). */
export async function loadSystemFonts() {
    const api = pyApi();
    if (!api || typeof api.list_system_fonts !== 'function') {
        systemFamilies = [];
        return systemFamilies;
    }
    try {
        const res = await api.list_system_fonts();
        systemFamilies = res && res.success ? res.families : [];
    } catch (e) {
        systemFamilies = [];
    }
    return systemFamilies;
}

// ---------- Export ----------

/** Every font family used by text in the project (slides and macros). */
function usedFamilies() {
    const used = new Set();
    const visit = (elements) => (elements || []).forEach(el => {
        if (el.fontFamily) used.add(String(el.fontFamily));
        visit(el.children);
        visit(el.extras);
        (el.overrides || []).forEach(o => { if (o.props && o.props.fontFamily) used.add(String(o.props.fontFamily)); });
    });
    state.slides.forEach(s => visit(s.elements));
    Object.values(state.macros || {}).forEach(m => visit(m.children));
    return [...used].filter(f => !GENERIC.has(f));
}

async function urlToDataUri(url) {
    const blob = await (await fetch(url)).blob();
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result).replace(/^data:[^;]*;/, 'data:font/woff2;'));
        reader.onerror = reject;
        reader.readAsDataURL(blob);
    });
}

/**
 * @font-face rules, with the font files embedded as data URIs, for the
 * fonts the project uses — so exported HTML/PDF need no installed fonts.
 */
export async function exportFontCss() {
    const rules = [];
    const api = pyApi();
    exportReport = { skipped: [], notOpen: [] };
    for (const family of usedFamilies()) {
        // Never embed a font whose licence forbids it; note non-open ones.
        const license = await fontLicense(family);
        if (license && license.embeddable === false) {
            exportReport.skipped.push(family);
            continue;
        }
        if (license && !license.open) exportReport.notOpen.push(family);
        const builtin = BUILTIN_FONTS.find(f => f.family === family);
        try {
            if (builtin) {
                for (const face of builtinFaces(builtin)) {
                    rules.push(fontFaceRule(family, { ...face, url: await urlToDataUri(face.url) }));
                }
                continue;
            }
            const embeddable = (f) => !(f.license && f.license.embeddable === false);
            const faces = projectFaces.filter(f => f.family === family);
            if (faces.length) {
                faces.filter(embeddable).forEach(f => rules.push(fontFaceRule(family, { weight: f.weight, style: f.style, url: f.data_uri })));
                continue;
            }
            if (api && typeof api.system_font_faces === 'function') {
                const res = await api.system_font_faces(family);
                (res && res.success ? res.fonts : []).filter(embeddable).forEach(f =>
                    rules.push(fontFaceRule(family, { weight: f.weight, style: f.style, url: f.data_uri })));
            }
        } catch (e) {
            console.warn(`Could not embed font ${family}:`, e);
        }
    }
    return rules.join('\n');
}

/**
 * After an export: fonts left out because their licence forbids
 * embedding, and embedded fonts without a recognised open licence.
 */
export function fontExportReport() {
    return exportReport;
}

/** Text for an export warning, or '' when every font is fine. */
export function fontExportWarning() {
    const { skipped, notOpen } = exportReport;
    const parts = [];
    if (skipped.length) {
        parts.push(`Not embedded — the licence forbids it, viewers will see a fallback font: ${skipped.join(', ')}.`);
    }
    if (notOpen.length) {
        parts.push(`Embedded without a recognised open licence (check you may share them): ${notOpen.join(', ')}.`);
    }
    return parts.join('\n\n');
}

// Built-in fonts are available from the start.
installFontFaces();
