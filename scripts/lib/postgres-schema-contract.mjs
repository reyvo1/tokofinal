export const CRITICAL_INDEX_REQUIREMENTS = [
  { key: 'product_list', table: 'Product', columns: ['companyId', 'isActive', 'name', 'id'] },
  { key: 'warehouse_branch_lookup', table: 'Warehouse', columns: ['branchId'] },
  { key: 'inventory_list', table: 'Inventory', columns: ['warehouseId', 'updatedAt', 'id'] },
  { key: 'accounting_event_list', table: 'AccountingEvent', columns: ['companyId', 'branchId', 'createdAt', 'id'] },
  { key: 'payroll_run_list', table: 'PayrollRun', columns: ['companyId', 'branchId', 'createdAt'] },
  { key: 'payroll_adjustment_sequence', table: 'PayrollRun', columns: ['companyId', 'branchId', 'adjustmentOfRunId', 'adjustmentSequence'], unique: true },
];

function physicalName(item) {
  return item?.dbName || item?.name;
}

export function buildExpectedSchemaContract(dmmf) {
  const models = (dmmf?.datamodel?.models || []).map((model) => ({
    model: model.name,
    table: physicalName(model),
    columns: (model.fields || [])
      .filter((field) => field.kind === 'scalar' || field.kind === 'enum')
      .map((field) => physicalName(field))
      .filter(Boolean)
      .sort(),
  })).sort((a, b) => a.table.localeCompare(b.table));

  const enums = (dmmf?.datamodel?.enums || []).map((entry) => ({
    enum: physicalName(entry),
    values: (entry.values || []).map((value) => physicalName(value)).filter(Boolean).sort(),
  })).sort((a, b) => a.enum.localeCompare(b.enum));

  return { models, enums };
}

export function indexCovers(indexDef, columns) {
  const text = String(indexDef || '');
  const match = text.match(/\bUSING\s+[A-Za-z0-9_]+\s*\(([^)]*)\)/i);
  if (!match) return false;
  const actualColumns = match[1].split(',').map((entry) => {
    const value = entry.trim();
    const quoted = value.match(/^"((?:[^"]|"")+)"/);
    if (quoted) return quoted[1].replaceAll('""', '"');
    const unquoted = value.match(/^([A-Za-z_][A-Za-z0-9_$]*)/);
    return unquoted?.[1] || '';
  });
  return columns.every((column, index) => actualColumns[index] === column);
}

export function compareSchemaContract(expected, actual, indexRequirements = CRITICAL_INDEX_REQUIREMENTS) {
  const tables = new Set((actual?.tables || []).map((row) => String(row.table_name || row.table || '')));
  const columns = new Set((actual?.columns || []).map((row) => `${row.table_name || row.table}.${row.column_name || row.column}`));
  const enumMap = new Map();
  for (const row of actual?.enums || []) {
    const name = String(row.enum_name || row.enum || '');
    if (!enumMap.has(name)) enumMap.set(name, new Set());
    enumMap.get(name).add(String(row.enum_value || row.value || ''));
  }

  const missingTables = [];
  const missingColumns = [];
  for (const model of expected.models || []) {
    if (!tables.has(model.table)) missingTables.push(model.table);
    for (const column of model.columns || []) {
      if (!columns.has(`${model.table}.${column}`)) missingColumns.push(`${model.table}.${column}`);
    }
  }

  const enumMismatches = [];
  for (const entry of expected.enums || []) {
    const actualValues = enumMap.get(entry.enum);
    if (!actualValues) {
      enumMismatches.push({ enum: entry.enum, missingValues: [...entry.values], missingType: true });
      continue;
    }
    const missingValues = entry.values.filter((value) => !actualValues.has(value));
    if (missingValues.length) enumMismatches.push({ enum: entry.enum, missingValues, missingType: false });
  }

  const indexRows = actual?.indexes || [];
  const missingCriticalIndexes = indexRequirements.filter((requirement) => !indexRows.some((row) => {
    const table = String(row.tablename || row.table_name || row.table || '');
    if (table !== requirement.table) return false;
    if (requirement.unique && !/\bCREATE\s+UNIQUE\s+INDEX\b/i.test(String(row.indexdef || ''))) return false;
    return indexCovers(row.indexdef, requirement.columns);
  })).map((requirement) => requirement.key);

  return {
    passed: missingTables.length === 0 && missingColumns.length === 0 && enumMismatches.length === 0 && missingCriticalIndexes.length === 0,
    missingTables,
    missingColumns,
    enumMismatches,
    missingCriticalIndexes,
  };
}
