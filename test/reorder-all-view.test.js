// Reproduces the user's scenario: items shared across businesses must not
// leapfrog single-business items the owner arranged at the top of the business
// they were viewing. Tests the rankFor logic in isolation.

const businesses = [
  { id: 'bMarvel' }, { id: 'bStark' }, { id: 'bSteve' }
];
// Items as in the screenshots
const items = [
  { id: 'x13', title: 'Vegas Roll', createdAt: 100, bizIds: ['bMarvel','bStark','bSteve'] },
  { id: 'x14', title: 'Gameroom',   createdAt: 101, bizIds: ['bMarvel','bStark','bSteve'] },
  { id: 'x15', title: 'Gamevault',  createdAt: 102, bizIds: ['bMarvel'] },
  { id: 'x16', title: 'Juwa 2.0',   createdAt: 103, bizIds: ['bMarvel'] },
  { id: 'x17', title: 'Juwa',       createdAt: 104, bizIds: ['bMarvel','bStark','bSteve'] },
];
// Owner reordered MARVEL so Gamevault, Juwa, Juwa 2.0 are on top.
// Stark/Steve have their own orders where the shared items rank high.
const itemOrder = {
  bMarvel: { games: ['x15','x17','x16','x13','x14'] },   // what the owner just set
  bStark:  { games: ['x13','x14','x17'] },               // Vegas Roll #1 here
  bSteve:  { games: ['x14','x13','x17'] },               // Gameroom #1 here
};
const tabKey = 'games';
const itemBizIds = it => Array.isArray(it.bizIds) ? it.bizIds : (it.bizId ? [it.bizId] : []);
const itemIdSeq = id => parseInt(String(id).replace(/\D/g,''),10) || 0;

// ---- the v205 logic, mirrored ----
const bizIndex = new Map(businesses.map((b, i) => [b.id, i]));
const rankFor = (it) => {
  const bids = itemBizIds(it).filter(bid => bizIndex.has(bid)).sort((x,y)=>bizIndex.get(x)-bizIndex.get(y));
  for (const bid of bids) {
    const saved = itemOrder?.[bid]?.[tabKey];
    if (saved) { const r = saved.indexOf(it.id); if (r !== -1) return { biz: bizIndex.get(bid), pos: r }; }
  }
  return { biz: bids.length ? bizIndex.get(bids[0]) : 1e9, pos: 1e9 };
};
const sorted = [...items].sort((a,b)=>{
  const ra=rankFor(a), rb=rankFor(b);
  if (ra.biz!==rb.biz) return ra.biz-rb.biz;
  if (ra.pos!==rb.pos) return ra.pos-rb.pos;
  const ca=a.createdAt||0, cb=b.createdAt||0; if (ca!==cb) return ca-cb;
  return itemIdSeq(a.id)-itemIdSeq(b.id);
});

const order = sorted.map(i => i.title);
console.log('Resulting All-businesses order:', order.join(' > '));

// All items' reference biz is Marvel (index 0, first in their bizIds), so they
// should follow Marvel's arranged order exactly: Gamevault, Juwa, Juwa 2.0, Vegas Roll, Gameroom.
const expected = ['Gamevault','Juwa','Juwa 2.0','Vegas Roll','Gameroom'];
let pass = JSON.stringify(order) === JSON.stringify(expected);
console.log(pass ? 'PASS: All-view honors the order set in the reference business (Marvel)'
                 : 'FAIL: got ' + JSON.stringify(order) + ' expected ' + JSON.stringify(expected));

// Critical regression assertion: Gamevault (Marvel #1) must come before Vegas Roll
// (which is Stark #1 / Steve #2 — the old "best rank" bug floated it to top).
const gv = order.indexOf('Gamevault'), vr = order.indexOf('Vegas Roll');
const noLeapfrog = gv < vr;
console.log(noLeapfrog ? 'PASS: shared item (Vegas Roll) no longer leapfrogs Marvel-top item'
                       : 'FAIL: Vegas Roll still above Gamevault');

process.exit(pass && noLeapfrog ? 0 : 1);
