# Session Handoff — T360-20260802-145524

- Checkpoint baseline: `RC0.5.3.1_EMBEDDED_INSTRUCTIONS_DYNAMIC_CHAT_HANDOFF`
- Work item: `work-items/active/T360-20260802-145524-menegakkan-isolasi-company-dan-branch-di-seluruh-endpoint.json`
- Branch: `security/t360-20260802-145524-menegakkan-isolasi-company-dan-branch-di-seluruh-endpoint`
- Phase: `IMPLEMENTATION`
- Owner: `IVO`

## Sudah dikerjakan

- Work item dan paket pekerjaan dibuat otomatis.

## Belum dikerjakan

- [ ] Audit source.
- [ ] Design.
- [ ] Implementation.
- [ ] Verification.

## Hasil quality gate

- Gate bertahap Tahap 3–16: test tenant, workflow validation, repository validation, API build, dan seluruh test repository lulus pada runner lokal.
- `quality:full`, HTTP/DB integration lintas tenant, staging/UAT, dan release gate tetap belum ditutup.

## Known issues

Belum ada.

## Langkah aman berikutnya

Lakukan change approval dan production deployment terjadwal. Jangan memindahkan ke RELEASED sebelum production smoke test, monitoring pascadeploy, dan rollback readiness diverifikasi.

### Tahap 4 — Goods receipts tenant scope

- Endpoint list, create, confirm, dan reject goods receipt dibatasi berdasarkan company dan branch pengguna.
- Purchase order sumber wajib berasal dari warehouse pada tenant pengguna.
- Inspection untuk konfirmasi wajib berasal dari company, branch, dan goods receipt yang sama.
- Percobaan akses lintas tenant dicatat sebagai `TENANT_ACCESS_DENIED`.
- Test khusus: `tests/tenant-scope-goods-receipts.test.mjs`.
- Commit target: `security: enforce tenant scope on goods receipts`.

### Tahap 5 — Public orders tenant scope

- Daftar order internal dibatasi oleh company dan branch pengguna.
- Checkout publik wajib menyertakan branch code.
- Detail dan pembayaran publik wajib menyertakan branch code serta HMAC access token.
- Warehouse default hanya dipilih dari branch storefront yang diminta.
- Tax code divalidasi terhadap company storefront.
- Akses publik yang salah dicatat sebagai TENANT_ACCESS_DENIED.
- Storefront meneruskan branch code dan access token.
- Test khusus: tests/tenant-scope-orders.test.mjs.

### Automation v1.2.1 — Compatible automatic chat checkpoint

- Checkpoint tetap menyertakan progres dari `SESSION-HANDOFF.md` dan `IMPLEMENTATION-CHECKLIST.md`.
- Nilai credential dalam handoff disensor sebelum masuk ke `FIRST-CHAT.md`.
- ZIP dibuat otomatis dari `git archive HEAD`, lalu commit, ukuran, dan SHA-256 dicatat.
- File untracked seperti ZIP transfer atau installer tidak masuk arsip dan tidak lagi menghalangi pembuatan checkpoint.
- Perubahan tracked/staged yang belum di-commit tetap memblokir checkpoint.
- Regression test: `tests/chat-checkpoint-compat.test.mjs`.

### Tahap 6 — Accounting core tenant scope

- Endpoint accounting mengambil company dan branch dari identitas pengguna terverifikasi.
- Daftar accounting event dibatasi company dan branch pengguna.
- Tax code dan posting rule dibatasi company pengguna.
- Override company/branch lintas tenant ditolak dengan TENANT_ACCESS_DENIED dan dicatat pada audit log.
- Preview pajak dan manual tax line memvalidasi tax code pada company yang sama.
- Manual accounting event mempertahankan idempotensi dan menolak penggunaan key pada event/branch berbeda.
- Tidak ada migration atau perubahan schema.
- Test khusus: tests/tenant-scope-accounting.test.mjs.
- Commit target: security: enforce tenant scope on accounting core.

### Tahap 7 — HR dan payroll tenant scope

- Endpoint HR dan payroll mengambil company serta branch dari identitas pengguna terverifikasi.
- Daftar dan mutasi employee dibatasi pada company dan branch token.
- Department, position, account user, payroll period, component, tax rule, dan social-security rule divalidasi pada company yang sama.
- Payroll run selalu dibuat, dihitung, disetujui, diposting, dan diterbitkan pada branch token.
- Employee self-service, attendance, payslip, channel binding, dan preference memakai employee pada company/branch token.
- Attendance, payroll assignment, tax profile, social profile, result, payslip, dan notification dibatasi pada tenant payroll run.
- Override company/branch lintas tenant ditolak dengan TENANT_ACCESS_DENIED dan dicatat pada audit log.
- Mutasi HR/payroll penting menghasilkan audit event terstruktur.
- Tidak ada migration atau perubahan schema.
- Test khusus: tests/tenant-scope-hr-payroll.test.mjs.
- Commit target: security: enforce tenant scope on hr and payroll.

