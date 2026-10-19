// Pure learning logic: building the daily session, exercise generation, streaks, load rules.
// No DOM, no storage: everything is passed in, so it can be unit-tested in Node.
import { dayKey, addDays, daysBetween, weekKey, shuffle, norm, tokens, DAY, startOfDay } from './util.js';
import { isDue, isKnown } from './fsrs.js';

export const MAX_NEW_PER_DAY = 10;
export const HEAVY_REVIEWS = 80;
export const PLANS = {
  10: { warm: 2, rev: 8, new: 4, speak: 2, min: [1, 3, 3, 2, 1] },
  20: { warm: 3, rev: 18, new: 8, speak: 5, min: [2, 7, 5, 5, 1] },
  30: { warm: 3, rev: 26, new: 10, speak: 7, min: [2, 11, 8, 8, 1] },
};
const STOP = new Set(['the', 'a', 'an', 'and', 'for', 'you', 'your', 'this', 'that', 'with', 'have', 'please', 'are', 'was', 'can', 'could', 'would', 'what', 'where', 'how', 'is', 'it', 'its', 'in', 'on', 'to', 'of', 'do', 'does', 'my', 'me', 'i', 'am', 'i\'m', 'it\'s', 'we', 'they']);

export function wordCount(en) { return tokens(en).length; }

// ---- exercise type for a card ----------------------------------------------------------
export function canBuild(item) { const n = item.en.trim().split(/\s+/).length; return n >= 3 && n <= 9; }
export function canFill(item) { return !!fillBlank(item.en); }
export function pickType(item, card) {
  const reps = card ? card.reps : 0;
  const seq = ['flash', 'fill', 'build', 'flash', 'listen'];
  let t;
  if (reps === 0) t = canBuild(item) ? 'build' : 'listen';
  else t = seq[(reps - 1) % seq.length];
  if (t === 'build' && !canBuild(item)) t = 'flash';
  if (t === 'fill' && !canFill(item)) t = 'flash';
  return t;
}

