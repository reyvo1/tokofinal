import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

test('browser UAT captures Runtime.exceptionThrown and fails before PASS on uncaught JS errors', () => {
  const source = fs.readFileSync('scripts/browser-uat.mjs', 'utf8');
  assert.match(source, /this\.listeners = new Map\(\)/);
  assert.match(source, /message\.method/);
  assert.match(source, /Runtime\.exceptionThrown/);
  assert.match(source, /browserRuntimeExceptions/);
  assert.match(source, /BROWSER_RUNTIME_EXCEPTIONS/);
  const exceptionGuard = source.indexOf('if (runtimeExceptions.length)');
  const pass = source.indexOf("evidence.status = 'PASS'", exceptionGuard);
  assert.ok(exceptionGuard >= 0 && pass > exceptionGuard, 'unhandled exception guard must execute before browser UAT PASS');
});
