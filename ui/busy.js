// ============================================================
// ui/busy.js — Showing that something is being done.
//
//   busy(label, promise)              a bar at the bottom of the window
//                                     while it runs (only if it takes
//                                     longer than a moment: no flicker)
//   placeholder(point, label, promise) also a box on the slide where the
//                                     image / table will appear
//   progressBar(container, {stage, done, total})  a determinate bar
//
// Each returns the promise's own result (or throws its error).
// ============================================================

const SHOW_AFTER_MS = 300;
const running = new Map(); // id -> label
let nextId = 1;
let bar = null;

function busyBar() {
    if (!bar) {
        bar = document.createElement('div');
        bar.className = 'busy-bar';
        bar.setAttribute('role', 'status');
        bar.innerHTML = '<div class="busy-track"><div class="busy-run"></div></div><span class="busy-label"></span>';
        document.body.appendChild(bar);
    }
    return bar;
}

function refresh() {
    const labels = [...running.values()].filter(Boolean);
    const b = busyBar();
    b.hidden = labels.length === 0;
    b.querySelector('.busy-label').textContent = labels.length > 1 ? `${labels[0]} (+${labels.length - 1} more)` : (labels[0] || '');
}

/** Runs `promise` (or a function returning one) with the busy bar showing `label`. */
export async function busy(label, promise) {
    const id = nextId++;
    running.set(id, null);
    const timer = setTimeout(() => {
        if (running.has(id)) {
            running.set(id, label);
            refresh();
        }
    }, SHOW_AFTER_MS);
    try {
        return await (typeof promise === 'function' ? promise() : promise);
    } finally {
        clearTimeout(timer);
        running.delete(id);
        refresh();
    }
}

/**
 * Like busy(), plus a box on the slide at `point` ({x, y} in slide
 * pixels, centred there; null: the slide's centre) while it runs.
 */
export async function placeholder(point, label, promise, { width = 480, height = 300 } = {}) {
    const canvas = document.getElementById('slide-canvas');
    let box = null;
    const timer = setTimeout(() => {
        if (!canvas) return;
        const w = canvas.offsetWidth || 1920;
        const h = canvas.offsetHeight || 1080;
        const k = w / 1920;
        const bw = width * k, bh = height * k;
        const cx = point ? point.x : w / 2, cy = point ? point.y : h / 2;
        box = document.createElement('div');
        box.className = 'busy-placeholder';
        box.style.left = `${Math.max(0, Math.min(w - bw, cx - bw / 2))}px`;
        box.style.top = `${Math.max(0, Math.min(h - bh, cy - bh / 2))}px`;
        box.style.width = `${bw}px`;
        box.style.height = `${bh}px`;
        box.style.fontSize = `${Math.round(28 * k)}px`;
        box.innerHTML = '<div class="busy-spinner"></div><div class="busy-placeholder-label"></div>';
        box.querySelector('.busy-placeholder-label').textContent = label;
        canvas.appendChild(box);
    }, SHOW_AFTER_MS);
    try {
        return await busy(label, promise);
    } finally {
        clearTimeout(timer);
        if (box) box.remove();
    }
}

/** A determinate progress bar in `container` ({ stage, done, total } from the backend). */
export function progressBar(container, { stage = '', done = 0, total = 0 } = {}) {
    if (!container) return;
    const pct = total > 0 ? Math.min(100, Math.round((done / total) * 100)) : null;
    container.innerHTML = `
        <div class="progress-track${pct === null ? ' indeterminate' : ''}"><div class="progress-fill" style="width:${pct === null ? 30 : pct}%"></div></div>
        <div class="progress-label"></div>`;
    container.querySelector('.progress-label').textContent = stage
        ? `${stage}${total > 0 ? ` — ${Math.min(done + 1, total)} / ${total}` : '…'}`
        : 'Working…';
}
