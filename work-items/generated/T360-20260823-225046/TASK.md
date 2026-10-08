# T360-20260823-225046 — Menyelesaikan trip manifest outbound inspection gate pass COD dan retur

## Mulai dari sini

- Work item: `work-items/active/T360-20260823-225046-menyelesaikan-trip-manifest-outbound-inspection-gate-pass-co.json`
- Modul: `delivery-trip`
- Wave: `W5 — Assets, fleet, and operational control`
- Risiko: `CRITICAL`
- Fase awal: `ANALYSIS`
- Branch yang disarankan: `feature/t360-20260823-225046-menyelesaikan-trip-manifest-outbound-inspection-gate-pass-co`
- Feature flag: `operations.deliveryControl.enabled`

## Tujuan

Menyelesaikan trip manifest outbound inspection gate pass COD dan retur. Pekerjaan harus mengikuti Development Kit, workflow, tenant isolation, permission, idempotency, audit, serta quality gate repository.

## Aturan bisnis

- Barang tidak keluar sebelum scan sama dengan manifest dan gate pass disetujui.
- Kendaraan gagal inspeksi blocking tidak dapat dispatch.
- COD, barang kembali, kerusakan, dan selisih diposting secara idempotent.
- Setiap dampak pajak harus memakai tax rule version dan periode berlaku yang dapat diaudit.

## Acceptance criteria

- Trip, driver, vehicle, manifest, loading, gate pass, proof of delivery, COD, dan return terhubung.
- Inventory movement mengikuti setiap perubahan custody barang.

## Dampak lintas modul

| Domain | Dampak |
|---|---|
| database | HIGH |
| inventory | HIGH |
| accounting | HIGH |
| tax | MEDIUM |
| payment | HIGH |
| payroll | LOW |
| sync | HIGH |
| security | HIGH |
| performance | MEDIUM |

## Test plan

- E2E order-outbound inventory movement-trip-delivery-COD-journal.
- Vehicle blocking inspection test.
- Offline sync retry/conflict test.
- Payment dan accounting idempotency test.

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

- `docs/ASSET-FLEET-OPERATIONS.md`
- `docs/INBOUND-OUTBOUND-CONTROL.md`