### Tahap 8 — Attendance dan device ingestion tenant scope

- Endpoint konfigurasi, pencatatan, daftar attendance, media lokal, device, geofence, biometric enrollment, dan fingerprint ingestion mengambil company serta branch dari token.
- Employee, device, geofence, biometric credential, attendance event, attendance record, dan daily summary dibatasi pada company/branch token.
- Idempotency key `operationId` dan `externalEventId` tidak dapat mengembalikan event milik branch lain.
- Media attendance lokal dipisahkan dalam direktori company/branch.
- Override company/branch lintas tenant ditolak dengan `TENANT_ACCESS_DENIED` dan dicatat pada audit log.
- Mutasi device, geofence, biometric enrollment, dan attendance event menghasilkan audit event terstruktur.
- Tidak ada migration atau perubahan schema.
- Test khusus: `tests/tenant-scope-attendance.test.mjs`.
- Commit target: `security: enforce tenant scope on attendance`.

### Tahap 9 — Finance operations tenant scope

- Daftar, pembuatan, approval, dan posting operational finance transaction mengambil company serta branch dari token.
- Override company/branch lintas tenant ditolak dengan `TENANT_ACCESS_DENIED` dan dicatat pada audit log.
- Tax code transaksi keuangan divalidasi terhadap company token.
- Idempotency key finance tetap company-scoped, tidak dapat mengembalikan transaksi branch lain, dan payload berbeda ditolak.
- Fiscal period, bank statement, dan bank reconciliation dibatasi pada company/branch token.
- Bank statement mewajibkan file name sebagai identitas import idempoten; reconciliation memvalidasi statement pada tenant yang sama.
- Outbox finance membawa company dan branch secara eksplisit.
- Tidak ada migration atau perubahan schema.
- Test khusus: `tests/tenant-scope-finance.test.mjs`.
- Commit target: `security: enforce tenant scope on finance operations`.

### Tahap 10 — Assets, fleet, dan returns tenant scope

- Asset list, category, acquisition, assignment, maintenance, dan depreciation mengambil company serta branch dari token.
- Asset category, warehouse, employee, inspection, dan tax code divalidasi pada tenant yang sama sebelum mutasi.
- Vehicle, delivery trip, loading, dispatch, stop, close, dan fuel dibatasi pada company/branch token.
- Vehicle asset, driver, warehouse, sale/order/shipment, batch/serial, inspection, gate pass, dan device divalidasi lintas referensi.
- Sale return dan purchase return list/create/confirm dibatasi pada warehouse tenant pengguna.
- Inspection, operational confirmation, gate pass, tax code, inventory movement, accounting event, serta outbox return mempertahankan tenant envelope.
- Override atau referensi lintas tenant ditolak dengan `TENANT_ACCESS_DENIED` dan dicatat pada audit log.
- Tidak ada migration atau perubahan schema.
- Test khusus: `tests/tenant-scope-assets-fleet-returns.test.mjs`.
- Commit target: `security: enforce tenant scope on assets fleet and returns`.

### Tahap 11 — Operations-control dan advanced inventory tenant scope

- Operation policy list/upsert, inspection template, operational inspection, gate pass, dan confirmation mengambil company serta branch dari token.
- Referensi sumber inspeksi/konfirmasi diverifikasi terhadap warehouse, company, dan branch pengguna untuk receipt, PO, sale, order, return, asset, maintenance, trip, stock transfer, stock opname, dan shipment.
- Vehicle, employee, inspection, template item, gate pass, serta source document wajib berada pada tenant yang sama.
- Stock transfer list dibatasi pada transfer yang melibatkan branch pengguna dan kedua warehouse wajib berada pada company yang sama.
- Approval/ship transfer hanya dilakukan oleh branch sumber; receive hanya dilakukan oleh branch tujuan.
- Stock opname list/create/count/submit/complete dibatasi pada warehouse dan location branch pengguna.
- Accounting event, inventory movement, audit, dan outbox transfer/opname mempertahankan company serta branch envelope.
- Override atau referensi lintas tenant ditolak dengan `TENANT_ACCESS_DENIED` dan dicatat pada audit log.
- Tidak ada migration atau perubahan schema.
- Test khusus: `tests/tenant-scope-operations-inventory.test.mjs`.
- Commit target: `security: enforce tenant scope on operations control and advanced inventory`.

### Tahap 12 — Reports tenant scope

