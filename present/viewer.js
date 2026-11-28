// ============================================================
// present/viewer.js — The slide show. Plain script (no imports):
// export/html.js inlines it into every exported HTML file, and the
// in-app Present mode shows that same HTML in a full-screen frame.
//
// Expects .slide elements (data-steps = number of build steps) whose
// elements may carry data-step="N" (shown from step N on), and the
// speaker notes as JSON in #gluon-notes (one string per slide).
//
// Two modes:
//   audience   the slides, full window (default)
//   presenter  current slide, next step, notes, timer
//              (window.GLUON_MODE = 'presenter', or #presenter)
//
//   → ↓ Space PageDown Enter, click     next step / slide
//   ← ↑ PageUp Backspace, right-click   previous
//   Home / End                          first / last slide
//   number + Enter                      go to that slide
//   B or .   /   W or ,                 black / white screen
//   S                                   presenter view
//   F                                   full screen
//   Esc                                 leave
//   presenter only: T pause/resume timer, R reset it, + / − notes size
//
// Messages between windows (postMessage):
//   presenter -> audience   { type: 'gluon-control', action: 'goto', slide, step, blank }
//                           (also 'next', 'prev', 'blank', 'query')
//   audience -> others      { type: 'gluon-position', slide, step, steps, total, blank }
//   either -> app frame     { type: 'gluon-exit' } / { type: 'gluon-presenter-request', ... }
//   sliders (core/liveEngine.js): presenter -> audience { type: 'gluon-control', action: 'vars', vars },
//                           audience -> presenter { type: 'gluon-vars', vars }; in this window
//                           the events 'gluon-vars-out' (a slider moved here) and 'gluon-vars-in'
// ============================================================

