# T360-20260823-184817 — Menyelesaikan inspeksi barang masuk supplier sampai posting

## Mulai dari sini

- Work item: `work-items/active/T360-20260823-184817-menyelesaikan-inspeksi-barang-masuk-supplier-sampai-posting.json`
- Modul: `inbound-inspection`
- Wave: `W5 — Assets, fleet, and operational control`
- Risiko: `HIGH`
- Fase awal: `ANALYSIS`
- Branch yang disarankan: `feature/t360-20260823-184817-menyelesaikan-inspeksi-barang-masuk-supplier-sampai-posting`
- Feature flag: `operations.inboundInspection.enabled`

## Tujuan

Menyelesaikan inspeksi barang masuk supplier sampai posting. Pekerjaan harus mengikuti Development Kit, workflow, tenant isolation, permission, idempotency, audit, serta quality gate repository.

## Aturan bisnis

- Goods receipt belum menambah stok sebelum inspeksi dan konfirmasi selesai.
- Barang rusak atau ditolak tidak masuk stok tersedia.
- Pajak masukan memakai tax rule version yang berlaku pada dokumen supplier.

## Acceptance criteria

- PO, scan, kondisi, batch, bukti, approval, stok, utang, pajak, dan jurnal terhubung.
- Selisih blocking menahan posting sampai disetujui.

## Dampak lintas modul

| Domain | Dampak |
|---|---|
| database | MEDIUM |
| inventory | HIGH |
| accounting | HIGH |
| tax | HIGH |
| payment | LOW |
| payroll | NONE |
| sync | MEDIUM |
| security | MEDIUM |
| performance | MEDIUM |

## Test plan

- Integration test PO-inspection-stock movement-payable-journal-tax.
- Inventory test barang rusak tidak menambah available stock.
- Journal debit-credit dan tax period test.
- Idempotency retry test konfirmasi penerimaan.

## Migration plan

Gunakan migration expand-only, jaga parity SQLite dan PostgreSQL, siapkan backfill terpisah, validasi index/query plan, dan jangan memakai db push pada production.

## Rollback plan

Nonaktifkan feature flag bila tersedia, rollback deployment, hentikan consumer baru, dan gunakan compensating operation untuk transaksi yang sudah diposting.

## Monitoring plan

Tambahkan metric sukses/gagal, latency, queue age, retry, structured log, alert threshold, dan masa observasi setelah rilis.

## Security notes

Terapkan autentikasi, permission granular, company/branch scope, perlindungan data sensitif, audit trail, dan larangan menyimpan credential pada source code.

## File yang kemungkinan relevan

- Cari implementasi terkait menggunakan nama modul dan event bisnis.

## Dokumen sumber

- `docs/INBOUND-OUTBOUND-CONTROL.md`
- `docs/ENTERPRISE-ACCOUNTING-TAX.md`
