// v216: the owner's self-heal push must NOT wipe member-only data (Balance entries
// the business login created). mergeSliceOntoCloud merges the owner's local slice
// on top of the current cloud slice, preserving cloud-only items, honoring owner
// tombstones, and keeping the newer copy when both have an item.
const path = require('path');
const Slice = require(path.join(__dirname, '..', 'supabase', 'shared-slice.js'));
const { mergeSliceOntoCloud } = Slice;

let pass=0, fail=0;
const ok=(c,m)=>{if(c){pass++;console.log('  \u2713 '+m);}else{fail++;console.log('  \u2717 '+m);}};

// Owner local slice: has games (owner data), NO balance.
const local = { items: {
  games: [ { id:'g1', name:'Game', updatedAt:100 } ],
}};
// Cloud: has the same game PLUS a balance entry the member added.
const cloud = { items: {
  games:   [ { id:'g1', name:'Game', updatedAt:100 } ],
  balance: [ { id:'b1', name:'Alice', balance:'500', updatedAt:200 } ],
}};

let merged = mergeSliceOntoCloud(local, cloud);
ok(merged.items.balance && merged.items.balance.length === 1, 'member-only balance entry is PRESERVED (the core fix)');
ok(merged.items.balance[0].name === 'Alice', 'preserved balance entry intact');
ok(merged.items.games.length === 1, 'owner game still present');

// Owner edited the game more recently → owner copy wins.
const local2 = { items: { games: [ { id:'g1', name:'Game EDITED', updatedAt:300 } ] } };
merged = mergeSliceOntoCloud(local2, cloud);
ok(merged.items.games[0].name === 'Game EDITED', 'newer owner edit wins over cloud');
ok(merged.items.balance.length === 1, 'balance still preserved during a game edit');

// Owner explicitly deleted a balance entry (tombstone) → deletion honored.
const local3 = { items: { balance: [ { id:'b1', deleted:true, deletedAt:400, updatedAt:400 } ] } };
merged = mergeSliceOntoCloud(local3, cloud);
const b1 = merged.items.balance.find(x=>x.id==='b1');
ok(b1 && b1.deleted === true, 'owner tombstone for a balance entry is honored (delete still works)');

// No cloud row yet → just return local (first share).
merged = mergeSliceOntoCloud(local, null);
ok(merged === local, 'no cloud row → push local as-is');

// Member added a SECOND balance entry the owner has never seen → preserved.
const cloud2 = { items: { balance: [
  { id:'b1', name:'Alice', balance:'500', updatedAt:200 },
  { id:'b2', name:'Bob', balance:'300', updatedAt:250 },
]}};
merged = mergeSliceOntoCloud({ items:{} }, cloud2);
ok(merged.items.balance.length === 2, 'all member balance entries preserved when owner has none');

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail?1:0);
