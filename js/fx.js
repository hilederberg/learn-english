// Screen router + motion. Adapted from the motion prototype (same easings/durations).
export const EASE = 'cubic-bezier(.22,.8,.24,1)', SPRING = 'cubic-bezier(.34,1.45,.5,1)', SOFT = 'cubic-bezier(.4,0,.2,1)';
const RM = () => window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches;
export function A(el, kf, o) {
  if (!el || !el.animate) return { finished: Promise.resolve(), cancel() {} };
  o = Object.assign({ fill: 'backwards' }, o || {});
  if (RM()) { o.duration = 1; o.delay = 0; if (o.iterations === Infinity) o.iterations = 1; }
  try { return el.animate(kf, o); } catch { return { finished: Promise.resolve(), cancel() {} }; }
}

let root, cur = null, busy = false, token = 0, timers = [], lastPct = 0;
const later = (fn, ms) => { const id = setTimeout(fn, RM() ? 0 : ms); timers.push(id); return id; };
export function initFx(el) { root = el; }
export const isBusy = () => busy;
export const current = () => cur;

export function count(el, to, dur, delay) {
  if (!el) return;
  if (RM()) { el.textContent = to; return; }
  el.textContent = 0; const t0 = performance.now() + delay, my = token;
  (function step(t) {
    if (my !== token) { el.textContent = to; return; }
    if (t < t0) { requestAnimationFrame(step); return; }
    const p = Math.min(1, (t - t0) / dur), e = 1 - Math.pow(1 - p, 3);
    el.textContent = Math.round(to * e);
    if (p < 1) requestAnimationFrame(step);
  })(performance.now());
}
export function drawRing(f, base) {
  f.querySelectorAll('.ringwrap svg circle').forEach((c, i) => {
    const o = c.getAttribute('stroke-dasharray'); if (!o) return;
    const p = o.split(/[ ,]+/).map(parseFloat), tot = p[0] + p[1];
    A(c, [{ strokeDasharray: '0.01 ' + tot }, { strokeDasharray: o }], { duration: 760, delay: base + i * 170, easing: EASE });
  });
  f.querySelectorAll('.ringwrap .bub').forEach((b, i) => A(b, [{ transform: 'scale(0)' }, { transform: 'scale(1)' }], { duration: 620, delay: base + 300 + i * 140, easing: SPRING }));
}
function flames(f) {
  f.querySelectorAll('.chip.y svg, .card.yellow svg').forEach(s => {
    const u = s.querySelector('use');
    if (u && u.getAttribute('href') === '#i-flame') A(s, [{ transform: 'rotate(-7deg) scale(1)' }, { transform: 'rotate(7deg) scale(1.08)' }], { duration: 1500, direction: 'alternate', iterations: Infinity, easing: 'ease-in-out', fill: 'none' });
  });
}
function bars(f, base) {
  f.querySelectorAll('.bar i').forEach(i => {
    const tgt = i.style.width || '100%', sb = i.closest('.sbar'); let from = '0%';
    if (sb) { from = lastPct + '%'; lastPct = parseFloat(tgt); }
    A(i, [{ width: from }, { width: tgt }], { duration: 900, delay: base, easing: EASE });
  });
}
function stagger(f, base) {
  const body = f.querySelector('.body'); if (!body) return;
  Array.from(body.children).forEach((el, i) => A(el, [{ opacity: 0, transform: 'translateY(26px) scale(.975)' }, { opacity: 1, transform: 'none' }], { duration: 680, delay: base + Math.min(i, 8) * 80, easing: EASE }));
  f.querySelectorAll('.list > *').forEach((el, i) => A(el, [{ opacity: 0, transform: 'translateY(22px)' }, { opacity: 1, transform: 'none' }], { duration: 640, delay: base + 260 + Math.min(i, 12) * 70, easing: EASE }));
  f.querySelectorAll('.card.center > *').forEach((el, i) => A(el, [{ opacity: 0, transform: 'translateY(14px) scale(.96)' }, { opacity: 1, transform: 'none' }], { duration: 620, delay: base + 280 + i * 100, easing: SPRING }));
  f.querySelectorAll('.rate > div').forEach((el, i) => A(el, [{ opacity: 0, transform: 'translateY(18px) scale(.9)' }, { opacity: 1, transform: 'none' }], { duration: 640, delay: base + 620 + i * 90, easing: SPRING }));
  f.querySelectorAll('.opt').forEach((el, i) => A(el, [{ opacity: 0, transform: 'translateX(-26px)' }, { opacity: 1, transform: 'none' }], { duration: 620, delay: base + 380 + i * 100, easing: EASE }));
  f.querySelectorAll('.tilebox .tile').forEach((el, i) => A(el, [{ opacity: 0, transform: 'translateY(16px) scale(.9)' }, { opacity: 1, transform: 'none' }], { duration: 560, delay: base + 420 + i * 60, easing: SPRING }));
}
export function confetti(f) {
  const box = document.createElement('div'); box.style.cssText = 'position:absolute;inset:0;pointer-events:none;z-index:9;overflow:hidden'; f.appendChild(box);
  const cols = ['#f3d86b', '#a9bf72', '#f6c4df', '#b8cdee', '#ec7a97'];
  const w = f.clientWidth || 390;
  for (let i = 0; i < 38; i++) {
    const d = document.createElement('div'); const k = i % 4, c = cols[i % cols.length];
    if (k === 0) d.innerHTML = '<svg width="18" height="17" style="--ik:#2b2525"><use href="#hrt"/></svg>';
    else if (k === 1) d.innerHTML = '<svg width="16" height="16" style="--ik:#2b2525"><use href="#sp"/></svg>';
    else d.style.cssText = `width:${8 + Math.random() * 6}px;height:${8 + Math.random() * 10}px;border-radius:${k === 2 ? '50%' : '3px'};background:${c}`;
    d.style.position = 'absolute'; d.style.left = (w / 2) + 'px'; d.style.top = '215px';
    box.appendChild(d);
    const ang = -Math.PI / 2 + (Math.random() - .5) * 2.6, v = 130 + Math.random() * 190, dx = Math.cos(ang) * v, dy = Math.sin(ang) * v - 30, r = (Math.random() - .5) * 540;
    A(d, [{ transform: 'translate(0,0) rotate(0) scale(.2)', opacity: 1 }, { transform: `translate(${dx}px,${dy}px) rotate(${r}deg) scale(1)`, opacity: 1, offset: .32 }, { transform: `translate(${dx * 1.2}px,${dy + 520}px) rotate(${r * 2}deg) scale(.9)`, opacity: 0 }], { duration: 2600 + Math.random() * 900, delay: 900 + Math.random() * 260, easing: 'cubic-bezier(.2,.6,.3,1)', fill: 'both' });
  }
  later(() => box.remove(), 4800);
}
function splashFx(f, short) {
  const logo = f.querySelector('.logo'); if (!logo) return;
  const svg = logo.querySelector('svg'), hi = logo.querySelector('b');
  if (short) {
    A(svg, [{ transform: 'scale(.8)', opacity: 0 }, { transform: 'none', opacity: 1 }], { duration: 420, easing: EASE });
    A(hi, [{ transform: 'scale(.4)', opacity: 0 }, { transform: 'none', opacity: 1 }], { duration: 420, delay: 100, easing: SPRING });
    A(f.querySelector('.h1'), [{ opacity: 0, transform: 'translateY(14px)' }, { opacity: 1, transform: 'none' }], { duration: 420, delay: 160, easing: EASE });
    A(f.querySelector('.p'), [{ opacity: 0 }, { opacity: 1 }], { duration: 420, delay: 220, easing: SOFT });
    return;
  }
  A(svg, [{ transform: 'rotate(-70deg) scale(.7)', opacity: 0 }, { transform: 'none', opacity: 1 }], { duration: 1500, easing: EASE });
  svg.querySelectorAll('circle').forEach((c, i) => { const o = c.getAttribute('stroke-dasharray'), p = o.split(/[ ,]+/).map(parseFloat); A(c, [{ strokeDasharray: '0.01 ' + (p[0] + p[1]) }, { strokeDasharray: o }], { duration: 760, delay: 150 + i * 260, easing: EASE }); });
  A(hi, [{ transform: 'scale(.2) rotate(-16deg)', opacity: 0 }, { transform: 'scale(1) rotate(0)', opacity: 1 }], { duration: 900, delay: 1050, easing: SPRING });
  A(f.querySelector('.h1'), [{ opacity: 0, transform: 'translateY(26px)' }, { opacity: 1, transform: 'none' }], { duration: 760, delay: 1500, easing: EASE });
  A(f.querySelector('.p'), [{ opacity: 0, transform: 'translateY(18px)' }, { opacity: 1, transform: 'none' }], { duration: 760, delay: 1750, easing: EASE });
  A(f.querySelector('.sm.center'), [{ opacity: 0 }, { opacity: 1 }], { duration: 700, delay: 2100, easing: SOFT });
}
function enterFx(f, name, mode, opts) {
  const base = mode === 'fade' ? 500 : (mode === 'swap' || mode === 'xfade') ? 60 : mode === 'tab' ? 200 : 150;
  if (name === 'splash') return splashFx(f, opts.short);
  if (mode !== 'swap') stagger(f, base);
  bars(f, base + 120);
  flames(f);
  const nav = f.querySelector('.nav');
  if (nav && (mode === 'fade' || mode === 'push' || mode === 'back')) A(nav, [{ transform: 'translateY(110px)', opacity: 0 }, { transform: 'none', opacity: 1 }], { duration: 760, delay: base + 200, easing: SPRING });
  if (name === 'home') { drawRing(f, base + 150); const b = f.querySelector('.ringnum b'); if (b) count(b, +b.dataset.count || 0, 1500, base + 200); }
  if (name === 'done') {
    drawRing(f, base + 100);
    A(f.querySelector('.ringnum svg'), [{ transform: 'scale(0) rotate(-50deg)' }, { transform: 'scale(1) rotate(0)' }], { duration: 800, delay: base + 900, easing: SPRING });
    f.querySelectorAll('.row.gap8 .h2').forEach((e, i) => count(e, +e.dataset.count || 0, 1100, base + 700 + i * 150));
    f.querySelectorAll('.row.gap8 > .card').forEach((e, i) => A(e, [{ opacity: 0, transform: 'translateY(30px) scale(.9)' }, { opacity: 1, transform: 'none' }], { duration: 700, delay: base + 620 + i * 140, easing: SPRING }));
    confetti(f);
  }
  if (name === 'intro' || name === 'warm') {
    const bub = f.querySelector('.card.center .bub'); A(bub, [{ transform: 'scale(.5) rotate(-12deg)' }, { transform: 'scale(1) rotate(0)' }], { duration: 760, delay: base + 300, easing: SPRING });
  }
  if (name === 'speak') {
    const mic = f.querySelector('#mic');
    A(mic, [{ transform: 'scale(.6)', opacity: 0 }, { transform: 'scale(1)', opacity: 1 }], { duration: 760, delay: base + 200, easing: SPRING });
    f._pulse = A(mic, [{ boxShadow: '0 4px 0 #2b2525,0 0 0 0 rgba(246,196,223,.9)' }, { boxShadow: '0 4px 0 #2b2525,0 0 0 30px rgba(246,196,223,0)' }], { duration: 2400, delay: base + 900, iterations: Infinity, easing: 'ease-out', fill: 'none' });
    f.querySelectorAll('.wave i').forEach(b => { b.style.transform = 'scaleY(.16)'; b.style.opacity = '.45'; });
  }
}

