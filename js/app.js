// App controller: boot, state, navigation, sessions, settings, backup.
import { db } from './db.js';
import { loadContent } from './content.js';
import { newCard, review, preview } from './fsrs.js';
import { dayKey, fmtInterval, lenientMatch, shuffle } from './util.js';
import * as E from './engine.js';
import { buildBackup, validateBackup, backupFileName } from './backup.js';
import { speak, stopSpeaking, unlockTTS, startRecording, playBlob } from './tts.js';
import * as UI from './screens.js';
import { initFx, go, dragStart, current, isBusy, openSheet, closeSheet, press, pop, A, EASE, SPRING, SOFT, idleHint, resetBars, cancelTimers } from './fx.js';

const VERSION = '1.0';
const $app = document.getElementById('app');
const S = {
  content: null, cards: new Map(), settings: { minutes: 20, rate: 'normal', restDay: true, theme: 'auto', goals: [] },
  streak: null, log: {}, seen: new Set(), meta: {}, session: null, preview: null, offline: !navigator.onLine,
  ui: { ob: 'welcome', goals: [], unitId: null, dlgBack: 'unit', ex: null, rec: null, blob: null, audio: 0 },
};
const now = () => new Date();
const today = () => dayKey(now());
const standalone = () => (window.matchMedia && matchMedia('(display-mode: standalone)').matches) || window.navigator.standalone === true;
const toast = msg => {
  const t = document.createElement('div'); t.className = 'toast'; t.textContent = msg; (current()?.el || $app).appendChild(t);
  A(t, [{ opacity: 0, transform: 'translateY(16px)' }, { opacity: 1, transform: 'none' }], { duration: 420, easing: EASE });
  setTimeout(() => A(t, [{ opacity: 1 }, { opacity: 0 }], { duration: 400, fill: 'forwards' }).finished?.then(() => t.remove()).catch(() => t.remove()), 2600);
};

// ----- persistence --------------------------------------------------------------------------------
const save = {
  settings: () => db.set('settings', S.settings), streak: () => db.set('streak', S.streak), log: () => {
    const keep = Object.keys(S.log).sort().slice(-60); S.log = Object.fromEntries(keep.map(k => [k, S.log[k]])); return db.set('log', S.log);
  },
  seen: () => db.set('seenGrammar', [...S.seen]), meta: () => db.set('meta', S.meta), session: () => S.session ? db.set('session', S.session) : db.del('session'),
};
async function loadState() {
  const [cards, kv] = await Promise.all([db.getAllCards(), db.allKv()]);
  S.cards = new Map(cards.map(c => [c.id, c]));
  S.settings = { ...S.settings, ...(kv.settings || {}) };
  S.streak = kv.streak || null; S.log = kv.log || {}; S.seen = new Set(kv.seenGrammar || []); S.meta = kv.meta || {};
  S.session = kv.session && kv.session.date === today() && kv.session.idx < kv.session.steps.length - 1 && !kv.session.finalized ? kv.session : null;
  if (kv.session && !S.session) db.del('session');
}
function applyTheme() {
  const t = S.settings.theme, r = document.documentElement;
  if (t === 'light' || t === 'dark') r.dataset.theme = t; else delete r.dataset.theme;
  const dark = t === 'dark' || (t === 'auto' && matchMedia('(prefers-color-scheme: dark)').matches);
  const m = document.querySelector('meta[name=theme-color]'); if (m) m.content = dark ? '#1c1a17' : '#f8f2e4';
}

// ----- derived data ----------------------------------------------------------------------------------
const logToday = () => S.log[today()] || { new: 0, reviews: 0 };
function homeData() {
  const pending = E.pendingReviews(S.cards, now()).length, plan = E.PLANS[S.settings.minutes] || E.PLANS[20];
  const lt = logToday();
  const d = { greet: E.greeting(now().getHours()), dayNo: E.dayNumber(S.meta.firstUse, today()), streak: E.streakShown(S.streak, today(), S.settings.restDay), words: E.wordsKnown(S.cards), pending, heavy: pending > E.HEAVY_REVIEWS, minutes: S.settings.minutes, offline: S.offline, state: 'start', first: false };
  if (S.session) { d.state = 'resume'; d.left = E.minutesLeft(S.session, plan); }
  else if (lt.done) d.state = 'done';
  d.first = S.cards.size === 0 && !S.session && !lt.done;
  return d;
}
function unitStats(u, i) { return { n: i + 1, total: u.items.length || 1, learned: u.items.filter(x => S.cards.has(x.id)).length }; }
const hasUnintroduced = () => S.content.openUnits.some(u => u.items.some(i => !S.cards.has(i.id)));

