# Workflow Pengembangan Toko360

Dokumen ini adalah workflow resmi untuk mengembangkan Toko360 berdasarkan `docs/DEVELOPMENT-KIT.md`. Tujuannya menjaga agar penambahan fungsi tetap modular, aman terhadap data besar, dan tidak merusak stok, keuangan, pajak, payroll, aset, armada, atau sinkronisasi.

## 1. Prinsip pengembangan

- **Satu sumber kebenaran:** Development Kit, module delivery map, dan work item aktif.
- **Tidak ada perubahan langsung tanpa work item.**
- **Feature flag first:** fungsi berisiko dapat dimatikan tanpa rollback database.
- **Expand–migrate–contract:** perubahan database tidak memutus versi lama.
- **Event dan posting terpusat:** modul tidak membuat jurnal atau pajak sendiri di luar accounting-tax core.
- **Append-only untuk ledger:** inventory movement, accounting event, attendance event, audit log, dan sync operation tidak diedit diam-diam.
- **Idempotency:** setiap mutasi yang dapat diulang harus aman dari duplikasi.
- **Tenant isolation:** `companyId`, `branchId`, warehouse scope, dan employee self-scope harus diuji.
- **Evidence before release:** tidak ada status “selesai” tanpa bukti test, migration, rollback, dan monitoring.

## 2. Delivery waves

Urutan modul resmi berada di `config/module-delivery-map.json`.

| Wave | Fokus | Ketergantungan utama |
|---|---|---|
| W0 | Platform, tenant, identity, security, audit | Tidak ada |
| W1 | Master data, gudang, persediaan | W0 |
| W2 | POS, website, order, payment, retur | W1 |
| W3 | Accounting, tax, kas, piutang, utang | W1–W2 |
| W4 | HRIS, absensi, payroll | W0 dan W3 |
| W5 | Aset, armada, inspeksi, gate pass | W1 dan W3 |
| W6 | Edge-cloud sync dan integrasi vendor | W0–W3 |
| W7 | Skala besar, reporting, archive, monitoring | W1–W3 |

Modul boleh dikerjakan paralel hanya apabila dependency dan kontraknya stabil.

## 3. Siklus satu work item

### Fase 1 — INTAKE

Masukkan masalah bisnis, pengguna, cabang yang terdampak, hasil yang diharapkan, dan batas ruang lingkup.

**Keluar fase jika:** masalah nyata dan pemilik keputusan sudah jelas.

### Fase 2 — ANALYSIS

Isi dampak:

- Database dan migration.
- Inventory dan movement.
- Accounting dan jurnal.
- Tax dan periode aturan.
- Payment/refund.
- Payroll.
- Edge-cloud sync.
- Security dan data sensitif.
- Performance serta volume data.

**Keluar fase jika:** invariant, risiko, dependency, dan acceptance criteria dapat diuji.

### Fase 3 — DESIGN

Hasil minimal:

- Alur proses normal, gagal, pembatalan, dan retry.
- API contract dan permission.
- Perubahan schema dan indeks.
- Event/outbox yang diterbitkan.
- Posting accounting-tax.
- Feature flag dan default aman.
- Migration, backfill, rollback, monitoring.

Untuk perubahan lintas modul, buat Architecture Decision Record di `docs/adr/`.

### Fase 4 — IMPLEMENTATION

Urutan aman:

1. Kontrak bersama dan feature flag.
2. Migration expand-only.
3. Domain service dan invariant.
4. API dan permission.
5. Outbox/worker/integration adapter.
6. UI.
7. Seed/configuration.
8. Dokumentasi dan test.

Jangan menggabungkan perubahan schema besar, refactor massal, dan fitur bisnis dalam satu PR.

### Fase 5 — VERIFICATION

Wajib menjalankan:

```bash
npm run quality:fast
npm run db:local:reset
npm run test:db:smoke
npm run quality:full
```

Tambahkan pengujian sesuai dampak:

- Stok: concurrency, negative stock, reversal, movement balance.
- Accounting: debit = kredit, posting ulang, period lock, reversal.
- Tax: rule version, effective date, inclusive/exclusive, return reversal.
- Payment: webhook replay, timeout, partial refund.
- Payroll: employee scope, approval, recalculation, immutable posted run.
- Sync: retry, duplicate packet, conflict, resume checkpoint.
- Data besar: pagination, query plan, P95/P99, export asynchronous.
- Security: permission, tenant scope, audit, secret handling, evidence access.

### Fase 6 — STAGING

Gunakan PostgreSQL dan data sintetis yang mewakili volume production.

Checklist:

- Migration berhasil dan dapat dilanjutkan ulang.
- Smoke test seluruh modul terdampak.
- UAT oleh pemilik proses.
- Feature flag default sesuai rencana.
- Dashboard metric dan alert aktif.
- Backup dan restore point tersedia.