- Dashboard membatasi sale, order, inventory summary, inventory total, pending order, dan goods receipt pada company/branch token.
- Profit and loss hanya mengelompokkan journal line melalui account pada branch pengguna dan company yang sama.
- Inventory valuation hanya membaca warehouse pada branch pengguna; warehouse lintas tenant ditolak dan diaudit.
- Report job mengambil company, branch, dan requestedBy dari token; field tenant lama hanya dipakai untuk mendeteksi override.
- Daftar report job dibatasi pada company serta branch pengguna sehingga worker memiliki tenant envelope eksplisit dari record job.
- Token tanpa company/branch ditolak dengan `TENANT_CONTEXT_REQUIRED`; override lintas tenant menghasilkan `TENANT_ACCESS_DENIED`.
- Pembuatan report job dicatat sebagai audit event `CREATE_REPORT_JOB`.
- Tidak ada migration atau perubahan schema.
- Test khusus: `tests/tenant-scope-reports.test.mjs`.
- Commit target: `security: enforce tenant scope on reports`.

### Tahap 13 — Platform configuration tenant scope

- Feature flag, system setting, custom field, integration, webhook, business rule, approval, UI schema, dan outbox administratif mengambil company/branch dari token.
- Konfigurasi company-level tetap menggunakan `branchId = null`; konfigurasi branch-level hanya dapat menunjuk branch token.
- Runtime manifest publik tidak lagi menerima `companyId`/`branchId` bebas dan wajib memakai branch code aktif.
- Runtime manifest admin/POS tetap memakai bearer token melalui optional authentication pada route publik.
- Storefront dan customer mobile meneruskan branch code ketika mengambil runtime manifest.
- Approval request dibatasi pada requester dari branch yang sama; outbox difilter berdasarkan company dan branch envelope payload.
- Secret integrasi tidak dikembalikan oleh endpoint daftar dan hanya ditandai dengan `hasSecrets`.
- Override atau referensi lintas tenant ditolak dengan `TENANT_ACCESS_DENIED` dan dicatat pada audit log.
- Mutasi platform menghasilkan audit event terstruktur; tidak ada migration atau perubahan schema.
- Test khusus: `tests/tenant-scope-platform.test.mjs`.
- Commit target: `security: enforce tenant scope on platform configuration`.

### Tahap 14 — Users dan access control tenant scope

- Daftar, pembuatan, perubahan role, dan perubahan status user mengambil company/branch dari token.
- User target wajib berada pada branch token; branch override serta akses user lintas tenant ditolak dan diaudit.
- Field `branchId` lama pada create user hanya menjadi compatibility field dan tidak menjadi tenant authority.
- Role dan permission merupakan katalog global; create role serta perubahan permission hanya dapat dilakukan `SUPER_ADMIN`.
- Role `SUPER_ADMIN` dan `OWNER` dilindungi dari assignment atau mutasi oleh admin tenant biasa.
- Perubahan role/status akun sendiri ditolak untuk mencegah administrative lockout.
- JWT guard memuat ulang status user, branch aktif, role, permission, dan tenant context dari database pada setiap request ber-token.
- User/branch yang dinonaktifkan serta perubahan role berlaku tanpa menunggu JWT kedaluwarsa.
- Mutasi user/role dan penolakan akses menghasilkan audit event terstruktur; tidak ada migration atau perubahan schema.
- Test khusus: `tests/tenant-scope-users-access.test.mjs`.
- Commit target: `security: enforce tenant scope on users and access control`.

### Tahap 15 — Extensions dan sync tenant scope

- Inventory batch dan serial dibatasi pada warehouse branch pengguna serta product yang memiliki inventory aktif pada warehouse tersebut.
- Endpoint retur lama pada extensions tidak lagi menulis stok atau event sendiri dan didelegasikan ke `ReturnsService` canonical.
- Loyalty program dan transaksi loyalty dibatasi pada company token.
- Device registration, daftar device, dan offline transaction ingestion memakai company/branch token.
- Retry offline transaction divalidasi berdasarkan device, localId, sequence, transaction type, dan canonical payload tenant.
- Forecast hanya membaca penjualan serta inventory warehouse branch pengguna dan menyimpan branch envelope pada parameter/reason.
- Shipment memvalidasi warehouse, order, sale, dan integration pada tenant yang sama.
- Marketplace order dibatasi melalui integration connection company/current branch dan orderData membawa tenant envelope.
- Notification memakai company token serta branch envelope pada data; mutasi menghasilkan audit terstruktur.
- Tidak ada migration atau perubahan schema.
- Test khusus: `tests/tenant-scope-extensions-sync.test.mjs`.
- Commit target: `security: enforce tenant scope on extension sync operations`.

### Tahap 16 — Product dan supplier company ownership

