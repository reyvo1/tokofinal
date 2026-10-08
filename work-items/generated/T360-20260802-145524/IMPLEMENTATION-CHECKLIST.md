# Implementation Checklist — T360-20260802-145524

## Analysis

- [x] Baca work item dan seluruh dokumen sumber.
- [x] Audit implementasi yang sudah ada; jangan membuat modul duplikat.
- [x] Tetapkan system of record, state machine, invariant, dan failure modes.
- [x] Konfirmasi dampak database, inventory, accounting, tax, payment, payroll, sync, security, dan performance.

## Design

- [x] Tetapkan API/DTO/event contract.
- [x] Tetapkan permission dan tenant/branch scope.
- [x] Tetapkan idempotency key serta retry behavior.
- [x] Tetapkan migration, index, pagination, retention, dan rollback.
- [x] Tetapkan accounting/tax posting rule bila relevan.

## Implementation

- [x] Implementasi kecil dan modular.
- [x] Hindari jurnal, pajak, stok, atau notification logic tersebar di modul.
- [x] Tambahkan audit event dan structured error.
- [x] Perbarui dokumentasi dan feature flag.

## Verification

- [x] Integration test akses silang tenant pada produk, stok, jurnal, pajak, payroll, dan pembayaran.
- [x] Security test token tanpa branch assignment.
- [x] Sync retry test memastikan envelope tenant tetap idempotent.
- [x] Jalankan `npm run quality:fast`.
- [x] Jalankan `npm run quality:full` sebelum release.
- [x] Catat evidence dan known issues pada work item/handoff.

## Release

- [x] UAT atau staging selesai.
- [x] Rollback plan telah diuji atau direview.
- [x] Monitoring aktif.
- [ ] Work item dipindahkan ke RELEASE_READY, RELEASED, lalu CLOSED sesuai evidence.

## Evidence pelaksanaan bertahap

### Evidence Tahap 8 — Attendance tenant scope

- [x] Tenant berasal dari `AuthUser`, bukan query/body.
- [x] Employee, device, geofence, biometric credential, event, record, dan summary divalidasi pada company/branch yang sama.
- [x] Idempotency attendance mempertahankan branch envelope dan menolak event branch lain.
- [x] Audit `TENANT_ACCESS_DENIED` serta audit mutasi attendance ditambahkan.
- [x] Tidak ada migration/schema change; rollback berupa `git restore` sebelum commit.
- [x] Test tenant Tahap 3–8, workflow validation, repository validation, API build, dan test repository dijalankan sebelum commit.
- [ ] Integration test HTTP/DB lintas tenant, device retry/offline sync, `quality:full`, staging, dan UAT masih diperlukan.

### Evidence Tahap 9 — Finance tenant scope

- [x] Finance transaction list/create/approve/post memakai tenant dari `AuthUser`.
- [x] Tax calculation, accounting event, dan outbox mempertahankan company/branch token.
- [x] Idempotency key finance menolak replay lintas branch atau payload berbeda.
- [x] Fiscal period, bank statement, dan reconciliation dibatasi pada tenant token.
- [x] Audit `TENANT_ACCESS_DENIED` serta audit lifecycle finance ditambahkan.
- [x] Tidak ada migration/schema change; rollback berupa `git restore` sebelum commit.
- [x] Test tenant Tahap 3–9, workflow validation, repository validation, API build, dan test repository dijalankan sebelum commit.
- [ ] HTTP/DB integration lintas tenant, concurrent import/post retry, `quality:full`, staging, dan UAT masih diperlukan.

### Evidence Tahap 10 — Assets, fleet, dan returns tenant scope

- [x] Assets, categories, acquisition, assignment, maintenance, dan depreciation memakai tenant dari `AuthUser`.
- [x] Fleet vehicle/trip/loading/dispatch/stop/close/fuel memakai company dan branch token.
- [x] Sale return dan purchase return list/create/confirm dibatasi pada warehouse tenant pengguna.
- [x] Seluruh foreign reference kritis divalidasi terhadap company/branch yang sama.
- [x] Inventory movement, accounting event, tax, audit, dan outbox mempertahankan tenant envelope.
- [x] Tidak ada migration/schema change; rollback berupa `git restore` sebelum commit.
- [x] Test tenant Tahap 3–10, workflow validation, repository validation, API build, dan test repository dijalankan sebelum commit.
- [ ] HTTP/DB integration lintas tenant, concurrent return/trip retry, `quality:full`, staging, dan UAT masih diperlukan.

### Evidence Tahap 11 — Operations-control dan advanced inventory tenant scope

