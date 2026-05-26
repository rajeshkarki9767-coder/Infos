// Unit tests for supabase/shared-slice.js — the build/apply/merge logic that
// keeps owner and business-login editors on the SAME data.
//
//   node test/slice.test.js

const S = require('../supabase/shared-slice.js');

let passed = 0, failed = 0;
function check(name, cond) {
  if (cond) { passed++; console.log('  \u2713 ' + name); }
  else { failed++; console.log('  \u2717 ' + name); }
}

function ownerState() {
  return {
    businesses: [
      { id: 'b1', name: 'Acme', color: '#111', email: 'team@acme.com', password: 'secret', devices: [{ fingerprint: 'x' }] },
      { id: 'b2', name: 'Other', color: '#222', email: 't@o.com', password: 'pw2' }
    ],
    items: {
      notices: [
        { id: 1, name: 'Shared notice', bizIds: ['b1'], deleted: false },
        { id: 2, name: 'B2 notice', bizIds: ['b2'], deleted: false },
        { id: 3, name: 'Multi', bizIds: ['b1', 'b2'], deleted: false },
        { id: 4, name: 'Trashed', bizIds: ['b1'], deleted: true }
      ],
      balance: [
        { id: 5, name: 'Entry', bizIds: ['b1'], amount: 100, password: 'leak', pin: '0000' }
      ],
      games: []
    },
    itemOrder: { b1: { notices: [3, 1] }, b2: { notices: [2] } },
    bizAllowedTabs: { b1: ['notices', 'balance'] },
    bizTabOrder: { b1: ['balance', 'notices'] },
    customTabs: [{ key: 'c100', label: 'Custom' }],
    globalActivity: [
      { id: 'a1', ts: 100, verb: 'created', bizIds: ['b1'] },
      { id: 'a2', ts: 200, verb: 'edited', bizIds: ['b2'] }
    ]
  };
}

console.log('\nbuildSharedSlice:');
{
  const slice = S.buildSharedSlice(ownerState(), 'b1');
  check('only b1 items included (notices: shared + multi, not b2-only, not trashed)',
    slice.items.notices.length === 2 &&
    slice.items.notices.map(i => i.id).sort().join(',') === '1,3');
  check('trashed item excluded', !slice.items.notices.some(i => i.id === 4));
  check('balance item present', slice.items.balance && slice.items.balance.length === 1);
  check('item password/pin stripped', !('password' in slice.items.balance[0]) && !('pin' in slice.items.balance[0]));
  check('business secrets stripped (no password/email/devices)',
    !('password' in slice.business) && !('devices' in slice.business));
  check('business identity kept', slice.business.id === 'b1' && slice.business.name === 'Acme' && slice.business.color === '#111');
  check('itemOrder scoped to b1', slice.itemOrder.notices.join(',') === '3,1');
  check('allowedTabs + tabOrder carried', slice.allowedTabs.join(',') === 'notices,balance' && slice.tabOrder[0] === 'balance');
  check('activity scoped to b1 only', slice.activity.length === 1 && slice.activity[0].id === 'a1');
  check('empty tab (games) omitted from slice', !('games' in slice.items));
}

console.log('\nsliceToMemberState:');
{
  const slice = S.buildSharedSlice(ownerState(), 'b1');
  const ms = S.sliceToMemberState(slice, { email: 'team@acme.com' });
  check('member state has exactly one business', ms.businesses.length === 1 && ms.businesses[0].id === 'b1');
  check('member items match slice', ms.items.notices.length === 2 && ms.items.balance.length === 1);
  check('member activeBizId set to the business', ms.activeBizId === 'b1');
  check('member __sharedBusinessId set', ms.__sharedBusinessId === 'b1');
  check('nextItemId beyond max existing id (5 -> 6)', ms.nextItemId === 6);
  check('standard empty tabs present for full app', Array.isArray(ms.items.system) && Array.isArray(ms.items.games));
  check('shared login is NOT tab-restricted (bizAllowedTabs empty = all tabs editable)', !ms.bizAllowedTabs.b1);
}

