// Small pure helpers (no DOM). Everything here is unit-tested in tests/.
export const DAY = 86400000;

export function dayKey(d = new Date()) {
  const y = d.getFullYear(), m = String(d.getMonth() + 1).padStart(2, '0'), dd = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${dd}`;
}
export function parseDay(k) { const [y, m, d] = k.split('-').map(Number); return new Date(y, m - 1, d); }
export function startOfDay(d) { return new Date(d.getFullYear(), d.getMonth(), d.getDate()); }
export function daysBetween(a, b) { return Math.round((parseDay(b) - parseDay(a)) / DAY); }
export function addDays(k, n) { const d = parseDay(k); d.setDate(d.getDate() + n); return dayKey(d); }
// Week starts on Sunday (Israel). Returns the day key of that Sunday.
export function weekKey(k) { const d = parseDay(k); d.setDate(d.getDate() - d.getDay()); return dayKey(d); }

export function shuffle(arr, rnd = Math.random) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
  return a;
}
export function mulberry32(seed) {
  return function () { seed |= 0; seed = (seed + 0x6D2B79F5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
export function pick(arr, rnd = Math.random) { return arr[Math.floor(rnd() * arr.length)]; }

// ---- forgiving text comparison -------------------------------------------------
export function norm(s) {
  return String(s).toLowerCase().replace(/[’‘´`]/g, "'").replace(/[^a-z0-9'\s-]/g, ' ').replace(/\s+/g, ' ').trim();
}
export function tokens(s) { const n = norm(s); return n ? n.split(' ') : []; }
export function lev(a, b) {
  const m = a.length, n = b.length; if (!m) return n; if (!n) return m;
  let prev = Array.from({ length: n + 1 }, (_, i) => i);
  for (let i = 1; i <= m; i++) {
    const cur = [i];
    for (let j = 1; j <= n; j++) cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    prev = cur;
  }
  return prev[n];
}
// 'exact' (ignores case/punctuation/extra spaces), 'close' (one typo in a longer answer) or 'no'.
export function lenientMatch(input, answer) {
  const a = norm(input), b = norm(answer);
  if (!a) return 'no';
  if (a === b) return 'exact';
  if (b.length >= 5 && lev(a, b) <= 1) return 'close';
  return 'no';
}

export function fmtInterval(days) {
  if (days < 1) return 'עוד היום';
  const n = Math.round(days);
  if (n === 1) return 'מחר';
  if (n < 14) return `${n} ימים`;
  if (n < 60) return `${Math.round(n / 7)} שבועות`;
  return `${Math.round(n / 30)} חודשים`;
}
