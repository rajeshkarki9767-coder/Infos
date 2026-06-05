// v222: All-businesses view reorder writes to a separate global order
// (state.globalItemOrder) and does NOT touch per-business order (state.itemOrder).
function makeReorder(state) {
  const itemIdSeq = id => parseInt(String(id).replace(/\D/g,''),10) || 0;
  return function reorderItemGlobal(tabKey, itemId, dir) {
    if (!state.globalItemOrder) state.globalItemOrder = {};
    const items = (state.items[tabKey] || []).filter(i => !i.deleted && !i.pinned);
    const saved = state.globalItemOrder[tabKey] || [];
    const ranked = new Map(saved.map((id,i)=>[id,i]));
    items.sort((a,b)=>{ const ai=ranked.has(a.id)?ranked.get(a.id):1e9, bi=ranked.has(b.id)?ranked.get(b.id):1e9;
      if(ai!==bi)return ai-bi; const ca=a.createdAt||0,cb=b.createdAt||0; if(ca!==cb)return ca-cb; return itemIdSeq(a.id)-itemIdSeq(b.id);});
    const idx=items.findIndex(i=>i.id===itemId); if(idx<0)return;
    const ni=dir==='up'?idx-1:idx+1; if(ni<0||ni>=items.length)return;
    [items[idx],items[ni]]=[items[ni],items[idx]];
    state.globalItemOrder[tabKey]=items.map(i=>i.id);
  };
}
let pass=0,fail=0; const ok=(c,m)=>{if(c){pass++;console.log('  \u2713 '+m);}else{fail++;console.log('  \u2717 '+m);}};

const state = {
  items: { games: [
    { id:'x1', createdAt:1, bizIds:['b4'] },
    { id:'x2', createdAt:2, bizIds:['b5'] },
    { id:'x3', createdAt:3, bizIds:['b4','b5'] },
  ]},
  itemOrder: { b4: { games: ['x1','x3'] }, b5: { games: ['x2','x3'] } },
  globalItemOrder: {}
};
const before_b4 = JSON.stringify(state.itemOrder.b4);
const before_b5 = JSON.stringify(state.itemOrder.b5);
const reorder = makeReorder(state);

// move x3 (currently last) up → global order becomes x1,x3,x2
reorder('games','x3','up');
ok(JSON.stringify(state.globalItemOrder.games)===JSON.stringify(['x1','x3','x2']), 'global order updated: x1,x3,x2');
ok(JSON.stringify(state.itemOrder.b4)===before_b4, 'per-business b4 order UNCHANGED');
ok(JSON.stringify(state.itemOrder.b5)===before_b5, 'per-business b5 order UNCHANGED');

// move x3 up again → x3,x1,x2
reorder('games','x3','up');
ok(JSON.stringify(state.globalItemOrder.games)===JSON.stringify(['x3','x1','x2']), 'global order now x3,x1,x2');

// can't move top item up
reorder('games','x3','up');
ok(JSON.stringify(state.globalItemOrder.games)===JSON.stringify(['x3','x1','x2']), 'top item cannot move up (no-op)');

// move bottom down is a no-op
reorder('games','x2','down');
ok(JSON.stringify(state.globalItemOrder.games)===JSON.stringify(['x3','x1','x2']), 'bottom item cannot move down (no-op)');

console.log(`\n${pass} passed, ${fail} failed`); process.exit(fail?1:0);
