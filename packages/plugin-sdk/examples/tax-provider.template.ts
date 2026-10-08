export interface TaxDocumentPayload {
  documentId: string;
  companyId: string;
  branchId?: string;
  documentType: string;
  taxPeriod?: string;
  netAmount: string;
  taxAmount: string;
  grossAmount: string;
  counterparty?: Record<string, unknown>;
}
export interface TaxProvider {
  code: string;
  validateConfiguration(config: Record<string, unknown>): Promise<void>;
  issueDocument(payload: TaxDocumentPayload): Promise<{ externalReference: string; fileReference?: string; raw?: unknown }>;
  cancelDocument(externalReference: string, reason: string): Promise<void>;
}
