// Guards that the human-visible APP_VERSION (shown on Settings → About) matches
// the service-worker CACHE_VERSION, so a deployed build's version is trustworthy.
//   node test/version.test.js
const fs = require('fs'), path = require('path');
let passed = 0, failed = 0;
const check = (n, c) => { if (c) { passed++; console.log('  \u2713 ' + n); } else { failed++; console.log('  \u2717 ' + n); } };

const app = fs.readFileSync(path.resolve(__dirname, '../app.js'), 'utf8');
const sw = fs.readFileSync(path.resolve(__dirname, '../sw.js'), 'utf8');

const appV = (app.match(/APP_VERSION\s*=\s*'([0-9.]+)'/) || [])[1];
const swV = (sw.match(/infos-v([0-9.]+)/) || [])[1];

console.log('\nversion is defined and shown on About:');
check('APP_VERSION constant exists in app.js', !!appV);
check('About page renders the version', /Version \$\{esc\(APP_VERSION\)\}/.test(app) || /v\$\{esc\(APP_VERSION\)\}/.test(app));
check('SW CACHE_VERSION exists', !!swV);
check(`APP_VERSION (${appV}) matches SW CACHE_VERSION (${swV})`, appV && swV && appV === swV);

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
