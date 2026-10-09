# TOKO360 — Audit Backend ⇄ Frontend dan Gap Operator (2026-10-09)

**Authority:** `docs/DEVELOPMENT-KIT.md`, `docs/DEVELOPMENT-WORKFLOW.md`, `docs/TOKO360-MASTER-PRODUCT-COMPLETION-WORKFLOW.md`, `config/product-completeness.json`, `config/f1-backend-ui-audit.json`, `config/admin-contextual-workflow-map.json` dan source proyek. Inventaris dokumen `.md` pada `docs/` berisi **93 berkas** pada checkpoint ini. Dokumen diinventarisasi/diekstrak; keputusan perubahan mengacu ke kontrak domain dan source relevan.

> **Jangan menyamakan status `FOUNDATION` dengan kode tidak ada.** Matriks produk menetapkan status *bukti kematangan*, bukan hanya keberadaan endpoint/menu. Status di bawah adalah data resmi yang belum diubah oleh wave ini.

## Pembuktian source sebelum wave

- Audit sistem: 529 API handlers; Admin 70/70 contextual destinations source-mapped, tanpa klaim Human UAT.
- POS: 4 workspace P5 resmi (SALE/SHIFT/RETURNS/SYNC). PPOB belum punya pintu operator kasir; backend digital-services sudah punya catalog, transactions, recheck dan dispatch provider.
- Storefront: 5 customer journey resmi. Fetch produk awal dibatasi 100 item, pencarian berbasis data lokal awal; produk >100 tidak dapat ditemukan tanpa pemanggilan `search` backend. Kegagalan satu service opsional dapat menolak seluruh `Promise.all`. Selector cabang tersembunyi pada layar mobile.
- Admin: submenu PPOB sudah terdaftar di `apps/admin/app/domain-workspaces.ts` dan dirender `apps/admin/app/modules/digital-services.tsx`. Akses bergantung role/permission. Jangan membuat menu paralel seolah tidak ada.

## Perubahan kompatibel di wave ini

1. Storefront: `GET /products?branchCode=...&search=...&cursor=...` untuk pencarian server dan paging; respons telat dari cabang/query lain tidak tercampur; produk hasil cari tetap bisa dibuka di detail. Katalog tetap tampil ketika layanan pendukung gagal, kesalahan tetap diinformasikan.
2. Storefront: selector cabang mobile dapat digunakan, tetap memakai `onBranchChange` canonical yang menghapus cart/session cabang lama.
3. POS: akses terlihat untuk katalog/status digital-services pada workspace Penjualan, baca dari endpoint permissioned; recheck hanya status `PENDING` atau `PROCESSING`. **Tidak ada tombol bayar PPOB palsu.** Tidak mengubah 4 screenshot/workspace P5 dan tidak membuat journal/shift palsu.
4. Source tests memperluas pemeriksaan root-fix tanpa mengubah assertion lama.

## Blocker prioritas tinggi untuk produk final

| Prioritas | Area / authority | Perlu untuk closure |
|---|---|---|
| KRITIS | `apps/api/src/digital-services/digital-services.service.ts::createTransaction` | Transaksi provider dapat diantrekan tanpa bukti pembayaran pelanggan. Harus ada lifecycle *prepayment capture → immutable paid/settlement → outbox dispatch → status provider → reversal/refund*, posting melalui Accounting Core, tenant/shift lock, jaminan retry+concurrency, migration SQLite/PostgreSQL, dan bukti runtime. Jangan aktifkan pembelian PPOB di POS sebelum itu. |
| TINGGI | `apps/api/src/sales/sales.service.ts` cash movement & shift close | Variance/cash movements belum punya jurnal kas terintegrasi Accounting Core. Perlu akun posting yang disetujui, reconciler, reversal, dan UAT multi-tender. |
| TINGGI | `apps/admin/app/modules/digital-services.tsx::buy` | Admin lama masih bisa memicu antrean provider tanpa pembayaran kasir. Hanya aman setelah backend paid-state mandatory dan kompensasi dibangun. Sebelum rilis produksi, batasi akses operasional dan buktikan gate peran serta pembayaran. |
| TINGGI | `docs/P5-FULL-VISUAL-PRODUCT-REBUILD.md` | P5 full empat frontend masih memerlukan Browser UAT exact build/commit dan acceptance visual manusia. Wave ini tidak mengganti matriks 15 Admin, 14 kontekstual, 4 POS, 5 Storefront, 7 Employee, lebar 1440/1024/390. |
| TINGGI | `config/product-completeness.json` | 48 fitur butuh bukti fungsi real dan Human Stage-20; `productReady=false`, `currentPhase=P5`, `humanStage20=PENDING`. |
| SEDANG | F9 Notification center | Provider nyata (Telegram/WhatsApp) dan validasi endpoint, delivery/retry serta izin belum punya evidence produksi cukup. |