- [x] Operation policy, inspection template/record, gate pass, dan confirmation memakai tenant dari `AuthUser`.
- [x] Source document serta foreign reference operasi divalidasi terhadap company/branch yang sama.
- [x] Stock transfer membedakan kewenangan branch sumber untuk approve/ship dan branch tujuan untuk receive.
- [x] Stock opname list/create/count/submit/complete dibatasi pada warehouse branch pengguna.
- [x] Inventory movement, accounting event, audit, dan outbox mempertahankan tenant envelope.
- [x] Tidak ada migration/schema change; rollback berupa `git restore` sebelum commit.
- [x] Test tenant Tahap 3–11, workflow validation, repository validation, API build, dan test repository dijalankan sebelum commit.
- [ ] HTTP/DB integration lintas tenant, concurrent transfer/opname retry, `quality:full`, staging, dan UAT masih diperlukan.

### Evidence Tahap 12 — Reports tenant scope

- [x] Dashboard, profit-loss, inventory valuation, dan report job memakai tenant dari `AuthUser`.
- [x] Sale, order, account, warehouse, inventory, receipt, dan report job dibatasi pada company/branch yang sama.
- [x] Report job menyimpan company, branch, serta requester token sebagai tenant envelope worker.
- [x] Override atau warehouse lintas tenant ditolak dan dicatat sebagai `TENANT_ACCESS_DENIED`.
- [x] Audit `CREATE_REPORT_JOB` ditambahkan.
- [x] Tidak ada migration/schema change; rollback berupa `git restore` sebelum commit.
- [x] Test tenant Tahap 3–12, workflow validation, repository validation, API build, dan test repository dijalankan sebelum commit.
- [ ] HTTP/DB integration lintas tenant, report worker retry/idempotency, `quality:full`, staging, dan UAT masih diperlukan.

### Evidence Tahap 13 — Platform configuration tenant scope

- [x] Seluruh endpoint konfigurasi platform administratif menerima `AuthUser` dan memakai tenant token.
- [x] Feature/settings/UI schema mempertahankan hierarchy global, company, branch token, dan user tanpa membaca branch lain.
- [x] Runtime manifest publik wajib branch code; manifest ber-token mengambil company/branch dari JWT.
- [x] Custom field, integration, webhook, business rule, approval, UI schema, dan outbox dibatasi pada tenant yang sama.
- [x] Approval request dan outbox tidak mengembalikan data branch lain.
- [x] Audit mutasi platform dan `TENANT_ACCESS_DENIED` ditambahkan.
- [x] Tidak ada migration/schema change; rollback berupa `git restore` sebelum commit.
- [x] Test tenant Tahap 3–13, workflow validation, repository validation, API/storefront build, dan test repository dijalankan sebelum commit.
- [ ] HTTP/DB integration lintas tenant, webhook/outbox worker retry, storefront multi-branch test, `quality:full`, staging, dan UAT masih diperlukan.

### Evidence Tahap 14 — Users dan access control tenant scope

- [x] User list/create/role/status memakai company dan branch dari `AuthUser`.
- [x] User lintas branch serta branch override ditolak sebagai `TENANT_ACCESS_DENIED`.
- [x] Role/permission global hanya dapat dimutasi `SUPER_ADMIN`.
- [x] Role `SUPER_ADMIN`/`OWNER`, akun protected, dan perubahan akun sendiri dilindungi dari privilege escalation atau lockout.
- [x] JWT guard memuat ulang status, branch, role, permission, dan tenant context dari database.
- [x] Audit mutasi user/role, `TENANT_ACCESS_DENIED`, dan `ACCESS_CONTROL_DENIED` ditambahkan.
- [x] Tidak ada migration/schema change; rollback berupa `git restore` sebelum commit.
- [x] Test tenant Tahap 3–14, workflow validation, repository validation, API build, dan test repository dijalankan sebelum commit.
- [ ] HTTP/DB integration lintas tenant, concurrent role/status update, token revocation load test, `quality:full`, staging, dan UAT masih diperlukan.

### Evidence Tahap 15 — Extensions dan sync tenant scope

- [x] Batch/serial, loyalty, device, forecast, shipment, marketplace, dan notification menerima tenant dari `AuthUser`.
- [x] Endpoint retur extensions didelegasikan ke `ReturnsService` dan tidak menggandakan inventory/accounting logic.
- [x] Offline sync menyimpan company/branch envelope dan menolak retry localId/sequence/payload yang tidak konsisten.
- [x] Warehouse, order, sale, integration, device, dan loyalty program divalidasi pada tenant yang sama.
- [x] Audit mutasi extensions dan `TENANT_ACCESS_DENIED` ditambahkan.
- [x] Tidak ada migration/schema change; rollback berupa `git restore` sebelum commit.
- [x] Test tenant Tahap 3–15, workflow validation, repository validation, API build, dan test repository dijalankan sebelum commit.
- [ ] HTTP/DB integration lintas tenant, offline worker replay/concurrency, notification/marketplace worker test, `quality:full`, staging, dan UAT masih diperlukan.

### Evidence Tahap 16 — Product dan supplier company ownership

