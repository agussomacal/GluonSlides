// ============================================================
// export/index.js — Clean export module bridge.
// Automatically saves HTML directly inside the project folder.
// ============================================================

import { state, pyApi } from '../core/state.js';
import { getExportHtmlString } from './html.js';
import { exportProjectPdf } from './pdf.js';
import { fontExportWarning } from '../core/fonts.js';
import { missingCitationKeys } from '../core/citations.js';

/**
 * Tells the user about fonts that were left out / may not be shareable,
 * and citations whose keys are not in the bibliography.
 */
function warnAboutFonts() {
    const parts = [];
    const fonts = fontExportWarning();
    if (fonts) parts.push(`Fonts in this export:\n\n${fonts}`);
    const missing = missingCitationKeys();
    if (missing.length) parts.push(`Citations not found in bibliography.bib (shown as [? key]):\n${missing.join(', ')}`);
    if (parts.length) alert(parts.join('\n\n'));
}

export async function projectExportHtml() {
    try {
        const htmlContent = await getExportHtmlString();
        const api = pyApi();

        if (!state.projectFolder) {
            alert('Please create or open a project folder first before exporting.');
            return;
        }

        const safeName = (state.projectName || 'presentation').replace(/[\s\\/:*?"<>|]+/g, '_');
        const res = await api.save_text_file(state.projectFolder, `${safeName}.html`, htmlContent);
        if (res.success) {
            warnAboutFonts();
            api.open_file_with_system(res.path);
        } else {
            alert(`HTML export failed: ${res.error}`);
        }
    } catch (e) {
        alert(`HTML export failed: ${e.message}`);
    }
}

export async function projectExportPdf() {
    const res = await exportProjectPdf();
    if (!res.ok) {
        alert(`PDF export failed: ${res.error}`);
        return;
    }
    warnAboutFonts();
    const api = pyApi();
    if (api && res.pdfPath) {
        api.open_file_with_system(res.pdfPath);
    }
}