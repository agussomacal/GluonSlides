// ============================================================
// present/viewer.js — The slide show. Plain script (no imports):
// export/html.js inlines it into every exported HTML file, and the
// in-app Present mode shows that same HTML in a full-screen frame.
//
// Expects .slide elements (data-steps = number of build steps) whose
// elements may carry data-step="N" (shown from step N on).
//
//   → ↓ Space PageDown Enter, click     next step / slide
//   ← ↑ PageUp Backspace, right-click   previous
//   Home / End                          first / last slide
//   number + Enter                      go to that slide
//   B or .   /   W or ,                 black / white screen
//   F                                   full screen
//   Esc                                 leave (in the app)
//
// Other windows (the presenter view, the app) drive it with
// postMessage({ type: 'gluon-control', action, slide?, step? }) and
// hear { type: 'gluon-position', slide, step, steps, total }.
// ============================================================

(function () {
    const slides = Array.from(document.querySelectorAll('.slide'));
    const total = slides.length;
    if (!total) return;
    const start = window.GLUON_START || {};
    let current = clamp(Number(start.slide) || 0, 0, total - 1);
    let step = 1;
    let blank = null;       // null | 'black' | 'white'
    let typed = '';         // digits typed for "go to slide"
    let typedTimer = null;

    function clamp(n, lo, hi) { return Math.max(lo, Math.min(hi, n)); }
    function stepsOf(i) { return Math.max(1, Number(slides[i].dataset.steps) || 1); }

    // ---------- Layout: fit the slide to the window ----------

    const first = slides[0];
    const slideW = parseFloat(first.style.width) || first.offsetWidth || 1920;
    const slideH = parseFloat(first.style.height) || first.offsetHeight || 1080;
    function fit() {
        const scale = Math.min(window.innerWidth / slideW, window.innerHeight / slideH);
        slides.forEach(s => { s.style.transform = `scale(${scale})`; });
    }
    window.addEventListener('resize', fit);

    // ---------- Overlays: black/white screen, counter, slide number ----------

    const screen = document.createElement('div');
    screen.className = 'gluon-blank';
    document.body.appendChild(screen);
    const counter = document.createElement('div');
    counter.className = 'gluon-counter';
    document.body.appendChild(counter);
    let counterTimer = null;
    function flashCounter(text) {
        counter.textContent = text;
        counter.classList.add('visible');
        clearTimeout(counterTimer);
        counterTimer = setTimeout(() => counter.classList.remove('visible'), 1500);
    }

    // ---------- Showing a position ----------

    function render() {
        slides.forEach((s, i) => s.classList.toggle('active', i === current));
        slides[current].querySelectorAll('[data-step]').forEach(el => {
            el.classList.toggle('step-hidden', Number(el.dataset.step) > step);
        });
        screen.className = 'gluon-blank' + (blank ? ` ${blank}` : '');
        try { history.replaceState(null, '', `#${current + 1}.${step}`); } catch (e) { /* srcdoc frames */ }
        announce();
    }

    function announce() {
        const msg = { type: 'gluon-position', slide: current, step, steps: stepsOf(current), total, blank };
        [window.parent !== window ? window.parent : null, window.opener].forEach(w => {
            if (w) { try { w.postMessage(msg, '*'); } catch (e) { /* closed */ } }
        });
        window.dispatchEvent(new CustomEvent('gluon-position', { detail: msg }));
    }

    function go(slide, s) {
        current = clamp(slide, 0, total - 1);
        step = clamp(s, 1, stepsOf(current));
        render();
    }

    function next() {
        if (blank) { blank = null; render(); return; }
        if (step < stepsOf(current)) go(current, step + 1);
        else if (current < total - 1) go(current + 1, 1);
        else flashCounter('End of presentation');
    }

    function prev() {
        if (blank) { blank = null; render(); return; }
        if (step > 1) go(current, step - 1);
        else if (current > 0) go(current - 1, stepsOf(current - 1));
    }

    function toggleBlank(color) {
        blank = blank === color ? null : color;
        render();
    }

    function toggleFullscreen() {
        const d = document;
        if (d.fullscreenElement) d.exitFullscreen && d.exitFullscreen();
        else if (d.documentElement.requestFullscreen) d.documentElement.requestFullscreen().catch(() => {});
    }

    function leave() {
        if (window.parent !== window) window.parent.postMessage({ type: 'gluon-exit' }, '*');
    }

    function goToTyped() {
        const n = parseInt(typed, 10);
        typed = '';
        if (n >= 1 && n <= total) go(n - 1, 1);
        else if (!Number.isNaN(n)) flashCounter(`No slide ${n}`);
    }

    // ---------- Input ----------

    document.addEventListener('keydown', (e) => {
        if (e.ctrlKey || e.metaKey || e.altKey) return;
        const k = e.key;
        if (/^[0-9]$/.test(k)) {
            typed += k;
            flashCounter(`Go to slide ${typed}…`);
            clearTimeout(typedTimer);
            typedTimer = setTimeout(() => { typed = ''; }, 3000);
            return;
        }
        if (k === 'Enter' && typed) { e.preventDefault(); goToTyped(); return; }
        if (['ArrowRight', 'ArrowDown', 'PageDown', ' ', 'Enter', 'n', 'N'].includes(k)) { e.preventDefault(); next(); }
        else if (['ArrowLeft', 'ArrowUp', 'PageUp', 'Backspace', 'p', 'P'].includes(k)) { e.preventDefault(); prev(); }
        else if (k === 'Home') { e.preventDefault(); go(0, 1); }
        else if (k === 'End') { e.preventDefault(); go(total - 1, stepsOf(total - 1)); }
        else if (k === 'b' || k === 'B' || k === '.') toggleBlank('black');
        else if (k === 'w' || k === 'W' || k === ',') toggleBlank('white');
        else if (k === 'f' || k === 'F') toggleFullscreen();
        else if (k === 'Escape') {
            if (blank) toggleBlank(blank);
            else leave();
        } else return;
        hideHint();
    });

    document.addEventListener('click', (e) => {
        if (e.button === 0 && !e.target.closest('a, button')) next();
    });
    document.addEventListener('contextmenu', (e) => {
        e.preventDefault();
        prev();
    });

    window.addEventListener('message', (e) => {
        const m = e.data;
        if (!m || m.type !== 'gluon-control') return;
        if (m.action === 'next') next();
        else if (m.action === 'prev') prev();
        else if (m.action === 'goto') go(Number(m.slide) || 0, Number(m.step) || 1);
        else if (m.action === 'blank') toggleBlank(m.color || 'black');
        else if (m.action === 'query') announce();
    });

    // ---------- Hint ----------

    const hint = document.querySelector('.nav-hint');
    function hideHint() { if (hint) hint.classList.add('hidden'); }
    setTimeout(hideHint, 4000);

    // Start where the URL says (#slide.step), else at GLUON_START.
    const fromHash = /^#(\d+)(?:\.(\d+))?$/.exec(location.hash || '');
    window.GluonViewer = { next, prev, go, position: () => ({ slide: current, step, steps: stepsOf(current), total }) };
    fit();
    if (fromHash) go(Number(fromHash[1]) - 1, Number(fromHash[2]) || 1);
    else go(current, Number(start.step) || 1);
})();
