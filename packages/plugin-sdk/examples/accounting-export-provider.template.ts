export interface AccountingExportPayload {
  companyId: string;
  branchId?: string;
  journalEntryId: string;
  accountingEventId: string;
  sourceType: string;
  sourceId: string;
}
export interface AccountingExportProvider {
  code: string;
  validateConfiguration(config: Record<string, unknown>): Promise<void>;
  exportJournal(payload: AccountingExportPayload): Promise<{ externalId: string; status: 'ACCEPTED'|'REJECTED'; raw?: unknown }>;
  reverseJournal?(externalId: string, reason: string): Promise<void>;
}