// ----- navigation -------------------------------------------------------------------------------------------
function view(name) {
  const c = S.content;
  switch (name) {
    case 'home': return ['home', UI.home(homeData())];
    case 'units': {
      const rows = c.units.map((u, i) => UI.unitRow(u, unitStats(u, i)));
      return ['units', UI.units(rows, c.openUnits.length)];
    }
    case 'unit': { const i = c.units.findIndex(u => u.id === S.ui.unitId); return ['unit', UI.unitDetail(c.units[i], unitStats(c.units[i], i))]; }
    case 'dialogs': {
      const list = c.units.flatMap((u, i) => u.dialogues.map(d => ({ ...d, color: u.color, icon: u.icon, n: i + 1 })));
      return ['dialogs', UI.dialogsTab(list)];
    }
    case 'settings': return ['settings', UI.settings({ ...S.settings, version: VERSION })];
    case 'backup': return ['backup', UI.backupScreen(S.meta.lastBackup ? new Date(S.meta.lastBackup).toLocaleDateString('he-IL') : '')];
    default: return ['home', UI.home(homeData())];
  }
}
async function nav(name, mode = 'push') {
  stopSpeaking(); S.ui.audio++; cancelRec(); S.preview = name === 'home' ? null : S.preview;
  const [n, html] = view(name); const el = await go(n, html, mode); idleHint(el); return el;
}

// ----- sessions ------------------------------------------------------------------------------------------------------
function ctx(kind, extra = {}) { return { now: now(), content: S.content, cards: S.cards, settings: S.settings, log: S.log, seenGrammar: S.seen, kind, ...extra }; }
async function prepare(kind, extra) {
  const s = E.buildSession(ctx(kind, extra));
  const acts = s.steps.filter(x => x.k !== 'summary').length;
  if (!acts) { S.preview = null; await showNothing(); return null; }
  S.preview = s; return s;
}
async function showNothing() { await go('empty', UI.nothing(!hasUnintroduced()), 'push'); }
async function startPlan() {
  const s = await prepare('daily'); if (!s) return;
  const m = (E.PLANS[S.settings.minutes] || E.PLANS[20]).min;
  const u = s.unit ? S.content.units.find(x => x.id === s.unit) : null;
  await go('plan', UI.plan({ mins: m, warm: s.warm, reviews: s.reviews, newItems: s.newItems, speak: s.speak, grammar: s.grammar, unitTitle: u ? u.titleHe : '' }), 'push');
}
async function beginSession(s) {
  S.session = { ...s, idx: 0, ms: 0, stats: { reviews: 0, newItems: 0, spoken: 0 }, t0: Date.now() };
  S.preview = null; resetBars(); await save.session(); await renderStep('push');
}
async function resume() { resetBars(); S.ui.stepStart = Date.now(); await renderStep('push'); }
const stepItem = st => S.content.itemById.get(st.id);
const totalSteps = () => S.session.steps.filter(x => x.k !== 'summary').length;
const pool = () => S.content.openUnits.flatMap(u => u.items);

async function advance(mode = 'next') {
  const s = S.session; const t = Date.now(); s.ms += Math.min(60000, t - (S.ui.stepStart || t));
  s.idx++; await save.session(); await renderStep(mode);
}
async function grade(id, g) {
  const c = review(S.cards.get(id) || newCard(id, now()), g, now()); S.cards.set(id, c); await db.putCard(c); return c;
}
function requeue(id) {
  const s = S.session; const pos = Math.min(s.idx + 4, s.steps.length - 1);
  s.steps.splice(pos, 0, { k: 'retry', id });
}
async function bumpLog(field) { const k = today(); S.log[k] = { new: 0, reviews: 0, ...(S.log[k] || {}) }; S.log[k][field] = (S.log[k][field] || 0) + 1; await save.log(); }