(function () {
    const slides = Array.from(document.querySelectorAll('.slide-wrapper > .slide'));
    const total = slides.length;
    if (!total) return;
    const start = window.GLUON_START || {};
    const presenter = window.GLUON_MODE === 'presenter' || /^#presenter/.test(location.hash || '');
    const notes = readNotes();
    let current = clamp(Number(start.slide) || 0, 0, total - 1);
    let step = 1;
    let blank = null;       // null | 'black' | 'white'
    let typed = '';         // digits typed for "go to slide"
    let typedTimer = null;
    let presenterWindow = null; // exported HTML: the presenter window this one opened

    function clamp(n, lo, hi) { return Math.max(lo, Math.min(hi, n)); }
    function stepsOf(i) { return Math.max(1, Number(slides[i].dataset.steps) || 1); }
    function inFrame() { return window.parent !== window; }
    /** The project slide a presented slide comes from (continuation pages share it). */
    function sourceOf(i) { const v = Number(slides[i].dataset.source); return Number.isFinite(v) ? v : i; }

    function readNotes() {
        const node = document.getElementById('gluon-notes');
        try { return node ? JSON.parse(node.textContent) : []; } catch (e) { return []; }
    }

    const first = slides[0];
    const slideW = parseFloat(first.style.width) || first.offsetWidth || 1920;
    const slideH = parseFloat(first.style.height) || first.offsetHeight || 1080;

    /** Whether an element is shown at step `k`: from its data-step, through its data-until. */
    function shownAt(el, k) {
        const from = Number(el.dataset.step) || 1;
        const until = el.dataset.until !== undefined ? Number(el.dataset.until) : Infinity;
        return from <= k && k <= until;
    }

    // ---------- Printing: one page per build step ----------
    // Printed (and the vector PDF) like it is presented: a slide with
    // three steps gives three pages, each with what was visible then.
    (function buildPrintPages() {
        const container = document.createElement('div');
        container.className = 'print-pages';
        slides.forEach((slide, index) => {
            const steps = Math.max(1, Number(slide.dataset.steps) || 1);
            for (let k = 1; k <= steps; k++) {
                const page = slide.cloneNode(true);
                page.removeAttribute('id');
                page.classList.remove('active');
                page.classList.add('print-page');
                // which slide and step: animations end there on this page (core/liveEngine.js)
                page.dataset.printSlide = String(index);
                page.dataset.printStep = String(k);
                page.querySelectorAll('[data-step], [data-until]').forEach(el => {
                    if (!shownAt(el, k)) el.remove();
                });
                container.appendChild(page);
            }
        });
        document.body.appendChild(container);
    })();

    // ---------- Overlays: black/white screen, short messages ----------

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

    /** Shows `slide` at `atStep` in `node`: elements not there yet, or gone already, are hidden. */
    function applySteps(node, atStep) {
        node.querySelectorAll('[data-step], [data-until]').forEach(el => {
            el.classList.toggle('step-hidden', !shownAt(el, atStep));
        });
    }

    // ---------- Audience layout: the slide, fitted to the window ----------

    function fit() {
        const scale = Math.min(window.innerWidth / slideW, window.innerHeight / slideH);
        slides.forEach(s => { s.style.transform = `scale(${scale})`; });
    }

    function renderAudience() {
        slides.forEach((s, i) => s.classList.toggle('active', i === current));
        applySteps(slides[current], step);
        screen.className = 'gluon-blank' + (blank ? ` ${blank}` : '');
    }

    // ---------- Presenter layout ----------

    let ui = null;
    const timer = { startedAt: Date.now(), elapsed: 0, running: true };
    let notesSize = 22;

    function buildPresenter() {
        document.body.classList.add('gluon-presenter');
        const root = document.createElement('div');
        root.className = 'gp';
        root.innerHTML = `
            <header class="gp-bar">
                <span class="gp-timer" title="Time since the start (T: pause, R: reset)">00:00</span>
                <button type="button" data-gp="pause" title="Pause / resume the timer (T)">⏸</button>
                <button type="button" data-gp="reset" title="Reset the timer (R)">↺</button>
                <span class="gp-clock" title="Time of day"></span>
                <span class="gp-pos"></span>
                <span class="gp-spacer"></span>
                <span class="gp-audience"></span>
                <button type="button" data-gp="prev" title="Back (←)">◀</button>
                <button type="button" data-gp="next" title="Next (→)">▶</button>
                <button type="button" data-gp="black" title="Black screen for the audience (B)">Black</button>
                <button type="button" data-gp="exit" title="End the presentation (Esc)">End</button>
            </header>
            <section class="gp-current"><div class="gp-label">Now</div><div class="gp-stage" data-stage="current"></div></section>
            <section class="gp-next"><div class="gp-label">Next</div><div class="gp-stage" data-stage="next"></div></section>
            <section class="gp-notes">
                <div class="gp-label">Notes
                    <button type="button" data-gp="smaller" title="Smaller notes (−)">A−</button>
                    <button type="button" data-gp="bigger" title="Bigger notes (+)">A+</button>
                </div>
                <div class="gp-notes-text"></div>
            </section>`;
        document.body.appendChild(root);
        ui = {
            root,
            timer: root.querySelector('.gp-timer'),
            clock: root.querySelector('.gp-clock'),
            pos: root.querySelector('.gp-pos'),
            audience: root.querySelector('.gp-audience'),
            current: root.querySelector('[data-stage="current"]'),
            next: root.querySelector('[data-stage="next"]'),
            notes: root.querySelector('.gp-notes-text'),
            black: root.querySelector('[data-gp="black"]'),
            pause: root.querySelector('[data-gp="pause"]'),
        };
        root.addEventListener('click', (e) => {
            const btn = e.target.closest('[data-gp]');
            if (btn) {
                const a = btn.dataset.gp;
                if (a === 'next') next();
                else if (a === 'prev') prev();
                else if (a === 'black') toggleBlank('black');
                else if (a === 'exit') leave();
                else if (a === 'pause') toggleTimer();
                else if (a === 'reset') resetTimer();
                else if (a === 'smaller') setNotesSize(notesSize - 2);
                else if (a === 'bigger') setNotesSize(notesSize + 2);
                btn.blur();
                return;
            }
            if (e.target.closest('.gp-current')) next();
        });
        if (window.ResizeObserver) new ResizeObserver(renderPresenter).observe(root);
        setInterval(tick, 500);
        tick();
        setNotesSize(notesSize);
    }

    /** A scaled copy of slide `i` at `atStep`, centred in `stage`. */
    function showInStage(stage, i, atStep) {
        stage.replaceChildren();
        if (i === null) {
            stage.innerHTML = '<div class="gp-end">End of presentation</div>';
            return;
        }
        const copy = slides[i].cloneNode(true);
        copy.removeAttribute('id');
        copy.classList.add('active', 'gp-copy');
        applySteps(copy, atStep);
        const w = stage.clientWidth || 1;
        const h = stage.clientHeight || 1;
        const scale = Math.min(w / slideW, h / slideH);
        copy.style.transform = `scale(${scale})`;
        copy.style.left = `${(w - slideW * scale) / 2}px`;
        copy.style.top = `${(h - slideH * scale) / 2}px`;
        stage.appendChild(copy);
    }

    function nextPosition() {
        if (step < stepsOf(current)) return { slide: current, step: step + 1 };
        if (current < total - 1) return { slide: current + 1, step: 1 };
        return null;
    }

    function renderPresenter() {
        if (!ui) return;
        showInStage(ui.current, current, step);
        const n = nextPosition();
        showInStage(ui.next, n ? n.slide : null, n ? n.step : 1);
        const steps = stepsOf(current);
        ui.pos.textContent = `Slide ${current + 1} / ${total}` + (steps > 1 ? ` · step ${step} / ${steps}` : '');
        const text = notes[current] || '';
        ui.notes.textContent = text;
        ui.notes.classList.toggle('empty', !text);
        if (!text) ui.notes.textContent = 'No notes for this slide.';
        ui.black.classList.toggle('on', blank === 'black');
        ui.current.classList.toggle('blanked', Boolean(blank));
    }

    function format(ms) {
        const s = Math.floor(ms / 1000);
        const h = Math.floor(s / 3600);
        const mm = String(Math.floor((s % 3600) / 60)).padStart(2, '0');
        const ss = String(s % 60).padStart(2, '0');
        return h ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
    }

    function elapsed() {
        return timer.elapsed + (timer.running ? Date.now() - timer.startedAt : 0);
    }

    function tick() {
        if (!ui) return;
        ui.timer.textContent = format(elapsed());
        ui.timer.classList.toggle('paused', !timer.running);
        ui.pause.textContent = timer.running ? '⏸' : '▶';
        const d = new Date();
        ui.clock.textContent = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
    }

    function toggleTimer() {
        if (timer.running) { timer.elapsed = elapsed(); timer.running = false; }
        else { timer.startedAt = Date.now(); timer.running = true; }
        tick();
    }

    function resetTimer() {
        timer.elapsed = 0;
        timer.startedAt = Date.now();
        tick();
    }

    function setNotesSize(px) {
        notesSize = clamp(px, 12, 48);
        if (ui) ui.notes.style.fontSize = `${notesSize}px`;
    }

    // ---------- Position: show it, tell the other windows ----------

    function post(target, msg) {
        if (target && target !== window) { try { target.postMessage(msg, '*'); } catch (e) { /* closed */ } }
    }

    /** Windows to keep in sync: the app frame host, the opener, a presenter popup. */
    function partners() {
        return [inFrame() ? window.parent : null, window.opener, presenterWindow && !presenterWindow.closed ? presenterWindow : null];
    }

    function render(notify = true) {
        if (presenter) renderPresenter(); else renderAudience();
        try { history.replaceState(null, '', presenter ? `#presenter-${current + 1}.${step}` : `#${current + 1}.${step}`); } catch (e) { /* srcdoc frames */ }
        window.dispatchEvent(new CustomEvent('gluon-rendered')); // e.g. sliders in the presenter's copies
        if (!notify) return;
        const position = { slide: current, source: sourceOf(current), step, steps: stepsOf(current), total, blank };
        const msg = presenter
            ? { type: 'gluon-control', action: 'goto', ...position }
            : { type: 'gluon-position', ...position };
        partners().forEach(w => post(w, msg));
        window.dispatchEvent(new CustomEvent('gluon-position', { detail: position }));
    }

    function go(slide, s, notify = true) {
        current = clamp(slide, 0, total - 1);
        step = clamp(s, 1, stepsOf(current));
        render(notify);
    }

    function next() {
        if (blank) { blank = null; render(); return; }
        const n = nextPosition();
        if (n) go(n.slide, n.step);
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
        if (inFrame()) {
            window.parent.postMessage({ type: 'gluon-exit' }, '*');
        } else if (presenter && window.opener) {
            window.close();
        }
        if (presenterWindow && !presenterWindow.closed) presenterWindow.close();
    }

    /** S: the presenter view (the app does it itself; a browser opens a window). */
    function openPresenter() {
        if (presenter) return;
        if (inFrame()) {
            window.parent.postMessage({ type: 'gluon-presenter-request', slide: current, source: sourceOf(current), step }, '*');
            return;
        }
        const url = location.href.split('#')[0] + `#presenter-${current + 1}.${step}`;
        presenterWindow = window.open(url, 'gluon-presenter', 'width=1280,height=800');
        if (!presenterWindow) flashCounter('Allow pop-ups to open the presenter view');
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
        else if (k === 's' || k === 'S') openPresenter();
        else if (presenter && (k === 't' || k === 'T')) toggleTimer();
        else if (presenter && (k === 'r' || k === 'R')) resetTimer();
        else if (presenter && (k === '+' || k === '=')) setNotesSize(notesSize + 2);
        else if (presenter && (k === '-' || k === '_')) setNotesSize(notesSize - 2);
        else if (k === 'Escape') {
            if (blank) toggleBlank(blank);
            else leave();
        } else return;
        hideHint();
    });

    if (!presenter) {
        document.addEventListener('click', (e) => {
            if (e.button === 0 && !e.target.closest('a, button')) next();
        });
        document.addEventListener('contextmenu', (e) => {
            e.preventDefault();
            prev();
        });
    }

    // Sliders: values moved here go to the other windows, theirs come here.
    window.addEventListener('gluon-vars-out', (e) => {
        const vars = e.detail || {};
        const msg = presenter ? { type: 'gluon-control', action: 'vars', vars } : { type: 'gluon-vars', vars };
        partners().forEach(w => post(w, msg));
    });

    window.addEventListener('message', (e) => {
        const m = e.data;
        if (!m || typeof m !== 'object') return;
        if ((presenter && m.type === 'gluon-vars') || (!presenter && m.type === 'gluon-control' && m.action === 'vars')) {
            window.dispatchEvent(new CustomEvent('gluon-vars-in', { detail: m.vars || {} }));
            return;
        }
        if (presenter && m.type === 'gluon-position') {
            // The audience moved (clicked there): follow without echoing.
            blank = m.blank || null;
            go(Number(m.slide) || 0, Number(m.step) || 1, false);
            if (ui) ui.audience.textContent = '';
        } else if (presenter && m.type === 'gluon-audience-closed') {
            if (ui) ui.audience.textContent = m.text || 'Audience window closed';
        } else if (!presenter && m.type === 'gluon-control') {
            if (m.action === 'next') next();
            else if (m.action === 'prev') prev();
            else if (m.action === 'goto') {
                blank = m.blank === undefined ? blank : (m.blank || null);
                go(Number(m.slide) || 0, Number(m.step) || 1);
            } else if (m.action === 'blank') toggleBlank(m.color || 'black');
            else if (m.action === 'query') render();
        }
    });

    // ---------- Start ----------

    const hint = document.querySelector('.nav-hint');
    function hideHint() { if (hint) hint.classList.add('hidden'); }
    setTimeout(hideHint, 4000);

    window.GluonViewer = {
        next, prev, go, mode: presenter ? 'presenter' : 'audience',
        position: () => ({ slide: current, source: sourceOf(current), step, steps: stepsOf(current), total, blank }),
    };

    if (presenter) {
        buildPresenter();
    } else {
        fit();
        window.addEventListener('resize', fit);
    }
    // Start where the URL says (#slide.step or #presenter-slide.step), else at GLUON_START.
    const fromHash = /^#(?:presenter-?)?(\d+)(?:\.(\d+))?$/.exec(location.hash || '');
    if (fromHash) go(Number(fromHash[1]) - 1, Number(fromHash[2]) || 1);
    else go(current, Number(start.step) || 1);
})();
