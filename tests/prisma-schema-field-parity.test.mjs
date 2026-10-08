import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const ROOT = new URL('../', import.meta.url);
const read = (p) => fs.readFileSync(new URL(p, ROOT), 'utf8');

// The canonical schema is a mirror, not an independent source: db push and prisma generate
// only ever read the sqlite and postgresql files. When a field exists in those two but not in
// the canonical copy, the repo still builds, tests still pass, and the drift is invisible
// until someone reads schema.prisma and trusts it. That is exactly what happened to
// Employee.settlementAccountCode and Employee.accountingEventId.
//
// validate-repo.mjs compared sqlite vs postgresql as full text (so fields were checked) but
// canonical vs sqlite by model NAME only. These tests lock the field-level comparison in so a
// future schema edit cannot silently reintroduce a name-only mirror check.

function modelBodies(schema) {
  const out = new Map();
  for (const match of schema.matchAll(/^model\s+(\w+)\s*\{([\s\S]*?)^\}/gm)) {
    out.set(match[1], match[2]
      .split('\n')
      .map((line) => line.replace(/\s+@db\.\w+(\([^)]*\))?/g, '').trimEnd())
      .filter((line) => line.trim() && !/^\/\//.test(line.trim()))
      .map((line) => line.trim())
      .join('\n'));
  }
  return out;
}

const sqlite = read('apps/api/prisma/schema.sqlite.prisma');
const postgres = read('apps/api/prisma/schema.postgresql.prisma');
const canonical = read('apps/api/prisma/schema.prisma');

test('canonical schema mirrors SQLite field-for-field, not just model-for-model', () => {
  const left = modelBodies(canonical);
  const right = modelBodies(sqlite);
  assert.equal(left.size, right.size, 'canonical and SQLite must declare the same number of models');
  for (const [model, rightBody] of right) {
    const leftBody = left.get(model);
    assert.ok(leftBody !== undefined, `canonical schema is missing model ${model}`);
    assert.equal(leftBody, rightBody, `canonical model ${model} differs from SQLite field-for-field`);
  }
});

test('canonical schema mirrors PostgreSQL field-for-field', () => {
  const left = modelBodies(canonical);
  const right = modelBodies(postgres);
  for (const [model, rightBody] of right) {
    const leftBody = left.get(model);
    assert.ok(leftBody !== undefined, `canonical schema is missing model ${model}`);
    assert.equal(leftBody, rightBody, `canonical model ${model} differs from PostgreSQL field-for-field`);
  }
});

test('Employee carries the payroll settlement trace fields in every schema', () => {
  // Named explicitly because these two are the concrete regression this file exists for.
  for (const [name, schema] of [['canonical', canonical], ['sqlite', sqlite], ['postgresql', postgres]]) {
    const body = modelBodies(schema).get('Employee');
    assert.ok(body, `${name} schema has no Employee model`);
    assert.match(body, /settlementAccountCode\s+String\?/, `${name}: Employee.settlementAccountCode missing`);
    assert.match(body, /accountingEventId\s+String\?\s+@unique/, `${name}: Employee.accountingEventId missing or lost its @unique`);
  }
});

test('repository validation compares schema fields, not only model names', () => {
  // A name-only mirror check is what let the drift pass. Assert the comparison exists so a
  // future simplification of validate-repo.mjs cannot quietly restore the blind check.
  const source = read('scripts/validate-repo.mjs');
  assert.match(source, /modelBodies/, 'validate-repo.mjs must compare per-model field bodies');
  assert.match(source, /canonical schema\.prisma vs SQLite/, 'validate-repo.mjs must compare canonical against SQLite');
  assert.match(source, /canonical schema\.prisma vs PostgreSQL/, 'validate-repo.mjs must compare canonical against PostgreSQL');
  assert.match(source, /is missing field\(s\)/, 'the failure message must name the missing field');
});
