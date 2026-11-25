// ============================================================
// ui/selectMenu.js — Styled option lists for the app's dropdowns.
//
// In the desktop app (WebKitGTK) an opened <select> list is drawn by
// GTK with the system theme, ignoring the page's CSS, which can make
// it unreadable on the dark UI. For selects with the app's classes we
// open our own list instead, styled like the toolbar menus. Choosing
// an option sets the select's value and fires a normal `change`
// event, so existing handlers work unchanged.
// ============================================================

const SELECTOR = 'select.prop-control, select.toolbar-select, select.styled-select';

let open = null; // { select, menu }

function close() {
    if (!open) return;
    open.menu.remove();
    open.select.classList.remove('select-open');
    open = null;
}

function choose(select, value) {
    if (select.value !== value) {
        select.value = value;
        select.dispatchEvent(new Event('change', { bubbles: true }));
    }
    close();
    select.focus();
}

function setActive(menu, index) {
    const items = [...menu.querySelectorAll('.select-menu-item:not([disabled])')];
    if (!items.length) return;
    const i = Math.max(0, Math.min(items.length - 1, index));
    items.forEach((item, k) => item.classList.toggle('focused', k === i));
    items[i].scrollIntoView({ block: 'nearest' });
}

function focusedIndex(menu) {
    return [...menu.querySelectorAll('.select-menu-item:not([disabled])')].findIndex(i => i.classList.contains('focused'));
}

function openFor(select) {
    close();
    const menu = document.createElement('div');
    menu.className = 'select-menu';
    menu.setAttribute('role', 'listbox');
    [...select.options].forEach(opt => {
        const item = document.createElement('button');
        item.type = 'button';
        item.className = 'select-menu-item';
        item.setAttribute('role', 'option');
        item.textContent = opt.textContent;
        item.dataset.value = opt.value;
        if (opt.disabled) item.disabled = true;
        if (opt.value === select.value) item.classList.add('selected', 'focused');
        item.addEventListener('mousedown', (e) => e.preventDefault()); // keep focus on the select
        item.addEventListener('click', () => choose(select, opt.value));
        menu.appendChild(item);
    });
    document.body.appendChild(menu);

    // Below the select, or above it when there is no room.
    const r = select.getBoundingClientRect();
    menu.style.minWidth = `${r.width}px`;
    menu.style.left = `${Math.min(r.left, window.innerWidth - menu.offsetWidth - 8)}px`;
    const below = window.innerHeight - r.bottom - 8;
    if (menu.offsetHeight > below && r.top > below) {
        menu.style.top = `${Math.max(8, r.top - menu.offsetHeight - 4)}px`;
    } else {
        menu.style.top = `${r.bottom + 4}px`;
    }
    select.classList.add('select-open');
    open = { select, menu };
    const sel = menu.querySelector('.selected');
    if (sel) sel.scrollIntoView({ block: 'nearest' });
}

export function initStyledSelects() {
    // Capture phase, so the native popup never opens.
    document.addEventListener('mousedown', (e) => {
        if (open && open.menu.contains(e.target)) return;
        const select = e.target.closest && e.target.closest(SELECTOR);
        if (!select || select.disabled || e.button !== 0) {
            close();
            return;
        }
        e.preventDefault();
        select.focus();
        if (open && open.select === select) close();
        else openFor(select);
    }, true);

    document.addEventListener('keydown', (e) => {
        if (!open) return;
        const { menu, select } = open;
        if (e.key === 'Escape') {
            e.preventDefault();
            e.stopPropagation();
            close();
        } else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
            e.preventDefault();
            e.stopPropagation();
            setActive(menu, focusedIndex(menu) + (e.key === 'ArrowDown' ? 1 : -1));
        } else if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            e.stopPropagation();
            const item = menu.querySelector('.select-menu-item.focused');
            if (item) choose(select, item.dataset.value);
        } else if (e.key === 'Tab') {
            close();
        }
    }, true);

    // The list would drift away from its select.
    window.addEventListener('resize', close);
    document.addEventListener('scroll', (e) => {
        if (open && !open.menu.contains(e.target)) close();
    }, true);
}
