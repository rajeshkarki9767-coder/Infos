// v208: "All businesses" view mirrors the order of the business the owner most
// recently filtered to / reordered (state.lastBizFilter). Reproduces the
// reported scenario: reorder in Marvel, then view All — Marvel's order must hold,
// regardless of where Marvel sits in state.businesses or what other businesses
// have ordered the shared items.

function buildSorter(items, itemOrder, lastBizFilter, businesses, tabKey) {
  const itemIdSeq = id => parseInt(String(id).replace(/\D/g,''),10) || 0;
  const bizById = id => businesses.find(b => b.id === id);
  const anchorId = (lastBizFilter && bizById(lastBizFilter)) ? lastBizFilter : null;
  const anchorOrder = anchorId ? (itemOrder?.[anchorId]?.[tabKey] || []) : [];
  const ranked = new Map(anchorOrder.map((id, i) => [id, i]));
  return [...items].sort((a, b) => {
    const ai = ranked.has(a.id) ? ranked.get(a.id) : 1e9;
    const bi = ranked.has(b.id) ? ranked.get(b.id) : 1e9;
    if (ai !== bi) return ai - bi;
    const ca = a.createdAt || 0, cb = b.createdAt || 0;
    if (ca !== cb) return ca - cb;
    return itemIdSeq(a.id) - itemIdSeq(b.id);
  });
}

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log('  \u2713 ' + m); } else { fail++; console.log('  \u2717 ' + m); } };

const items = [
  { id:'x13', title:'Vegas Roll', createdAt:13, bizIds:['bMarvel','bStark','bSteve'] },
  { id:'x14', title:'Gameroom',   createdAt:14, bizIds:['bMarvel','bStark','bSteve'] },
  { id:'x15', title:'Gamevault',  createdAt:15, bizIds:['bMarvel'] },
  { id:'x16', title:'Juwa',       createdAt:16, bizIds:['bMarvel','bStark','bSteve'] },
  { id:'x17', title:'Juwa 2.0',   createdAt:17, bizIds:['bMarvel'] },
];
// Owner arranged Marvel: Gamevault, Juwa, Juwa 2.0 on top.
const itemOrder = {
  bMarvel: { games: ['x15','x16','x17','x13','x14'] },
  bStark:  { games: ['x13','x14','x16'] },
  bSteve:  { games: ['x14','x13','x16'] },
};

// Case 1: Marvel is LAST in state.businesses (the order that broke v206/v207).
let sorted = buildSorter(items, itemOrder, 'bMarvel',
  [{id:'bStark'},{id:'bSteve'},{id:'bMarvel'}], 'games');
let order = sorted.map(i => i.title);
console.log('Marvel-last  All order:', order.join(' > '));
ok(JSON.stringify(order) === JSON.stringify(['Gamevault','Juwa','Juwa 2.0','Vegas Roll','Gameroom']),
   'mirrors Marvel order even when Marvel is last in state.businesses');

// Case 2: Marvel FIRST — same result (independent of businesses order).
sorted = buildSorter(items, itemOrder, 'bMarvel',
  [{id:'bMarvel'},{id:'bStark'},{id:'bSteve'}], 'games');
ok(JSON.stringify(sorted.map(i=>i.title)) === JSON.stringify(['Gamevault','Juwa','Juwa 2.0','Vegas Roll','Gameroom']),
   'same result when Marvel is first (order independent of state.businesses)');

// Case 3: anchor = Stark → All view mirrors Stark's order instead.
sorted = buildSorter(items, itemOrder, 'bStark',
  [{id:'bMarvel'},{id:'bStark'},{id:'bSteve'}], 'games');
order = sorted.map(i => i.title);
console.log('Stark-anchor All order:', order.join(' > '));
ok(order[0] === 'Vegas Roll' && order[1] === 'Gameroom',
   'switching anchor to Stark makes All mirror Stark order');

// Case 4: no anchor set → falls back to creation order (no crash).
sorted = buildSorter(items, itemOrder, null, [{id:'bMarvel'}], 'games');
ok(sorted[0].title === 'Vegas Roll', 'no anchor → creation order fallback');

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
