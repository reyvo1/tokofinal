// Single canonical operator-selectable report catalogue.
// Machine-readable source of truth: config/report-type-catalog.json
// Backend allow-list: apps/api/src/reports/dto/create-report-job.dto.ts (REPORT_TYPES)
// tests/t360-full-ui-audit-remediation.test.mjs asserts this file matches both.
//
// Previously each surface (ReportingWorkspace, AutomationWorkspace, Accounting)
// hardcoded its own subset, so the exportable/schedulable report list depended on
// which workspace the operator happened to be standing in.
export const REPORT_TYPES = [
  'SALES',
  'PRODUCTS',
  'PROFIT_LOSS',
  'TRIAL_BALANCE',
  'BALANCE_SHEET',
  'GENERAL_LEDGER',
  'TAX_SUMMARY',
  'CASHIER',
  'CHANNELS',
  'CUSTOMERS',
  'DISCOUNTS',
  'RETURNS',
  'INVENTORY',
  'INVENTORY_MOVEMENTS',
  'BATCH_EXPIRY',
  'STOCK_OPNAME',
  'PURCHASES',
  'SUPPLIERS',
  'CASH_FLOW',
  'MARGIN',
  'AUDIT_LOG',
  'RECEIVABLES',
  'PAYABLES',
  'DELIVERY_COD',
  'PAYROLL',
  'INVENTORY_VALUATION',
  'BRANCH_COMPARISON',
  'COST_CENTER',
  'PERIOD_COMPARISON',
] as const;

export const REPORT_TYPE_LABELS: Record<string, string> = {
  SALES: 'Penjualan',
  PRODUCTS: 'Produk',
  PROFIT_LOSS: 'Laba Rugi',
  TRIAL_BALANCE: 'Neraca Saldo',
  BALANCE_SHEET: 'Posisi Keuangan',
  GENERAL_LEDGER: 'Buku Besar',
  TAX_SUMMARY: 'Ringkasan Pajak',
  CASHIER: 'Kasir',
  CHANNELS: 'Kanal',
  CUSTOMERS: 'Pelanggan',
  DISCOUNTS: 'Diskon',
  RETURNS: 'Retur',
  INVENTORY: 'Persediaan',
  INVENTORY_MOVEMENTS: 'Pergerakan Stok',
  BATCH_EXPIRY: 'Batch & Kedaluwarsa',
  STOCK_OPNAME: 'Stock Opname',
  PURCHASES: 'Pembelian',
  SUPPLIERS: 'Pemasok',
  CASH_FLOW: 'Arus Kas',
  MARGIN: 'Margin',
  AUDIT_LOG: 'Log Audit',
  RECEIVABLES: 'Piutang',
  PAYABLES: 'Hutang',
  DELIVERY_COD: 'Delivery COD',
  PAYROLL: 'Payroll',
  INVENTORY_VALUATION: 'Valuasi Persediaan',
  BRANCH_COMPARISON: 'Perbandingan Cabang',
  COST_CENTER: 'Cost Center',
  PERIOD_COMPARISON: 'Perbandingan Periode',
};

export function reportTypeLabel(type: string): string {
  return REPORT_TYPE_LABELS[type] ?? type;
}
