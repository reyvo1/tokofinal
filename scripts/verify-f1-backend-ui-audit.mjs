import fs from 'node:fs';

const file = 'config/f1-backend-ui-audit.json';
if (!fs.existsSync(file)) throw new Error(`${file} belum dihasilkan. Jalankan npm/node audit F1 terlebih dahulu.`);

const audit = JSON.parse(fs.readFileSync(file, 'utf8'));
const expected = ['F2','F3','F4','F5','F6','F7','F8','F9','F10','F11'];
const actual = audit.capabilities.map((x) => x.id);

if (JSON.stringify(expected) !== JSON.stringify(actual)) {
  throw new Error(`F1 capability matrix tidak lengkap: ${actual.join(', ')}`);
}
if (audit.classification?.unknownCount !== 0) {
  throw new Error(`Masih ada ${audit.classification?.unknownCount} UNKNOWN.`);
}
for (const item of audit.capabilities) {
  if (!['EXPOSED','HIDDEN','PARTIAL','MISSING','DEFERRED_BY_DESIGN'].includes(item.status)) {
    throw new Error(`${item.id} status invalid: ${item.status}`);
  }
  if (!item.gap?.trim()) throw new Error(`${item.id} belum memiliki gap/backlog.`);
}

console.log('F1 AUDIT CONTRACT PASS');
console.log(actual.map((id) => `${id}:${audit.capabilities.find((x) => x.id === id).status}`).join(' | '));
