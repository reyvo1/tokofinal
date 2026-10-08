import fs from 'node:fs';

const file = new URL('../config/functional-depth-roadmap.json', import.meta.url);
const roadmap = JSON.parse(fs.readFileSync(file, 'utf8'));

const expected = Array.from({ length: 12 }, (_, i) => `F${i + 1}`);
const actual = roadmap.phases.map((phase) => phase.id);

if (JSON.stringify(actual) !== JSON.stringify(expected)) {
  throw new Error(`Urutan roadmap berubah: ${actual.join(' -> ')}`);
}

if (!roadmap.policy?.sequenceLocked || roadmap.policy?.allowPhaseSkipping !== false) {
  throw new Error('Roadmap lock policy tidak aktif.');
}

const current = roadmap.phases.find((phase) => phase.id === roadmap.currentPhase);
if (!current) throw new Error(`Current phase ${roadmap.currentPhase} tidak ditemukan.`);

for (const phase of roadmap.phases) {
  for (const dependency of phase.dependsOn || []) {
    if (!expected.includes(dependency)) {
      throw new Error(`${phase.id}: dependency tidak dikenal ${dependency}`);
    }
  }
}

console.log(`ROADMAP LOCK PASS: ${actual.join(' -> ')}`);
console.log(`CURRENT PHASE: ${roadmap.currentPhase} (${current.status})`);
