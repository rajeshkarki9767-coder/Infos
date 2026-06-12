// v230: keep only the 2 newest balance batches per business; older ones are
// tombstoned (soft-delete so the removal syncs). This test mirrors the prune.
function itemIdSeq(id){ const m=/(\d+)/.exec(String(id||'')); return m?parseInt(m[1],10):1e15; }
function itemBizIds(it){ return it.bizIds || (it.bizId?[it.bizId]:[]); }
function itemHasBiz(it,bid){ return itemBizIds(it).includes(bid); }
function makePrune(state, KEEP=2) {
  return function prune(bizId) {
    if (!bizId) return 0;
    const list = state.items && state.items.balance;
    if (!list || !list.length) return 0;
    const byBatch = new Map();
    list.forEach(it => {
      if (it.deleted) return;
      if (!itemHasBiz(it, bizId)) return;
      const bid = it.batchId || ('solo_'+it.id);
      if (!byBatch.has(bid)) byBatch.set(bid, []);
      byBatch.get(bid).push(it);
    });
    if (byBatch.size <= KEEP) return 0;
    const ordered = [...byBatch.entries()].map(([bid,items])=>({bid,items,
      created: Math.max(...items.map(i=>i.createdAt||0)),
      seq: Math.max(...items.map(i=>itemIdSeq(i.id)))
    })).sort((a,b)=>(b.created-a.created)||(b.seq-a.seq));
    const toRemove = ordered.slice(KEEP);
    const now = Date.now(); let pruned=0;
    toRemove.forEach(batch => batch.items.forEach(it => {
      const bids = itemBizIds(it);
      if (bids.length>1 && bids.some(x=>x!==bizId)) return;
      it.deleted=true; it.deletedAt=now; it.updatedAt=now; pruned++;
    }));
    return pruned;
  };
}
let pass=0,fail=0; const ok=(c,m)=>{if(c){pass++;console.log('  \u2713 '+m);}else{fail++;console.log('  \u2717 '+m);}};

// 4 batches for bS, different ages → keep 2 newest, tombstone 2 oldest
const state = { items: { balance: [
  { id:'x1', batchId:'b1', createdAt:100, bizIds:['bS'], name:'old1' },
  { id:'x2', batchId:'b2', createdAt:200, bizIds:['bS'], name:'old2' },
  { id:'x3', batchId:'b3', createdAt:300, bizIds:['bS'], name:'new1' },
  { id:'x4', batchId:'b3', createdAt:300, bizIds:['bS'], name:'new1b' },
  { id:'x5', batchId:'b4', createdAt:400, bizIds:['bS'], name:'new2' },
]}};
const prune = makePrune(state);
const n = prune('bS');
ok(n === 2, 'pruned exactly the 2 items in the 2 oldest batches');
ok(state.items.balance.find(i=>i.id==='x1').deleted === true, 'oldest batch tombstoned');
ok(state.items.balance.find(i=>i.id==='x2').deleted === true, '2nd-oldest tombstoned');
ok(!state.items.balance.find(i=>i.id==='x3').deleted, 'newest-1 batch kept (both rows)');
ok(!state.items.balance.find(i=>i.id==='x5').deleted, 'newest batch kept');
ok(state.items.balance.find(i=>i.id==='x1').updatedAt > 0, 'tombstone stamped updatedAt (sync-able)');

// ≤2 batches → no-op
const s2 = { items:{ balance:[ {id:'x1',batchId:'a',createdAt:1,bizIds:['bS']},{id:'x2',batchId:'b',createdAt:2,bizIds:['bS']} ]}};
ok(makePrune(s2)('bS') === 0, 'two batches → nothing pruned');

// Other business's items untouched
const s3 = { items:{ balance:[
  {id:'x1',batchId:'a',createdAt:1,bizIds:['bM']},
  {id:'x2',batchId:'b',createdAt:2,bizIds:['bS']},{id:'x3',batchId:'c',createdAt:3,bizIds:['bS']},{id:'x4',batchId:'d',createdAt:4,bizIds:['bS']},
]}};
makePrune(s3)('bS');
ok(!s3.items.balance.find(i=>i.id==='x1').deleted, "other business's entry untouched");
ok(s3.items.balance.find(i=>i.id==='x2').deleted, "target business's old batch pruned");

// Multi-business item in an old batch is NOT deleted (protects shared items)
const s4 = { items:{ balance:[
  {id:'x1',batchId:'a',createdAt:1,bizIds:['bS','bM']},
  {id:'x2',batchId:'b',createdAt:2,bizIds:['bS']},{id:'x3',batchId:'c',createdAt:3,bizIds:['bS']},{id:'x4',batchId:'d',createdAt:4,bizIds:['bS']},
]}};
makePrune(s4)('bS');
ok(!s4.items.balance.find(i=>i.id==='x1').deleted, 'multi-business item never auto-deleted');

console.log(`\n${pass} passed, ${fail} failed`); process.exit(fail?1:0);