// ----- screen switching --------------------------------------------------------------------------
const MODE_MS = { push: 680, next: 600, back: 680, tab: 620, fade: 1100, xfade: 480, swap: 30, none: 0 };
export function cancelTimers() { timers.forEach(clearTimeout); timers = []; }
export async function go(name, html, mode = 'push', opts = {}) {
  if (!root) throw new Error('fx not initialised');
  token++;
  const prev = cur ? cur.el : null;
  const el = document.createElement('div'); el.className = 'screen'; el.dataset.name = name; el.innerHTML = html;
  if (prev && mode === 'none') { prev.remove(); }
  root.appendChild(el);
  el.style.zIndex = 2; if (prev) prev.style.zIndex = 1;
  const anims = [], opt = d => ({ duration: d, easing: EASE, fill: 'both' });
  busy = true;
  const rtl = (document.documentElement.dir || 'rtl') === 'rtl';
  const s = rtl ? 1 : -1; // RTL: new screen comes from the left
  if (!prev || mode === 'none') { /* first */ }
  else if (mode === 'push' || mode === 'next') {
    const d = mode === 'push' ? 680 : 600;
    anims.push(A(el, [{ transform: `translateX(${-100 * s}%)` }, { transform: 'none' }], opt(d)));
    anims.push(A(prev, [{ transform: 'none', filter: 'brightness(1)' }, { transform: `translateX(${26 * s}%)`, filter: 'brightness(.9)' }], opt(d)));
  } else if (mode === 'back') {
    el.style.zIndex = 1; prev.style.zIndex = 2;
    anims.push(A(el, [{ transform: `translateX(${26 * s}%)`, filter: 'brightness(.9)' }, { transform: 'none', filter: 'brightness(1)' }], opt(680)));
    anims.push(A(prev, [{ transform: 'none' }, { transform: `translateX(${-100 * s}%)` }], opt(680)));
  } else if (mode === 'tab') {
    el.style.zIndex = 1; prev.style.zIndex = 2; prev.style.background = 'transparent';
    anims.push(A(prev.querySelector('.body'), [{ opacity: 1, transform: 'none' }, { opacity: 0, transform: 'translateY(-10px)' }], { duration: 240, easing: SOFT, fill: 'both' }));
    const pn = prev.querySelector('.nav'); if (pn) pn.style.visibility = 'hidden';
  } else if (mode === 'fade') {
    anims.push(A(el, [{ opacity: 0, transform: 'scale(.96)' }, { opacity: 1, transform: 'none' }], { duration: 900, delay: 200, easing: EASE, fill: 'both' }));
    anims.push(A(prev, [{ opacity: 1, transform: 'none' }, { opacity: 0, transform: 'scale(1.08)' }], { duration: 800, easing: SOFT, fill: 'both' }));
  } else if (mode === 'xfade') {
    anims.push(A(el, [{ opacity: 0 }, { opacity: 1 }], { duration: 480, easing: SOFT, fill: 'both' }));
  }
  cur = { name, el };
  if (mode !== 'none') enterFx(el, name, mode, opts); else { drawRing(el, 0); }
  const dur = RM() ? 30 : (MODE_MS[mode] ?? 30);
  await new Promise(r => setTimeout(r, dur + 40));
  anims.forEach(a => { try { a.cancel(); } catch {} });
  if (prev) { try { prev.getAnimations({ subtree: true }).forEach(a => a.cancel()); } catch {} prev.remove(); }
  el.style.zIndex = '';
  busy = false;
  return el;
}

