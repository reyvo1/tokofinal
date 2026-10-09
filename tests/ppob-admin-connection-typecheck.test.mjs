import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const source = readFileSync(new URL('../apps/admin/app/modules/digital-services.tsx', import.meta.url), 'utf8');

function connectionBranches(input) {
  const start = input.indexOf('async function saveConnection(');
  const end = input.indexOf('async function sync(', start);
  assert.ok(start >= 0 && end > start, 'saveConnection must be present');
  const block = input.slice(start, end);
  const patch = block.match(/await call\(token,`\/platform\/integrations\/\$\{integration\.id\}`,\{method:'PATCH',body:JSON\.stringify\(([^\n]+)\);/);
  const create = block.match(/await call\(token,'\/platform\/integrations',\{method:'POST',body:JSON\.stringify\(([^\n]+)\);/);
  assert.ok(patch && create, 'both PATCH and POST branches must be present');
  return { patch: patch[1], create: create[1] };
}

function validateNewConnection(input) {
  const { create } = connectionBranches(input);
  assert.doesNotMatch(create, /\bintegration\s*(?:\?|\.)/, 'null-narrowed creation branch cannot read integration');
  for (const key of ['catalogKind', 'providerBalanceAccountCode', 'ppobCashEnabled', 'encryptedSecrets', 'capabilities']) {
    assert.match(create, new RegExp('\\b' + key + '\\b'));
  }
}

test('new Digiflazz connection never dereferences a null-narrowed integration', () => {
  validateNewConnection(source);
  const formerBug = source.replace(
    "config:{catalogKind:'prepaid'",
    "config:{...(integration?.config??{}),catalogKind:'prepaid'",
  );
  assert.notEqual(formerBug, source, 'negative-control mutation must be effective');
  assert.throws(() => validateNewConnection(formerBug), /null-narrowed/);
});

test('existing Digiflazz credential rotation preserves current config and both requests keep real API contracts', () => {
  const { patch, create } = connectionBranches(source);
  assert.match(patch, /\.\.\.\(integration\?\.config\?\?\{\}\)/);
  for (const part of [patch, create]) {
    assert.match(part, /providerBalanceAccountCode:providerBalanceAccount\.trim\(\)\.toUpperCase\(\)/);
    assert.match(part, /ppobCashEnabled/);
    assert.match(part, /encryptedSecrets/);
    assert.match(part, /catalog:true,prepaidTransaction:true,recheck:true/);
  }
});
