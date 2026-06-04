// v210 P0 regression: editing a balance batch must NOT delete rows just because
// a balance field is blank. Only rows the user explicitly removed from the form
// (their _id no longer in `rows`) may be removed — and via soft-delete (Trash).
// Mirrors the reconciliation logic from the bal-save handler.

function reconcile(editingBatch, rows, recorder, targetBizIds, nextId) {
  const items = editingBatch.map(it => ({ ...it })); // simulate state.items
  const existingById = new Map(items.map(it => [it.id, it]));
  const keptIds = new Set();
  const idsStillInForm = new Set(rows.filter(r => r._id).map(r => r._id));
  const validRows = rows.map(r => ({ name:(r.name||'').trim(), balance:(r.balance||'').trim(), _id:r._id }))
                        .filter(r => r.name && r.balance);
  validRows.forEach(r => {
    if (r._id && existingById.has(r._id)) {
      const it = existingById.get(r._id);
      it.name = r.name; it.balance = r.balance; it.recordedBy = recorder;
      keptIds.add(r._id);
    } else {
      const ni = { id:'x'+(nextId++), name:r.name, balance:r.balance, recordedBy:recorder };
      items.push(ni); keptIds.add(ni.id);
    }
  });
  editingBatch.forEach(it => { if (idsStillInForm.has(it.id) && !keptIds.has(it.id)) keptIds.add(it.id); });
  const removed = [];
  items.forEach(it => { if (existingById.has(it.id) && !keptIds.has(it.id)) { it.deleted = true; removed.push(it.id); } });
  return { items, removed };
}

let pass=0, fail=0;
const ok=(c,m)=>{if(c){pass++;console.log('  \u2713 '+m);}else{fail++;console.log('  \u2717 '+m);}};

const batch = [
  { id:'x1', name:'Alice', balance:'100', recordedBy:'Joe', batchId:'b1' },
  { id:'x2', name:'Bob',   balance:'200', recordedBy:'Joe', batchId:'b1' },
];

// Scenario 1 (THE BUG): user edits, clears Bob's balance but keeps the row.
let rows = [ {name:'Alice',balance:'150',_id:'x1'}, {name:'Bob',balance:'',_id:'x2'} ];
let res = reconcile(batch, rows, 'Joe', ['bM'], 100);
const bob = res.items.find(i=>i.id==='x2');
ok(bob && !bob.deleted, 'row with cleared balance is PRESERVED, not deleted (the reported bug)');
ok(bob && bob.balance==='200', 'preserved row keeps its previous balance');
ok(res.items.find(i=>i.id==='x1').balance==='150', 'edited row updates normally');
ok(res.removed.length===0, 'nothing removed when user only blanked a field');

// Scenario 2: user explicitly removes Bob (row gone from form).
rows = [ {name:'Alice',balance:'150',_id:'x1'} ];
res = reconcile(batch, rows, 'Joe', ['bM'], 100);
ok(res.removed.includes('x2'), 'explicitly removed row IS removed');
ok(res.items.find(i=>i.id==='x2').deleted===true, 'removal is a SOFT delete (recoverable in Trash)');

// Scenario 3: add a new row alongside existing, none lost.
rows = [ {name:'Alice',balance:'150',_id:'x1'}, {name:'Bob',balance:'200',_id:'x2'}, {name:'Carol',balance:'300'} ];
res = reconcile(batch, rows, 'Joe', ['bM'], 100);
ok(res.items.filter(i=>!i.deleted).length===3, 'adding a row keeps all three');
ok(res.removed.length===0, 'no deletions when adding');

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail?1:0);
