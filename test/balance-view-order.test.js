// v226: balance view/edit rows always render in stable creation-order (by item id
// sequence), regardless of how a sync merge shuffled the stored array.
function itemIdSeq(id){ const m=/(\d+)/.exec(String(id||'')); return m?parseInt(m[1],10):1e15; }
let pass=0,fail=0; const ok=(c,m)=>{if(c){pass++;console.log('  \u2713 '+m);}else{fail++;console.log('  \u2717 '+m);}};

// Stored array shuffled by a merge: created order was x1,x2,x3 but array is x3,x1,x2
const shuffled = [
  { id:'x3', name:'Vegas Roll', balance:'529' },
  { id:'x1', name:'Milkyway', balance:'432' },
  { id:'x2', name:'Pandamaster', balance:'492' },
];
const ordered = shuffled.slice().sort((a,b)=>itemIdSeq(a.id)-itemIdSeq(b.id));
ok(ordered.map(r=>r.name).join(',')==='Milkyway,Pandamaster,Vegas Roll', 'rows restored to creation order regardless of array shuffle');

// Idempotent: already-ordered stays ordered
const already = ordered.slice().sort((a,b)=>itemIdSeq(a.id)-itemIdSeq(b.id));
ok(already.map(r=>r.id).join(',')==='x1,x2,x3', 'stable sort is idempotent');

// Malformed id sinks to the end (doesn't crash, doesn't jump to top)
const withBad = [{id:'x2',name:'B'},{id:'weird',name:'Z'},{id:'x1',name:'A'}]
  .sort((a,b)=>itemIdSeq(a.id)-itemIdSeq(b.id));
ok(withBad.map(r=>r.name).join(',')==='A,B,Z', 'malformed id sorts last, no crash');

console.log(`\n${pass} passed, ${fail} failed`); process.exit(fail?1:0);