## Inventaris status resmi fitur lengkap

| Key fitur (sumber: matrix) | Nama | Status resmi |
|---|---|---|
| `multi_branch` | Banyak cabang | `IMPLEMENTED_RUNTIME_PENDING` |
| `multi_warehouse` | Banyak gudang | `IMPLEMENTED_RUNTIME_PENDING` |
| `stock_transfer` | Transfer gudang | `IMPLEMENTED_RUNTIME_PENDING` |
| `stock_opname` | Stock count dan adjustment | `IMPLEMENTED_RUNTIME_PENDING` |
| `batch_expiry` | Batch dan FEFO | `FOUNDATION` |
| `serial_number` | Pelacakan unit unik | `FOUNDATION` |
| `sales_return` | POS request → inspection → refund/restock/accounting/loyalty correction | `IMPLEMENTED_RUNTIME_PENDING` |
| `purchase_return` | Retur supplier | `FOUNDATION` |
| `loyalty` | Poin dan tier | `FOUNDATION` |
| `approval_workflow` | Approval configurable | `FOUNDATION` |
| `bank_reconciliation` | Rekonsiliasi bank | `FOUNDATION` |
| `forecasting` | Moving average | `IMPLEMENTED_RUNTIME_PENDING` |
| `reorder_suggestions` | Saran pembelian | `IMPLEMENTED_RUNTIME_PENDING` |
| `third_party_api` | Integrasi eksternal | `FOUNDATION` |
| `payment_gateway` | Payment provider | `FOUNDATION` |
| `marketplace` | Marketplace sync | `FOUNDATION` |
| `shipping` | Ekspedisi | `FOUNDATION` |
| `whatsapp` | WhatsApp notification | `FOUNDATION` |
| `customer_app` | Mobile customer app | `FOUNDATION` |
| `pos_offline` | Offline POS tunai dengan cache terverifikasi, antrean lokal, replay idempoten, dan conflict handling | `RUNTIME_VERIFIED` |
| `accounting_full` | Full accounting closing/reporting | `FOUNDATION` |
| `business_intelligence` | BI/warehouse | `FOUNDATION` |
| `scale_integration` | Timbangan/perangkat | `FOUNDATION` |
| `hris` | Data karyawan dan organisasi | `FOUNDATION` |
| `attendance` | Event, record, shift, policy | `PARTIAL` |
| `attendance_geofence` | GPS dan radius cabang | `PARTIAL` |
| `attendance_photo` | Selfie/liveness evidence | `FOUNDATION` |
| `biometric_attendance` | Fingerprint/face device bridge | `FOUNDATION` |
| `payroll` | Payroll run, result, slip, journal | `IMPLEMENTED_RUNTIME_PENDING` |
| `payroll_tax` | Pajak dan jaminan sosial configurable | `IMPLEMENTED_RUNTIME_PENDING` |
| `employee_portal` | Self-service attendance/payslip | `PARTIAL` |
| `telegram_payslip` | Secure payslip notification | `FOUNDATION` |
| `whatsapp_payslip` | Secure payslip notification | `FOUNDATION` |
| `system_tax` | Tarif resmi tetap harus dikonfigurasi | `FOUNDATION` |
| `fixed_assets` | Depresiasi dan maintenance foundation | `FOUNDATION` |
| `fleet_delivery` | Trip, manifest, loading, fuel, POD | `FOUNDATION` |
| `quality_inspection` | Checklist/evidence/policy | `FOUNDATION` |
| `gate_pass` | Barang dan kendaraan masuk/keluar | `FOUNDATION` |
| `operations_automation` | Worker, retry, idempotency | `FOUNDATION` |
| `fleet_gps` | Membutuhkan provider | `FOUNDATION` |
| `manufacturing` | Manufacturing BOM & production | `IMPLEMENTED_RUNTIME_PENDING` |
| `digital_services_ppob` | PPOB / digital services | `IMPLEMENTED_RUNTIME_PENDING` |
| `product_bulk_tooling` | Bulk product & barcode labels | `IMPLEMENTED_RUNTIME_PENDING` |
| `setup_readiness` | Business setup readiness | `IMPLEMENTED_RUNTIME_PENDING` |
| `rawbt_printing` | Android RawBT receipt transport | `IMPLEMENTED_RUNTIME_PENDING` |
| `dynamic_product_uom` | Dynamic Product UOM & base-unit safety | `IMPLEMENTED_RUNTIME_PENDING` |
| `staff_memo` | Personal Staff Memo | `IMPLEMENTED_RUNTIME_PENDING` |
| `retail_transaction_completion` | Retail Transaction Completion | `IMPLEMENTED_RUNTIME_PENDING` |

