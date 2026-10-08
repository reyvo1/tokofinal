import { IsIn, IsObject, IsOptional, IsString } from 'class-validator';

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

export class CreateReportJobDto {
  /** Kompatibilitas lama; company tetap berasal dari token. */
  @IsOptional()
  @IsString()
  companyId?: string;

  /** Kompatibilitas lama; branch tetap berasal dari token. */
  @IsOptional()
  @IsString()
  branchId?: string;

  @IsString()
  @IsIn(REPORT_TYPES)
  reportType!: string;

  /** Export dijalankan worker; CSV untuk data mentah, XLSX untuk spreadsheet, PDF untuk review/cetak. */
  @IsOptional()
  @IsIn(['CSV','XLSX','PDF'])
  format?: string;

  @IsOptional()
  @IsObject()
  filters?: Record<string, unknown>;
}
