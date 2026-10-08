# Arsitektur Toko360 0.3

## Bentuk Sistem

Toko360 memakai **modular monolith** untuk memudahkan pengembangan awal, tetapi setiap domain memiliki batas jelas sehingga dapat dipisahkan menjadi service saat beban dan tim meningkat.

```text
Clients
├── Storefront Next.js
├── Admin Next.js
├── POS Next.js/PWA
├── Mobile/Flutter (future)
└── External channels
       │
       ▼
NestJS API
├── Identity & Access
├── Platform Runtime
├── Catalog
├── Procurement
├── Inventory
├── Commerce
├── Payment
├── Finance
├── Fulfillment
├── CRM/Loyalty
├── Analytics
└── Integration Hub
       │
       ├── SQLite file (local no-Docker) / PostgreSQL (staging-production)
       ├── Database polling worker lokal / Redis queue adapter produksi
       ├── Object storage
       └── Provider adapters
```

## Extension Layers

1. **FeatureFlag**: on/off dan konfigurasi fitur.
2. **SystemSetting**: konfigurasi global/company/branch/user.
3. **CustomField**: atribut baru tanpa migration.
4. **UiSchemaDefinition**: form, table, dashboard, navigation dinamis.
5. **BusinessRule**: conditions/actions JSON.
6. **ApprovalPolicy**: persetujuan bertingkat.
7. **EventOutbox/Webhook**: integrasi andal.
8. **Plugin SDK**: payment, shipping, marketplace, notification, custom.
9. **ExternalMapping**: pemetaan ID internal-eksternal.

## Invariant Transaksi

- Goods receipt, sale, stock transfer, stock opname, dan return memakai database transaction.
- Inventory berubah hanya bersama InventoryMovement.
- Finance menggunakan journal entries/lines dan harus seimbang.
- Event eksternal ditulis ke outbox dalam transaksi domain yang sama.
- Offline transaction dan webhook harus idempoten.

## Scaling Path

1. Pertahankan SQLite untuk development; gunakan PostgreSQL dan tambahkan Redis workers/read replicas ketika kebutuhan production meningkat.
2. Pisahkan reporting/analytics read model.
3. Pisahkan integration workers.
4. Pisahkan inventory/payment service bila concurrency tinggi.
5. Tambah tenant isolation/RLS jika platform SaaS.

## Local and Production Profiles

```text
Developer PC
├── Node.js processes
├── SQLite file database
└── no Docker / no VM

GitHub CI
├── SQLite integration job
└── PostgreSQL service container integration job

Production
├── Node.js application instances
├── managed/self-hosted PostgreSQL
├── optional Redis/message broker
└── provider adapters
```

Domain service dan repository tidak bergantung pada cara database dijalankan. Pergantian profil dilakukan pada Prisma schema dan environment, sedangkan API contract tetap sama.

## Large-scale data layer

Untuk jutaan data, arsitektur menambahkan lapisan berikut tanpa mengubah domain utama:

```text
API instances
  ├── transactional write path → PostgreSQL primary
  ├── read/report path          → read replica/summary tables
  └── async commands            → outbox/worker

Worker
  ├── daily aggregates
  ├── report exports
  ├── import chunks
  ├── sync central-edge
  ├── retention/archive
  └── reconciliation
```

Semua list API memakai cursor pagination. Tabel ledger/event disiapkan untuk partisi waktu. Dashboard membaca summary; transaksi kasir tetap membaca/menulis primary. Detail terdapat di `LARGE-SCALE-DATA.md`.

## HRIS dan perangkat absensi

HRIS menggunakan domain terpisah tetapi berbagi identity, company/branch scope, approval, accounting, notification, audit, outbox, worker, dan plugin registry. Mesin fingerprint/face tidak mengakses database langsung. Device bridge di server toko menarik event vendor dan mengirim kontrak standar ke Attendance API dengan idempotency key.

Foto absensi dikirim langsung ke private object storage melalui signed upload; API hanya menyimpan object key dan metadata validasi. Payroll berjalan sebagai pipeline: attendance cutoff → component calculation → tax/social rule engine → review/approval → accounting posting → payment → payslip → notification queue.

## Enterprise operational posting flow

```text
Commerce / Procurement / Inventory / HR / Asset / Fleet
                    ↓ domain fact
             AccountingEvent
                    ↓ versioned rule
              JournalEntry
                    ↓
       TaxTransaction / TaxDocument
                    ↓
          AuditLog + EventOutbox
                    ↓
 AutomationJob / Webhook / Notification / External adapter
```

Inbound/outbound operations use `OperationPolicy`, `InspectionTemplate`, `OperationalInspection`, `OperationalConfirmation`, and `GatePass` before inventory/accounting posting. Vendor-specific payment, tax, accounting export, GPS, fingerprint, messaging, and shipping implementations live behind plugin adapters.
