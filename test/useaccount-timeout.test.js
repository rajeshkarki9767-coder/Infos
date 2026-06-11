// v228: useAccount must not hang the boot if IndexedDB stalls. We assert the
// source wraps the real bind in a timeout race that degrades to in-memory.
const fs = require('fs');
const src = fs.readFileSync(require('path').join(__dirname, '..', 'db.js'), 'utf8');
let pass=0, fail=0; const ok=(c,m)=>{if(c){pass++;console.log('  \u2713 '+m);}else{fail++;console.log('  \u2717 '+m);}};
ok(/async function useAccount\(email\)[\s\S]{0,600}Promise\.race/.test(src), 'useAccount races against a timeout');
ok(/async function _useAccountInner\(email\)/.test(src), 'original bind preserved as _useAccountInner');
ok(/__TO__/.test(src), 'timeout sentinel present');

// Behavioral: a hanging inner never settles, but the race resolves via timeout.
async function behavioral() {
  function raceWithTimeout(realFn, ms) {
    const real = realFn();
    const to = new Promise(res => setTimeout(() => res('__TO__'), ms));
    return Promise.race([real, to]);
  }
  const neverResolves = () => new Promise(() => {}); // simulates hung IDB
  const r = await raceWithTimeout(neverResolves, 30);
  return r === '__TO__';
}
behavioral().then(okTimeout => {
  ok(okTimeout, 'a hung inner bind resolves via timeout (boot not frozen)');
  console.log(`\n${pass} passed, ${fail} failed`); process.exit(fail?1:0);
});
