# T360-20260823-230058 — Membangun sinkronisasi dua arah server toko dan pusat

## Mulai dari sini

- Work item: `work-items/active/T360-20260823-230058-membangun-sinkronisasi-dua-arah-server-toko-dan-pusat.json`
- Modul: `sync-protocol`
- Wave: `W6 — Hybrid edge-cloud and integrations`
- Risiko: `CRITICAL`
- Fase awal: `ANALYSIS`
- Branch yang disarankan: `feature/t360-20260823-230058-membangun-sinkronisasi-dua-arah-server-toko-dan-pusat`
- Feature flag: `hybrid.sync.enabled`

## Tujuan

Membangun sinkronisasi dua arah server toko dan pusat. Pekerjaan harus mengikuti Development Kit, workflow, tenant isolation, permission, idempotency, audit, serta quality gate repository.

## Aturan bisnis

- Setiap data mempunyai system of record dan conflict policy.
- Sync envelope ditandatangani, idempotent, mempunyai checkpoint, receipt, retry, dan dead letter.
- Inventory disinkronkan sebagai movement, bukan menimpa saldo akhir.
- Setiap dampak pajak harus memakai tax rule version dan periode berlaku yang dapat diaudit.

## Acceptance criteria

- Server toko tetap beroperasi offline dan menyinkronkan transaksi saat koneksi kembali.
- Master data pusat turun ke toko tanpa menimpa transaksi lokal yang sah.

## Dampak lintas modul

| Domain | Dampak |
|---|---|
| database | HIGH |
| inventory | HIGH |
| accounting | HIGH |
| tax | HIGH |
| payment | HIGH |
| payroll | HIGH |
| sync | HIGH |
| security | HIGH |
| performance | HIGH |

## Test plan

- Offline 8 jam lalu sync retry/idempotency test.
- Conflict test harga, customer, inventory movement, journal, tax, payroll, dan payment.
- Security test signature replay dan credential rotation.
- Performance test batch sync besar.

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

- `docs/DEVELOPMENT-KIT.md`
- `docs/AUTOMATION-RULEBOOK.md`
- `docs/SESSION-HANDOFF.md`
