import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
const plan = JSON.parse(read('.github/ci/security-dependency-plan.json'));
const script = read('scripts/ci-propose-security-dependency-refresh.mjs');
const workflow = read('.github/workflows/full-system-simulation.yml');
const pkg = JSON.parse(read('package.json'));

const byId = Object.fromEntries(plan.candidates.map((candidate) => [candidate.id, candidate]));

test('security dependency proposal evaluates multiple isolated candidates without weakening the committed audit gate', () => {
  assert.ok(Array.isArray(plan.candidates));
  assert.equal(plan.candidates.length, 2);
  const currentPrisma = byId['runtime-framework-patched-prisma-current'];
  const auditCompat = byId['runtime-framework-patched-prisma-audit-compat'];
  assert.ok(currentPrisma);
  assert.ok(auditCompat);
  // next 16.3.5 kena GHSA-vcvr-r3jv-pc5j (RCE di next/og, severity critical). Gate
  // `npm audit --omit=dev --audit-level=high` memblokir high/critical, jadi plan wajib
  // menunjuk versi patched. Yang dikunci di sini adalah KESESUAIAN plan dengan kedua
  // candidate dan hood minimum patched -- bukan satu nomor versi tertentu.
  assert.equal(currentPrisma.direct.next, auditCompat.direct.next);
  assert.ok(/^16\.[3-9]\.\d+$/.test(currentPrisma.direct.next), `next candidate harus >= 16.3.6: ${currentPrisma.direct.next}`);
  assert.equal(currentPrisma.direct['@nestjs/core'], '12.0.4');
  assert.equal(currentPrisma.direct['@nestjs/platform-express'], '12.0.4');
  assert.equal(currentPrisma.direct['@nestjs/config'], '12.0.0');
  assert.equal(currentPrisma.direct['@nestjs/jwt'], '12.0.2');
  assert.equal(currentPrisma.direct['@nestjs/swagger'], '12.0.1');
  assert.equal(currentPrisma.direct['@nestjs/cli'], undefined);
  assert.equal(currentPrisma.direct['@nestjs/testing'], '12.0.3');
  assert.equal(currentPrisma.direct['@nestjs/schematics'], undefined);
  assert.equal(currentPrisma.overrides['deepmerge-ts'], '8.0.1');
  assert.equal(auditCompat.direct.prisma, '6.12.0');
  assert.equal(auditCompat.direct['@prisma/client'], '6.12.0');
  assert.match(auditCompat.description, /Never auto-adopt/i);
  assert.ok(plan.notes.some((note) => /TypeScript >=6\.0/.test(note)));

});

// Runner 2026-10-02 (run 37032723106) gagal di gate `dependencyAudit`: next 16.3.5 kena
// GHSA-vcvr-r3jv-pc5j (RCE di next/og, severity critical). Plan security sudah menunjuk
// versi patched, tapi EMPAT package.json aplikasi masih pin 16.3.5 - jadi gate audit yang
// membaca lock produk tetap merah. Test ini mengunci versi yang benar-benar di-declare
// aplikasi, bukan hanya plan.
test('empat aplikasi Next declaring versi patched, sama dengan plan security', () => {
  const patched = byId['runtime-framework-patched-prisma-current'].direct.next;
  for (const app of ['admin', 'storefront', 'pos', 'employee-portal']) {
    const declared = JSON.parse(read(`apps/${app}/package.json`)).dependencies.next;
    assert.equal(declared, patched, `${app} harus declaring next ${patched}, bukan ${declared}`);
  }
  const lock = JSON.parse(read('package-lock.json'));
  const locked = lock.packages?.['node_modules/next']?.version;
  assert.equal(locked, patched, `package-lock.json harus mengunci next ${patched}, bukan ${locked}`);
});

test('security proposal is isolated, records each candidate lock/audit, and never overwrites the checked-out package lock', () => {
  assert.match(script, /mkdtempSync/);
  assert.match(script, /isolated: true/);
  assert.match(script, /package-lock-only/);
  assert.match(script, /lockStrategy: 'fresh-from-manifests'/);
  assert.match(script, /Deliberately do not seed the candidate with the committed lock/);
  assert.match(script, /verifyOverrideResolution/);
  assert.match(script, /security proposal override resolution mismatch/);
  assert.doesNotMatch(script, /copyFileSync\(path\.join\(root, 'package-lock\.json'\), path\.join\(tempRoot, 'package-lock\.json'\)\)/);
  assert.match(script, /preferredCandidate/);
  assert.match(script, /PROPOSAL_CANDIDATE/);
  assert.match(script, /PROPOSAL_BLOCKER/);
  assert.match(script, /handoff\/quality\/security-dependency-proposal/);
  assert.doesNotMatch(script, /copyFileSync\(proposedLock,\s*beforeLock/);
});

test('primary audit remains blocking while proposal is diagnostic-only and uploaded as evidence', () => {
  assert.match(workflow, /Audit production dependencies for high\/critical vulnerabilities/);
  assert.match(workflow, /id: dependency_audit/);
  assert.match(workflow, /Generate isolated security dependency lock proposal when audit blocks/);
  assert.match(workflow, /continue-on-error: true[\s\S]*?npm run ci:security:proposal/);
  assert.match(workflow, /handoff\/quality\/security-dependency-proposal\/\*\*/);
  assert.equal(pkg.scripts['ci:security:proposal'], 'node scripts/ci-propose-security-dependency-refresh.mjs');
});


test('security proposal preserves npm install failure diagnostics without mutating the committed lock', () => {
  assert.match(script, /npm=\$\{tail\}/);
  assert.match(script, /slice\(-24\)/);
  assert.doesNotMatch(script, /--legacy-peer-deps|--force/);
});
