// ============================================================
// editor/inspector/settings.js — Inspector settings: defaults,
// validation, persistence (Python user config + localStorage
// fallback), applying them as CSS variables, and the settings
// popover UI.
// ============================================================

import { pyApi } from '../../core/state.js';

const STORAGE_KEY = 'gluon_gl_inspector_settings_v1';
export const MIN_DRAWER_HEIGHT = 140;

const DEFAULT_SETTINGS = {
    tabSize: 2,
    fontSize: 13,
    lineHeight: 20,
    drawerHeight: 280,
    autoApply: true,
    colors: {
        directiveStruct: '#c084fc',
        directiveElement: '#38bdf8',
        braceArg: '#fbbf24',
        paramKey: '#a5b4fc',
        paramNum: '#fdba74',
        paramColor: '#2dd4bf',
        paramStr: '#86efac',
        paramVal: '#cbd5e1',
        bodyText: '#f1f5f9',
        bodyMath: '#f472b6',
        comment: '#64748b',
    },
};

const TOKEN_COLOR_FIELDS = [
    { key: 'directiveStruct', label: 'Structural (.project, .slide)', cssVar: '--gl-tok-directive-struct' },
    { key: 'directiveElement', label: 'Element (.element.*)', cssVar: '--gl-tok-directive-element' },
    { key: 'braceArg', label: 'Brace args ({Title})', cssVar: '--gl-tok-brace-arg' },
    { key: 'paramKey', label: 'Parameter keys (id:, x:)', cssVar: '--gl-tok-param-key' },
    { key: 'paramNum', label: 'Numbers', cssVar: '--gl-tok-param-num' },
    { key: 'paramColor', label: 'Colors (#hex)', cssVar: '--gl-tok-param-color' },
    { key: 'paramStr', label: 'Strings ("...")', cssVar: '--gl-tok-param-str' },
    { key: 'paramVal', label: 'Other values', cssVar: '--gl-tok-param-val' },
    { key: 'bodyText', label: 'Body content text', cssVar: '--gl-tok-body-text' },
    { key: 'bodyMath', label: 'Math ($...$)', cssVar: '--gl-tok-body-math' },
    { key: 'comment', label: 'Comments (#)', cssVar: '--gl-tok-comment' },
];

const HEX_COLOR_RE = /^#[0-9a-fA-F]{6}$/;

let settings = sanitize(readLocalStorage());

export function getSettings() {
    return settings;
}

export function maxDrawerHeight() {
    return Math.max(MIN_DRAWER_HEIGHT, Math.round(window.innerHeight * 0.8));
}

function clampNumber(value, min, max, fallback) {
    const n = Number(value);
    return Math.max(min, Math.min(max, Number.isFinite(n) ? n : fallback));
}

function sanitize(parsed) {
    const p = parsed && typeof parsed === 'object' ? parsed : {};
    const colors = {};
    for (const { key } of TOKEN_COLOR_FIELDS) {
        const c = p.colors && p.colors[key];
        colors[key] = typeof c === 'string' && HEX_COLOR_RE.test(c) ? c : DEFAULT_SETTINGS.colors[key];
    }
    return {
        tabSize: clampNumber(p.tabSize, 1, 16, DEFAULT_SETTINGS.tabSize),
        fontSize: clampNumber(p.fontSize, 10, 28, DEFAULT_SETTINGS.fontSize),
        lineHeight: clampNumber(p.lineHeight, 14, 42, DEFAULT_SETTINGS.lineHeight),
        drawerHeight: clampNumber(p.drawerHeight, MIN_DRAWER_HEIGHT, maxDrawerHeight(), DEFAULT_SETTINGS.drawerHeight),
        autoApply: p.autoApply !== undefined ? !!p.autoApply : DEFAULT_SETTINGS.autoApply,
        colors,
    };
}

function readLocalStorage() {
    try {
        const raw = localStorage.getItem(STORAGE_KEY);
        return raw ? JSON.parse(raw) : null;
    } catch {
        return null;
    }
}

function writeLocalStorage() {
    try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
    } catch {
        // Ignore quota / disabled storage.
    }
}

/** Merges `patch` into the settings, validates and persists them. */
export function updateSettings(patch) {
    settings = sanitize({ ...settings, ...patch, colors: { ...settings.colors, ...(patch.colors || {}) } });
    saveSettings();
    return settings;
}

export function resetSettings() {
    settings = sanitize(null);
    saveSettings();
    return settings;
}

export function saveSettings() {
    writeLocalStorage();
    const api = pyApi();
    if (api && typeof api.save_inspector_settings === 'function') {
        Promise.resolve(api.save_inspector_settings(JSON.stringify(settings))).catch(() => {});
    }
}

