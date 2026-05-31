// Link field requirement by tab: optional on Notices (Reminder), required on Games & System.
const fs = require('fs');
const path = require('path');
const app = fs.readFileSync(path.join(__dirname, '..', 'app.js'), 'utf8');
let failed = 0;
const check = (n, c) => { console.log((c ? '  \u2713 ' : '  \u2717 ') + n); if (!c) failed++; };

const fn = app.slice(app.indexOf('function fieldsFor'), app.indexOf('function openItemModal'));

// Notices branch: link present and optional (no required:true on the link line)
const noticesBlock = fn.slice(fn.indexOf("tabKey === 'notices'"), fn.indexOf('idpass-system'));
check('Notices: link is optional', /k: 'link'[^}]*optional/i.test(noticesBlock) && !/k: 'link'[^}]*required: true/.test(noticesBlock));

// Shared shape (Games/System): link required
const sharedBlock = fn.slice(fn.indexOf('System / Games'));
check('Games/System: link is required', /k: 'link', lbl: 'Link', type: 'url', required: true/.test(sharedBlock));
check('Games/System: link label not "(optional)"', !/k: 'link', lbl: 'Link \(optional\)'/.test(sharedBlock));

// validation honors required
check('required fields are validated on save', /fields\.filter\(f => f\.required && !values\[f\.k\]\)/.test(app));

if (failed) { console.log('\n  ' + failed + ' failed'); process.exit(1); }
console.log('  4 passed, 0 failed');
