// FSRS-4.5 scheduler (the open spaced-repetition algorithm), dependency-free.
// Grades: 1 = Again (שכחתי), 2 = Hard (קשה), 3 = Good (טוב), 4 = Easy (קל).
import { DAY, startOfDay } from './util.js';

export const W = [0.4872, 1.4003, 3.7145, 13.8206, 5.1618, 1.2298, 0.8975, 0.031, 1.6474, 0.1367, 1.0461, 2.1072, 0.0793, 0.3246, 1.587, 0.2272, 2.8755];
const DECAY = -0.5, FACTOR = 19 / 81;
export const RETENTION = 0.9;
const clamp = (x, a, b) => Math.min(b, Math.max(a, x));

export function newCard(id, now = new Date()) {
  return { id, S: 0, D: 0, reps: 0, lapses: 0, last: null, due: now.getTime(), introducedAt: now.getTime(), speakWeak: 0 };
}
export function retrievability(card, now = new Date()) {
  if (!card.last || !card.S) return 0;
  const t = Math.max(0, (now.getTime() - card.last) / DAY);
  return Math.pow(1 + FACTOR * t / card.S, DECAY);
}
export function intervalFor(S, retention = RETENTION) {
  return clamp(Math.round(S / FACTOR * (Math.pow(retention, 1 / DECAY) - 1)), 1, 36500);
}
const initS = g => Math.max(W[g - 1], 0.1);
const initD = g => clamp(W[4] - (g - 3) * W[5], 1, 10);
function nextD(D, g) {
  const d = D - W[6] * (g - 3);
  return clamp(W[7] * W[4] + (1 - W[7]) * d, 1, 10);
}
function nextRecallS(D, S, R, g) {
  const hard = g === 2 ? W[15] : 1, easy = g === 4 ? W[16] : 1;
  return S * (1 + Math.exp(W[8]) * (11 - D) * Math.pow(S, -W[9]) * (Math.exp((1 - R) * W[10]) - 1) * hard * easy);
}
function nextForgetS(D, S, R) {
  return Math.min(S, W[11] * Math.pow(D, -W[12]) * (Math.pow(S + 1, W[13]) - 1) * Math.exp((1 - R) * W[14]));
}

// Returns a NEW card object with the review applied.
export function review(card, grade, now = new Date()) {
  const c = { ...card };
  if (!c.last || !c.S) { // first ever review
    c.S = initS(grade); c.D = initD(grade);
  } else {
    const R = retrievability(c, now);
    c.D = nextD(c.D, grade);
    if (grade === 1) { c.S = Math.max(nextForgetS(card.D, card.S, R), 0.1); c.lapses = (c.lapses || 0) + 1; }
    else c.S = nextRecallS(card.D, card.S, R, grade);
  }
  c.reps = (c.reps || 0) + 1;
  c.last = now.getTime();
  if (grade === 1) c.due = now.getTime() + 10 * 60000;           // see it again in this session
  else {
    const n = intervalFor(c.S);
    const d = startOfDay(now); d.setDate(d.getDate() + n);
    c.due = d.getTime();                                          // due at the start of that day
  }
  return c;
}
// Interval preview (in days) for the 4 rating buttons.
export function preview(card, now = new Date()) {
  return [1, 2, 3, 4].map(g => {
    const c = review(card, g, now);
    return g === 1 ? 0 : Math.max(1, Math.round((c.due - startOfDay(now).getTime()) / DAY));
  });
}
export function isDue(card, now = new Date()) {
  const end = startOfDay(now); end.setDate(end.getDate() + 1);
  return card.due < end.getTime();
}
// A word counts as "known" after a successful recall that gives it >= 3 days of stability.
export function isKnown(card) { return card.reps >= 1 && card.S >= 3; }