// ----- sheets and dialogs (added on top of the current screen) -------------------------------------
export function openSheet(html, { shake } = {}) {
  const host = cur.el; closeSheetNow();
  const tpl = document.createElement('template'); tpl.innerHTML = html.trim();
  const nodes = Array.from(tpl.content.children);
  nodes.forEach(n => { n.classList.add('dyn'); host.appendChild(n); });
  const sheet = nodes.find(n => n.classList.contains('sheet')), dialog = nodes.find(n => n.classList.contains('dialog')), scrim = nodes.find(n => n.classList.contains('scrim'));
  if (scrim) A(scrim, [{ opacity: 0 }, { opacity: 1 }], { duration: 420, easing: SOFT });
  if (sheet) {
    A(sheet, [{ transform: 'translateY(105%)' }, { transform: 'none' }], { duration: 760, easing: SPRING });
    A(sheet.querySelector('svg'), [{ transform: 'scale(0) rotate(-40deg)' }, { transform: 'scale(1) rotate(0)' }], { duration: 700, delay: 360, easing: SPRING });
    A(sheet.querySelector('.btn'), [{ opacity: 0, transform: 'translateY(14px)' }, { opacity: 1, transform: 'none' }], { duration: 560, delay: 520, easing: EASE });
  }
  if (dialog) A(dialog, [{ opacity: 0, transform: 'translateY(-46%) scale(.9)' }, { opacity: 1, transform: 'translateY(-52%) scale(1)' }], { duration: 560, easing: SPRING });
  if (shake) A(shake, [{ transform: 'translateX(0)' }, { transform: 'translateX(-9px)' }, { transform: 'translateX(8px)' }, { transform: 'translateX(-5px)' }, { transform: 'translateX(3px)' }, { transform: 'none' }], { duration: 560, easing: SOFT, fill: 'none' });
  return sheet || dialog;
}
export function closeSheetNow() { if (cur) cur.el.querySelectorAll('.dyn').forEach(e => e.remove()); }
export function closeSheet() {
  if (!cur) return Promise.resolve();
  const els = Array.from(cur.el.querySelectorAll('.dyn'));
  if (!els.length) return Promise.resolve();
  const anims = els.map(e => A(e, [{ opacity: 1, transform: getComputedStyle(e).transform === 'none' ? 'none' : getComputedStyle(e).transform }, e.classList.contains('sheet') ? { opacity: 1, transform: 'translateY(105%)' } : { opacity: 0, transform: e.style.transform || 'none' }], { duration: 380, easing: SOFT, fill: 'forwards' }));
  return Promise.all(anims.map(a => a.finished || Promise.resolve())).catch(() => {}).then(() => els.forEach(e => e.remove()));
}
export function press(el) { A(el, [{ transform: 'scale(1)' }, { transform: 'scale(.92)' }, { transform: 'scale(1.04)' }, { transform: 'none' }], { duration: 420, easing: EASE, fill: 'none' }); }
export function pop(el) { A(el, [{ transform: 'scale(.96)' }, { transform: 'scale(1.03)' }, { transform: 'none' }], { duration: 480, easing: SPRING, fill: 'none' }); }
export function idleHint(f) {
  const id = setTimeout(() => { if (RM() || !f.isConnected) return; const b = Array.from(f.querySelectorAll('.body .btn:not(.text):not(.off)')).pop(); if (b) A(b, [{ transform: 'scale(1)' }, { transform: 'scale(1.035)' }, { transform: 'scale(1)' }], { duration: 1600, iterations: 3, easing: 'ease-in-out', fill: 'none' }); }, 4200);
  timers.push(id);
}
export const resetBars = () => { lastPct = 0; };
