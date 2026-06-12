// v229: the low-balance banner only flags the LATEST batch per business.
function itemHasBiz(it, bid){ const ids = it.bizIds || (it.bizId?[it.bizId]:[]); return ids.includes(bid); }
function build(batches, scopeBizIds, limits, bizNames) {
  const isItemLow = (it, bid) => { const n=parseFloat(it.balance); const lim=limits[bid]; return !isNaN(n)&&lim!=null&&n<=lim; };
  const lowByBiz = new Map();
  scopeBizIds.forEach(bid => {
    const latestBatch = batches.find(b => b.items.some(it => itemHasBiz(it, bid)));
    if (!latestBatch) return;
    const bn = bizNames[bid]; if (!bn) return;
    latestBatch.items.forEach(it => {
      if (!itemHasBiz(it, bid)) return;
      if (!isItemLow(it, bid)) return;
      if (!lowByBiz.has(bn)) lowByBiz.set(bn, []);
      lowByBiz.get(bn).push(`${it.name} (${it.balance})`);
    });
  });
  return lowByBiz;
}
let pass=0,fail=0; const ok=(c,m)=>{if(c){pass++;console.log('  \u2713 '+m);}else{fail++;console.log('  \u2717 '+m);}};

const limits = { bS: 1000 };
const names = { bS: 'Stark' };
// newest-first batches: latest has Milkyway 432; OLDER batch has Milkyway 824 etc.
const batches = [
  { items: [ { name:'Milkyway', balance:'432', bizIds:['bS'] }, { name:'Vegas Roll', balance:'1200', bizIds:['bS'] } ] },
  { items: [ { name:'Milkyway', balance:'824', bizIds:['bS'] }, { name:'Ultrapanda', balance:'884', bizIds:['bS'] } ] },
];
let r = build(batches, ['bS'], limits, names);
ok(r.get('Stark').length === 1 && r.get('Stark')[0].startsWith('Milkyway (432)'), 'only LATEST batch flagged (old Milkyway 824 / Ultrapanda excluded)');
ok(!r.get('Stark').some(e=>e.includes('824')), 'older batch values do not appear');
ok(!r.get('Stark').some(e=>e.includes('Vegas Roll')), 'non-low rows in latest batch not flagged (1200 > 1000)');

// Two businesses, each gets its own latest
const limits2 = { bS: 1000, bM: 500 };
const names2 = { bS:'Stark', bM:'Marvel' };
const batches2 = [
  { items: [ { name:'Juwa', balance:'138', bizIds:['bM'] } ] },            // latest, Marvel
  { items: [ { name:'Milkyway', balance:'432', bizIds:['bS'] } ] },        // latest for Stark
  { items: [ { name:'Juwa 2.0', balance:'423', bizIds:['bM'] } ] },        // OLD Marvel — excluded
];
r = build(batches2, ['bS','bM'], limits2, names2);
ok(r.get('Marvel').length===1 && r.get('Marvel')[0].includes('138'), "Marvel shows only its latest batch's low");
ok(!JSON.stringify([...r]).includes('423'), 'old Marvel batch (Juwa 2.0 423) excluded');
ok(r.get('Stark').length===1, "Stark's own latest still flagged independently");

// Business with no batches → no line
r = build(batches2, ['bX'], limits2, { bX:'Ghost' });
ok(r.size===0, 'business with no entries produces no banner line');

console.log(`\n${pass} passed, ${fail} failed`); process.exit(fail?1:0);