async function renderStep(mode = 'next') {
  const s = S.session, st = s.steps[s.idx]; S.ui.stepStart = Date.now(); S.ui.audio++; S.ui.ex = null; S.ui.blob = null; S.ui.fb = null;
  const n = s.idx + 1, total = totalSteps(), it = st.id ? stepItem(st) : null, aud = S.ui.audio;
  let el;
  const say = (text, delay = 500) => setTimeout(() => { if (S.ui.audio === aud) speak(text, { pref: S.settings.rate }); }, delay);
  switch (st.k) {
    case 'warm': el = await go('warm', UI.warm(it, n, total), mode); say(it.en, 700); break;
    case 'intro': el = await go('intro', UI.intro(it, n, total), mode); say(it.en, 800); break;
    case 'grammar': el = await go('grammar', UI.grammar(S.content.grammarById.get(st.gid), n, total), mode); break;
    case 'summary': return renderSummary(mode);
    case 'speak': el = await go('speak', UI.speakEx(it, n, total), mode); break;
    case 'drill': {
      const g = S.content.grammarById.get(st.gid), d = g.drills[st.i];
      if (d.type === 'fill') { S.ui.ex = { kind: 'fill', ex: { text: d.text.replace(/_+/g, '____'), he: d.he, answer: d.answer }, drill: true }; el = await go('fill', UI.fillEx(S.ui.ex.ex, n, total, 'תרגול · ' + g.titleHe), mode); }
      else { const ex = E.makeBuild({ id: 'drill', en: d.answer, he: d.he }, [], Math.random); S.ui.ex = { kind: 'build', ex, drill: true }; el = await go('build', UI.build(ex, n, total, 'תרגול · ' + g.titleHe), mode); }
      break;
    }
    default: { // review | check | retry
      let t = st.t || 'flash';
      const stage = st.k === 'check' ? 'חומר חדש · בדיקה' : st.k === 'retry' ? 'עוד פעם' : 'חזרה';
      if (st.k === 'retry') t = 'flash';
      if (t === 'build') { const ex = E.makeBuild(it, pool()); S.ui.ex = { kind: 'build', ex, it }; el = await go('build', UI.build(ex, n, total, stage), mode); }
      else if (t === 'listen') { const ex = E.makeListen(it, pool()); S.ui.ex = { kind: 'listen', ex, it, sel: null }; el = await go('listen', UI.listen(ex, n, total, stage), mode); say(it.en, 650); }
      else if (t === 'fill') { const ex = E.fillBlank(it.en); S.ui.ex = { kind: 'fill', ex: { ...ex, he: it.he }, it }; el = await go('fill', UI.fillEx(S.ui.ex.ex, n, total, stage), mode); }
      else {
        S.ui.ex = { kind: 'flash', it, st };
        el = await go('flash', UI.flash(it, n, total, stage, E.hintFor(it.en)), mode);
      }
    }
  }
  if (el) idleHint(el);
}

// ----- exercises ------------------------------------------------------------------------------------------------------
const f = () => current().el;
const $ = sel => f().querySelector(sel);

