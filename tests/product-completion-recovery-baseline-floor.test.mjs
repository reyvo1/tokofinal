import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const source = fs.readFileSync(new URL('../scripts/audit-recovery-coverage.mjs', import.meta.url), 'utf8');

test('historical R0 recovery snapshot is a regression floor, not a ceiling on product growth', () => {
  assert.match(source, /prismaModels < matrix\.sourceSnapshot\.prismaModels/);
  assert.match(source, /apiHandlers < matrix\.sourceSnapshot\.apiHandlers/);
  assert.match(source, /uiControls < matrix\.sourceSnapshot\.uiInteractiveElements/);
  assert.doesNotMatch(source, /uiControls !== matrix\.sourceSnapshot\.uiInteractiveElements/);
  assert.doesNotMatch(source, /Regenerate R0 matrix/);
});
