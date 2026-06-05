// v211 regression: deleting a balance entry on a business (member) login must
// STICK — it must not flicker back when a stale realtime payload (still showing
// the item live) arrives, and a just-added local item must not vanish before the
// cloud echoes it. Reproduces the reported "disappears, reappears, disappears".
const path = require('path');
const api = require(path.join(__dirname, '..', 'supabase', 'shared-slice.js'));
const { sliceToMemberState } = api;

let pass=0, fail=0;
const ok=(c,m)=>{if(c){pass++;console.log('  \u2713 '+m);}else{fail++;console.log('  \u2717 '+m);}};

const biz = { id:'bCloud', name:'Marvel', color:'#e23' };

// --- Scenario A: member deleted x2 locally; a STALE payload still shows x2 live.
const prevAfterDelete = { balance: [
  { id:'x1', name:'Alice', balance:'100', updatedAt:10 },
  { id:'x2', name:'Bob',   balance:'200', updatedAt:10, deleted:true, deletedAt:50 }, // locally deleted
]};
const staleSlice = { business:biz, items:{ balance:[
  { id:'x1', name:'Alice', balance:'100', updatedAt:10 },
  { id:'x2', name:'Bob',   balance:'200', updatedAt:10 }, // stale: still live, no tombstone
]}};
let res = sliceToMemberState(staleSlice, { prevItems: prevAfterDelete });
let x2 = res.items.balance.find(i=>i.id==='x2');
ok(x2 && x2.deleted === true, 'locally-deleted entry stays deleted against a stale live payload (no resurrection)');
ok(res.items.balance.find(i=>i.id==='x1'), 'other entries unaffected');

// --- Scenario B: incoming payload carries the tombstone -> stays deleted.
const tombSlice = { business:biz, items:{ balance:[
  { id:'x1', name:'Alice', balance:'100', updatedAt:10 },
  { id:'x2', deleted:true, deletedAt:50 },
]}};
res = sliceToMemberState(tombSlice, { prevItems: prevAfterDelete });
ok(!res.items.balance.some(i=>i.id==='x2' && !i.deleted), 'tombstone in incoming keeps entry deleted');

// --- Scenario C: member just ADDED x9 locally; cloud hasn't echoed it yet.
const prevWithNew = { balance: [
  { id:'x1', name:'Alice', balance:'100', updatedAt:10 },
  { id:'x9', name:'New',   balance:'999', updatedAt:99 }, // just added, not yet in cloud
]};
const cloudWithoutNew = { business:biz, items:{ balance:[
  { id:'x1', name:'Alice', balance:'100', updatedAt:10 },
]}};
res = sliceToMemberState(cloudWithoutNew, { prevItems: prevWithNew });
ok(res.items.balance.find(i=>i.id==='x9'), 'just-added local entry is NOT dropped before cloud echo');

// --- Scenario D: genuine remote delete of x1 while member had it live.
const prevLive = { balance: [ { id:'x1', name:'Alice', balance:'100', updatedAt:10 } ] };
const remoteDel = { business:biz, items:{ balance:[ { id:'x1', deleted:true, deletedAt:60 } ] }};
res = sliceToMemberState(remoteDel, { prevItems: prevLive });
ok(!res.items.balance.some(i=>i.id==='x1' && !i.deleted), 'genuine remote delete removes the live local item');

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail?1:0);
