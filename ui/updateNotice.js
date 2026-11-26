// ============================================================
// ui/updateNotice.js — "A new version is available" (backend/updates.py).
//
// At start the backend asks GitHub for the latest release. If it is newer,
// a small card in the corner offers: Download (opens the release page),
// Skip this version, Don't check again, and × (just for now). Nothing is
// downloaded or installed by the app. The start screen shows the version
// and a checkbox to turn the check on or off.
// ============================================================

import { whenApiReady } from '../core/state.js';

function escapeText(s) {
    return String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
}

function showNotice(api, info) {
    document.getElementById('update-notice')?.remove();
    const card = document.createElement('div');
    card.id = 'update-notice';
    card.className = 'update-notice';
    card.setAttribute('role', 'status');
    card.innerHTML = `
        <button type="button" class="update-close" data-update="close" title="Close" aria-label="Close">×</button>
        <div class="update-title">GluonSlides ${escapeText(info.version)} is available</div>
        <div class="update-text">You have ${escapeText(info.current)}.</div>
        <div class="update-actions">
            <button type="button" class="btn btn-primary" data-update="download">Download</button>
            <button type="button" class="btn btn-secondary" data-update="skip">Skip this version</button>
        </div>
        <button type="button" class="update-link" data-update="never">Don't check for updates</button>`;
    card.addEventListener('click', async (e) => {
        const what = e.target.closest('[data-update]')?.dataset.update;
        if (!what) return;
        if (what === 'download') await api.open_url(info.url);
        if (what === 'skip') await api.set_update_preferences(null, info.version);
        if (what === 'never') {
            await api.set_update_preferences(false, null);
            syncCheckbox(false);
        }
        card.remove();
    });
    document.body.appendChild(card);
}

function syncCheckbox(on) {
    const box = document.getElementById('update-check-toggle');
    if (box) box.checked = on;
}

/** Version and the update-check checkbox on the start screen; the check itself. */
export async function initUpdateNotice() {
    const api = await whenApiReady(60000);
    if (!api || typeof api.check_for_update !== 'function') return;
    const footer = document.getElementById('welcome-footer');
    if (footer && typeof api.get_version === 'function') {
        const v = await api.get_version();
        footer.innerHTML = `
            <span>GluonSlides ${escapeText(v && v.version)}</span>
            <label class="update-toggle"><input type="checkbox" id="update-check-toggle"> Check for new versions at start</label>`;
        footer.querySelector('#update-check-toggle').addEventListener('change', (e) => {
            api.set_update_preferences(e.target.checked, null);
        });
    }
    const info = await api.check_for_update();
    syncCheckbox(Boolean(info && info.check));
    if (info && info.newer) showNotice(api, info);
}
