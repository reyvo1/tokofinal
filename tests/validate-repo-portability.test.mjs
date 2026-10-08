import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const rootPackage = JSON.parse(
  readFileSync(new URL('../package.json', import.meta.url), 'utf8'),
);

const rootLock = JSON.parse(
  readFileSync(new URL('../package-lock.json', import.meta.url), 'utf8'),
);

const validator = readFileSync(
  new URL('../scripts/validate-repo.mjs', import.meta.url),
  'utf8',
);

test('repository validator owns its TypeScript dependency at the workspace root', () => {
  assert.match(
    rootPackage.devDependencies?.typescript ?? '',
    /^\^5\.9\.0$/,
  );

  assert.equal(
    rootLock.packages?.['']?.devDependencies?.typescript,
    rootPackage.devDependencies.typescript,
  );
});

test('repository validator resolves TypeScript from project dependencies only', () => {
  assert.match(
    validator,
    /await import\('typescript'\)/,
  );

  assert.doesNotMatch(
    validator,
    /\/opt\/nvm|npm root -g|node_modules\/typescript\/lib\/typescript\.js/,
  );

  assert.match(
    validator,
    /Run `npm ci` from the repository root/,
  );
});
