# API Toko360

Base URL: `/api/v1`. Dokumentasi interaktif: `/docs`.

## Core

- Auth: `/auth/login`, `/auth/me`.
- Products: `/products`.
- Suppliers: `/suppliers`.
- Purchase orders: `/purchase-orders`.
- Goods receipts: `/goods-receipts`.
- Inventory: `/inventory`, `/inventory/movements`, `/inventory/warehouses`.
- Sales/POS: `/sales`.
- Online orders: `/orders`.
- Users: `/users`.
- Reports: `/reports/*`.

## Runtime Platform

- `GET /platform/manifest`: features, modules, settings, UI schemas, plugin catalog.
- `/platform/features`, `/platform/settings`.
- `/platform/custom-fields`, `/platform/custom-field-values`.
- `/platform/integrations`, `/platform/webhooks`.
- `/platform/business-rules`.
- `/platform/approval-policies`, `/platform/approval-requests`.
- `/platform/ui-schemas`, `/platform/outbox`.

## Advanced Inventory

- `/stock-transfers`: create, approve, ship, receive.
- `/stock-opnames`: create, count, submit, complete.
- `/inventory-batches`, `/inventory-serials`.

## Returns

- Canonical sale returns: `/returns/sales*`.
- Canonical purchase returns: `/returns/purchases*`.
- Canonical storefront/order returns: `/returns/orders*` and `/storefront/account/returns*`.
- Legacy `/sale-returns*` and `/purchase-returns*` aliases were removed in Product Completion P4 after repository consumer verification.

## Extensions

- `/loyalty/programs`, `/loyalty/transactions`.
- `/finance/fiscal-periods`, `/finance/bank-statements/import`, `/finance/reconciliations`.
- `/devices`, `/devices/:id/offline-transactions`.
- `/forecasts/run`.
- `/shipments`, `/marketplace-orders/import`, `/notifications`.

Gunakan Swagger untuk schema request/response. Untuk production, tambahkan pagination, filtering specification, idempotency headers, API versioning policy, and standardized error envelope.

## Cursor pagination

Endpoint daftar besar menggunakan:

```text
?limit=50&cursor=<opaque-cursor>
```

Response:

```json
{
  "items": [],
  "pageInfo": {
    "limit": 50,
    "nextCursor": null,
    "hasMore": false
  }
}
```

Sudah diterapkan pada produk, supplier, inventory, inventory movement, purchase order, goods receipt, sales, orders, dan inventory valuation. Client tidak boleh menebak isi cursor; kirim kembali nilai `nextCursor` apa adanya.

## Asynchronous report jobs

```http
POST /api/v1/reports/jobs
GET  /api/v1/reports/jobs?companyId=...&limit=50&cursor=...
GET  /api/v1/reports/jobs/{id}/download
```

Ekspor besar harus dibuat sebagai report job dan diproses worker, bukan dihitung di request interaktif.
Tipe laporan yang didukung worker: `SALES`, `PRODUCTS`. Hasil CSV disimpan di `logs/report-exports/`.

## Analitik lanjutan (T360-20260829 value pack 2)

```http
GET /api/v1/reports/peak-hours?days=30
GET /api/v1/reports/dead-stock?days=30&limit=50
GET /api/v1/reports/customer-rfm?days=90&limit=50
GET /api/v1/promotions
GET /api/v1/promotions/preview?subtotal=100000&code=...&memberTier=...
POST /api/v1/promotions
PATCH /api/v1/promotions/{id}
PATCH /api/v1/products/{id}
GET  /api/v1/products/{id}/price-history
GET /api/v1/platform/ops-health
```

Catatan: `promotions/preview` bersifat read-only (fondasi engine promo) dan tidak mengubah
perhitungan penjualan/pajak. Perubahan harga produk otomatis mencatat `ProductPriceHistory`.
Struk digital `GET /receipts/:saleNumber` kini menyertakan tombol bagikan WhatsApp dan CSS cetak.

## HRIS dan Karyawan

