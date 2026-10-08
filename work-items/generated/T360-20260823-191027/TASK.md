# T360-20260823-191027 — Menyelesaikan order website reservasi fulfillment dan pengiriman

## Mulai dari sini

- Work item: `work-items/active/T360-20260823-191027-menyelesaikan-order-website-reservasi-fulfillment-dan-pengir.json`
- Modul: `orders`
- Wave: `W2 — Commerce channels`
- Risiko: `HIGH`
- Fase awal: `ANALYSIS`
- Branch yang disarankan: `feature/t360-20260823-191027-menyelesaikan-order-website-reservasi-fulfillment-dan-pengir`
- Feature flag: `commerce.onlineOrder.enabled`

## Tujuan

Menyelesaikan order website reservasi fulfillment dan pengiriman. Pekerjaan harus mengikuti Development Kit, workflow, tenant isolation, permission, idempotency, audit, serta quality gate repository.

## Aturan bisnis

- Checkout mereservasi stok dengan expiry dan membebaskan reservasi ketika pembayaran gagal.
- Status fulfillment mengikuti state machine dan tidak dapat dilompati tanpa permission.
- Setiap dampak pajak harus memakai tax rule version dan periode berlaku yang dapat diaudit.

## Acceptance criteria

- Order dari website masuk ke branch pemroses dan menghasilkan picking sampai delivery.
- Pembayaran dan pajak diposting tepat satu kali.

## Dampak lintas modul

| Domain | Dampak |
|---|---|
| database | MEDIUM |
| inventory | HIGH |
| accounting | HIGH |
| tax | HIGH |
| payment | HIGH |
| payroll | NONE |
| sync | HIGH |
| security | MEDIUM |
| performance | HIGH |

## Test plan

- E2E checkout-payment-reservation-fulfillment-stock-journal-tax.
- Idempotency webhook dan offline sync test.
- Performance test checkout paralel.

## Migration plan

Gunakan migration expand-only, jaga parity SQLite dan PostgreSQL, siapkan backfill terpisah, validasi index/query plan, dan jangan memakai db push pada production.

## Rollback plan

Nonaktifkan feature flag bila tersedia, rollback deployment, hentikan consumer baru, dan gunakan compensating operation untuk transaksi yang sudah diposting.

## Monitoring plan

Tambahkan metric sukses/gagal, latency, queue age, retry, structured log, alert threshold, dan masa observasi setelah rilis.

## Security notes

Terapkan autentikasi, permission granular, company/branch scope, perlindungan data sensitif, audit trail, dan larangan menyimpan credential pada source code.

## File yang kemungkinan relevan

- `apps/api/src/orders`
- `apps/api/src/orders/dto`
- `apps/api/src/orders/orders.controller.ts`
- `apps/api/src/orders/orders.module.ts`
- `apps/api/src/orders/orders.service.ts`
- `apps/api/src/purchase-orders`
- `apps/api/src/purchase-orders/dto`
- `apps/api/src/purchase-orders/purchase-orders.controller.ts`
- `apps/api/src/purchase-orders/purchase-orders.module.ts`
- `apps/api/src/purchase-orders/purchase-orders.service.ts`

## Dokumen sumber

- `docs/DEVELOPMENT-KIT.md`
- `docs/ASSET-FLEET-OPERATIONS.md`