- `Product` dan `Supplier` memperoleh `companyId` nullable sebagai migration expand-only pada SQLite dan PostgreSQL.
- Migration dan backfill provider-specific tersedia di `database/migrations/T360-20260802-145524-product-supplier-ownership/`.
- Backfill hanya menetapkan ownership bila seluruh bukti relasi menunjuk tepat satu company; record unresolved/multi-company tidak dipilih secara arbitrer.
- Katalog produk publik wajib memakai branch code aktif dan hanya mengembalikan inventory warehouse branch tersebut tanpa mengekspos companyId.
- Product dan supplier baru mengambil company dari tenant token; list/detail dibatasi pada company token.
- Purchase order, sales, public orders, stock transfer/opname, fleet manifest, dan extensions memvalidasi product/supplier pada company yang sama.
- Constraint global SKU, barcode, dan supplier code dipertahankan selama fase expand; contract migration dilakukan terpisah setelah backfill dan observasi.
- Production migration/backfill tidak dijalankan oleh paket source dan `prisma db push` tetap dilarang untuk production.
- Test khusus: `tests/tenant-scope-products-suppliers.test.mjs`.
- Commit target: `migration(database): add product supplier company ownership`.

### Tahap 17 — Rehearsal migration Product/Supplier

- Database SQLite sumber tidak diubah; expand/backfill dijalankan pada snapshot hasil SQLite backup API.
- Restore test: lulus; integrity: ok.
- Product unresolved: 0; Supplier unresolved: 0.
- Ownership mismatch Product/Supplier: 0/0.
- Backfill + keputusan administratif idempotent: ya; missing index: 0; FK violation: 0.
- Keputusan ownership eksplisit pada snapshot: 1; sumber keputusan: stage17-ownership-decisions.json.
- Reconciliation SQL provider-specific dan runbook staging tersedia; production tetap belum disentuh.
- Evidence: `work-items/generated/T360-20260802-145524/evidence/T360-20260802-145524-stage17-local-rehearsal.json`.
- Langkah aman berikutnya: jalankan expand/backfill/reconciliation pada PostgreSQL TEST/STAGING dengan restore point teruji, lalu HTTP/DB integration lintas tenant dan `quality:full`.

### Tahap 18 — PostgreSQL TEST/STAGING migration Product/Supplier

- Target: STAGING; production tidak disentuh.
- Backup custom-format terverifikasi: ya; SHA-256 dicatat pada evidence.
- Restore drill database scratch: lulus.
- Product unresolved: 0; Supplier unresolved: 0.
- Empat index ownership tersedia: ya.
- Eksekusi kedua idempoten: ya.
- Credential dan raw database URL tidak disimpan pada evidence.
- Evidence: `work-items/generated/T360-20260802-145524/evidence/T360-20260802-145524-stage18-postgres-staging.json`.
- Langkah aman berikutnya: HTTP/DB integration lintas tenant terhadap staging, `quality:full`, query-plan review, UAT, dan observasi sebelum production rollout.

### Tahap 19 — HTTP/DB integration lintas tenant dan quality gate

- PostgreSQL STAGING diuji melalui API hasil build pada port sementara.
- Integration test lulus: 11/11.
- Audit TENANT_ACCESS_DENIED terverifikasi: 7.
- Cleanup fixture staging: lulus.
- Produk, stok, jurnal, pajak, payroll, finance/payment, user branch, token tanpa branch, public order payment, dan offline sync tercakup.
- `quality:full` lulus setelah integration test staging.
- Credential, password, token, dan raw database URL tidak disimpan.
- Evidence: `work-items/generated/T360-20260802-145524/evidence/T360-20260802-145524-stage19-http-db-integration.json`.
- Production belum disentuh.
- Langkah aman berikutnya: UAT staging, observasi/monitoring, query-plan DBA review, dan release readiness review sebelum production rollout.

### Tahap 20 — UAT, observasi staging, query-plan review, dan release readiness

- UAT staging lulus: 10/10; approver tercatat pada evidence.
- Health observation p95: 23.28 ms dari 30 sample.
- Ownership unresolved Product/Supplier: 0/0.
- Query utama direview dengan EXPLAIN ANALYZE + BUFFERS dan critical index coverage.
- PostgreSQL connection, long-running query, queue status, audit denial, dan database stats dicatat.
- Evidence Tahap 18/19 diverifikasi sebelum gate Tahap 20.
- Evidence: `work-items/generated/T360-20260802-145524/evidence/T360-20260802-145524-stage20-release-readiness.json`.
- Production belum disentuh; keputusan ini hanya RELEASE_READY.
- Langkah aman berikutnya: change approval, production deployment terjadwal, smoke test pascadeploy, observasi, lalu fase RELEASED/CLOSED berdasarkan evidence baru.
