import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const read = (path) => fs.readFileSync(path, 'utf8');
const schemas = ['apps/api/prisma/schema.prisma','apps/api/prisma/schema.sqlite.prisma','apps/api/prisma/schema.postgresql.prisma'].map(read);

test('video parity migration is registered and additive for both database profiles', () => {
  const order = JSON.parse(read('config/expand-migration-order.json'));
  assert.ok(order.migrations.includes('T360-20261004-video-parity-expansion'));
  for (const sql of [read('database/migrations/T360-20261004-video-parity-expansion/sqlite-expand.sql'), read('database/migrations/T360-20261004-video-parity-expansion/postgresql-expand.sql')]) {
    assert.match(sql, /ProductionRecipe/);
    assert.match(sql, /ProductionOrder/);
    assert.match(sql, /DigitalServiceProduct/);
    assert.match(sql, /DigitalServiceTransaction/);
    assert.match(sql, /retailCeilingPrice/);
    assert.doesNotMatch(sql, /DROP\s+(TABLE|COLUMN)/i);
  }
});

test('schema parity exposes manufacturing, PPOB and HET on the correct models in all Prisma authorities', () => {
  const modelBody = (schema, name) => {
    const match = schema.match(new RegExp(`^model\\s+${name}\\s*\\{([\\s\\S]*?)^\\}`, 'm'));
    assert.ok(match, `model ${name} harus ada`);
    return match[1];
  };

  for (const schema of schemas) {
    const product = modelBody(schema, 'Product');
    const digitalServiceProduct = modelBody(schema, 'DigitalServiceProduct');
    assert.match(product, /retailCeilingPrice\s+Decimal\?/);
    assert.doesNotMatch(digitalServiceProduct, /retailCeilingPrice/);
    assert.match(schema, /model ProductionRecipe \{/);
    assert.match(schema, /model ProductionOrder \{/);
    assert.match(schema, /model DigitalServiceProduct \{/);
    assert.match(schema, /model DigitalServiceTransaction \{/);
    assert.match(schema, /PRODUCTION_CONSUME/);
    assert.match(schema, /PRODUCTION_OUTPUT/);
    assert.match(schema, /PPOB/);
  }
});

test('manufacturing posts inventory and WIP atomically and fails closed for tracked products', () => {
  const source = read('apps/api/src/manufacturing/manufacturing.service.ts');
  assert.match(source, /serializableTx\(this\.prisma/);
  assert.match(source, /consumeAvailableLocationStock/);
  assert.match(source, /depositLocationStock/);
  assert.match(source, /PRODUCTION_CONSUME/);
  assert.match(source, /PRODUCTION_OUTPUT/);
  assert.match(source, /production-consume:\$\{order\.id\}/);
  assert.match(source, /production-complete:\$\{order\.id\}/);
  assert.match(source, /traceability produksi/);
  assert.match(source, /nextMovingAverageCost/);
  assert.doesNotMatch(source, /inventoryCostLayer|FIFO/i);
});

test('manufacturing and digital services are registered, permission-gated and seeded', () => {
  const app = read('apps/api/src/app.module.ts');
  const seed = read('apps/api/prisma/seed.ts');
  const manufacturingController = read('apps/api/src/manufacturing/manufacturing.controller.ts');
  const digitalController = read('apps/api/src/digital-services/digital-services.controller.ts');
  assert.match(app, /ManufacturingModule/);
  assert.match(app, /DigitalServicesModule/);
  for (const permission of ['manufacturing.view','manufacturing.manage','digital_service.view','digital_service.manage']) assert.ok(seed.includes(`'${permission}'`));
  assert.match(manufacturingController, /@Permissions\('manufacturing\.view'\)/);
  assert.match(manufacturingController, /@Permissions\('manufacturing\.manage'\)/);
  assert.match(digitalController, /@Permissions\('digital_service\.view'\)/);
  assert.match(digitalController, /@Permissions\('digital_service\.manage'\)/);
});

test('PPOB provider calls stay in worker behind encrypted integration and outbox', () => {
  const service = read('apps/api/src/digital-services/digital-services.service.ts');
  const worker = read('apps/worker/src/index.ts');
  const platform = read('apps/api/src/platform/platform.service.ts');
  assert.doesNotMatch(service, /fetch\s*\(/);
  assert.match(service, /eventOutbox/);
  assert.match(service, /companyId_idempotencyKey/);
  assert.match(service, /type: 'PPOB'/);
  assert.match(worker, /DIGIFLAZZ/);
  assert.match(worker, /md5/i);
  assert.match(worker, /digital-service\.catalog\.sync/);
  assert.match(worker, /digital-service\.transaction\.requested/);
  assert.match(worker, /digital-service\.transaction\.recheck/);
  assert.match(platform, /encryptText\(dto\.encryptedSecrets\)/);
  assert.match(platform, /hasSecrets: Boolean\(encryptedSecrets\)/);
});

test('admin PPOB surface can configure encrypted Digiflazz connection without reading secret back', () => {
  const source = read('apps/admin/app/modules/digital-services.tsx');
  assert.match(source, /type:'PPOB'/);
  assert.match(source, /provider:'DIGIFLAZZ'/);
  assert.match(source, /encryptedSecrets/);
  assert.match(source, /integration\.manage/);
  assert.match(source, /digital_service\.manage/);
  assert.match(source, /Sync katalog/);
  assert.doesNotMatch(source, /integration\.encryptedSecrets/);
});

test('bulk products require bounded dry-run and preserve HET validation', () => {
  const controller = read('apps/api/src/products/products.controller.ts');
  const service = read('apps/api/src/products/products.service.ts');
  const dto = read('apps/api/src/products/dto/bulk-products.dto.ts');
  const ui = read('apps/admin/app/modules/product-bulk-labels.tsx');
  assert.match(controller, /bulk-import/);
  assert.match(controller, /export-csv/);
  assert.match(dto, /ArrayMaxSize\(1000\)/);
  assert.match(service, /dryRun/);
  assert.match(service, /retailCeilingPrice/);
  assert.match(service, /Harga jual.*HET|HET.*harga jual/i);
  assert.match(ui, /Dry-run/);
  assert.match(ui, /Code128/);
  assert.match(ui, /A4 label sheet/);
  assert.match(ui, /58 mm thermal/);
});

test('setup readiness UI matches server response and cannot run deployment mutations', () => {
  const controller = read('apps/api/src/platform/platform.controller.ts');
  const service = read('apps/api/src/platform/platform.service.ts');
  const ui = read('apps/admin/app/modules/setup-readiness.tsx');
  assert.match(controller, /setup-readiness/);
  assert.match(controller, /platform\.configure/);
  assert.match(service, /readyForOperations/);
  assert.match(service, /optionalConnectedIntegrations/);
  assert.match(ui, /data\.completed/);
  assert.match(ui, /data\.required/);
  assert.match(ui, /step\.required === false/);
  assert.doesNotMatch(ui, /requiredComplete|requiredTotal|db push|migrate deploy|prisma migrate/);
});

test('RawBT is additive and reuses canonical ESC POS receipt bytes', () => {
  const printing = read('apps/pos/lib/printing.ts');
  const pos = read('apps/pos/app/page.tsx');
  assert.match(printing, /buildRawBtUrl/);
  assert.match(printing, /rawbt:base64,/);
  assert.match(printing, /buildReceipt\(receipt\)/);
  assert.match(printing, /WebUSB \/ Web Bluetooth/);
  assert.match(pos, /openRawBtReceipt/);
  assert.match(pos, /RawBT 58mm/);
});

test('admin navigation exposes manufacturing, PPOB, bulk labels and setup readiness through module permissions', () => {
  const nav = read('apps/admin/app/navigation.ts');
  const domains = read('apps/admin/app/domain-workspaces.ts');
  const page = read('apps/admin/app/page.tsx');
  for (const marker of ['manufacturing','digital-services']) assert.ok(nav.includes(marker));
  for (const marker of ['bulk-labels','ppob','setup']) assert.ok(domains.includes(`key: '${marker}'`));
  assert.ok(domains.includes("workspaceKey: 'manufacturing'"));
  for (const view of ['ProductBulkLabelsView','ManufacturingView','DigitalServicesView','SetupReadinessView']) assert.ok(page.includes(view));
});

test('wave explicitly keeps canonical costing and does not weaken release gates', () => {
  const item = JSON.parse(read('work-items/active/T360-20261004-184500-video-parity-expansion.json'));
  const docs = read('docs/VIDEO-PARITY-ENHANCEMENT-20261004.md');
  assert.equal(item.phase, 'VERIFICATION');
  assert.ok(item.businessRules.some((rule) => rule.includes('FIFO cost-layer valuation is not claimed')));
  assert.match(docs, /MOVING_AVERAGE/);
  assert.match(docs, /No gate is removed or weakened/);
  assert.match(docs, /Full Automated UAT/);
});
