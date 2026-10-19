import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { lenientMatch, norm, dayKey, addDays, weekKey, daysBetween, mulberry32, shuffle, fmtInterval, lev } from '../js/util.js';
import { newCard, review, preview, isDue, isKnown, intervalFor, retrievability } from '../js/fsrs.js';
import { buildSession, computeStreak, streakShown, pendingReviews, pickType, makeBuild, checkBuild, makeListen, fillBlank, canBuild, PLANS, HEAVY_REVIEWS, wordsKnown, buildGrammarPractice } from '../js/engine.js';
import { buildBackup, validateBackup } from '../js/backup.js';
import { indexContent } from '../js/content.js';

const load = id => JSON.parse(readFileSync(new URL(`../content/units/${id}.json`, import.meta.url)));
const meta = JSON.parse(readFileSync(new URL('../content/units.json', import.meta.url)));
function content() {
  const units = meta.units.map(u => {
    if (!u.open) return { ...u, items: [], grammar: [], dialogues: [] };
    const d = load(u.id); return { ...u, items: d.items.map(i => ({ ...i, unit: u.id })), grammar: d.grammar, dialogues: d.dialogues };
  });
  return indexContent(units);
}
const C = content();
const NOW = new Date('2026-10-20T09:00:00');

test('lenient compare ignores case, punctuation, spacing; accepts one typo in longer words', () => {
  assert.equal(lenientMatch('Could  I have a COFFEE!', 'could I have a coffee'), 'exact');
  assert.equal(lenientMatch("I’d like", "I'd like"), 'exact');
  assert.equal(lenientMatch('cofee', 'coffee'), 'close');
  assert.equal(lenientMatch('tea', 'tee'), 'no');   // too short to be forgiving
  assert.equal(lenientMatch('', 'a'), 'no');
  assert.equal(lenientMatch('cat', 'dog'), 'no');
});
test('dates helpers', () => {
  assert.equal(addDays('2026-10-31', 1), '2026-11-01');
  assert.equal(daysBetween('2026-10-20', '2026-10-22'), 2);
  assert.equal(weekKey('2026-10-21'), '2026-10-18'); // Sunday
  assert.equal(dayKey(new Date('2026-03-05T10:00:00')), '2026-03-05');
});
test('FSRS: first Good review gives ~3.7 day stability and schedules a future day', () => {
  let c = newCard('x', NOW);
  c = review(c, 3, NOW);
  assert.ok(Math.abs(c.S - 3.7145) < 0.01);
  assert.equal(c.reps, 1);
  assert.ok(c.due > NOW.getTime() + 2 * 86400000);
  assert.equal(isDue(c, NOW), false);
  assert.equal(isKnown(c), true);
});
test('FSRS: Again schedules within the day, Easy > Good > Hard intervals', () => {
  const c0 = newCard('x', NOW);
  const again = review(c0, 1, NOW);
  assert.ok(isDue(again, new Date(NOW.getTime() + 11 * 60000)));
  assert.equal(again.lapses ?? 0, 0);
  const p = preview(review(c0, 3, NOW), new Date('2026-10-24T09:00:00'));
  assert.equal(p[0], 0); assert.ok(p[1] < p[2] && p[2] < p[3]);
});
test('FSRS: stability grows with successful reviews, drops after a lapse', () => {
  let c = review(newCard('x', NOW), 3, NOW);
  const t2 = new Date(c.due + 3600000); const s1 = c.S;
  c = review(c, 3, t2); assert.ok(c.S > s1 * 2);
  const s2 = c.S; const t3 = new Date(c.due + 3600000);
  c = review(c, 1, t3); assert.ok(c.S < s2); assert.equal(c.lapses, 1);
  assert.ok(retrievability(c, t3) <= 1);
  assert.equal(intervalFor(0.1), 1);
});
test('content: every item well formed, ids unique, 3 units of ~50 items', () => {
  const ids = new Set();
  for (const u of C.openUnits) {
    assert.ok(u.items.length >= 45 && u.items.length <= 55, `${u.id}: ${u.items.length}`);
    for (const it of u.items) {
      assert.ok(it.id && it.en && it.he && it.icon && it.exampleEn && it.exampleHe, it.id);
      assert.ok(!ids.has(it.id), 'dup ' + it.id); ids.add(it.id);
    }
    assert.ok(u.grammar.length >= 1 && u.dialogues.length >= 1);
    for (const g of u.grammar) { assert.ok(g.ruleHe && g.examples.length === 3 && g.drills.length >= 3); for (const d of g.drills) assert.ok(d.type === 'build' ? d.answer.split(' ').length >= 3 : d.text.includes('___')); }
  }
});
test('build exercise: correct order passes, wrong order fails, distractor tile never required', () => {
  const rnd = mulberry32(5);
  const pool = C.openUnits.flatMap(u => u.items);
  const item = C.itemById.get('u02-001');
  const ex = makeBuild(item, pool, rnd);
  const order = ex.words.map(w => ex.tiles.find(t => t.real && t.t === w && !ex._u)?.id);
  const ids = []; const used = new Set();
  for (const w of ex.words) { const t = ex.tiles.find(t => t.real && t.t === w && !used.has(t.id)); used.add(t.id); ids.push(t.id); }
  assert.equal(checkBuild(ex, ids), true);
  assert.equal(checkBuild(ex, ids.slice().reverse()), false);
  assert.ok(ex.tiles.length >= ex.words.length);
});
test('listen exercise: 4 unique options including the right one', () => {
  const pool = C.openUnits.flatMap(u => u.items);
  const ex = makeListen(C.itemById.get('u01-001'), pool, mulberry32(2));
  assert.equal(ex.options.length, 4); assert.equal(new Set(ex.options).size, 4);
  assert.equal(ex.options[ex.correct], C.itemById.get('u01-001').he);
});
test('fill blank picks a meaningful word', () => {
  const f = fillBlank('Could I have a coffee, please?');
  assert.equal(f.answer.toLowerCase(), 'coffee'); assert.ok(f.text.includes('____'));
  assert.equal(fillBlank('Hello'), null);
});
test('pickType: first check is build for sentences, listen for single words; later types rotate', () => {
  assert.equal(pickType(C.itemById.get('u02-001'), null), 'build');
  assert.equal(pickType(C.itemById.get('u03-020'), null), 'listen'); // "Red"
  const it = C.itemById.get('u02-001');
  const types = [1, 2, 3, 4, 5].map(r => pickType(it, { reps: r }));
  assert.deepEqual(types, ['flash', 'fill', 'build', 'flash', 'listen']);
});
test('first-ever session: no warm-up/reviews, 8 new items in 4 intro+check groups, speaking, summary', () => {
  const s = buildSession({ now: NOW, content: C, cards: new Map(), settings: { minutes: 20 }, log: {}, seenGrammar: new Set(), rnd: mulberry32(1) });
  assert.equal(s.newItems, 8); assert.equal(s.reviews, 0); assert.equal(s.warm, 0);
  const kinds = s.steps.map(x => x.k);
  assert.equal(kinds.filter(k => k === 'intro').length, 8); assert.equal(kinds.filter(k => k === 'check').length, 8);
  assert.equal(kinds.at(-1), 'summary');
  // intro precedes its check; two intros then two checks
  assert.deepEqual(kinds.slice(0, 4), ['intro', 'intro', 'check', 'check']);
  assert.ok(s.steps.filter(x => x.k === 'speak').length >= 1);
  assert.equal(s.unit, 'unit-01');
});
test('load rules: max 10 new/day, reviews before new, >80 pending blocks new items', () => {
  const cards = new Map();
  for (let i = 1; i <= 90; i++) { const id = 'u01-' + String(i % 49 + 1).padStart(3, '0'); const c = newCard(id + '_' + i, new Date('2026-09-01T10:00:00')); cards.set(c.id, { ...c, id: id, S: 2, D: 5, reps: 2, last: new Date('2026-09-02').getTime(), due: new Date('2026-10-01').getTime() }); }
  // only 49 unique ids can exist as cards; make heavy by lowering threshold usage instead:
  const many = new Map(); let n = 0;
  for (const u of C.openUnits) for (const it of u.items) { many.set(it.id, { ...newCard(it.id, new Date('2026-09-01T10:00:00')), S: 2, D: 5, reps: 2, last: new Date('2026-09-02').getTime(), due: new Date('2026-10-01').getTime() }); n++; }
  assert.ok(n > HEAVY_REVIEWS);
  const heavy = buildSession({ now: NOW, content: C, cards: many, settings: { minutes: 20 }, log: {}, seenGrammar: new Set(), rnd: mulberry32(3) });
  assert.equal(heavy.heavy, true); assert.equal(heavy.newItems, 0);
  assert.equal(heavy.reviews, PLANS[20].rev);
  const light = new Map([...many].slice(0, 5));
  const s2 = buildSession({ now: NOW, content: C, cards: light, settings: { minutes: 20 }, log: { '2026-10-20': { new: 7 } }, seenGrammar: new Set(), rnd: mulberry32(3) });
  assert.equal(s2.newItems, 3);   // 10 - 7
  const kinds = s2.steps.map(x => x.k);
  assert.ok(kinds.indexOf('review') < kinds.indexOf('intro'), 'reviews first');
  const s3 = buildSession({ now: NOW, content: C, cards: light, settings: { minutes: 20 }, log: { '2026-10-20': { new: 10 } }, seenGrammar: new Set(), rnd: mulberry32(3) });
  assert.equal(s3.newItems, 0);
});
test('mini session: reviews only (8), no new/speaking', () => {
  const cards = new Map(); C.openUnits[0].items.slice(0, 12).forEach(it => cards.set(it.id, { ...newCard(it.id, new Date('2026-10-01T10:00:00')), S: 3, D: 5, reps: 1, last: 1, due: new Date('2026-10-10').getTime() }));
  const s = buildSession({ now: NOW, content: C, cards, settings: { minutes: 20 }, log: {}, seenGrammar: new Set(), kind: 'mini', rnd: mulberry32(1) });
  assert.equal(s.reviews, 8); assert.equal(s.newItems, 0); assert.equal(s.speak, 0);
  assert.deepEqual([...new Set(s.steps.map(x => x.k))], ['review', 'summary']);
});
test('warm-up uses yesterday\'s phrases; grammar bite appears once enough items are learned', () => {
  const cards = new Map();
  C.openUnits[0].items.slice(0, 8).forEach(it => cards.set(it.id, { ...newCard(it.id, new Date('2026-10-19T10:00:00')), S: 3.7, D: 5, reps: 1, last: new Date('2026-10-19T10:00:00').getTime(), due: new Date('2026-10-23').getTime() }));
  const s = buildSession({ now: NOW, content: C, cards, settings: { minutes: 20 }, log: {}, seenGrammar: new Set(), rnd: mulberry32(7) });
  assert.equal(s.warm, 3);
  assert.equal(s.grammar, 'g01-tobe');
  const s2 = buildSession({ now: NOW, content: C, cards, settings: { minutes: 20 }, log: {}, seenGrammar: new Set(['g01-tobe']), rnd: mulberry32(7) });
  assert.equal(s2.grammar, 'g01-aan');
});
test('streak: consecutive days, one rest day per week, reset after a longer gap', () => {
  let s = computeStreak(null, '2026-10-18', true); assert.equal(s.current, 1);
  s = computeStreak(s, '2026-10-18', true); assert.equal(s.current, 1);       // same day: unchanged
  s = computeStreak(s, '2026-10-19', true); assert.equal(s.current, 2);
  s = computeStreak(s, '2026-10-21', true); assert.equal(s.current, 3);       // skipped 10-20 (rest day)
  assert.equal(s.restWeek, weekKey('2026-10-20'));
  const t = computeStreak(s, '2026-10-23', true);                              // second skipped day in the same week
  assert.equal(t.current, 1);
  const u = computeStreak(s, '2026-10-22', true); assert.equal(u.current, 4);
  const v = computeStreak(u, '2026-10-26', true); assert.equal(v.current, 1); // 3-day gap breaks it
  const w = computeStreak(s, '2026-10-23', false); assert.equal(w.current, 1); // rest days disabled
  assert.equal(s.best, 3);
  assert.equal(streakShown(s, '2026-10-22', true), 3); assert.equal(streakShown(s, '2026-10-25', true), 0);
});
test('backup: round trip validates, corrupt files are rejected', () => {
  const cards = [{ ...newCard('u01-001', NOW), S: 3.7, D: 5, reps: 1, last: 1, due: 2 }];
  const b = buildBackup(cards, { settings: { minutes: 20 }, streak: { current: 3 }, junk: 1 }, NOW);
  assert.deepEqual(Object.keys(b.kv).sort(), ['settings', 'streak']);
  const round = JSON.parse(JSON.stringify(b));
  assert.equal(validateBackup(round).ok, true);
  assert.equal(validateBackup({ ...round, app: 'x' }).ok, false);
  assert.equal(validateBackup({ ...round, cards: [{ id: 'a' }] }).ok, false);
  assert.equal(validateBackup(null).ok, false);
  assert.equal(validateBackup({ ...round, v: 99 }).ok, false);
});
test('grammar practice session and words-known counter', () => {
  const g = C.grammarById.get('g02-could'); const s = buildGrammarPractice(g);
  assert.equal(s.steps.length, 1 + g.drills.length + 1);
  const cards = new Map([['a', { reps: 1, S: 5 }], ['b', { reps: 1, S: 1 }], ['c', { reps: 0, S: 0 }]]);
  assert.equal(wordsKnown(cards), 1);
  assert.equal(fmtInterval(0), 'עוד היום'); assert.equal(fmtInterval(1), 'מחר'); assert.equal(fmtInterval(3), '3 ימים');
});

test('every spoken sentence has a natural-voice recording (run tools/make-audio.py after content changes)', () => {
  const index = JSON.parse(readFileSync(new URL('../audio/index.json', import.meta.url)));
  const clean = t => t.replace(/\s+/g, ' ').trim();
  const need = [['f', 'Hello, nice to meet you.']];
  for (const u of meta.units.filter(u => u.open)) {
    const d = load(u.id);
    d.items.forEach(it => need.push(['f', it.en]));
    (d.grammar || []).forEach(g => {
      g.examples.forEach(e => need.push(['f', e.en]));
      g.drills.forEach(dr => need.push(['f', dr.type === 'fill' ? dr.text.replace(/_+/, dr.answer) : dr.answer]));
    });
    (d.dialogues || []).forEach(dl => dl.lines.forEach(l => need.push([l.speaker === 'A' ? 'm' : 'f', l.en])));
  }
  const missing = need.filter(([v, t]) => !index[`${v}|${clean(t)}`]).map(([v, t]) => `${v}|${t}`);
  assert.deepEqual(missing, []);
  for (const f of new Set(Object.values(index))) assert.ok(readFileSync(new URL(`../audio/${f}`, import.meta.url)).length > 1000, f);
});