async function onReveal() {
  const ex = S.ui.ex; if (!ex || ex.kind !== 'flash' || ex.shown) return; ex.shown = true;
  const a = $('#answer'), pre = $('#pre'), post = $('#post'), rate = $('#rate');
  $('#hint').style.display = 'none';
  const isRetry = ex.st.k === 'retry';
  if (isRetry) post.innerHTML = '<div class="btn mt16" data-a="next" role="button">הבנתי, המשך</div>';
  else { const c = S.cards.get(ex.it.id) || newCard(ex.it.id, now()); const iv = preview(c, now()); rate.innerHTML = UI.rateButtons(iv.map(fmtInterval)); }
  pre.style.display = 'none'; a.style.display = ''; post.style.display = '';
  A(a, [{ opacity: 0, transform: 'translateY(12px)' }, { opacity: 1, transform: 'none' }], { duration: 560, easing: EASE });
  A(post, [{ opacity: 0, transform: 'translateY(18px)' }, { opacity: 1, transform: 'none' }], { duration: 600, delay: 160, easing: SPRING });
  speak(ex.it.en, { pref: S.settings.rate });
}
async function onRate(g) {
  const ex = S.ui.ex; if (!ex || ex.rated) return; ex.rated = true;
  await grade(ex.it.id, g); S.session.stats.reviews++; await bumpLog('reviews');
  if (g === 1) requeue(ex.it.id);
  await advance('next');
}
function onTile(el) {
  const slot = $('#slot'), box = $('#tiles'); if (!slot || S.ui.ex?.done) return;
  const inSlot = el.parentElement === slot; (inSlot ? box : slot).appendChild(el); pop(el);
  $('#chk').classList.toggle('off', slot.children.length === 0);
}
function onOpt(el) {
  const ex = S.ui.ex; if (!ex || ex.done) return;
  f().querySelectorAll('.opt').forEach(o => o.classList.remove('sel')); el.classList.add('sel'); pop(el);
  ex.sel = +el.dataset.v; $('#chk').classList.remove('off');
}
async function onCheck() {
  const ex = S.ui.ex, st = S.session.steps[S.session.idx]; if (!ex || ex.done) return;
  let ok = false, close = false, answer = '', note = '';
  if (ex.kind === 'build') {
    const ids = [...$('#slot').children].map(t => +t.dataset.v); if (!ids.length) return;
    ok = E.checkBuild(ex.ex, ids); answer = ex.ex.answer; note = ex.it ? ex.it.he : ex.ex.he;
  } else if (ex.kind === 'listen') {
    if (ex.sel == null) return; ok = ex.sel === ex.ex.correct; answer = ex.ex.en; note = ex.it.he;
    const opts = [...f().querySelectorAll('.opt')]; opts.forEach(o => o.classList.remove('sel')); opts[ex.ex.correct].classList.add('ok'); if (!ok) opts[ex.sel].classList.add('no');
  } else if (ex.kind === 'fill') {
    const inp = $('#fillIn'); const v = inp.value.trim(); if (!v) return; inp.blur();
    const m = lenientMatch(v, ex.ex.answer); ok = m !== 'no'; close = m === 'close';
    answer = ex.it ? ex.it.en : ex.ex.text.replace('____', ex.ex.answer); note = ex.ex.he;
  }
  ex.done = true; f().querySelectorAll('.tile').forEach(t => t.style.pointerEvents = 'none');
  // scheduling
  if (!ex.drill) {
    const g = ok ? (close ? 2 : 3) : 1;
    await grade(ex.it.id, g); if (st.k === 'review') { S.session.stats.reviews++; await bumpLog('reviews'); }
    if (!ok) requeue(ex.it.id);
  }
  const shakeEl = ex.kind === 'listen' && !ok ? f().querySelectorAll('.opt')[ex.sel] : ex.kind === 'build' && !ok ? $('#slot') : null;
  S.ui.fb = UI.feedback(ok, { en: answer, close, note }); // kept so the exit dialog can restore it
  openSheet(S.ui.fb, { shake: shakeEl });
  if (ex.kind !== 'listen') speak(answer, { pref: S.settings.rate });
}

// ----- speaking ------------------------------------------------------------------------------------------------------
function cancelRec() {
  if (S.ui.rec) { try { S.ui.rec.cancel(); } catch {} S.ui.rec = null; }
  clearInterval(S.ui.recTimer); clearTimeout(S.ui.recAuto);
}
async function onMic() {
  if (S.ui.rec) return onRecDone();
  if (S.ui.micBusy) return; S.ui.micBusy = true;
  const aud = S.ui.audio;
  try {
    stopSpeaking();
    const rec = await startRecording(); if (aud !== S.ui.audio) { rec.cancel(); return; }
    S.ui.rec = rec; recUI();
  } catch (e) {
    if (e && e.name === 'NotSupportedError') { toast('ההקלטה לא נתמכת במכשיר הזה'); S.ui.blob = null; await renderCompare(); }
    else await go('mic', UI.micPermission(), 'push');
  } finally { S.ui.micBusy = false; }
}
function recUI() {
  const fr = f(), mic = fr.querySelector('#mic'), lab = fr.querySelector('#lab'), btn = fr.querySelector('#recDone');
  fr.getAnimations({ subtree: true }).forEach(a => { if (mic.contains(a.effect?.target) || a.effect?.target === mic) a.cancel(); });
  mic.style.background = 'var(--heart)';
  A(mic, [{ transform: 'scale(.9)' }, { transform: 'scale(1.06)' }, { transform: 'scale(1)' }], { duration: 560, easing: SPRING, fill: 'none' });
  A(mic, [{ boxShadow: '0 4px 0 #2b2525,0 0 0 0 rgba(236,122,151,.6)' }, { boxShadow: '0 4px 0 #2b2525,0 0 0 32px rgba(236,122,151,0)' }], { duration: 1500, iterations: Infinity, easing: 'ease-out', fill: 'none' });
  fr.querySelectorAll('.wave i').forEach((b, i) => { b.style.opacity = '1'; b.style.transform = ''; A(b, [{ transform: 'scaleY(.2)' }, { transform: 'scaleY(1.05)' }], { duration: 520 + ((i * 137) % 380), delay: (i * 70) % 420, direction: 'alternate', iterations: Infinity, easing: 'ease-in-out', fill: 'none' }); });
  let s = 0; const fmt = n => `${Math.floor(n / 60)}:${String(n % 60).padStart(2, '0')}`;
  lab.textContent = 'מקליטה… 0:00';
  S.ui.recTimer = setInterval(() => { s++; lab.textContent = 'מקליטה… ' + fmt(s); }, 1000);
  S.ui.recAuto = setTimeout(onRecDone, 30000);
  btn.style.pointerEvents = 'auto'; btn.style.opacity = '1';
  A(btn, [{ opacity: 0, transform: 'translateY(34px)' }, { opacity: 1, transform: 'none' }], { duration: 700, delay: 500, easing: SPRING });
}
async function onRecDone() {
  const rec = S.ui.rec; if (!rec) return; S.ui.rec = null; clearInterval(S.ui.recTimer); clearTimeout(S.ui.recAuto);
  const btn = f().querySelector('#recDone'); if (btn) btn.style.pointerEvents = 'none';
  S.ui.blob = await rec.stop(); await renderCompare();
}
async function renderCompare() {
  const s = S.session, st = s.steps[s.idx], it = stepItem(st);
  await go('speakCmp', UI.speakCompare(it, s.idx + 1, totalSteps()), 'xfade');
}

