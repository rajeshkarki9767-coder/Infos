// v209: new Balance entry pre-fills names from the most recent batch for the
// current business, in that batch's order, distinct & non-empty. Mirrors the
// lastBalanceNamesForBiz logic in isolation.
let pass=0, fail=0;
const ok=(c,m)=>{if(c){pass++;console.log('  \u2713 '+m);}else{fail++;console.log('  \u2717 '+m);}};

function lastNames(items, bizId) {
  const itemBizIds = it => it.bizIds || (it.bizId?[it.bizId]:[]);
  const itemCreatedAt = it => it.createdAt || 0;
  const list = items.filter(it=>!it.deleted && itemBizIds(it).includes(bizId));
  if(!list.length) return [];
  const origIndex=new Map(list.map((it,i)=>[it.id,i]));
  const batchMap=new Map();
  list.forEach(it=>{const b=it.batchId||('solo_'+it.id);if(!batchMap.has(b))batchMap.set(b,[]);batchMap.get(b).push(it);});
  let best=null;
  for(const [,g] of batchMap){
    const created=Math.max(...g.map(i=>itemCreatedAt(i)||0));
    const sumIndex=Math.max(...g.map(i=>origIndex.get(i.id)||0));
    if(!best||created>best.created||(created===best.created&&sumIndex>best.sumIndex)) best={group:g,created,sumIndex};
  }
  best.group.sort((a,b)=>(origIndex.get(a.id)||0)-(origIndex.get(b.id)||0));
  const seen=new Set();const names=[];
  best.group.forEach(it=>{const n=(it.name||'').trim();if(n&&!seen.has(n)){seen.add(n);names.push(n);}});
  return names;
}

const items=[
  // Older batch
  {id:'x1',name:'Alice',balance:'100',batchId:'b1',createdAt:1000,bizIds:['bM']},
  {id:'x2',name:'Bob',  balance:'200',batchId:'b1',createdAt:1000,bizIds:['bM']},
  // Newer batch (most recent) — should win, order Carol, Dave, Eve
  {id:'x3',name:'Carol',balance:'10', batchId:'b2',createdAt:2000,bizIds:['bM']},
  {id:'x4',name:'Dave', balance:'20', batchId:'b2',createdAt:2000,bizIds:['bM']},
  {id:'x5',name:'Eve',  balance:'30', batchId:'b2',createdAt:2000,bizIds:['bM']},
  // Another business — must be ignored
  {id:'x6',name:'Zack', balance:'5',  batchId:'b3',createdAt:3000,bizIds:['bStark']},
];

ok(JSON.stringify(lastNames(items,'bM'))===JSON.stringify(['Carol','Dave','Eve']),
   'pre-fills names from most recent batch, in order, for the right business');
ok(JSON.stringify(lastNames(items,'bStark'))===JSON.stringify(['Zack']),
   'scopes to the current business only');
ok(JSON.stringify(lastNames(items,'bNone'))===JSON.stringify([]),
   'no entries for a business → empty (falls back to one blank row)');

// distinct names within a batch
const dup=[{id:'y1',name:'Sam',balance:'1',batchId:'c1',createdAt:5,bizIds:['bM']},
           {id:'y2',name:'Sam',balance:'2',batchId:'c1',createdAt:5,bizIds:['bM']},
           {id:'y3',name:'',   balance:'3',batchId:'c1',createdAt:5,bizIds:['bM']}];
ok(JSON.stringify(lastNames(dup,'bM'))===JSON.stringify(['Sam']),'dedupes names and drops blanks');

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail?1:0);
