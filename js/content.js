// Loads units.json + the open unit files and builds lookup tables.
export async function loadContent(base = './') {
  const meta = await (await fetch(base + 'content/units.json')).json();
  const units = [];
  for (const u of meta.units) {
    const unit = { ...u, items: [], grammar: [], dialogues: [] };
    if (u.open) {
      const data = await (await fetch(`${base}content/units/${u.id}.json`)).json();
      unit.items = data.items.map(it => ({ ...it, unit: u.id }));
      unit.grammar = data.grammar || [];
      unit.dialogues = data.dialogues || [];
    }
    units.push(unit);
  }
  return indexContent(units);
}
export function indexContent(units) {
  const itemById = new Map(), grammarById = new Map(), dialogueById = new Map();
  for (const u of units) {
    u.items.forEach(it => itemById.set(it.id, it));
    u.grammar.forEach(g => grammarById.set(g.id, { ...g, unit: u.id }));
    u.dialogues.forEach(d => dialogueById.set(d.id, { ...d, unit: u.id }));
  }
  return { units, itemById, grammarById, dialogueById, openUnits: units.filter(u => u.open) };
}
