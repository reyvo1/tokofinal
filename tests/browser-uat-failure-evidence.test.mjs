import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

test('browser UAT captures a failure screenshot before closing CDP when possible', () => {
  const source = fs.readFileSync('scripts/browser-uat.mjs','utf8');
  assert.match(source, /Page\.captureScreenshot/);
  assert.match(source, /logs', 'browser-uat', 'failure\.png'/);
  assert.match(source, /evidence\.failureScreenshot/);
  const catchIndex = source.indexOf('Page.captureScreenshot');
  const closeIndex = source.indexOf('cdp?.close()', catchIndex);
  assert.ok(catchIndex >= 0 && closeIndex > catchIndex, 'screenshot must be attempted before CDP is closed');
});
