// Tiny IndexedDB wrapper. Falls back to memory if IndexedDB is unavailable (e.g. private mode).
const NAME = 'english-learning', VERSION = 1;
let dbp = null, mem = { cards: new Map(), kv: new Map() }, useMem = false;

function open() {
  if (dbp) return dbp;
  dbp = new Promise((resolve, reject) => {
    try {
      const req = indexedDB.open(NAME, VERSION);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains('cards')) db.createObjectStore('cards', { keyPath: 'id' });
        if (!db.objectStoreNames.contains('kv')) db.createObjectStore('kv');
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    } catch (e) { reject(e); }
  }).catch(() => { useMem = true; return null; });
  return dbp;
}
function wrap(req) { return new Promise((res, rej) => { req.onsuccess = () => res(req.result); req.onerror = () => rej(req.error); }); }

export const db = {
  get isMemory() { return useMem; },
  async getAllCards() {
    const d = await open(); if (!d) return [...mem.cards.values()];
    return wrap(d.transaction('cards').objectStore('cards').getAll());
  },
  async putCard(card) {
    const d = await open(); if (!d) { mem.cards.set(card.id, card); return; }
    await wrap(d.transaction('cards', 'readwrite').objectStore('cards').put(card));
  },
  async putCards(cards) {
    const d = await open(); if (!d) { cards.forEach(c => mem.cards.set(c.id, c)); return; }
    const tx = d.transaction('cards', 'readwrite'); const st = tx.objectStore('cards');
    cards.forEach(c => st.put(c));
    await new Promise((res, rej) => { tx.oncomplete = res; tx.onerror = () => rej(tx.error); });
  },
  async get(key) {
    const d = await open(); if (!d) return mem.kv.get(key);
    return wrap(d.transaction('kv').objectStore('kv').get(key));
  },
  async set(key, value) {
    const d = await open(); if (!d) { mem.kv.set(key, value); return; }
    await wrap(d.transaction('kv', 'readwrite').objectStore('kv').put(value, key));
  },
  async del(key) {
    const d = await open(); if (!d) { mem.kv.delete(key); return; }
    await wrap(d.transaction('kv', 'readwrite').objectStore('kv').delete(key));
  },
  async allKv() {
    const d = await open(); if (!d) return Object.fromEntries(mem.kv);
    const st = d.transaction('kv').objectStore('kv');
    const keys = await wrap(st.getAllKeys()); const vals = await wrap(st.getAll());
    return Object.fromEntries(keys.map((k, i) => [k, vals[i]]));
  },
  async clearAll() {
    const d = await open(); if (!d) { mem = { cards: new Map(), kv: new Map() }; return; }
    const tx = d.transaction(['cards', 'kv'], 'readwrite');
    tx.objectStore('cards').clear(); tx.objectStore('kv').clear();
    await new Promise((res, rej) => { tx.oncomplete = res; tx.onerror = () => rej(tx.error); });
  },
};