## Aturan verifikasi

- Lokal: `npm run workflow:validate && npm run validate:repo && npm run audit:full:repo`; tes tambahan `node --test tests/ppob-storefront-operator-coverage.test.mjs`.
- Gate akhir Ubuntu: `npm run uat:pre-github:local` (dependensi lengkap, SQLite TEST lokal), kemudian GitHub exact-commit Full System Simulation dan Automated UAT tanpa mengurangi assertion lama.
- Jangan menyebut hasil source audit sebagai bukti runtime, PPOB payment, visual Human Accepted, atau ready production.

## Daftar dokumentasi yang diinventarisasi untuk audit

- `docs/ADMIN-APPLICATION-SHELL.md`
- `docs/ADMIN-DOMAIN-WORKSPACES.md`
- `docs/ADVANCED-DEVELOPMENT.md`
- `docs/API.md`
- `docs/ARCHITECTURE.md`
- `docs/ASSET-FLEET-ACCOUNTING-RECONCILIATION.md`
- `docs/ASSET-FLEET-OPERATIONS.md`
- `docs/AUTOMATED-WORK-STARTER.md`
- `docs/AUTOMATION-RULEBOOK.md`
- `docs/BIOMETRIC-LOCATION-SECURITY.md`
- `docs/BROWSER-UAT.md`
- `docs/CHAT-HANDOFF-AUTOMATION.md`
- `docs/CI-TESTING.md`
- `docs/COMPLETION-DOCS-INDEX.md`
- `docs/DATABASE-PROFILES.md`
- `docs/DEVELOPMENT-KIT.md`
- `docs/DEVELOPMENT-WORKFLOW.md`
- `docs/DYNAMIC-CONFIGURATION.md`
- `docs/EDGE-SYNC-PROTOCOL.md`
- `docs/EMPLOYEE-PORTAL-PRODUCTIZATION.md`
- `docs/ENTERPRISE-ACCOUNTING-TAX.md`
- `docs/ERD.md`
- `docs/EXTENSION-GUIDE.md`
- `docs/F1-BACKEND-UI-AUDIT.md`
- `docs/F10-AI-FORECAST-ASSISTANT-COMPLETION.md`
- `docs/F11-UOM-TRANSACTION-COMPLETION.md`
- `docs/F12-FINAL-UI-UX-COMPLETION.md`
- `docs/F3-INVENTORY-COMPLETION.md`
- `docs/F4-ACCOUNTING-COMPLETION.md`
- `docs/F5-TAX-COMPLETION.md`
- `docs/F6-REPORTING-COMPLETION.md`
- `docs/F7-FINANCE-COMPLETION.md`
- `docs/F8-AUTOMATION-SCHEDULED-REPORTS-COMPLETION.md`
- `docs/F9-NOTIFICATION-CENTER-COMPLETION.md`
- `docs/FEATURE-CATALOG.md`
- `docs/FINAL-PRODUCTION-READINESS.md`
- `docs/FINANCE-ACCOUNTING-RECONCILIATION.md`
- `docs/FINGERPRINT-INTEGRATION.md`
- `docs/FULL-GITHUB-UAT.md`
- `docs/FUNCTIONAL-COMPLETENESS-W0-W2.md`
- `docs/FUNCTIONAL-DEPTH-ROADMAP.md`
- `docs/GITHUB-SETUP.md`
- `docs/HRIS-ATTENDANCE-PAYROLL.md`
- `docs/IMPLEMENTATION-ROADMAP.md`
- `docs/INBOUND-OUTBOUND-CONTROL.md`
- `docs/LARGE-SCALE-DATA.md`
- `docs/LOCAL-NO-DOCKER.md`
- `docs/OPS-PRODUCTION-READINESS.md`
- `docs/P1-ADMIN-CONTEXTUAL-WORKFLOW-ISOLATION.md`
- `docs/P3-HIDDEN-CAPABILITY-PRODUCTIZATION.md`
- `docs/P4-CANONICAL-DOMAIN-OWNERSHIP.md`
- `docs/P5-FULL-UI-ROOT-AUDIT.md`
- `docs/P5-FULL-VISUAL-PRODUCT-REBUILD.md`
- `docs/P5-V2-VISUAL-ART-DIRECTION.md`
- `docs/P5-V3-TAILWIND-TOTAL-UI-REBUILD.md`
- `docs/P5-V4-TOTAL-PRESENTATION-REBUILD.md`
- `docs/PAYROLL-ACCOUNTING-RECONCILIATION.md`
- `docs/PAYROLL-TAX-INDONESIA.md`
- `docs/PERFORMANCE-CHECKLIST.md`
- `docs/POS-MODERNIZATION.md`
- `docs/POS-OFFLINE-TRANSACTIONS.md`
- `docs/PROCUREMENT-INTEGRITY.md`
- `docs/PRODUCT-COMPLETENESS-STATUS.md`
- `docs/PRODUCTION-CHECKLIST.md`
- `docs/PRODUCTION-PROMOTION-GATE.md`
- `docs/PROJECT-CHECKPOINTS.md`
- `docs/PROJECT-STATE.md`
- `docs/QUALITY-GATES.md`
- `docs/R1-TENANT-ACCESS-CONTROL-PLANE.md`
- `docs/R5-ASSETS-FLEET-LIFECYCLE.md`
- `docs/R6-SCALE-SUMMARY-RETENTION-AI-TRUTH.md`
- `docs/R7-FULL-UI-INFORMATION-ARCHITECTURE.md`
- `docs/R8-GITHUB-FULL-RUNTIME-UAT.md`
- `docs/RUNTIME-FINALIZATION.md`
- `docs/RUNTIME-STAGING-CERTIFICATION.md`
- `docs/SERVER-DRIVEN-ADMIN-UI.md`
- `docs/SESSION-HANDOFF.md`
- `docs/STOREFRONT-FULFILLMENT-INTEGRITY.md`
- `docs/STOREFRONT-PRODUCTIZATION.md`
- `docs/TESTING.md`
- `docs/TOKO360-MASTER-PRODUCT-COMPLETION-WORKFLOW.md`
- `docs/TOKO360-MASTER-RECOVERY-WORKFLOW.md`
- `docs/TOKO360-POST-COMPLETION-HYBRID-BRANCH-WORKFLOW.md`
- `docs/TROUBLESHOOTING-INSTALL.md`
- `docs/UAT-CANDIDATE-GATE.md`
- `docs/UI-BUSINESS-AUDIT-20260929.md`
- `docs/UI-UX-FINAL-CLEANUP.md`
- `docs/VIDEO-PARITY-ENHANCEMENT-20261004.md`
- `docs/adr/ADR-T360-20260802-145524-PRODUCT-SUPPLIER-OWNERSHIP.md`
- `docs/adr/README.md`
- `docs/runbooks/PRODUCT-SUPPLIER-OWNERSHIP-MIGRATION.md`
- `docs/runbooks/RELEASE-READINESS-STAGING.md`
- `docs/runbooks/TENANT-INTEGRATION-STAGING.md`

## Milestone tambahan 2026-10-09 03:37 — W2 PPOB cash journal (pending runtime UAT)

Backend/POS/Admin kini memiliki calon alur PPOB tunai, receipt/journal Accounting Core, provider dispatch guard, explicit settlement/refund, dan aktivasinya default OFF. Detail invariant serta hal yang **belum selesai** ada di `docs/PPOB-CASH-PAYMENT-FULFILLMENT-20261009.md`. Pernyataan historis di atas merekam keadaan sebelum milestone ini; ini bukan klaim implementasi semua 48 fitur, bukan Human UAT, dan bukan izin push otomatis.