// ----- summary -------------------------------------------------------------------------------------------------------------
async function renderSummary(mode) {
  const s = S.session, practice = s.kind === 'practice';
  if (!practice && !s.finalized) {
    s.finalized = true;
    S.streak = E.computeStreak(S.streak, today(), S.settings.restDay); await save.streak();
    const k = today(); S.log[k] = { new: 0, reviews: 0, ...(S.log[k] || {}) }; if (s.kind === 'daily') S.log[k].done = true; await save.log();
  }
  await save.session();
  const mins = Math.max(1, Math.round(s.ms / 60000));
  await go('done', UI.summary({ practice, reviews: s.stats.reviews, newItems: s.stats.newItems, spoken: s.stats.spoken, streak: S.streak ? S.streak.current : 0, minutes: mins, nextNew: hasUnintroduced() }), mode === 'next' ? 'fade' : mode);
}
async function finish() {
  S.session = null; await db.del('session'); await nav('home', 'back');
}

// ----- settings, backup ------------------------------------------------------------------------------------------------------
async function exportBackup() {
  const kv = await db.allKv(); const b = buildBackup([...S.cards.values()], kv, now());
  const name = backupFileName(now()), blob = new Blob([JSON.stringify(b)], { type: 'application/json' });
  try {
    const file = new File([blob], name, { type: 'application/json' });
    if (navigator.canShare && navigator.canShare({ files: [file] })) await navigator.share({ files: [file], title: 'גיבוי לימוד אנגלית' });
    else { const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name; document.body.appendChild(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1500); }
  } catch (e) { if (e && e.name === 'AbortError') return; await go('backupDone', UI.backupDone('לא הצלחתי לשמור את הקובץ.', false), 'push'); return; }
  S.meta.lastBackup = now().toISOString(); await save.meta();
  await go('backupDone', UI.backupDone('הקובץ מוכן. שמרי אותו במקום בטוח, למשל ב״קבצים״ או במייל.'), 'push');
}
async function onImportFile(file) {
  let obj; try { obj = JSON.parse(await file.text()); } catch { return go('backupDone', UI.backupDone('הקובץ לא נקרא.', false), 'push'); }
  const v = validateBackup(obj); if (!v.ok) return go('backupDone', UI.backupDone(v.error, false), 'push');
  S.ui.importData = obj; openSheet(UI.confirmDialog('import'));
}
async function applyImport() {
  const o = S.ui.importData; await closeSheet();
  await db.clearAll(); await db.putCards(o.cards);
  for (const [k, v] of Object.entries(o.kv)) await db.set(k, v);
  await loadState();
  if (!S.meta.onboarded) { S.meta.onboarded = true; await save.meta(); }
  applyTheme(); S.ui.importData = null;
  await go('backupDone', UI.backupDone(`שוחזרו ${o.cards.length} כרטיסיות והגדרות.`), 'push');
}
async function setSetting(v, el) {
  const [k, val] = v.split(':'); S.settings[k] = k === 'minutes' ? +val : val; await save.settings();
  el.parentElement.querySelectorAll('span').forEach(x => x.classList.toggle('on', x === el));
  if (k === 'theme') applyTheme();
  if (k === 'rate') speak('Hello, nice to meet you.', { pref: S.settings.rate });
}

