// ============================================================
// editor/toolbar.js — Builds the "add element" toolbar from the
// element registry. Each element declares a `category` and may list
// `variants` (presets of the same type). A category with a single
// entry becomes a plain button; several entries become a dropdown.
// ============================================================

import { ElementRegistry } from '../core/registry.js';
import { escapeHtml } from '../core/render.js';

// Toolbar order and labels for categories with several entries.
// Unknown categories are appended after these, in registration order.
const CATEGORIES = [
    { id: 'text', label: 'Text', icon: '📝' },
    { id: 'shapes', label: 'Shapes', icon: '⬛' },
    { id: 'lines', label: 'Lines & curves', icon: '〰️' },
    { id: 'media', label: 'Media', icon: '🖼️' },
];

/** Toolbar entries ({ type, variant, label, icon }) grouped by category id. */
function entriesByCategory() {
    const groups = new Map(CATEGORIES.map(c => [c.id, []]));
    ElementRegistry.types()
        .filter(def => def.toolbar !== false)
        .forEach(def => {
            const category = def.category || def.type;
            if (!groups.has(category)) groups.set(category, []);
            const variants = Array.isArray(def.variants) && def.variants.length
                ? def.variants.map(v => ({ type: def.type, variant: v.id, label: v.label, icon: v.icon || def.icon }))
                : [{ type: def.type, variant: null, label: def.label.replace(/^Add\s+/i, ''), icon: def.icon }];
            groups.get(category).push(...variants);
        });
    return groups;
}

function closeMenus(except = null) {
    document.querySelectorAll('.toolbar-dropdown.open').forEach(d => {
        if (d !== except) d.classList.remove('open');
    });
}

document.addEventListener('click', (e) => {
    if (!e.target.closest('.toolbar-dropdown')) closeMenus();
});
document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') closeMenus();
});

/**
 * (Re)builds the add-element controls inside `container`.
 * `onAdd(type, variantId)` creates the element.
 */
export function renderAddElementToolbar(container, onAdd) {
    container.querySelectorAll('[data-role="add-element"]').forEach(n => n.remove());

    for (const [categoryId, entries] of entriesByCategory()) {
        if (entries.length === 0) continue;

        if (entries.length === 1) {
            const e = entries[0];
            const btn = document.createElement('button');
            btn.className = 'toolbar-btn';
            btn.dataset.role = 'add-element';
            btn.dataset.type = e.type;
            btn.innerHTML = `<span>${e.icon}</span> ${escapeHtml(e.label)}`;
            btn.addEventListener('click', () => onAdd(e.type, e.variant));
            container.appendChild(btn);
            continue;
        }

        const meta = CATEGORIES.find(c => c.id === categoryId) || { label: categoryId, icon: entries[0].icon };
        const dropdown = document.createElement('div');
        dropdown.className = 'toolbar-dropdown';
        dropdown.dataset.role = 'add-element';
        dropdown.dataset.category = categoryId;
        dropdown.innerHTML = `
            <button class="toolbar-btn" type="button">
                <span>${meta.icon}</span> ${escapeHtml(meta.label)} <span class="toolbar-caret">▾</span>
            </button>
            <div class="toolbar-menu" role="menu">
                ${entries.map((e, i) => `
                    <button type="button" role="menuitem" data-index="${i}">
                        <span class="toolbar-menu-icon">${e.icon}</span> ${escapeHtml(e.label)}
                    </button>`).join('')}
            </div>`;

        dropdown.querySelector('.toolbar-btn').addEventListener('click', (ev) => {
            const willOpen = !dropdown.classList.contains('open');
            closeMenus(dropdown);
            dropdown.classList.toggle('open', willOpen);
            if (willOpen) {
                // The toolbar scrolls horizontally (overflow clips), so the
                // menu is positioned relative to the window, under its button.
                const r = ev.currentTarget.getBoundingClientRect();
                const menu = dropdown.querySelector('.toolbar-menu');
                menu.style.left = `${r.left}px`;
                menu.style.top = `${r.bottom + 4}px`;
            }
        });
        dropdown.querySelector('.toolbar-menu').addEventListener('click', (ev) => {
            const item = ev.target.closest('[data-index]');
            if (!item) return;
            const e = entries[Number(item.dataset.index)];
            dropdown.classList.remove('open');
            onAdd(e.type, e.variant);
        });
        container.appendChild(dropdown);
    }
}
