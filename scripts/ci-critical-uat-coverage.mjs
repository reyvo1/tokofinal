#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import { sourceFingerprint } from './lib/source-fingerprint.mjs';

export const scenarioCoverage = {
  'UAT-01-AUTH-ACCESS': ['functional-w0-auth-password-reset-2fa.test.mjs','functional-w0-auth-refresh-rotation.test.mjs','tenant-scope-users-access.test.mjs'],
  'UAT-02-PUBLIC-CATALOG': ['commerce-fulfillment-integrity.test.mjs','functional-w2-storefront-customer-account.test.mjs','functional-w2-storefront-fulfillment-address.test.mjs'],
  'UAT-03-SALES-ORDER-PAYMENT': ['core-pos-transaction-integrity.test.mjs','functional-w2-payment-provider.test.mjs','tenant-scope-orders.test.mjs','tenant-scope-sales-purchase.test.mjs'],
  'UAT-04-PURCHASE-RECEIPT': ['procurement-integrity.test.mjs','functional-w1-purchase-request.test.mjs','functional-w2-purchase-return-admin.test.mjs','tenant-scope-goods-receipts.test.mjs'],
  'UAT-05-INVENTORY-OPERATIONS': ['functional-w1-inventory-admin-workflow.test.mjs','functional-w1-location-level-inventory.test.mjs','functional-w1-batch-serial-safety.test.mjs','tenant-scope-operations-inventory.test.mjs'],
  'UAT-06-ACCOUNTING-FINANCE-REPORTS': ['finance-accounting-reporting-integrity.test.mjs','functional-w3-finance-reconciliation.test.mjs','functional-w7-reporting-data-completeness.test.mjs','tenant-scope-reports.test.mjs'],
  'UAT-07-HR-ATTENDANCE-PAYROLL': ['hr-payroll-accounting-integrity.test.mjs','hr-payroll-kit.test.mjs','functional-w4-hr-leave-overtime.test.mjs','tenant-scope-hr-payroll.test.mjs'],
  'UAT-08-OFFLINE-SYNC': ['offline-pos-replay.test.mjs','functional-w6-edge-sync-protocol.test.mjs','tenant-scope-extensions-sync.test.mjs'],
  'UAT-09-AUDIT-DENIAL': ['tenant-http-db-integration.test.mjs','tenant-scope-platform.test.mjs','tenant-scope-users-access.test.mjs'],
  'UAT-10-RESTORE-ROLLBACK': ['backup-dr-readiness.test.mjs','product-supplier-ownership-postgres-stage.test.mjs','ops-production-readiness.test.mjs'],
  'UAT-11-DELIVERY-LIFECYCLE': ['functional-w5-admin-delivery-lifecycle.test.mjs','functional-w5-admin-asset-fleet-workflow.test.mjs','asset-fleet-accounting-integrity.test.mjs'],
  'UAT-12-PAYROLL-ADJUSTMENT-RECOVERY': ['payroll-adjustment-integrity.test.mjs','payroll-adjustment-postgres-stage.test.mjs','hr-payroll-accounting-integrity.test.mjs'],
};

const OUTPUT = path.join('handoff', 'quality', 'github-critical-uat-coverage-latest.json');

function writeEvidence(root, evidence) {
  const output = path.join(root, OUTPUT);
  fs.mkdirSync(path.dirname(output), { recursive: true });
  fs.writeFileSync(output, JSON.stringify(evidence, null, 2) + '\n');
  return output;
}

export function validateScenarioCoverage(root = process.cwd()) {
  const testsRoot = path.join(root, 'tests');
  const missing = [];
  for (const [scenario, files] of Object.entries(scenarioCoverage)) {
    if (!Array.isArray(files) || files.length < 2) missing.push(`${scenario}:coverage-too-thin`);
    for (const file of files) if (!fs.existsSync(path.join(testsRoot, file))) missing.push(`${scenario}:${file}`);
  }
  if (Object.keys(scenarioCoverage).length !== 12) missing.push(`scenario-count:${Object.keys(scenarioCoverage).length}`);
  if (missing.length) throw new Error(`Critical UAT coverage mapping invalid: ${missing.join(', ')}`);
  return true;
}

export function writeScenarioCoverageEvidence(root = process.cwd()) {
  const sourceIdentity = sourceFingerprint(root);
  writeEvidence(root, {
    generatedAt: new Date().toISOString(),
    status: 'FAIL',
    sourceIdentity,
    scenarioCount: 0,
    error: 'Critical UAT coverage evidence invalidated at attempt start; a fresh PASS must replace it.',
  });
  try {
    validateScenarioCoverage(root);
    const evidence = {
      generatedAt: new Date().toISOString(),
      status: 'PASS',
      sourceIdentity,
      scenarioCount: 12,
      evidenceClass: 'SOURCE_CONTRACT',
      runtimeClosure: false,
      note: 'Source-contract inventory only: maps the 12 critical UAT scenarios to regression files. R8 exact runtime closure is emitted separately by ci:r8:probe and Human Stage-20 remains separate.',
      scenarios: Object.entries(scenarioCoverage).map(([id, files]) => ({ id, automatedRegressionFiles: files })),
    };
    writeEvidence(root, evidence);
    return evidence;
  } catch (error) {
    writeEvidence(root, {
      generatedAt: new Date().toISOString(),
      status: 'FAIL',
      sourceIdentity,
      scenarioCount: 0,
      error: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  try {
    const evidence = writeScenarioCoverageEvidence();
    console.log(`Critical UAT source-contract coverage PASS: ${evidence.scenarioCount}/12 scenarios mapped. Runtime closure belongs to ci:r8:probe; Human Stage-20 remains separate.`);
  } catch (error) {
    console.error(`CRITICAL_UAT_COVERAGE_ERROR: ${error instanceof Error ? error.message : error}`);
    process.exitCode = 1;
  }
}
