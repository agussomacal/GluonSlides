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
    // Text box, columns and tables. A split button: one click adds a text
    // box, its ▾ lists the rest.
    { id: 'text', label: 'Text', icon: '📝', split: true, order: ['text', 'columns', 'table'] },
    { id: 'fields', label: 'Fields', icon: '#', menu: true }, // slide number, footer, date...
    { id: 'shapes', label: 'Shapes', icon: '⬛' },
    { id: 'lines', label: 'Lines & curves', icon: '〰️' },
    { id: 'media', label: 'Media', icon: '🖼️' },
    { id: 'macros', label: 'Macros', icon: '🧩', menu: true }, // always a dropdown
];

/** Toolbar entries ({ type, variant, label, icon }) grouped by category id. */
function entriesByCategory() {
    const groups = new Map(CATEGORIES.map(c => [c.id, []]));
    ElementRegistry.types()
        .filter(def => def.toolbar !== false)
        .forEach(def => {
            // A variant may sit in another category than its type
            // (e.g. closed paths under Shapes).
            // A type that declares variants (even none yet, like an empty
            // macro library) lists exactly those.
            const entries = Array.isArray(def.variants)
                ? def.variants.map(v => ({
                    type: def.type, variant: v.id, label: v.label, icon: v.icon || def.icon, iconNode: v.iconNode,
                    category: v.category || def.category || def.type,
                }))
                : [{
                    type: def.type, variant: null, label: def.label.replace(/^Add\s+/i, ''), icon: def.icon,
                    category: def.category || def.type,
                }];
            entries.forEach(entry => {
                entry.borrowed = entry.category !== (def.category || def.type);
                if (!groups.has(entry.category)) groups.set(entry.category, []);
                groups.get(entry.category).push(entry);
            });
        });
    // A category lists its own types first, then variants borrowed from
    // other types (independent of module load order).
    for (const [id, entries] of groups) {
        const sorted = [...entries.filter(e => !e.borrowed), ...entries.filter(e => e.borrowed)];
        // A category may fix the order of its types (stable within a type).
        const order = (CATEGORIES.find(c => c.id === id) || {}).order;
        if (order) {
            const rank = (e) => (order.includes(e.type) ? order.indexOf(e.type) : order.length);
            sorted.sort((a, b) => rank(a) - rank(b));
        }
        groups.set(id, sorted);
    }
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

        const meta = CATEGORIES.find(c => c.id === categoryId) || { label: categoryId, icon: entries[0].icon };
        if (entries.length === 1 && !meta.menu) {
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

        const dropdown = document.createElement('div');
        dropdown.className = 'toolbar-dropdown';
        dropdown.dataset.role = 'add-element';
        dropdown.dataset.category = categoryId;
        const first = entries[0];
        if (meta.split) dropdown.classList.add('toolbar-split');
        dropdown.innerHTML = `
            ${meta.split ? `
            <button class="toolbar-btn toolbar-split-main" type="button" data-type="${escapeHtml(first.type)}" title="Add a ${escapeHtml(first.label.toLowerCase())}">
                <span>${meta.icon}</span> ${escapeHtml(meta.label)}
            </button>
            <button class="toolbar-btn toolbar-split-caret" type="button" title="More: ${escapeHtml(entries.slice(1).map(e => e.label).join(', '))}"><span class="toolbar-caret">▾</span></button>` : `
            <button class="toolbar-btn" type="button">
                <span>${meta.icon}</span> ${escapeHtml(meta.label)} <span class="toolbar-caret">▾</span>
            </button>`}
            <div class="toolbar-menu" role="menu">
                ${entries.map((e, i) => `
                    ${i > 0 && e.type !== entries[i - 1].type ? '<div class="toolbar-menu-divider"></div>' : ''}
                    <button type="button" role="menuitem" data-index="${i}" data-variant="${escapeHtml(e.variant || '')}">
                        <span class="toolbar-menu-icon">${e.icon}</span> ${escapeHtml(e.label)}
                    </button>`).join('')}
            </div>`;

        // Variants may draw their own icon (e.g. a macro's thumbnail).
        dropdown.querySelectorAll('.toolbar-menu [data-index]').forEach(item => {
            const entry = entries[Number(item.dataset.index)];
            if (typeof entry.iconNode !== 'function') return;
            const slot = item.querySelector('.toolbar-menu-icon');
            slot.replaceChildren(entry.iconNode());
        });

        if (meta.split) {
            dropdown.querySelector('.toolbar-split-main').addEventListener('click', () => {
                closeMenus();
                onAdd(first.type, first.variant);
            });
        }
        dropdown.querySelector(meta.split ? '.toolbar-split-caret' : '.toolbar-btn').addEventListener('click', () => {
            const willOpen = !dropdown.classList.contains('open');
            closeMenus(dropdown);
            dropdown.classList.toggle('open', willOpen);
            if (willOpen) {
                // The toolbar scrolls horizontally (overflow clips), so the
                // menu is positioned relative to the window, under its button.
                const r = dropdown.getBoundingClientRect();
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
