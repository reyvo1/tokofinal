# T360-20260823-231401 — Menyelesaikan device bridge dan adapter provider eksternal

## Mulai dari sini

- Work item: `work-items/active/T360-20260823-231401-menyelesaikan-device-bridge-dan-adapter-provider-eksternal.json`
- Modul: `device-bridge`
- Wave: `W6 — Hybrid edge-cloud and integrations`
- Risiko: `HIGH`
- Fase awal: `ANALYSIS`
- Branch yang disarankan: `integration/t360-20260823-231401-menyelesaikan-device-bridge-dan-adapter-provider-eksternal`
- Feature flag: `integrations.deviceBridge.enabled`

## Tujuan

Menyelesaikan device bridge dan adapter provider eksternal. Pekerjaan harus mengikuti Development Kit, workflow, tenant isolation, permission, idempotency, audit, serta quality gate repository.

## Aturan bisnis

- Setiap adapter mengikuti contract, timeout, retry, circuit breaker, dan credential scope.
- Provider callback wajib diverifikasi signature dan diproses idempotent.
- Setiap dampak pajak harus memakai tax rule version dan periode berlaku yang dapat diaudit.

## Acceptance criteria

- Fingerprint, scanner, printer, timbangan, payment, WhatsApp, Telegram, marketplace, dan shipping dapat dipasang melalui adapter.
- Kegagalan provider tidak memblokir transaksi inti yang dapat diantrikan.

## Dampak lintas modul

| Domain | Dampak |
|---|---|
| database | MEDIUM |
| inventory | MEDIUM |
| accounting | LOW |
| tax | LOW |
| payment | HIGH |
| payroll | MEDIUM |
| sync | HIGH |
| security | HIGH |
| performance | MEDIUM |

## Test plan

- Adapter contract test dan simulated timeout.
- Webhook idempotency/retry test.
- Offline device queue conflict test.
- Security test credential rotation dan signature.
- Inventory movement dan rekonsiliasi stok test sesuai scope pekerjaan.
- Journal debit-credit dan idempotent posting test sesuai event pekerjaan.

## Migration plan

Gunakan migration expand-only, jaga parity SQLite dan PostgreSQL, siapkan backfill terpisah, validasi index/query plan, dan jangan memakai db push pada production.

## Rollback plan

Nonaktifkan feature flag bila tersedia, rollback deployment, hentikan consumer baru, dan gunakan compensating operation untuk transaksi yang sudah diposting.

## Monitoring plan

Tambahkan metric sukses/gagal, latency, queue age, retry, structured log, alert threshold, dan masa observasi setelah rilis.

## Security notes

Terapkan autentikasi, permission granular, company/branch scope, perlindungan data sensitif, audit trail, dan larangan menyimpan credential pada source code.

## File yang kemungkinan relevan

- `packages/plugin-sdk/examples/device-bridge.template.ts`

## Dokumen sumber

- `docs/EXTENSION-GUIDE.md`
- `docs/FINGERPRINT-INTEGRATION.md`
- `docs/AUTOMATION-RULEBOOK.md`
