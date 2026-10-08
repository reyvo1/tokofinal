# ERD Domain Map

```text
Company ─ Branch ─ Warehouse ─ Inventory ─ InventoryMovement
                                  ├─ StockTransfer / Item
                                  ├─ StockOpname / Item
                                  ├─ InventoryBatch
                                  └─ InventorySerial

Supplier ─ PurchaseOrder ─ PurchaseOrderItem
                 └─ GoodsReceipt ─ GoodsReceiptItem
                 └─ PurchaseReturn / Item

Customer ─ Sale / Order ─ Items ─ Payment
             ├─ SaleReturn / Item
             ├─ Shipment
             └─ LoyaltyAccount ─ LoyaltyTransaction

Branch ─ Account ─ JournalLine ─ JournalEntry
       ├─ FiscalPeriod
       ├─ BankStatement / Line
       └─ BankReconciliation

Platform
├─ FeatureFlag / SystemSetting / ModuleDefinition
├─ UiSchemaDefinition / CustomFieldDefinition / CustomFieldValue
├─ BusinessRule / ApprovalPolicy / ApprovalRequest / ApprovalDecision
├─ IntegrationConnection / ExternalMapping / ApiKey
├─ EventOutbox / WebhookEndpoint / WebhookDelivery
├─ Device / OfflineTransaction
└─ ForecastRun / ReorderSuggestion
```

Lihat `apps/api/prisma/schema.prisma` sebagai sumber kebenaran model.

## Large-scale reporting and lifecycle

```text
Sale / Order / JournalLine / InventoryMovement
                 │
                 ├── incremental worker ── DailySalesSummary
                 │                       ├─ DailyFinanceSummary
                 │                       └─ DailyInventorySummary
                 │
                 ├── ReportJob ── streamed export/output storage
                 │
                 ├── IdempotencyReceipt ── duplicate mutation protection
                 │
                 └── DataRetentionPolicy ── DataArchiveRun
```

Summary tables are derived and rebuildable. Source transactions and ledger remain the authoritative record.

## Enterprise domains added in 0.5.0

- Accounting: AccountingEvent → AccountingEventLine; AccountingPostingRule → AccountingPosting → JournalEntry; TaxCode → TaxTransaction/TaxDocument.
- General finance: OperationalFinanceTransaction → AccountingEvent.
- Asset: AssetCategory → Asset → AssetTransaction/AssetAssignment/MaintenanceWorkOrder/AssetDepreciationLine.
- Fleet: Asset ↔ Vehicle → DeliveryTrip → DeliveryStop/DeliveryManifestItem; Vehicle → FuelTransaction/VehicleMeterReading.
- Control: InspectionTemplate → InspectionTemplateItem; OperationalInspection → InspectionResultItem/InspectionEvidence; GatePass; OperationalConfirmation; OperationPolicy.
- Automation: BusinessRule/EventOutbox → AutomationJob.
