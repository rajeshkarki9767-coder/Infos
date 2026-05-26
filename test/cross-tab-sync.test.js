// Verifies owner items on Notices/System/Games/ID&Pass assigned to a business
// survive the full round-trip: buildSharedSlice -> (cloud) -> sliceToMemberState
// -> filterByBiz, and are visible to the business login.
//   node test/cross-tab-sync.test.js
const path = require('path');
const Slice = require(path.resolve(__dirname, '../supabase/shared-slice.js'));

let passed = 0, failed = 0;
function check(n, c) { if (c) { passed++; console.log('  \u2713 ' + n); } else { failed++; console.log('  \u2717 ' + n); } }

// Minimal owner state: one business (local id 'b1'), items on each tab assigned to it.
const LOCAL = 'b1', CLOUD = 'cloud-uuid-1';
const ownerState = {
  businesses: [{ id: LOCAL, name: 'Acme', color: '#378ADD' }],
  items: {
    notices:  [{ id: 'x1', title: 'Notice A', bizIds: [LOCAL] }],
    system:   [{ id: 'x2', name: 'System A', bizIds: [LOCAL] }],
    games:    [{ id: 'x3', name: 'Game A',   bizIds: [LOCAL] }],
    'idpass-system':   [{ id: 'x4', name: 'IDsys A', username:'u', password:'secret', bizIds: [LOCAL] }],
    'idpass-accounts': [{ id: 'x5', name: 'IDacc A', username:'u2', password:'secret2', bizIds: [LOCAL] }],
    balance:  [{ id: 'x6', name: 'Bal A', balance: '100', bizIds: [LOCAL] }],
  },
  itemOrder: {}, bizAllowedTabs: {}, customTabs: [], globalActivity: []
};

console.log('\nowner builds shared slice for the business:');
const slice = Slice.buildSharedSlice(ownerState, LOCAL, CLOUD);
['notices','system','games','idpass-system','idpass-accounts','balance'].forEach(tab => {
  check(`slice includes ${tab} item`, !!(slice.items[tab] && slice.items[tab].length === 1));
});
check('slice item bizIds normalized to CLOUD id', slice.items.system[0].bizIds.includes(CLOUD));
check('secrets stripped from idpass items in slice', !slice.items['idpass-system'][0].password && !slice.items['idpass-system'][0].passwordEnc);

console.log('\nbusiness login hydrates the slice into member state:');
const ms = Slice.sliceToMemberState(slice, { email: 'team@acme.com' });
check('member state business id is the CLOUD id', ms.businesses[0].id === CLOUD);
['notices','system','games','idpass-system','idpass-accounts','balance'].forEach(tab => {
  check(`member sees ${tab} item`, !!(ms.items[tab] && ms.items[tab].length === 1));
});

console.log('\nfilterByBiz visibility (business login is bizContext = CLOUD id):');
// Replicate the view-only filter: items shown where itemHasBiz(it, bizContext).
function itemBizIds(it){ return Array.isArray(it.bizIds)?it.bizIds:(it.bizId?[it.bizId]:[]); }
const bizContext = ms.businesses[0].id; // CLOUD
['notices','system','games','idpass-system','idpass-accounts','balance'].forEach(tab => {
  const visible = ms.items[tab].filter(it => itemBizIds(it).includes(bizContext));
  check(`${tab}: item is visible under bizContext filter`, visible.length === 1);
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
