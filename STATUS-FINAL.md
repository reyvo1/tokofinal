> **SUPERSEDED — historical only.** Current product status is defined solely by `config/product-completeness.json`: `productReady=false`, `humanStage20=PENDING`, `currentPhase=P5 / IMPLEMENTED_RUNTIME_PENDING`. Nothing below claims product readiness.
>
> The 2026-09-22 "UI-P1 through UI-P7 is closed" and "no remaining active work items" statements describe only the UI productization stream as of that date. They were superseded on 2026-09-25 when the P0–P7 product-completion workflow was activated, and they are now factually stale: `work-items/active/` currently holds **4 work items** (3 VERIFICATION, 1 BLOCKED). The "708 PASS" regression count is from 2026-09-22; the current count is 1089. The commit, fingerprint, and build-artifact hashes cannot be verified from the current working copy because it carries no `.git`.
>
> Read `docs/PRODUCT-COMPLETENESS-STATUS.md` and `handoff/CURRENT-WORK.md` (top block) instead.

## Final automation closure — 2026-09-22 (SUPERSEDED by the note above)

UI productization/hardening **UI-P1 through UI-P7 is closed from authoritative GitHub Full System Simulation evidence**.

Final verified source:
- commit: `97346eafe34b1cad9eb24f3072f04d7fd2c0150d`
- regression: **708 PASS**
- Built Browser UAT: **PASS**
- Stage-18 / Stage-19 / Stage-20 automated: **PASS**
- full-system aggregate: **PASS**
- source fingerprint: `328cc5695ff3ab82fa8aaa5dffbbe5828a5e48c1b1f191e852a0881fd7a6c8ad`
- build artifact: `3e5c9d075d12974b4a0e79ae90a639a23ce087549b5aaa4a4616467630b9cbe9`

There are no remaining active UI/productization work items after this closure.

This does **not** claim production readiness. Human Stage-20 UAT remains **PENDING 12/12** and `uat:candidate:verify` must remain fail-closed until valid manual evidence exists. After Human UAT, the remaining release path is UAT-candidate verification, promotion approval/security/DR/provider evidence, production deployment/schema/backup/smoke attestation, then final production-ready verification.


## UI productization checkpoint — UI-P1 (2026-09-22)

Admin information architecture now has canonical routes, runtime-aware navigation, collapsible/searchable shell, breadcrumbs, and company/branch context. Backend/domain foundations remain unchanged. UI-P2+ remains future productization work and must be opened as explicit work items after UI-P1 passes GitHub full-system simulation.
# Toko360 — Status Proyek (2026-08-29)

> **Current continuation update — 2026-09-12:** source-functional closure remains preserved. Release evidence chain is hardened and full dependency-free regression is **565/565 PASS**. Current runtime gates remain fail-closed because this container cannot resolve `registry.npmjs.org`; therefore this tree is **not yet a UAT candidate and not production-ready**. The authoritative status is `handoff/CURRENT-WORK.md`.

> Working hardening update — 2026-09-11: source baseline aktif sudah melewati **Runtime / Staging Certification Hardening**, **UI/UX Final Cleanup**, dan **Protected Runtime/Certification Tooling Hardening**. Full static regression terbaru **342/342 PASS**; mock load runner 300/300 dan mock staging certification 6/6 PASS. Full Next.js/NestJS + PostgreSQL runtime dan visual browser certification tetap wajib dibuktikan di TEST/STAGING setelah dependency tersedia. Lihat `handoff/CURRENT-WORK.md` untuk status terbaru.

## AUTOMATION BACKLOG: 18/18 WORK ITEM SELESAI ✅

> Catatan penting: 18/18 di sini hanya berarti backlog automation/work-item yang terdaftar telah ditutup. Ini **bukan** pernyataan bahwa seluruh fungsi Development Kit sudah lengkap. Functional completeness dilacak terpisah di `docs/FUNCTIONAL-COMPLETENESS-W0-W2.md` dan handoff aktif.
- 18 work item RELEASED + CLOSED (termasuk value pack 2 T360-20260829)
- 1 work item RELEASE_READY: production readiness — DITUNDA, menunggu keputusan deploy Rey

## Value pack 2 (T360-20260829) — selesai
- Laporan peak-hours, dead-stock, customer-rfm
- Export CSV asinkron (worker + download)
- Fondasi promo (PromoRule + preview read-only), riwayat harga produk
- Struk digital: tombol WhatsApp + print CSS
- Endpoint ops-health (outbox/webhook/job)

## Integrasi vendor: DITUNDA (butuh credential)
- Payment gateway (QRIS), ekspedisi, WhatsApp BSP, marketplace sync, e-faktur

## Keamanan batch W0 (semua RELEASED + teruji UAT nyata)
- Tenant isolation, permission guard (86 endpoint ber-metadata)
- Atomic document numbering, idempotency receipts
- Serializable stock transaction + guarded decrement (zero oversell terbukti)
- Fiscal period close enforcement

