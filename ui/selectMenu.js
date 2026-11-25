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
    if (open.observer) open.observer.disconnect();
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

const SEARCH_THRESHOLD = 12; // longer lists get a search box (e.g. fonts)

function visibleItems(menu) {
    return [...menu.querySelectorAll('.select-menu-item:not([disabled])')].filter(i => !i.hidden);
}

function setActive(menu, index) {
    const items = visibleItems(menu);
    menu.querySelectorAll('.select-menu-item.focused').forEach(i => i.classList.remove('focused'));
    if (!items.length) return;
    const i = Math.max(0, Math.min(items.length - 1, index));
    items[i].classList.add('focused');
    items[i].scrollIntoView({ block: 'nearest' });
}

function focusedIndex(menu) {
    return visibleItems(menu).findIndex(i => i.classList.contains('focused'));
}

function makeItem(select, opt) {
    const item = document.createElement('button');
    item.type = 'button';
    item.className = 'select-menu-item';
    item.setAttribute('role', 'option');
    item.textContent = opt.textContent.trim();
    item.dataset.value = opt.value;
    // e.g. a font name drawn in its own font. Applied only when the item
    // scrolls into view (see openFor): drawing hundreds of names in their
    // own fonts at once makes the list slow to open.
    if (opt.dataset.preview) item.dataset.previewFont = opt.dataset.preview;
    if (opt.disabled) item.disabled = true;
    if (opt.value === select.value) item.classList.add('selected', 'focused');
    item.addEventListener('mousedown', (e) => e.preventDefault()); // keep focus
    item.addEventListener('click', () => choose(select, opt.value));
    return item;
}

/** Shows only items matching `query`; hides section headers left empty. */
function filterItems(menu, query) {
    const q = query.trim().toLowerCase();
    menu.querySelectorAll('.select-menu-item').forEach(item => {
        item.hidden = q !== '' && !item.textContent.toLowerCase().includes(q);
    });
    menu.querySelectorAll('.select-menu-group').forEach(header => {
        let next = header.nextElementSibling;
        let any = false;
        while (next && !next.classList.contains('select-menu-group')) {
            if (!next.hidden) any = true;
            next = next.nextElementSibling;
        }
        header.hidden = !any;
    });
    setActive(menu, 0);
}

function openFor(select) {
    close();
    const menu = document.createElement('div');
    menu.className = 'select-menu';
    const list = document.createElement('div');
    list.className = 'select-menu-list';
    list.setAttribute('role', 'listbox');

    for (const child of select.children) {
        if (child.tagName === 'OPTGROUP') {
            const header = document.createElement('div');
            header.className = 'select-menu-group';
            header.textContent = child.label;
            list.appendChild(header);
            [...child.children].forEach(opt => list.appendChild(makeItem(select, opt)));
        } else if (child.tagName === 'OPTION') {
            list.appendChild(makeItem(select, child));
        }
    }

    let search = null;
    if (select.options.length > SEARCH_THRESHOLD) {
        search = document.createElement('input');
        search.type = 'text';
        search.className = 'select-menu-search';
        search.placeholder = 'Search…';
        search.spellcheck = false;
        search.addEventListener('input', () => filterItems(menu, search.value));
        menu.appendChild(search);
    }
    menu.appendChild(list);
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
    // Font previews for visible items only.
    let observer = null;
    const lazy = list.querySelectorAll('[data-preview-font]');
    if (lazy.length) {
        observer = new IntersectionObserver((entries) => {
            entries.forEach(entry => {
                if (!entry.isIntersecting) return;
                entry.target.style.fontFamily = entry.target.dataset.previewFont;
                observer.unobserve(entry.target);
            });
        }, { root: list, rootMargin: '120px 0px' });
        lazy.forEach(item => observer.observe(item));
    }

    select.classList.add('select-open');
    open = { select, menu, search, observer };
    const sel = menu.querySelector('.selected');
    if (sel) sel.scrollIntoView({ block: 'nearest' });
    if (search) search.focus();
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
        } else if (e.key === 'Enter' || (e.key === ' ' && !open.search)) {
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