// ----- events ------------------------------------------------------------------------------------------------------------------
const OB = ['welcome', 'goals', 'time'];
async function obGo(to) {
  if (to === 'finish') {
    S.settings.goals = S.ui.goals; await save.settings(); S.meta.onboarded = true; S.meta.firstUse = S.meta.firstUse || today(); await save.meta();
    return standalone() ? nav('home', 'fade') : go('install', UI.install(), 'push');
  }
  if (to === 'done') return nav('home', 'fade');
  const back = OB.indexOf(to) < OB.indexOf(S.ui.ob); S.ui.ob = to;
  const html = to === 'welcome' ? UI.welcome() : to === 'goals' ? UI.goals(S.ui.goals) : UI.timeChoice(S.settings.minutes, S.settings.restDay);
  await go(to, html, back ? 'back' : 'push');
}
async function act(a, el) {
  const v = el.dataset.v;
  switch (a) {
    case 'tab': if (current().name !== v) { press(el); await nav(v, 'tab'); } return;
    case 'back': return nav(v, 'back');
    case 'start': press(el);
      if (S.session) return resume();
      if (logToday().done) return act('mini', el);
      if (S.cards.size === 0) return act('begin', el);
      return startPlan();
    case 'resume': return resume();
    case 'mini': { const s = await prepare('mini'); if (s) await go('mini', UI.miniIntro(s.reviews), 'push'); return; }
    case 'speakonly': { const s = await prepare('speak'); if (!s) { toast('עוד אין מה לתרגל'); return; } return beginSession(s); }
    case 'begin': { const s = S.preview || await prepare('daily'); if (s) await beginSession(s); return; }
    case 'next': return advance('next');
    case 'introDone': {
      const st = S.session.steps[S.session.idx]; if (!S.cards.has(st.id)) { const c = newCard(st.id, now()); S.cards.set(st.id, c); await db.putCard(c); }
      S.session.stats.newItems++; await bumpLog('new'); return advance('next');
    }
    case 'reveal': return onReveal();
    case 'hint': $('#hint').style.display = ''; el.style.display = 'none'; A($('#hint'), [{ opacity: 0 }, { opacity: 1 }], { duration: 400 }); return;
    case 'rate': return onRate(+v);
    case 'tile': return onTile(el);
    case 'opt': return onOpt(el);
    case 'check': return onCheck();
    case 'sheetNext': {
      const st = S.session.steps[S.session.idx]; await closeSheet();
      return advance('next');
    }
    case 'say': {
      pop(el); const slow = !!el.dataset.slow, p = el.dataset.p ? +el.dataset.p : 1;
      return void speak(el.dataset.t, { slow, pref: S.settings.rate, pitch: p });
    }
    case 'exit': return void openSheet(UI.exitDialog());
    case 'exitNo': await closeSheet(); if (S.ui.fb && S.ui.ex?.done) openSheet(S.ui.fb); return;
    case 'exitYes': { cancelRec(); stopSpeaking(); if (S.session) { S.session.ms += Math.min(60000, Date.now() - (S.ui.stepStart || Date.now())); await save.session(); if (S.session.kind === 'practice') { S.session = null; await db.del('session'); } } return nav('home', 'back'); }
    case 'closeSheet': return closeSheet();
    case 'mic': return onMic();
    case 'recDone': return onRecDone();
    case 'skipSpeak': { cancelRec(); return advance('next'); }
    case 'micBack': return renderStep('back');
    case 'micRetry': {
      try { const r = await startRecording(); r.cancel(); await renderStep('back'); } catch { toast('המיקרופון עדיין חסום. אפשר לפתוח אותו בהגדרות האייפון.'); }
      return;
    }
    case 'cmpOrig': return void speak(stepItem(S.session.steps[S.session.idx]).en, { pref: S.settings.rate });
    case 'cmpMine': return S.ui.blob ? void playBlob(S.ui.blob) : toast('אין הקלטה להשמעה');
    case 'again': return renderStep('xfade');
    case 'spkRate': {
      const st = S.session.steps[S.session.idx], c = S.cards.get(st.id), r = +v;
      if (c) { c.speakWeak = Math.max(0, (c.speakWeak || 0) + (r === 0 ? 1 : r === 2 ? -1 : 0)); await db.putCard(c); }
      S.session.stats.spoken++; return advance('next');
    }
    case 'finish': return finish();
    case 'unit': S.ui.unitId = v; return nav('unit', 'push');
    case 'locked': { const i = S.content.units.findIndex(u => u.id === v); return void openSheet(UI.lockedSheet(S.content.units[i], i + 1)); }
    case 'unitStart': { const s = await prepare('daily', { unitFocus: v }); if (!s) return; const m = (E.PLANS[S.settings.minutes] || E.PLANS[20]).min; const u = s.unit ? S.content.units.find(x => x.id === s.unit) : null; return void go('plan', UI.plan({ mins: m, warm: s.warm, reviews: s.reviews, newItems: s.newItems, speak: s.speak, grammar: s.grammar, unitTitle: u ? u.titleHe : '' }), 'push'); }
    case 'gram': return void go('gramView', UI.grammarView(S.content.grammarById.get(v), 'unit'), 'push');
    case 'gramPractice': return beginSession({ ...E.buildGrammarPractice(S.content.grammarById.get(v)) });
    case 'dlg': { S.ui.dlgBack = el.dataset.from || 'unit'; const d = S.content.dialogueById.get(v); if (S.ui.dlgBack === 'unit') S.ui.unitId = d.unit; return void go('dialogue', UI.dialogue(d, S.ui.dlgBack), 'push'); }
    case 'dlgAll': {
      const aud = ++S.ui.audio, lines = [...f().querySelectorAll('.bubble-msg')], slow = !!el.dataset.slow;
      for (const b of lines) {
        if (S.ui.audio !== aud) return; pop(b); b.style.outline = '3px solid var(--yellow)';
        await speak(b.dataset.t, { slow, pref: S.settings.rate, pitch: +b.dataset.p || 1 }); b.style.outline = '';
        await new Promise(r => setTimeout(r, 350));
      }
      return;
    }
    case 'goal': { const g = S.ui.goals; const i = g.indexOf(v); if (i < 0) g.push(v); else g.splice(i, 1); return void go('goals', UI.goals(g), 'swap'); }
    case 'time': S.settings.minutes = +v; return void go('time', UI.timeChoice(S.settings.minutes, S.settings.restDay), 'swap');
    case 'toggle': S.settings.restDay = !S.settings.restDay; el.classList.toggle('on', S.settings.restDay); return save.settings();
    case 'ob': return obGo(v);
    case 'set': return setSetting(v, el);
    case 'tips': return void openSheet(UI.tipsSheet());
    case 'backup': return nav('backup', 'push');
    case 'doExport': return exportBackup();
    case 'pickImport': return void $('#importFile').click();
    case 'doImport': return applyImport();
    case 'reset': return void openSheet(UI.confirmDialog('reset'));
    case 'doReset': { cancelRec(); await db.clearAll(); location.reload(); return; }
    case 'reload': return location.reload();
  }
}

