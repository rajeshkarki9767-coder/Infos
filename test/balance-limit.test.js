// v215: per-business low-balance limit. An entry at or below its business's limit
// is flagged. Mirrors isLowItem + limitFor logic.
function makeChecker(balanceLimits, limitBizId) {
  const itemBizIds = it => it.bizIds || (it.bizId ? [it.bizId] : []);
  const limitFor = bid => { const v = balanceLimits && balanceLimits[bid]; return (typeof v === 'number' && !isNaN(v)) ? v : null; };
  return function isLowItem(it) {
    const n = parseFloat(it.balance);
    if (isNaN(n)) return false;
    const bids = limitBizId ? [limitBizId] : itemBizIds(it);
    return bids.some(bid => { const lim = limitFor(bid); return lim != null && n <= lim; });
  };
}
let pass=0, fail=0;
const ok=(c,m)=>{if(c){pass++;console.log('  \u2713 '+m);}else{fail++;console.log('  \u2717 '+m);}};

const limits = { bM: 750, bS: 1000 };

// focused on Marvel (bM), limit 750
let isLow = makeChecker(limits, 'bM');
ok(isLow({ balance:'500', bizIds:['bM'] }) === true,  '500 <= 750 is low');
ok(isLow({ balance:'750', bizIds:['bM'] }) === true,  'exactly at limit (750) is low (at-or-below)');
ok(isLow({ balance:'751', bizIds:['bM'] }) === false, '751 > 750 is not low');
ok(isLow({ balance:'abc', bizIds:['bM'] }) === false, 'non-numeric balance is not low');

// no business focus → check any business the item belongs to
isLow = makeChecker(limits, null);
ok(isLow({ balance:'900', bizIds:['bS'] }) === true,  '900 <= 1000 (Stark limit) is low');
ok(isLow({ balance:'900', bizIds:['bM'] }) === false, '900 > 750 (Marvel limit) not low');
ok(isLow({ balance:'900', bizIds:['bX'] }) === false, 'business with no limit set → not low');

// limit not set at all
isLow = makeChecker({}, 'bM');
ok(isLow({ balance:'1', bizIds:['bM'] }) === false, 'no limit set → nothing flagged');

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail?1:0);
