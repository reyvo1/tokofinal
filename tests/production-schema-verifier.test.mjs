import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const pkg = JSON.parse(fs.readFileSync('package.json','utf8'));
const verifier = fs.readFileSync('scripts/verify-production-schema.mjs','utf8');
const smoke = fs.readFileSync('scripts/production-smoke.mjs','utf8');
const ready = fs.readFileSync('scripts/verify-production-ready.mjs','utf8');
const attestation = JSON.parse(fs.readFileSync('config/production-deployment-attestation.json.example','utf8'));

test('production schema verifier is explicit, read-only and target locked', () => {
  assert.equal(pkg.scripts['production:schema:verify'], 'node scripts/verify-production-schema.mjs');
  assert.match(verifier, /VERIFY_T360_PRODUCTION_SCHEMA_READ_ONLY/);
  assert.match(verifier, /T360_PRODUCTION_SCHEMA_DATABASE_URL/);
  assert.match(verifier, /T360_PRODUCTION_EXPECTED_DB_HOST/);
  assert.match(verifier, /T360_PRODUCTION_EXPECTED_DB_NAME/);
  assert.match(verifier, /SET TRANSACTION READ ONLY/);
  assert.match(verifier, /businessMutationsPerformed: false/);
  assert.match(verifier, /readOnly: true/);
  assert.match(verifier, /Production promotion belum PASS/);
  assert.match(verifier, /Production backup belum PASS/);
});

test('production schema verifier compares Prisma contract, enums and critical indexes', () => {
  assert.match(verifier, /Prisma\.dmmf/);
  assert.match(verifier, /buildExpectedSchemaContract/);
  assert.match(verifier, /compareSchemaContract/);
  assert.match(verifier, /information_schema\.tables/);
  assert.match(verifier, /information_schema\.columns/);
  assert.match(verifier, /pg_enum/);
  assert.match(verifier, /pg_indexes/);
  assert.match(verifier, /production-schema-latest\.json/);
});

test('production smoke refuses to run before matching schema evidence', () => {
  assert.match(smoke, /production-schema-latest\.json/);
  assert.match(smoke, /Production schema verification belum PASS\/read-only/);
  assert.match(smoke, /Production schema verification berasal dari database berbeda/);
  assert.match(smoke, /PRODUCTION_SCHEMA_PREREQUISITE/);
});

test('final production-ready gate requires matching ordered schema evidence and review', () => {
  assert.match(ready, /PRODUCTION_SCHEMA_CONTRACT/);
  assert.match(ready, /Production schema verification harus dilakukan setelah pre-deploy backup diverifikasi/);
  assert.match(ready, /Production schema verification harus selesai sebelum production smoke/);
  assert.match(ready, /schemaContractReviewed/);
  assert.equal(attestation.checks.schemaContractReviewed, 'PASS');
});
