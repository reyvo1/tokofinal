# Toko360 Full GitHub UAT Contract

## Tujuan

GitHub adalah authoritative automated full-system simulation untuk kandidat source Toko360. Gate ini tidak menggantikan Human Stage-20 UAT, tetapi wajib membuktikan source, database upgrade, build artifact, API routing, browser interaction, tenant/runtime workflows, asynchronous worker/reporting, provider integration, load/index/DR, dan evidence identity pada commit yang sama.

## Prinsip fail-closed

- Tidak ada test, assertion, lint, migration, security, tenant, browser, provider, load, atau DR gate yang boleh dilemahkan agar hijau.
- `continue-on-error` hanya boleh dipakai untuk mengumpulkan diagnostic evidence; final aggregate/enforce step tetap wajib gagal jika required gate gagal.
- Human Stage-20 tidak pernah diubah menjadi PASS oleh automation.
- External-provider live tests tidak boleh memakai production credential atau production tenant.

## Automated full-system chain

1. Repository structural audit membaca seluruh auditable tree dan menginventarisasi controller/API handler, Prisma model, migration, workflow, test, document, dan seluruh source UI.
2. UI interaction audit menginventarisasi seluruh tombol/link/interactive control pada Admin, POS, Storefront, dan Employee Portal. Native `alert`, `confirm`, `prompt`, decorative gradient, primary horizontal-scroll navigation, dan inert control adalah blocker.
3. Expand migration rehearsal menjalankan upgrade baseline source sebelumnya ke schema saat ini pada PostgreSQL scratch database.
4. PostgreSQL staging schema + hardened bootstrap seed disiapkan.
5. Exact build gate menjalankan lint/typecheck, regression, SQLite compatibility DB smoke, PostgreSQL client generation, dan enam production builds.
6. Built Browser UAT menjalankan exact built artifact dan membuka seluruh operator surfaces.
7. Browser UAT melakukan route/workspace sweep dan geometry check pada 1440x900, 1024x768, dan 390x844. Horizontal page overflow atau visible element keluar viewport adalah FAIL. Success/failure screenshots disimpan sebagai evidence.
8. Runtime OpenAPI sweep membaca `/docs-json` lalu mengeksekusi seluruh documented HTTP method/path terhadap exact API runtime. Router-level 404/`Cannot METHOD`, 5xx, atau unreachable endpoint adalah blocker. Validation/domain 4xx untuk synthetic invalid payload bukan semantic PASS dan tetap dilengkapi dedicated critical lifecycle tests.
9. Notification provider probe menjalankan jalur API -> PostgreSQL -> Notification queue -> Worker -> Telegram/WhatsApp adapter -> localhost provider simulator -> delivery status, termasuk owner daily digest dan idempotency header.
10. Worker/report probe membuktikan DB-polling worker dan report output dari exact runtime.
11. Stage-18, Stage-19, payroll migration, automated Stage-20, staging certification, load smoke, index profile, dan DR rehearsal tetap authoritative.
12. Aggregate summary hanya PASS bila seluruh required automated gate source-bound dan artifact-bound PASS.

## Telegram nyata

Deterministic provider simulator adalah mandatory karena dapat direproduksi dan tidak bergantung layanan luar. Untuk membuktikan credential/network Telegram nyata, manual `Toko360 Full Automated UAT` menyediakan input `run_live_telegram`.

Bila diaktifkan, job `Optional LIVE Telegram Provider` memakai protected GitHub Environment `provider-uat` dan dua secret:

- `T360_LIVE_TELEGRAM_BOT_TOKEN`
- `T360_LIVE_TELEGRAM_CHAT_ID`

Job mengirim satu pesan uji langsung ke Telegram API dan menyimpan evidence yang hanya berisi hash chat identity, HTTP status, message id, GitHub run id, dan commit SHA. Token/chat id mentah tidak ditulis ke artifact. Gate ini tidak menyentuh production database atau production tenant.

## Evidence minimum

- `handoff/quality/full-repository-audit-latest.json`
- `handoff/quality/ui-interaction-audit-latest.json`
- migration rehearsal output
- build artifact manifest
- browser UAT JSON + success/failure screenshots
- `handoff/quality/github-api-runtime-sweep-latest.json`
- `handoff/quality/github-notification-provider-probe-latest.json`
- worker/report evidence
- Stage-18/19/20 evidence
- staging/load/index/DR evidence
- optional `handoff/quality/github-live-telegram-smoke-latest.json`

## Human boundary

Automated GitHub UAT dapat menyatakan automated system candidate PASS sementara Human Stage-20 tetap PENDING. Final release candidate baru boleh dipromosikan setelah manusia menyelesaikan scenario operator pada exact tested build artifact dan memberikan approval terikat artifact yang sama.