console.log('\nmemberStateToSlice (round-trip after a member edit):');
{
  const slice = S.buildSharedSlice(ownerState(), 'b1');
  const ms = S.sliceToMemberState(slice, {});
  // Member adds a new balance entry.
  ms.items.balance.push({ id: ms.nextItemId, name: 'Member added', bizIds: ['b1'], amount: 50 });
  const back = S.memberStateToSlice(ms);
  check('round-tripped slice keeps the new entry', back.items.balance.length === 2 &&
    back.items.balance.some(i => i.name === 'Member added'));
  check('round-tripped slice still scoped to b1', back.business.id === 'b1');
}
{
  const ms = { businesses: [], items: {} };
  check('memberStateToSlice returns null with no business', S.memberStateToSlice(ms) === null);
}

console.log('\napplySliceToOwnerState (owner sees member edits):');
{
  const owner = ownerState();
  // Member edited: renamed the shared notice, added an entry, changed color.
  const editedSlice = {
    schema: 1,
    business: { id: 'b1', name: 'Acme Renamed', color: '#999' },
    items: {
      notices: [
        { id: 1, name: 'Shared notice EDITED', bizIds: ['b1'] },
        { id: 3, name: 'Multi', bizIds: ['b1', 'b2'] },
        { id: 99, name: 'New from member', bizIds: ['b1'] }
      ],
      balance: [{ id: 5, name: 'Entry', bizIds: ['b1'], amount: 100 }]
    },
    itemOrder: { notices: [99, 3, 1] },
    activity: [{ id: 'a3', ts: 300, verb: 'created', bizIds: ['b1'] }]
  };
  S.applySliceToOwnerState(owner, editedSlice);

  const notices = owner.items.notices;
  check('owner sees member rename', notices.some(i => i.id === 1 && i.name === 'Shared notice EDITED'));
  check('owner sees member-added item', notices.some(i => i.id === 99 && i.name === 'New from member'));
  check('owner still has b2-only notice (untouched)', notices.some(i => i.id === 2 && i.name === 'B2 notice'));
  check('owner keeps the trashed item (trash is local, not shared)', notices.some(i => i.id === 4 && i.deleted));
  check('multi-biz item retained', notices.some(i => i.id === 3));
  const b1 = owner.businesses.find(b => b.id === 'b1');
  check('business renamed/recolored from shared copy', b1.name === 'Acme Renamed' && b1.color === '#999');
  check('business SECRETS preserved (password/email/devices not clobbered)',
    b1.password === 'secret' && b1.email === 'team@acme.com' && Array.isArray(b1.devices));
  check('owner itemOrder for b1 updated', owner.itemOrder.b1.notices.join(',') === '99,3,1');
  check('activity merged (a1 from owner + a3 from member), newest first',
    owner.globalActivity.some(e => e.id === 'a3') && owner.globalActivity.some(e => e.id === 'a1') &&
    owner.globalActivity[0].id === 'a3');
}

console.log('\napplySliceToOwnerState — isolation: other business untouched:');
{
  const owner = ownerState();
  const slice = S.buildSharedSlice(owner, 'b1');
  // mutate slice to simulate edits
  slice.items.notices[0].name = 'changed';
  S.applySliceToOwnerState(owner, slice);
  check('b2-only items remain exactly as before', owner.items.notices.filter(i => S._itemHasBiz(i, 'b2') && !S._itemHasBiz(i, 'b1')).length === 1);
  check('b2 business record unchanged', owner.businesses.find(b => b.id === 'b2').name === 'Other');
}

console.log('\nmergeActivity de-dupes + sorts:');
{
  const merged = S.mergeActivity(
    [{ id: 'x', ts: 10 }, { id: 'y', ts: 30 }],
    [{ id: 'x', ts: 10 }, { id: 'z', ts: 20 }]
  );
  check('de-dupes by id', merged.length === 3);
  check('sorted newest-first', merged[0].id === 'y' && merged[2].id === 'x');
}