## Aplikasi LIVE (dev lokal)
| App | Port |
|---|---|
| Admin (dark enterprise) | 3001 |
| POS Kasir | 3002 |
| Portal Karyawan | 3003 |
| Toko Online | 3010 |
| API | 4000 |

## Login seed lokal (development/test saja)
- Akun seed development tersedia melalui canonical seed. UI production-facing tidak lagi mem-prefill credential demo.
- Jangan gunakan credential seed/default pada production.

## Tooling penting
- Gate: `bash scripts/quality-full-safe.sh` (fix EPERM prisma lock Windows)
- Backup drill SQLite compatibility: `node apps/api/scripts/backup-drill.mjs` (delegates to canonical hardened backup/verify/restore tooling; no raw-copy fallback)
- Retention: `node apps/api/scripts/retention-cleanup.mjs`

## Menunggu keputusan Rey
1. Production deployment (VPS/credential)
2. Adapter vendor: payment gateway, ekspedisi, WhatsApp BSP
3. Revisi UI kalau ada yang kurang pas

Repo: github.com/reyvo1/tokojo (branch security/t360-*), semua push tanpa force.


## Runtime finalization checkpoint — 2026-09-11

Source-level runtime bootstrap diperkeras: npm installer lockfile/fail-fast, PostgreSQL production-safe bootstrap seed, canonical promotion permissions, seed-aware DB smoke, dan CI PostgreSQL bootstrap. Full workspace build tetap menunggu registry/dependency tersedia di TEST/STAGING.


## Protected runtime / certification tooling checkpoint — 2026-09-11

Staging sekarang fail-closed untuk JWT/CORS/master encryption key seperti production; webhook protected-environment tidak dikirim tanpa signing secret yang layak; load-test menolak threshold numerik invalid sebelum mengirim traffic. Dependency install nyata tetap tertahan `EAI_AGAIN registry.npmjs.org`, tanpa partial install.


## Recovery tooling compatibility hardening — 2026-09-11

- Legacy `apps/api/scripts/backup-drill.mjs` now resolves repository paths from its own file location and delegates to canonical `scripts/backup-database.mjs`, `verify-backup.mjs`, and `restore-backup.mjs`.
- The legacy raw SQLite copy fallback was removed; active WAL/journal now fails closed through the canonical guard.
- SQLite restore rehearsal requires a fresh target with no existing main/WAL/SHM/journal files.
- PostgreSQL restore isolation normalizes obvious loopback aliases (`localhost`, `127.0.0.1`, IPv6 loopback, trailing-dot localhost) before comparing the active target.
- Retention cleanup resolves repository configuration from the script location and rejects retention windows outside integer 1-3650 days (0/absent remains disabled).
- Dependency-free regression: **342/342 PASS**.

## UI productization checkpoint — 2026-09-22
UI-P1 application shell is CLOSED after GitHub full-system PASS. UI-P2 Admin Domain Workspaces is active in VERIFICATION. Dependency-free regression for the UI-P2 source is **683/683 PASS** on GitHub/Linux-equivalent line endings. No database/schema/business-logic changes are part of UI-P2; heavy Next/browser/runtime validation remains GitHub-authoritative after push.

### UI-P3 verification candidate — 2026-09-22
- Baseline source: `b1c561d97813f5e0916d194e0146cbec147a741e`
- Active work item: `T360-20260922-152500` / VERIFICATION
- Focused POS/UAT regression: 43/43 PASS pada kandidat UI-P3
- Full dependency-free GitHub-equivalent: 688/688 PASS pada kandidat UI-P3
- Human Stage-20 UAT: PENDING 12/12, unchanged

## UI-P4 status
UI-P3 CLOSED berdasarkan GitHub PASS `be8007b`. UI-P4 Storefront productization berada di VERIFICATION. Human Stage-20 UAT tetap PENDING 12/12 dan tidak diubah.

## UI-P5 status
UI-P5 Employee Portal productization berada di VERIFICATION pada baseline `4c336296fde105b425f94cdf4a5ab4968c0d4fb9`. UI-P4 tetap VERIFICATION sampai evidence current-main hijau yang tepat tersedia. Human Stage-20 UAT tetap PENDING 12/12.

## UI-P5 verification note
- Focused UI-P5 static regression: **5/5 PASS**.
- Changed TS/TSX transpile: **4/4 PASS**.
- Existing browser-uat tests were not claimed locally because the user-provided subset snapshot does not contain `scripts/browser-uat.mjs` / workflow files that those tests read.
- GitHub Full System Simulation remains authoritative for authenticated Employee Portal browser/runtime.

## UI-P6 server-driven Admin UI
Phase: VERIFICATION. UI-P4/UI-P5 have full-system PASS evidence at `e37f7feee08f44544c38fa508e69af6e6cb8468f`; Human Stage-20 remains PENDING 12/12 and candidate verification remains fail-closed.

## UI-P7 status
- UI-P6: CLOSED dari full-system green commit `4cac591f0ba27f571e987e07b7343d85dba40241`.
- UI-P7: VERIFICATION.
- Human Stage-20 UAT: tetap PENDING 12/12 dan fail-closed.
