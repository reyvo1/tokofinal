# T360-20260823-224136 — Menyelesaikan absensi fingerprint foto GPS dan geofence

## Mulai dari sini

- Work item: `work-items/active/T360-20260823-224136-menyelesaikan-absensi-fingerprint-foto-gps-dan-geofence.json`
- Modul: `attendance`
- Wave: `W4 — HR and payroll`
- Risiko: `HIGH`
- Fase awal: `ANALYSIS`
- Branch yang disarankan: `integration/t360-20260823-224136-menyelesaikan-absensi-fingerprint-foto-gps-dan-geofence`
- Feature flag: `hr.attendance.enabled`

## Tujuan

Menyelesaikan absensi fingerprint foto GPS dan geofence. Pekerjaan harus mengikuti Development Kit, workflow, tenant isolation, permission, idempotency, audit, serta quality gate repository.

## Aturan bisnis

- Fingerprint mentah tidak disimpan; hanya credential reference vendor.
- Foto dan lokasi mempunyai retention, access scope, dan audit trail.
- Event offline diproses idempotent berdasarkan device dan sequence.
- Setiap dampak pajak harus memakai tax rule version dan periode berlaku yang dapat diaudit.

## Acceptance criteria

- Fingerprint, selfie, GPS, geofence, shift, koreksi, dan approval menghasilkan attendance record konsisten.
- Karyawan hanya melihat data absensi sendiri.

## Dampak lintas modul

| Domain | Dampak |
|---|---|
| database | MEDIUM |
| inventory | NONE |
| accounting | LOW |
| tax | LOW |
| payment | NONE |
| payroll | HIGH |
| sync | HIGH |
| security | HIGH |
| performance | MEDIUM |

## Test plan

- Device adapter contract test.
- Offline sync retry/idempotency test.
- Payroll attendance input integration test.
- Security test foto privat dan employee self-scope.
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

- `apps/api/src/attendance`
- `apps/api/src/attendance/attendance.controller.ts`
- `apps/api/src/attendance/attendance.module.ts`
- `apps/api/src/attendance/attendance.service.ts`
- `apps/api/src/attendance/dto`
- `packages/plugin-sdk/examples/attendance-media-storage.template.ts`
- `docs/HRIS-ATTENDANCE-PAYROLL.md`

## Dokumen sumber

- `docs/HRIS-ATTENDANCE-PAYROLL.md`
- `docs/BIOMETRIC-LOCATION-SECURITY.md`
- `docs/FINGERPRINT-INTEGRATION.md`