console.log('\ncloud-id normalization (owner local id <-> cloud id):');
{
  const owner = ownerState();
  // Build b1's slice with a distinct cloud id.
  const slice = S.buildSharedSlice(owner, 'b1', 'CLOUD-1');
  check('slice business identified by cloud id', slice.business.id === 'CLOUD-1');
  check('slice records localId hint', slice.business.localId === 'b1');
  check('single-biz item bizIds normalized to cloud id', slice.items.notices.find(i => i.id === 1).bizIds.join(',') === 'CLOUD-1');
  const multi = slice.items.notices.find(i => i.id === 3);
  check('multi-biz item keeps b2 + swaps b1->cloud id', multi.bizIds.includes('b2') && multi.bizIds.includes('CLOUD-1') && !multi.bizIds.includes('b1'));

  // Member loads it (sees cloud id), adds an item, pushes back.
  const ms = S.sliceToMemberState(slice, {});
  check('member business id is the cloud id', ms.businesses[0].id === 'CLOUD-1');
  ms.items.notices.push({ id: ms.nextItemId++, name: 'Member new', bizIds: ['CLOUD-1'] });
  const back = S.memberStateToSlice(ms);
  check('member round-trip keeps cloud id on all items', back.items.notices.every(i => i.bizIds.includes('CLOUD-1')));

  // Owner applies it back, remapping cloud id -> local b1.
  S.applySliceToOwnerState(owner, back, 'b1');
  const n = owner.items.notices;
  check('owner-applied member-new item carries LOCAL id b1', n.find(i => i.name === 'Member new').bizIds.join(',') === 'b1');
  check('owner-applied multi item has b1 (local) and b2', (() => { const m = n.find(i => i.id === 3); return m.bizIds.includes('b1') && m.bizIds.includes('b2'); })());
  check('owner business b1 keeps its LOCAL id after apply', owner.businesses.find(b => b.id === 'CLOUD-1') === undefined && !!owner.businesses.find(b => b.id === 'b1'));
}

console.log('\nNON-DESTRUCTIVE merge — entries do NOT disappear when slice is partial:');
{
  // Owner has 3 notices for business b1. A partial incoming slice (e.g. from a
  // business login whose state was incomplete) contains only ONE of them.
  // The other two must SURVIVE (this was the "entries disappear" bug).
  const owner = {
    items: { notices: [
      { id: 11, name: 'Keep A', bizIds: ['b1'] },
      { id: 12, name: 'Keep B', bizIds: ['b1'] },
      { id: 13, name: 'Updated C', bizIds: ['b1'] }
    ] },
    businesses: [{ id: 'b1', name: 'Acme', password: 'x', email: 'e', devices: [] }]
  };
  const partialSlice = {
    business: { id: 'CLOUD-1', localId: 'b1', name: 'Acme' },
    items: { notices: [ { id: 13, name: 'Updated C (edited)', bizIds: ['CLOUD-1'] } ] }
  };
  S.applySliceToOwnerState(owner, partialSlice, 'b1');
  const ids = owner.items.notices.map(i => i.id).sort();
  check('partial slice does NOT drop omitted owner items (11 & 12 survive)', ids.includes(11) && ids.includes(12));
  check('partial slice DOES apply the updated item (13 edited)', owner.items.notices.find(i => i.id === 13).name === 'Updated C (edited)');
}
{
  // A TOMBSTONE (explicit deletion) in the slice DOES remove the item.
  const owner = {
    items: { notices: [
      { id: 21, name: 'Stays', bizIds: ['b1'] },
      { id: 22, name: 'Gets deleted', bizIds: ['b1'] }
    ] },
    businesses: [{ id: 'b1', name: 'Acme', password: 'x', email: 'e', devices: [] }]
  };
  const sliceWithTomb = {
    business: { id: 'CLOUD-1', localId: 'b1', name: 'Acme' },
    items: { notices: [
      { id: 21, name: 'Stays', bizIds: ['CLOUD-1'] },
      { id: 22, deleted: true, deletedAt: Date.now(), bizIds: ['CLOUD-1'] }
    ] }
  };
  S.applySliceToOwnerState(owner, sliceWithTomb, 'b1');
  const ids = owner.items.notices.map(i => i.id);
  check('tombstone removes the explicitly-deleted item (22 gone)', !ids.includes(22));
  check('non-deleted item stays (21 present)', ids.includes(21));
}
{
  // buildSharedSlice should EMIT a tombstone for a recently-deleted item so the
  // deletion can propagate.
  const state = {
    items: { notices: [
      { id: 31, name: 'Live', bizIds: ['b1'] },
      { id: 32, name: 'Dead', bizIds: ['b1'], deleted: true, deletedAt: Date.now() }
    ] },
    businesses: [{ id: 'b1', name: 'Acme' }]
  };
  const sl = S.buildSharedSlice(state, 'b1', 'CLOUD-1');
  const dead = (sl.items.notices || []).find(i => i.id === 32);
  check('buildSharedSlice emits a tombstone for a recent deletion', !!dead && dead.deleted === true);
  check('buildSharedSlice still includes the live item', (sl.items.notices || []).some(i => i.id === 31 && !i.deleted));
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