/** Loads settings from the Python user config (falls back to localStorage). */
export async function loadSettings() {
    const api = pyApi();
    if (api && typeof api.get_inspector_settings === 'function') {
        try {
            const res = await api.get_inspector_settings();
            if (res && res.success && res.settings && typeof res.settings === 'object') {
                settings = sanitize(res.settings);
                writeLocalStorage();
                return settings;
            }
        } catch {
            // Fall back to localStorage below.
        }
    }
    settings = sanitize(readLocalStorage());
    return settings;
}

/** Applies size + color settings to the drawer as CSS variables. */
export function applySettingsToDrawer(drawer) {
    if (!drawer) return;
    const { tabSize, fontSize, lineHeight, drawerHeight, colors } = settings;
    drawer.style.setProperty('--gl-tab-size', String(tabSize));
    drawer.style.setProperty('--gl-font-size', `${fontSize}px`);
    drawer.style.setProperty('--gl-line-height', `${lineHeight}px`);
    drawer.style.height = `${drawerHeight}px`;
    for (const field of TOKEN_COLOR_FIELDS) {
        drawer.style.setProperty(field.cssVar, colors[field.key]);
    }
}

// ---------- Settings popover ----------

function popoverHtml() {
    const colorRows = TOKEN_COLOR_FIELDS.map(field => `
        <div class="gl-settings-row">
            <label for="gl-set-color-${field.key}">${field.label}</label>
            <input type="color" id="gl-set-color-${field.key}" data-color-key="${field.key}" />
        </div>`).join('');

    return `
        <div class="gl-settings-header">
            <span>Inspector & Highlight Settings</span>
            <button type="button" data-role="close" title="Close settings">✕</button>
        </div>
        <div class="gl-settings-scroll">
            <div>
                <div class="gl-settings-section-title">Editor Properties</div>
                <div class="gl-settings-row">
                    <label for="gl-set-tab-size">Tab size (spaces)</label>
                    <input type="number" id="gl-set-tab-size" data-setting="tabSize" min="1" max="16" step="1" />
                </div>
                <div class="gl-settings-row">
                    <label for="gl-set-font-size">Font size (px)</label>
                    <input type="number" id="gl-set-font-size" data-setting="fontSize" min="10" max="28" step="1" />
                </div>
                <div class="gl-settings-row">
                    <label for="gl-set-line-height">Line height (px)</label>
                    <input type="number" id="gl-set-line-height" data-setting="lineHeight" min="14" max="42" step="1" />
                </div>
                <div class="gl-settings-row">
                    <label for="gl-set-auto-apply">Auto-apply edits while typing</label>
                    <input type="checkbox" id="gl-set-auto-apply" />
                </div>
            </div>
            <div>
                <div class="gl-settings-section-title">Syntax Highlight Colors</div>
                ${colorRows}
            </div>
        </div>
        <div class="gl-settings-footer">
            <button type="button" data-role="reset">Reset Defaults</button>
        </div>`;
}

/**
 * Builds the settings popover and appends it to <body>.
 * `onChange()` runs after every change so the owner can re-apply.
 */
export function createSettingsPopover(id, { onChange }) {
    const popover = document.createElement('div');
    popover.id = id;
    popover.className = 'gl-settings-popover';
    popover.innerHTML = popoverHtml();
    document.body.appendChild(popover);

    const autoApplyInput = popover.querySelector('#gl-set-auto-apply');

    function syncControls() {
        popover.querySelectorAll('input[data-setting]').forEach(input => {
            input.value = String(settings[input.dataset.setting]);
        });
        autoApplyInput.checked = settings.autoApply;
        popover.querySelectorAll('input[data-color-key]').forEach(picker => {
            picker.value = settings.colors[picker.dataset.colorKey];
        });
    }

    popover.querySelectorAll('input[data-setting]').forEach(input => {
        input.addEventListener('input', () => {
            if (input.value === '') return;
            updateSettings({ [input.dataset.setting]: Number(input.value) });
            onChange();
        });
        input.addEventListener('change', syncControls); // show clamped value
    });

    autoApplyInput.addEventListener('change', () => {
        updateSettings({ autoApply: autoApplyInput.checked });
        onChange();
    });

    popover.querySelectorAll('input[data-color-key]').forEach(picker => {
        picker.addEventListener('input', () => {
            updateSettings({ colors: { [picker.dataset.colorKey]: picker.value } });
            onChange();
        });
    });

    popover.querySelector('[data-role="reset"]').addEventListener('click', () => {
        resetSettings();
        syncControls();
        onChange();
    });

    let open = false;
    const api = {
        element: popover,
        isOpen: () => open,
        setOpen(next, { anchorBottom = 0 } = {}) {
            open = !!next;
            popover.classList.toggle('open', open);
            if (open) {
                syncControls();
                popover.style.bottom = `${anchorBottom + 10}px`;
            }
        },
    };
    popover.querySelector('[data-role="close"]').addEventListener('click', () => api.setOpen(false));
    return api;
}
