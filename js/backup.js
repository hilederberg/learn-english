// Export / import of all progress as a single JSON file.
export const BACKUP_APP = 'english-learning', BACKUP_VERSION = 1;
export const KV_KEYS = ['settings', 'streak', 'log', 'seenGrammar', 'meta'];

export function buildBackup(cards, kv, now = new Date()) {
  const data = { app: BACKUP_APP, v: BACKUP_VERSION, exportedAt: now.toISOString(), cards: cards.map(c => ({ ...c })), kv: {} };
  for (const k of KV_KEYS) if (kv[k] !== undefined) data.kv[k] = kv[k];
  return data;
}
export function validateBackup(o) {
  if (!o || typeof o !== 'object') return { ok: false, error: 'הקובץ לא תקין' };
  if (o.app !== BACKUP_APP) return { ok: false, error: 'זה לא קובץ גיבוי של האפליקציה' };
  if (o.v !== BACKUP_VERSION) return { ok: false, error: 'גרסת הגיבוי לא נתמכת' };
  if (!Array.isArray(o.cards)) return { ok: false, error: 'חסרים נתוני כרטיסיות' };
  for (const c of o.cards) {
    if (!c || typeof c.id !== 'string' || !['S', 'D', 'due', 'reps'].every(k => typeof c[k] === 'number' && isFinite(c[k]))) return { ok: false, error: 'כרטיסייה פגומה בקובץ' };
  }
  if (!o.kv || typeof o.kv !== 'object') return { ok: false, error: 'חסרות הגדרות בקובץ' };
  return { ok: true };
}
export function backupFileName(now = new Date()) {
  const p = n => String(n).padStart(2, '0');
  return `english-backup-${now.getFullYear()}-${p(now.getMonth() + 1)}-${p(now.getDate())}.json`;
}