// ---- exercise payloads -------------------------------------------------------------------
export function fillBlank(en) {
  const words = en.trim().split(/\s+/);
  if (words.length < 3) return null;
  let best = -1, bl = 0;
  words.forEach((w, i) => { const c = norm(w).replace(/'/g, ''); if (c.length >= 3 && !STOP.has(norm(w)) && c.length > bl) { best = i; bl = c.length; } });
  if (best < 0) return null;
  const answer = words[best].replace(/[.,!?;:"]/g, '');
  const text = words.map((w, i) => i === best ? w.replace(answer, '____') : w).join(' ');
  return { text, answer };
}
export function makeBuild(item, pool = [], rnd = Math.random) {
  const words = item.en.trim().split(/\s+/);
  const target = words.map(w => norm(w));
  const need = new Set(target);
  const extras = [];
  if (words.length <= 6) {
    const others = shuffle(pool.filter(p => p.id !== item.id), rnd);
    for (const o of others) {
      const w = o.en.trim().split(/\s+/).find(x => { const n = norm(x); return n.length >= 2 && !need.has(n) && !extras.some(e => norm(e) === n) && /^[A-Za-z']+$/.test(x.replace(/[.,!?]/g, '')); });
      if (w) { extras.push(w.replace(/[.,!?]/g, '')); break; }
    }
  }
  const tiles = shuffle([...words.map((w, i) => ({ id: i, t: w.replace(/[.,!?]$/, ''), real: true })), ...extras.map((w, i) => ({ id: 100 + i, t: w, real: false }))], rnd);
  return { he: item.he, words: words.map(w => w.replace(/[.,!?]$/, '')), target, tiles, answer: item.en };
}
export function checkBuild(ex, chosenIds) {
  const chosen = chosenIds.map(id => ex.tiles.find(t => t.id === id));
  return norm(chosen.map(t => t.t).join(' ')) === norm(ex.words.join(' '));
}
export function makeListen(item, pool, rnd = Math.random) {
  const same = shuffle(pool.filter(p => p.id !== item.id && p.he !== item.he && p.unit === item.unit), rnd);
  const rest = shuffle(pool.filter(p => p.id !== item.id && p.he !== item.he && p.unit !== item.unit), rnd);
  const distract = [...new Set([...same, ...rest].map(p => p.he))].slice(0, 3); // unique, so no two options read the same
  const options = shuffle([item.he, ...distract], rnd);
  return { options, correct: options.indexOf(item.he), en: item.en };
}
export function hintFor(en) {
  return en.split(/\s+/).map(w => { const letters = w.replace(/[.,!?]/g, ''); return letters[0] + ' _'.repeat(Math.max(0, letters.length - 1)).replace(/ /g, ''); }).join('  ');
}

// ---- streak (with one rest day per week) -----------------------------------------------
export function computeStreak(prev, today, restEnabled) {
  const s = { current: 0, best: 0, last: null, restWeek: null, ...(prev || {}) };
  if (s.last === today) return s;
  if (!s.last) { s.current = 1; }
  else {
    const gap = daysBetween(s.last, today);
    if (gap === 1) s.current += 1;
    else if (gap === 2 && restEnabled && s.restWeek !== weekKey(addDays(s.last, 1))) { s.current += 1; s.restWeek = weekKey(addDays(s.last, 1)); }
    else s.current = 1;
  }
  s.last = today; s.best = Math.max(s.best, s.current);
  return s;
}
// What to show on the home screen today (the streak is "alive" if it can still be continued).
export function streakShown(s, today, restEnabled) {
  if (!s || !s.last) return 0;
  if (s.last === today) return s.current;
  const gap = daysBetween(s.last, today);
  if (gap === 1) return s.current;
  if (gap === 2 && restEnabled && s.restWeek !== weekKey(addDays(s.last, 1))) return s.current;
  return 0;
}

// ---- daily session --------------------------------------------------------------------------
// ctx: { now, content, cards:Map, settings:{minutes}, log:{day:{new,reviews}}, seenGrammar:Set,
//        kind:'daily'|'mini'|'speak', unitFocus?, rnd? }
export function pendingReviews(cards, now) {
  return [...cards.values()].filter(c => isDue(c, now)).sort((a, b) => a.due - b.due);
}
export function buildSession(ctx) {
  const { now, content, cards, kind = 'daily' } = ctx;
  const rnd = ctx.rnd || Math.random;
  const today = dayKey(now);
  const plan = PLANS[ctx.settings.minutes] || PLANS[20];
  const log = (ctx.log && ctx.log[today]) || { new: 0, reviews: 0 };
  const pending = pendingReviews(cards, now);
  const heavy = pending.length > HEAVY_REVIEWS;
  const steps = [];
  const info = { kind, date: today, heavy, pending: pending.length, warm: 0, reviews: 0, newItems: 0, speak: 0, grammar: null, unit: null };
  const pool = content.openUnits.flatMap(u => u.items);

  const speakPool = (n, newIds = []) => {
    const learned = [...cards.values()].sort((a, b) => (b.speakWeak || 0) - (a.speakWeak || 0) || b.introducedAt - a.introducedAt).map(c => c.id);
    const ids = [...new Set([...newIds.slice(0, 2), ...learned, ...newIds])].filter(id => content.itemById.has(id));
    const phrases = ids.filter(id => wordCount(content.itemById.get(id).en) >= 2);
    return (phrases.length >= n ? phrases : ids).slice(0, n);
  };

  if (kind === 'speak') {
    speakPool(plan.speak).forEach(id => steps.push({ k: 'speak', id }));
    info.speak = steps.length;
    steps.push({ k: 'summary' });
    return { ...info, steps };
  }

  const revTarget = kind === 'mini' ? 8 : plan.rev;
  let revs = pending.slice(0, revTarget);
  if (kind === 'mini' && revs.length < revTarget) { // extra practice from cards due soonest
    const more = [...cards.values()].filter(c => !revs.includes(c)).sort((a, b) => a.due - b.due).slice(0, revTarget - revs.length);
    revs = revs.concat(more);
  }

  if (kind === 'daily') {
    // warm-up: up to 3 phrases from the last active day before today
    const days = [...new Set([...cards.values()].map(c => dayKey(new Date(c.introducedAt))).filter(d => d < today))].sort();
    if (days.length) {
      const last = days[days.length - 1];
      const ids = shuffle([...cards.values()].filter(c => dayKey(new Date(c.introducedAt)) === last && content.itemById.has(c.id)), rnd).slice(0, plan.warm).map(c => c.id);
      ids.forEach(id => steps.push({ k: 'warm', id }));
      info.warm = ids.length;
    }
  }
  revs.forEach(c => { const it = content.itemById.get(c.id); if (it) steps.push({ k: 'review', id: c.id, t: pickType(it, c) }); });
  info.reviews = revs.length;

  let newIds = [];
  if (kind === 'daily' && !heavy) {
    const room = Math.max(0, Math.min(plan.new, MAX_NEW_PER_DAY - (log.new || 0)));
    const order = ctx.unitFocus ? [content.units.find(u => u.id === ctx.unitFocus), ...content.openUnits.filter(u => u.id !== ctx.unitFocus)].filter(Boolean) : content.openUnits;
    const unit = order.find(u => u.items.some(i => !cards.has(i.id)));
    if (unit && room > 0) {
      newIds = unit.items.filter(i => !cards.has(i.id)).slice(0, room).map(i => i.id);
      info.unit = unit.id;
      for (let i = 0; i < newIds.length; i += 2) {  // intro two, then check them
        const grp = newIds.slice(i, i + 2);
        grp.forEach(id => steps.push({ k: 'intro', id }));
        grp.forEach(id => steps.push({ k: 'check', id, t: pickType(content.itemById.get(id), null) }));
      }
      info.newItems = newIds.length;
    }
    // one grammar bite per day once a few items of a unit are known
    const gUnit = unit || content.openUnits[0];
    const learnedInUnit = gUnit ? gUnit.items.filter(i => cards.has(i.id) || newIds.includes(i.id)).length : 0;
    const g = gUnit && learnedInUnit >= 4 ? gUnit.grammar.find(x => !ctx.seenGrammar.has(x.id)) : null;
    if (g) {
      steps.push({ k: 'grammar', gid: g.id });
      g.drills.forEach((_, i) => steps.push({ k: 'drill', gid: g.id, i }));
      info.grammar = g.id;
    }
    const sp = speakPool(plan.speak, newIds);
    sp.forEach(id => steps.push({ k: 'speak', id }));
    info.speak = sp.length;
  }
  steps.push({ k: 'summary' });
  return { ...info, steps };
}
// A practice session for one grammar topic (from the unit screen)
export function buildGrammarPractice(g) {
  const steps = [{ k: 'grammar', gid: g.id }];
  g.drills.forEach((_, i) => steps.push({ k: 'drill', gid: g.id, i }));
  steps.push({ k: 'summary' });
  return { kind: 'practice', date: dayKey(new Date()), steps, heavy: false, pending: 0, warm: 0, reviews: 0, newItems: 0, speak: 0, grammar: g.id, unit: g.unit };
}

export function wordsKnown(cards) { let n = 0; for (const c of cards.values()) if (isKnown(c)) n++; return n; }
export function minutesLeft(session, plan = PLANS[20]) {
  const rest = session.steps.slice(session.idx || 0).filter(s => s.k !== 'summary').length;
  const all = session.steps.filter(s => s.k !== 'summary').length || 1;
  const total = plan.min.reduce((a, b) => a + b, 0);
  return Math.max(1, Math.round(total * rest / all));
}
export function dayNumber(firstUse, today) { return Math.max(1, daysBetween(firstUse || today, today) + 1); }
export function greeting(h) { return h < 5 ? 'לילה טוב!' : h < 12 ? 'בוקר טוב!' : h < 17 ? 'צהריים טובים!' : h < 21 ? 'ערב טוב!' : 'לילה טוב!'; }