let busyAct = false;
$app.addEventListener('click', async e => {
  const el = e.target.closest('[data-a]'); if (!el) return;
  const a = el.dataset.a, passthrough = ['say', 'exit', 'exitNo', 'closeSheet', 'pickImport', 'dlgAll', 'cmpOrig', 'cmpMine', 'reveal', 'hint', 'tile', 'opt', 'toggle', 'set', 'check', 'mic', 'recDone'];
  unlockTTS();
  if ((isBusy() || busyAct) && !passthrough.includes(a)) return;
  if (isBusy()) return;
  if (!passthrough.includes(a)) busyAct = true;
  try { await act(a, el); } catch (err) { console.error(err); } finally { busyAct = false; }
});
// ----- swipe navigation (iOS style, RTL) -----------------------------------------------------------------------------
// Tabs: finger right = next tab, finger left = previous. Inner screens: finger left = back (or right from the left edge).
// No swipes inside a session, so an exercise is never left by accident.
const TABS = ['home', 'units', 'dialogs', 'settings'];
// Tabs and plain "back" screens follow the finger (fx.dragStart); onboarding and edge swipes fall back to a tap.
let touch = null, drag = null;
const canSwipe = () => { const c = current(); return c && !isBusy() && !busyAct && !c.el.querySelector('.dyn') ? c : null; };
function beginDrag(dx) {
  const cur = canSwipe(); if (!cur) return null;
  let to = null, dir = 'back';
  const tab = TABS.indexOf(cur.name);
  if (tab >= 0) { to = TABS[tab + (dx > 0 ? 1 : -1)]; dir = dx > 0 ? 'fwd' : 'back'; }
  else if (dx < 0) to = cur.el.querySelector('.body > .row:first-child > .close.flip[data-a="back"]')?.dataset.v;
  if (!to) return null;
  const [n, html] = view(to), h = dragStart(n, html, dir); if (!h) return null;
  stopSpeaking(); S.ui.audio++; cancelRec();
  return { h, to, dir };
}
$app.addEventListener('touchstart', e => {
  touch = e.touches.length === 1 && !e.target.closest('input,textarea,.seg,.switch') ? { x: e.touches[0].clientX, y: e.touches[0].clientY, t: Date.now(), lx: e.touches[0].clientX, lt: Date.now(), v: 0 } : null;
}, { passive: true });
$app.addEventListener('touchmove', e => {
  if (!touch) return;
  const x = e.touches[0].clientX, dx = x - touch.x, dy = e.touches[0].clientY - touch.y, now = Date.now();
  if (now > touch.lt) { touch.v = (x - touch.lx) / (now - touch.lt); touch.lx = x; touch.lt = now; }
  if (!touch.dir) {
    if (Math.abs(dx) < 10 && Math.abs(dy) < 10) return;
    touch.dir = Math.abs(dx) > 1.2 * Math.abs(dy) ? 'h' : 'v';
    if (touch.dir === 'h') drag = beginDrag(dx);
  }
  if (drag) drag.h.move(dx);
}, { passive: true });
async function endDrag(dx, v) {
  const d = drag; drag = null;
  const sign = d.dir === 'fwd' ? 1 : -1, W = $app.clientWidth || 390;
  const commit = sign * dx > W * 0.33 || (sign * v > 0.45 && sign * dx > 24); // a third of the way, or a quick flick
  const el = await d.h.end(commit);
  if (el) { if (d.to === 'home') S.preview = null; idleHint(el); }
}
$app.addEventListener('touchend', e => {
  if (!touch) return;
  const t = touch; touch = null;
  const p = e.changedTouches[0], dx = p.clientX - t.x, dy = p.clientY - t.y;
  if (drag) { endDrag(dx, t.v); return; }
  // no live drag (onboarding, mic screen, edge swipe to the right): a quick swipe acts like the button
  if (Math.abs(dx) < 60 || Math.abs(dx) < 1.6 * Math.abs(dy) || Date.now() - t.t > 800) return;
  const cur = canSwipe(); if (!cur || TABS.includes(cur.name)) return;
  if (OB.includes(cur.name) && dx > 0) { cur.el.querySelector('.btn[data-a="ob"]')?.click(); return; }
  if (dx < 0 || t.x < 32) cur.el.querySelector('.body > .row:first-child > .close.flip[data-a]')?.click();
}, { passive: true });
$app.addEventListener('touchcancel', () => { touch = null; if (drag) { const d = drag; drag = null; d.h.end(false); } }, { passive: true });

