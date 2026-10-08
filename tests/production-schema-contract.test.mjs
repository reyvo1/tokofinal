import test from 'node:test';
import assert from 'node:assert/strict';
import { buildExpectedSchemaContract, compareSchemaContract, indexCovers } from '../scripts/lib/postgres-schema-contract.mjs';

test('schema contract converts Prisma DMMF model and enum names to physical contract', () => {
  const contract = buildExpectedSchemaContract({ datamodel: {
    models: [{ name: 'Thing', dbName: 'things', fields: [
      { name: 'id', kind: 'scalar' },
      { name: 'state', dbName: 'state_code', kind: 'enum' },
      { name: 'owner', kind: 'object' },
    ] }],
    enums: [{ name: 'State', dbName: 'thing_state', values: [{ name: 'OPEN' }, { name: 'CLOSED', dbName: 'closed' }] }],
  } });
  assert.deepEqual(contract.models, [{ model: 'Thing', table: 'things', columns: ['id', 'state_code'] }]);
  assert.deepEqual(contract.enums, [{ enum: 'thing_state', values: ['OPEN', 'closed'] }]);
});

test('schema contract passes compatible expand-only database and critical indexes', () => {
  const expected = { models: [{ table: 'Thing', columns: ['id','companyId'] }], enums: [{ enum: 'Status', values: ['OPEN','CLOSED'] }] };
  const actual = {
    tables: [{ table_name: 'Thing' }, { table_name: 'Extra' }],
    columns: [{ table_name: 'Thing', column_name: 'id' }, { table_name: 'Thing', column_name: 'companyId' }, { table_name: 'Thing', column_name: 'futureColumn' }],
    enums: [{ enum_name: 'Status', enum_value: 'OPEN' }, { enum_name: 'Status', enum_value: 'CLOSED' }, { enum_name: 'Status', enum_value: 'FUTURE' }],
    indexes: [{ tablename: 'Thing', indexdef: 'CREATE INDEX x ON public."Thing" USING btree ("companyId", "id")' }],
  };
  const result = compareSchemaContract(expected, actual, [{ key: 'thing_company', table: 'Thing', columns: ['companyId','id'] }]);
  assert.equal(result.passed, true);
  assert.deepEqual(result.missingColumns, []);
});

test('schema contract fails on missing column, enum value, or required unique index', () => {
  const expected = { models: [{ table: 'PayrollRun', columns: ['id','adjustmentSequence'] }], enums: [{ enum: 'RunStatus', values: ['POSTED','PAID'] }] };
  const actual = {
    tables: [{ table_name: 'PayrollRun' }],
    columns: [{ table_name: 'PayrollRun', column_name: 'id' }],
    enums: [{ enum_name: 'RunStatus', enum_value: 'POSTED' }],
    indexes: [{ tablename: 'PayrollRun', indexdef: 'CREATE INDEX x ON public."PayrollRun" USING btree ("companyId")' }],
  };
  const result = compareSchemaContract(expected, actual, [{ key: 'adjustment_unique', table: 'PayrollRun', columns: ['companyId'], unique: true }]);
  assert.equal(result.passed, false);
  assert.deepEqual(result.missingColumns, ['PayrollRun.adjustmentSequence']);
  assert.deepEqual(result.enumMismatches[0].missingValues, ['PAID']);
  assert.deepEqual(result.missingCriticalIndexes, ['adjustment_unique']);
});

test('index coverage preserves leading-column order and unique requirement', () => {
  assert.equal(indexCovers('CREATE INDEX x ON public."A" USING btree ("companyId", "createdAt")', ['companyId','createdAt']), true);
  assert.equal(indexCovers('CREATE INDEX x ON public."A" USING btree ("createdAt", "companyId")', ['companyId','createdAt']), false);
});