- [x] Schema SQLite, PostgreSQL, dan schema aktif menambahkan company ownership nullable serta index Product/Supplier.
- [x] SQL expand-only dan backfill terpisah tersedia untuk kedua provider; tidak ada drop atau NOT NULL pada fase ini.
- [x] Product/Supplier baru dan endpoint daftar/detail memakai tenant tepercaya atau branch code storefront.
- [x] Product/supplier references pada purchase, sale, order, inventory, fleet, dan extensions divalidasi terhadap company yang sama.
- [x] Public catalog membatasi inventory pada branch storefront dan tidak mengekspos companyId.
- [x] Seed lokal mengisi company ownership dan ADR mencatat deployment, failure mode, rollback, serta monitoring.
- [x] Test tenant Tahap 3–16, workflow validation, repository validation, schema validation, Prisma generate, API/storefront build, dan test repository dijalankan sebelum commit.
- [ ] Expand migration dan backfill TEST/STAGING, rekonsiliasi zero unresolved, HTTP/DB integration lintas tenant, query-plan review, `quality:full`, restore test, UAT, dan production rollout masih diperlukan.

### Evidence Tahap 17 — Rehearsal migration Product/Supplier

- [x] SQLite backup API menghasilkan snapshot konsisten dan restore-test dengan table counts serta integrity yang sama.
- [x] Expand/backfill hanya dijalankan pada salinan; database sumber tidak berubah.
- [x] Backfill dan keputusan ownership administratif dijalankan dua kali dan terbukti idempoten.
- [x] Mapping eksplisit untuk record tanpa kandidat transaksi divalidasi terhadap identitas record/company dan dicatat pada evidence.
- [x] Unresolved Product/Supplier, ownership mismatch, FK violation, dan missing index bernilai nol.
- [x] Reconciliation SQL SQLite/PostgreSQL dan runbook staging tersedia.
- [x] Test rehearsal, test tenant Tahap 16, workflow/repository validation, API build, dan test repository dijalankan sebelum commit.
- [ ] PostgreSQL TEST/STAGING migration, HTTP/DB integration lintas tenant, query-plan staging, `quality:full`, restore staging, UAT, dan production rollout masih diperlukan.

### Evidence Tahap 18 — PostgreSQL TEST/STAGING Product/Supplier

- [x] Target dan database restore divalidasi sebagai TEST/STAGING serta ditolak bila memiliki penanda production/live.
- [x] Backup `pg_dump` custom-format dibuat dan archive list diverifikasi.
- [x] Backup direstore ke database scratch terpisah dan jumlah Product/Supplier diverifikasi.
- [x] Expand, backfill, keputusan administratif, dan reconciliation dijalankan dalam transaksi PostgreSQL.
- [x] Unresolved Product/Supplier bernilai nol dan empat index ownership tersedia.
- [x] Eksekusi kedua terbukti idempoten dan query plan dicatat.
- [x] Credential serta raw database URL tidak masuk evidence atau Git.
- [ ] HTTP/DB integration lintas tenant, `quality:full`, query-plan DBA review, UAT, monitoring, dan production rollout masih diperlukan.

### Evidence Tahap 19 — HTTP/DB integration lintas tenant

- [x] API hasil build dijalankan terhadap PostgreSQL TEST/STAGING pada port sementara.
- [x] Dua tenant fixture terisolasi menguji produk, stok, jurnal, pajak, payroll, finance/payment, user, dan public order.
- [x] Token tanpa branch assignment ditolak.
- [x] Offline sync retry idempoten, altered replay ditolak, dan device lintas tenant ditolak.
- [x] `TENANT_ACCESS_DENIED` terverifikasi pada database audit.
- [x] Seluruh fixture integration dihapus kembali setelah test.
- [x] `quality:full` lulus setelah integration staging.
- [x] Credential/token/raw database URL tidak masuk evidence atau Git.
- [ ] UAT staging, observasi, query-plan DBA review, monitoring threshold, release readiness, dan production rollout masih diperlukan.

### Evidence Tahap 20 — Release readiness staging

- [x] Evidence Tahap 18 migration/restore dan Tahap 19 HTTP/DB integration/quality:full diverifikasi.
- [x] UAT staging seluruh skenario kritis lulus dan memiliki approver.
- [x] Health observation p95 berada dalam budget dan tidak ada error sample.
- [x] Tidak ada Product/Supplier ownership unresolved.
- [x] Tidak ada long-running query melewati threshold saat observasi.
- [x] Query plan dan critical index coverage lulus.
- [x] Queue, audit denial, connection, dan PostgreSQL stats dicatat tanpa credential.
- [x] Rollback/restore evidence direview dan monitoring owner ditetapkan.
- [x] Work item dipindahkan ke RELEASE_READY.
- [ ] Production deployment, post-deploy smoke, observation, RELEASED, dan CLOSED masih diperlukan.