### Fase 7 — RELEASE_READY

Work item harus memiliki `releaseEvidence`, misalnya URL GitHub Actions, hasil UAT, query plan, atau dokumen rekonsiliasi.

Release plan wajib menyebut:

- Urutan deployment.
- Migration dan backfill.
- Feature flag activation.
- Observasi dan metric.
- Rollback aplikasi.
- Compensating operation untuk data yang sudah diposting.

### Fase 8 — RELEASED dan CLOSED

Setelah rilis:

- Pantau error, latency, queue age, database locks, dan business invariant.
- Rekonsiliasi stok, pembayaran, jurnal, pajak, atau payroll sesuai modul.
- Tutup work item hanya setelah masa observasi selesai.

## 4. Branch dan commit

Format branch:

```text
feature/t360-20260729-215200-outbound-inspection
fix/t360-20260729-215200-payment-replay
migration/t360-20260729-215200-inventory-index
hotfix/t360-20260729-215200-critical-stock-lock
release/v0.5.3
```

Judul commit dan PR memakai Conventional Commits:

```text
feat(inventory): add atomic outbound confirmation
fix(accounting): prevent duplicate posting receipt
migration(database): add sale branch-date index
```

## 5. Pull request policy

- Satu PR mengacu pada satu work item utama.
- PR tidak boleh di-merge jika CI merah.
- Perubahan high/critical risk membutuhkan reviewer domain terkait.
- Schema SQLite dan PostgreSQL harus tetap sejajar.
- API breaking change memerlukan versi atau compatibility layer.
- Migration production tidak boleh memakai destructive reset.
- PR harus menjelaskan rollback dan dampak operasional.

## 6. Quality gates

| Gate | Perintah/lingkungan | Tujuan |
|---|---|---|
| G0 Workflow | `npm run workflow:validate` | Manifest dan analisis dampak lengkap |
| G1 Static | `npm run validate:repo` dan lint | Struktur, syntax, schema parity |
| G2 Unit | `npm test` | Aturan domain |
| G3 Local integration | SQLite smoke/build | Cepat tanpa Docker |
| G4 PostgreSQL integration | GitHub Actions | Perilaku production DB |
| G5 Performance | workflow performance | P95/P99 dan error budget |
| G6 Staging/UAT | Server staging | Proses bisnis end-to-end |
| G7 Release | release candidate workflow | Bukti, artifact, dan checksum |

## 7. Definition of Done

Sebuah fitur dinyatakan selesai hanya jika:

- Acceptance criteria terpenuhi.
- Permission dan tenant scope diuji.
- Migration dan rollback terdokumentasi.
- Stok/accounting/tax invariant lulus bila terdampak.
- Retry/idempotency lulus bila ada proses async/integrasi.
- Pagination dan indeks tersedia untuk data tumbuh.
- Audit log dan monitoring tersedia.
- Dokumentasi API/operasional diperbarui.
- CI SQLite dan PostgreSQL hijau.
- UAT dan release evidence tercatat.

## 8. Hotfix

Hotfix hanya untuk gangguan production kritis.

1. Buat work item type `hotfix`, risk `CRITICAL`.
2. Branch dari tag/release production.
3. Perubahan sekecil mungkin.
4. Jalankan test khusus regression dan accounting/inventory reconciliation.
5. Rilis dengan feature flag bila memungkinkan.
6. Merge kembali ke `main` dan `develop`.
7. Buat post-incident review maksimal pada siklus kerja berikutnya.

## 9. Larangan

- Menghapus transaksi posted secara langsung.
- Mengubah stok akhir tanpa inventory movement.
- Mengedit jurnal posted tanpa reversal/adjustment.
- Mengubah tarif pajak aktif tanpa versi baru.
- Menyimpan fingerprint mentah atau credential di repository.
- Mengambil seluruh tabel tanpa pagination.
- Mengirim data sensitif ke log atau notifikasi terbuka.
- Menjalankan migration destructive langsung di production.
- Menyatukan banyak fitur besar dalam satu PR tanpa dependency map.

## 10. Memulai pekerjaan secara otomatis

Jalankan `npm run work:auto`. Sistem memilih pekerjaan READY dari `config/implementation-backlog.json`, membuat work item fase ANALYSIS, branch, paket task/checklist/prompt/handoff, lalu membuka editor. Bila ada pekerjaan aktif, sistem membukanya terlebih dahulu agar work in progress tidak menumpuk.

Otomatisasi hanya menyiapkan dan mengarahkan pelaksanaan. Fase tidak boleh dimajukan tanpa hasil analisis, perubahan source, test, quality gate, dan release evidence yang sesuai.
