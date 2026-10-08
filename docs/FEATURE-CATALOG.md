> **Status authority (P0):** maturity labels in this catalog describe source/foundation shape only. Product-completeness status is authoritative only in `config/product-completeness.json`. A feature is not complete merely because it is listed here.

# Feature Catalog

| Key | Default | Maturity | Purpose |
|---|---:|---|---|
| multi_branch | on | implemented | Banyak cabang |
| multi_warehouse | on | implemented | Banyak gudang |
| stock_transfer | on | implemented | Transfer gudang |
| stock_opname | on | implemented | Stock count dan adjustment |
| batch_expiry | on | foundation | Batch dan FEFO |
| serial_number | on | foundation | Pelacakan unit unik |
| sales_return | on | implemented-core-workflow | POS request → inspection → refund/restock/accounting/loyalty correction |
| purchase_return | on | foundation | Retur supplier |
| loyalty | on | foundation | Poin dan tier |
| approval_workflow | on | foundation | Approval configurable |
| bank_reconciliation | on | foundation | Rekonsiliasi bank |
| forecasting | on | baseline | Moving average |
| reorder_suggestions | on | baseline | Saran pembelian |
| third_party_api | on | plugin-sdk | Integrasi eksternal |
| payment_gateway | off | adapter-ready | Payment provider |
| marketplace | off | adapter-ready | Marketplace sync |
| shipping | off | adapter-ready | Ekspedisi |
| whatsapp | off | adapter-ready | WhatsApp notification |
| customer_app | off | API-ready | Mobile customer app |
| pos_offline | on | implemented-safe-replay | Offline POS tunai dengan cache terverifikasi, antrean lokal, replay idempoten, dan conflict handling |
| accounting_full | off | foundation | Full accounting closing/reporting |
| business_intelligence | off | data-ready | BI/warehouse |
| scale_integration | off | adapter-ready | Timbangan/perangkat |
| hris | on | foundation | Data karyawan dan organisasi |
| attendance | on | implemented-foundation | Event, record, shift, policy |
| attendance_geofence | on | implemented-foundation | GPS dan radius cabang |
| attendance_photo | off | object-storage-required | Selfie/liveness evidence |
| biometric_attendance | off | adapter-ready | Fingerprint/face device bridge |
| payroll | on | implemented-foundation | Payroll run, result, slip, journal |
| payroll_tax | on | versioned-rule-engine | Pajak dan jaminan sosial configurable |
| employee_portal | on | implemented-foundation | Self-service attendance/payslip |
| telegram_payslip | off | adapter-ready | Secure payslip notification |
| whatsapp_payslip | off | adapter-ready | Secure payslip notification |
| manufacturing | on | implemented-runtime-pending | Versioned BOM, production order, inventory movement dan WIP accounting |
| digital_services_ppob | off | adapter-ready | PPOB provider-neutral dengan Digiflazz worker adapter |
| product_bulk_tooling | on | implemented-runtime-pending | HET, dry-run CSV import/export dan Code128 label printing |
| setup_readiness | on | implemented-runtime-pending | Checklist kesiapan bisnis tanpa deployment mutation dari browser |
| rawbt_printing | on | implemented-runtime-pending | Transport tambahan RawBT Android untuk ESC/POS 58mm |
| staff_memo | on | implemented-runtime-pending | Memo pribadi database-backed untuk seluruh role staf pada Admin, POS, dan Employee Portal |
| dynamic_product_uom | on | implemented-runtime-pending | Base unit dari master UNIT aktif + kemasan ProductUnit dinamis tanpa fallback PCS runtime |
| retail_transaction_completion | on | implemented-runtime-pending | Dynamic tender/payment authority, exact split tender, customer on-account AR, tender-safe refund and accounting |

## Enterprise operations

| Feature key | Modul | Default | Catatan |
|---|---|---:|---|
| `accounting_full` | Accounting event dan posting rule | aktif | Seluruh domain menggunakan engine yang sama |
| `system_tax` | Pajak lintas transaksi | aktif | Tarif resmi tetap harus dikonfigurasi |
| `fixed_assets` | Aset bergerak/tidak bergerak | aktif | Depresiasi dan maintenance foundation |
| `fleet_delivery` | Armada pengiriman | aktif | Trip, manifest, loading, fuel, POD |
| `quality_inspection` | Pemeriksaan inbound/outbound | aktif | Checklist/evidence/policy |
| `gate_pass` | Gate control | aktif | Barang dan kendaraan masuk/keluar |
| `operations_automation` | Automation jobs | aktif | Worker, retry, idempotency |
| `fleet_gps` | GPS/telematics adapter | nonaktif | Membutuhkan provider |

## P3 runtime maturity presentation

P3 keeps the original `Maturity` column above as source vocabulary, but runtime presentation normalizes it so an enabled flag cannot masquerade as product completion. Seeded feature metadata now includes `maturityClass`, `operatorVisibility`, `ownership`, and `helpText`; scoped feature overrides preserve those fields.

Runtime classes are `OPERATIONAL`, `LIMITED`, `FOUNDATION`, and `ADAPTER_REQUIRED`. `FOUNDATION` and `ADAPTER_REQUIRED` are explicitly non-complete product states even when a feature flag is enabled. Canonical product-completeness status remains `config/product-completeness.json`.