$app.addEventListener('change', e => { if (e.target.id === 'importFile' && e.target.files[0]) { onImportFile(e.target.files[0]); e.target.value = ''; } });
$app.addEventListener('keydown', e => { if (e.key === 'Enter' && e.target.id === 'fillIn') { e.preventDefault(); onCheck(); } });
$app.addEventListener('input', e => { if (e.target.id === 'fillIn') $('#chk').classList.toggle('off', !e.target.value.trim()); });
addEventListener('online', () => { S.offline = false; refreshHomeBanner(); });
addEventListener('offline', () => { S.offline = true; refreshHomeBanner(); });
// Reopened from the background on a new day: reload so greeting, streak and today's plan are fresh.
let bootDay = null;
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState !== 'visible' || !bootDay || today() === bootDay || isBusy()) return;
  if (current() && ['home', 'units', 'dialogs', 'settings'].includes(current().name)) location.reload();
});
function refreshHomeBanner() { if (current() && current().name === 'home' && !isBusy()) { const [n, html] = view('home'); go(n, html, 'swap'); } }

// ----- boot ----------------------------------------------------------------------------------------------------------------------------
async function boot() {
  initFx($app);
  try {
    S.content = await loadContent('./');
    await loadState();
  } catch (e) {
    console.error(e); await go('error', UI.loadError(), 'swap'); return;
  }
  applyTheme(); bootDay = today();
  if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(() => {});
  if ('serviceWorker' in navigator && location.protocol !== 'file:') navigator.serviceWorker.register('./sw.js').catch(() => {});
  const short = S.meta.lastSplash === today();
  await go('splash', UI.splash(short), 'swap', { short });
  S.meta.lastSplash = today(); save.meta();
  await new Promise(r => setTimeout(r, matchMedia('(prefers-reduced-motion: reduce)').matches ? 200 : short ? 1000 : 3700));
  if (!S.meta.onboarded) { S.ui.ob = 'welcome'; await go('welcome', UI.welcome(), 'fade'); }
  else await nav('home', 'fade');
  window.__app = { S, ready: true };
}
boot();