```http
GET    /api/v1/hr/employees?companyId=&limit=&cursor=
POST   /api/v1/hr/employees
PATCH  /api/v1/hr/employees/{id}
GET    /api/v1/hr/departments?companyId=
POST   /api/v1/hr/departments
GET    /api/v1/hr/positions?companyId=
POST   /api/v1/hr/positions
```

## Absensi

```http
POST /api/v1/attendance/events
POST /api/v1/attendance/devices
POST /api/v1/attendance/geofences
POST /api/v1/attendance/biometrics/enroll
POST /api/v1/attendance/devices/fingerprint/events
GET  /api/v1/attendance/employee?employeeId=&limit=&cursor=
```

Fingerprint ingest membutuhkan service account/API key dengan scope `attendance.device_ingest`.

## Payroll

```http
POST /api/v1/payroll/periods
GET  /api/v1/payroll/components?limit=&cursor=
POST /api/v1/payroll/components
GET  /api/v1/payroll/employee-components?limit=&cursor=
POST /api/v1/payroll/employee-components
POST /api/v1/payroll/tax-rule-sets
POST /api/v1/payroll/social-security-rule-sets
POST /api/v1/payroll/runs
POST /api/v1/payroll/runs/{id}/calculate
POST /api/v1/payroll/runs/{id}/approve
POST /api/v1/payroll/runs/{id}/post-accounting
POST /api/v1/payroll/runs/{id}/publish-payslips
GET  /api/v1/payroll/runs?companyId=
```

## Employee Self-Service

```http
GET /api/v1/employee/me
GET /api/v1/employee/me/attendance?limit=&cursor=
GET /api/v1/employee/me/payslips?limit=&cursor=
GET /api/v1/employee/me/payslips/{id}
```

### Binding Telegram/WhatsApp karyawan

```http
POST /api/v1/employee/me/channels/request-verification
POST /api/v1/employee/me/channels/verify
POST /api/v1/employee/me/notification-preferences
```

## Enterprise accounting, tax, assets, fleet, inspection, and returns


`POST /api/v1/orders` dan `POST /api/v1/finance-operations` adalah retriable mutation fail-closed: klien wajib mengirim operation key stabil melalui `Idempotency-Key` atau `idempotencyKey`. Body/header bila keduanya ada harus sama; retry payload yang sama wajib memakai key yang sama.

```text
GET/POST /api/v1/accounting-core/tax-codes
GET/POST /api/v1/accounting-core/posting-rules
GET      /api/v1/accounting-core/events
POST     /api/v1/accounting-core/events/manual
GET/POST /api/v1/finance-operations
POST     /api/v1/finance-operations/{id}/approve
POST     /api/v1/finance-operations/{id}/post
GET/POST /api/v1/assets
GET      /api/v1/assets/summary
GET      /api/v1/assets/maintenances
GET/POST /api/v1/assets/categories
POST     /api/v1/assets/{id}/assign
POST     /api/v1/assets/{id}/transfer
POST     /api/v1/assets/{id}/dispose
POST     /api/v1/assets/maintenance
POST     /api/v1/assets/maintenance/{id}/complete
POST     /api/v1/assets/depreciation-runs
GET/POST /api/v1/fleet/vehicles
GET/POST /api/v1/fleet/trips
GET      /api/v1/fleet/summary
GET      /api/v1/fleet/fuel
POST     /api/v1/fleet/trips/{id}/loading
POST     /api/v1/fleet/trips/{id}/dispatch
POST     /api/v1/fleet/stops/{id}/complete
POST     /api/v1/fleet/trips/{id}/close
POST     /api/v1/fleet/fuel
GET      /api/v1/finance-operations/supplier-payables
GET/POST /api/v1/operations-control/policies
POST     /api/v1/operations-control/inspection-templates
POST     /api/v1/operations-control/inspections
POST     /api/v1/operations-control/gate-passes
POST     /api/v1/operations-control/confirmations
GET/POST /api/v1/returns/sales
POST     /api/v1/returns/sales/{id}/confirm
GET/POST /api/v1/returns/purchases
POST     /api/v1/returns/purchases/{id}/confirm
```
