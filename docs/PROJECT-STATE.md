> **Canonical product status:** `config/product-completeness.json` is the only machine-readable completion authority. Historical recovery/F1/F12 status below is evidence/context, not proof of product completeness.
>
> **Counting rule for this file:** every number below is the count *at the time that wave was authored* and is kept as a historical record. The live counts are regenerated from source by `npm run audit:p5:visual` into `config/p5-full-ui-root-audit.json` and are currently **36 controllers / 454 API handlers / 180 Prisma models / 63 contextual destinations / 420 interactive controls**, with **1089/1089** dependency-free tests passing. Do not treat a number in a dated section as a current one.
>
> **This copy has no `.git`.** Commit SHAs and source fingerprints below are notes from the originating machine and cannot be verified from here.

# Toko360 Project State

## Official checkpoint

```text
RC0.5.3.1_EMBEDDED_INSTRUCTIONS_DYNAMIC_CHAT_HANDOFF
```

## Baseline

- Version: 0.5.3
- Development profile: SQLite, tanpa Docker
- Production profile: PostgreSQL
- GitHub PostgreSQL validation: tersedia
- Development workflow: aktif
- One-click work automation: aktif
- Embedded system instructions: aktif, maksimal 8.000 karakter
- Dynamic first-chat/session handoff: aktif
- Active work items: lihat `work-items/active/`
- Completed work items: lihat `work-items/completed/`

## Source of truth

1. `instructions/SYSTEM-INSTRUCTIONS.md`
2. `docs/DEVELOPMENT-KIT.md`
3. `docs/DEVELOPMENT-WORKFLOW.md`
4. `config/module-delivery-map.json`
5. `config/workflow-policy.json`
6. Work item aktif
7. Commit/tag checkpoint resmi

## 2026-09-26 — P4 runtime closure / P5 FULL visual rebuild

P4 is **RUNTIME_VERIFIED** on exact-source commit `d305ade2050765de86c7f5ef1c54eb7426c5e25b`, source fingerprint `cf6165fcc74e94abb3866230aa1764cee9487d4de6b630377465d20bda7d9246`. P4 canonical ownership, Stage-19, automated Stage-20, R8, full-system aggregate and Automated UAT are green on this source. A-10 is closed and P0-P4 source is frozen absent regression evidence. Human Stage-20 remains separately PENDING.

P5 is now **IMPLEMENTED_RUNTIME_PENDING** as one full visual-product wave across Admin, POS, Storefront and Employee Portal. `config/p5-visual-surface-map.json` defines 14 Admin primary workspaces, 13 representative contextual routes, 4 POS views, 5 Storefront views, 7 Employee Portal views, and the 1440/1024/390 responsive matrix. `audit:p5:visual` fails closed on source-contract regressions; both heavy GitHub workflows require `ci:p5:probe` against exact-source Browser UAT screenshot evidence. Automated P5 evidence must keep human visual acceptance explicitly PENDING until human review is recorded.

P5 V1 and V2 automated candidates passed exact-source automation but were **REJECTED** by human runtime review. P5 V3/V3.3 also failed the human visual bar: screenshots still showed a legacy-skin feel, weak composition, and POS/Admin presentation that did not demonstrate the requested professional redesign. P5 V4 is therefore active as **ONE P5 FULL V4 TOTAL PRESENTATION REBUILD**. Four product shells and compatibility layers are replaced together with Tailwind CSS v4, runtime identity is verified from computed styles rather than screenshot existence alone, and business/API/permission/domain authority remains frozen. Canonical V4 contract: `config/p5-v4-total-ui-rebuild.json` + `docs/P5-V4-TOTAL-PRESENTATION-REBUILD.md`. Per explicit operator instruction, V4 must be reviewed locally for a visible change **before any commit/push**; P6 remains blocked until V4 local visual acceptance and exact-source automation both pass.

## Planned post-completion expansion

After the current P0-P7 product-completion program reaches Human Stage-20 acceptance and `PRODUCT_READY = true`, the next planned program is **POST-1 — Hybrid Multi-Branch Edge Operations**. Canonical plan: `docs/TOKO360-POST-COMPLETION-HYBRID-BRANCH-WORKFLOW.md`. It covers one local TOKO360 server per store/branch plus central hosting sync, local-first continuity, mobile/PWA + Telegram stock operations, and multi-device LAN barcode price-check kiosks. POST-1 is planning-only now and must not interrupt P4-P7.

## Aturan melanjutkan

- Jangan memakai ZIP/checkpoint yang lebih lama sebagai baseline.
- Jalankan `npm run workflow:validate` dan `npm run validate:repo` sebelum perubahan.
- Gunakan `npm run chat:handoff` sebelum berpindah chat; untuk akun baru jalankan `npm run chat:system` terlebih dahulu.
- Jangan mengubah database production dengan `db push`, reset, atau seed demo.
- Perbarui file ini hanya ketika checkpoint resmi baru diterbitkan.

## Active reopening — 2026-09-24 F12R4

Human visual acceptance kembali menolak presentasi F12R3 karena information architecture masih bertumpuk, beberapa capability sulit ditemukan, dan usability operator belum layak. Work item aktif `T360-20260923-221011` kini melakukan full UI architecture rebuild: satu Admin primary sidebar + satu contextual subnav, explicit Tenant/Organization, Settings/Access, Integrations/Notifications (Telegram/WhatsApp), AI/Automation, dan canonical Tailwind CSS v4 pada empat frontend. Deep GitHub Full UAT dari F12R3 tetap dipertahankan dan tidak boleh dilemahkan. Semua automated green evidence sebelum source rebuild ini adalah historical evidence dan tidak boleh dipakai untuk menyatakan source baru release-ready; Human Stage-20 tetap BLOCKED sampai visual acceptance baru lulus.

## Recovery R0 — 2026-09-24

Deep functional/UI/workflow audit reopened product completeness after human inspection and source reconciliation found 48 explicit gaps across truth/governance, tenant/access, HR/payroll, reporting/integrations, core hidden flows, assets/fleet, scale/AI, UI information architecture, and runtime UAT depth. The authoritative recovery work item is `T360-20260924-020700`. `config/recovery-finding-matrix.json` maps **48/48 findings, 0 unmapped** to R0–R8.

Current source baseline is HEAD `c391fc9fd8c42cb6352317853718cba1415a9603` plus the preserved uncommitted F12R4 working-tree changes. F12R4 work item `T360-20260923-221011` is now **BLOCKED**, not rejected or reverted: its presentation changes remain available, but final UI verification cannot resume until R1–R6 functional/operator-flow prerequisites stabilize.

Current generated counts: 180 Prisma models, 405 API handlers, 295 UI interactive elements; `audit:recovery` fails closed when these source-shape counts change without regenerating the R0 recovery matrix. Human Stage-20 remains BLOCKED/PENDING and no historical green run may be used as release evidence for recovered source.

## Recovery R1 — 2026-09-24

R1 is **CLOSED** on exact GitHub runtime commit `abac92662cab4cc7352de4f9f9d2e2419aad9c29`. Full System Simulation, Full Automated UAT, `ci:r1:probe`, PostgreSQL migration rehearsal, exact six-app build, runtime API sweep, Built Browser UAT, Telegram/WhatsApp provider simulation, worker/report probe, Stage-18, Stage-19, automated Stage-20, and aggregate automated gates passed on current R1 source. Human Stage-20 remains a separate PENDING gate and was not replaced by automation.

F07–F10 are runtime-closed by that evidence. No UAT assertion was weakened to obtain green; the final R1 fixes corrected real mobile layout, canonical nested navigation, and runtime-origin consistency while keeping fail-closed browser/provider gates intact.

## Recovery R2 — 2026-09-24

R2 is **CLOSED** on current green GitHub runtime evidence. The exact current-source chain passed `ci:r2:probe`, PostgreSQL runtime, six-app build, Built Browser UAT, Telegram/WhatsApp provider simulation, Stage-18, Stage-19, automated Stage-20, and aggregate gates. Human Stage-20 remains separate/PENDING. F11–F21 are runtime-closed for recovery sequencing.

## Recovery R3 — 2026-09-24

R3 is **IMPLEMENTATION** under `T360-20260924-195500-recovery-r3-reporting-integrations`. Scope is F22–F25, F29, F37, F39, F42–F44. The first implementation cluster fixes owner digest at the root: operator configuration is exposed, POST config/send require `notification.manage`, disabled digest cannot be manually sent, low-stock uses each product `minStock` without the old `available <= 10` prefilter, and configured recipients are verified/non-revoked Telegram `EmployeeChannelBinding` IDs rather than raw destination strings.

The GitHub provider simulation is strengthened to create and verify an employee Telegram binding through the real Employee Self-Service API and provider simulator before configuring/sending the owner digest. R3 remains open until the remaining integration/operator findings and current-source runtime/browser/provider evidence pass.

## Recovery R4 — 2026-09-24

R4 automated runtime is **CLOSED** on exact green baseline `4963f8acdf8b5a63a8cc79caad5162dcf26c3808`. R3 remains independently OPEN. R4 uses existing domain authority rather than replacing it: InventoryMovement remains append-only ledger truth, goods-receipt rejection remains pre-posting only, General Ledger reads posted journals, and promotion checkout remains server authoritative.

The only R4 schema expansion is `Supplier.isActive Boolean @default(true)` with SQLite/PostgreSQL parity. Inactive suppliers are excluded from new procurement but historical supplier transactions remain readable. Storefront environment branch code is bootstrap fallback; runtime users may switch among active sibling branches discovered from a current valid branch anchor. Human Stage-20 remains PENDING and separate from automated closure.

## Recovery R5 — 2026-09-25

R5 is **VERIFICATION** under `T360-20260925-000500-recovery-r5-assets-fleet`. Master scope is F31 `AssetMaintenancePlan` management, F32 `VehicleDriverAssignment` lifecycle, and F33 asset assign/transfer/dispose operator flow. R5 depends only on closed R1, so open R3 findings F29/F37/F39/F42/F43 do not block this wave.

R5 reuses the existing AssetMaintenancePlan and VehicleDriverAssignment schemas with no migration. Admin now exposes maintenance-plan lifecycle, driver assignment lifecycle, asset assignment, explicit Asset handover inspection, transfer, and disposal/sale. Transfer/disposal still require a PASSED/APPROVED inspection; the UI does not auto-pass the gate. F31/F32/F33 remain OPEN_REVALIDATION_REQUIRED until the new exact-source PostgreSQL `ci:r5:probe` and aggregate GitHub gates pass. Human Stage-20 remains PENDING.

## 2026-09-25 — R5 runtime closure / R6 verification

R5 F31/F32/F33 is runtime-closed on origin/main commit `708d34cb7afd259c507844cadf065b23029797ec`. GitHub `ci:r5:probe` PASS is bound to source fingerprint `91f5b3910bed430d5a682fb53a3ce8baf050884674be56269eb39af309781655` (629 files); both full-system workflows are green and Human Stage-20 remains PENDING.

R6 is now the active recovery wave. F26-F29 are source-implemented but require exact PostgreSQL runtime evidence before closure. F30 is recognized as runtime-closed by the R4 AccountingCloseControl close/block/reopen/post probe. R3 remains open for F37/F39/F42/F43; F29 moves to R6 verification because its secondary-wave runtime contract is now implemented here.

## 2026-09-25 — R6 runtime closure / R3 residual verification

R6 F26/F27/F28/F29 is **RUNTIME CLOSED** on exact GitHub commit `bd4abf386c56bce283f10c08ff988ea109909b54`, source fingerprint `1d07234c2f58891d1cf95309c65d4465d8c1bb4cb67b77bc4e9e233ae2c274c6` (631 files). Full System Simulation, Full Automated UAT, `ci:r6:probe`, aggregate release gates, and automated Stage-20 PASS. F30 remains runtime-closed by canonical R4 AccountingCloseControl evidence. Human Stage-20 remains **PENDING 12/12** and is not replaced by automation.

R3 is now **VERIFICATION** for residual F37/F39/F42/F43. Admin Integrations exposes payment-provider diagnostics, multi-outlet and cashier-target reporting, device sync receipt/offline-transaction diagnostics with acknowledgement/requeue operations, and marketplace order list/import. The new device diagnostics read route is authenticated tenant/branch scoped. Both PostgreSQL GitHub workflows execute `ci:r3:residual-probe`; these four HIGH findings remain `SOURCE_IMPLEMENTED_RUNTIME_EVIDENCE_PENDING` until exact-source runtime evidence passes. R7 remains blocked on R3 closure.

## 2026-09-25 — R3/R4 closure and R7 verification

Exact checkpoint `abac92662cab4cc7352de4f9f9d2e2419aad9c29` / source fingerprint `5006faaa354e32cdcfd952388a8dff76c712693835178ff53ff918875bf22615` passed Full System Simulation, Full Automated UAT, R3 residual probe, R4 core-business probe, provider/runtime gates, and automated Stage-20. R3 residual F37/F39/F42/F43 and R4 F34/F35/F36/F38/F40/F41 are therefore runtime-closed for sequencing. Human Stage-20 remains PENDING and separate.

R7 is now **VERIFICATION** under `T360-20260923-221011`. Primary scope is F45 canonical chart strategy and F46 final information architecture/operator discoverability. Admin retains exactly one primary sidebar plus one contextual secondary navigation. Dashboard analytics now use reusable canonical chart primitives rather than ad-hoc SVG colors/gradient behavior. Both PostgreSQL workflows require `ci:r7:probe`, which consumes exact-source Browser UAT evidence for all 14 Admin workspaces, contextual destinations, canonical analytics, screenshot evidence, and responsive no-overflow matrices across Admin, POS, Storefront, and Employee Portal. R8 must not start until this atomic R7 wave is committed/pushed/clean and exact-source R7 Browser UAT evidence passes.

## 2026-09-25 — R8 source implementation

R8 source implementation is prepared on checkpoint `5c9558c65a95a5000482decfc0f9185de042ffe3` while R7 remains exact-source VERIFICATION. F04/F05 now have explicit source-contract versus runtime-evidence separation; F06 has mandatory two-domain safe Browser mutation evidence; F23/F24/F25/F44 have a dedicated PostgreSQL runtime probe with cleanup/restoration. Both GitHub PostgreSQL workflows are wired for R8 reporting/security and final exact-source release evidence. R8 must not be classified CLOSED until current-source R7 and R8 GitHub evidence are PASS. Human Stage-20 remains PENDING.

## 2026-09-25 — Post-audit Product Completion Workflow activated

The 957/957 full functional/UI/script audit supersedes automated-R0-R8-green as the definition of product completeness. Automated recovery evidence remains valid engineering evidence, but the product is classified **NOT FUNCTIONALLY COMPLETE / NOT HUMAN-UI ACCEPTED** until the new P0-P7 product-completion workflow closes.

Active workflow: `docs/TOKO360-MASTER-PRODUCT-COMPLETION-WORKFLOW.md`.

Immediate order: P0 truth/security/hygiene -> P1 Admin contextual workflow isolation -> P2 Multi-UOM + payroll completeness -> P3 hidden capability productization -> P4 canonical/legacy cleanup -> P5 page-level visual rebuild -> P6 Ubuntu/operator hygiene -> P7 exact-runtime + Human Stage-20 acceptance.

Historical `docs/TOKO360-MASTER-RECOVERY-WORKFLOW.md` remains preserved as recovery history and runtime evidence sequencing, but does not override the new product-completion verdict or permit source-marker/browser-no-overflow evidence to substitute for real operator/human acceptance.

## 2026-09-26 — P3 runtime closure / P4 implementation history

P3 A-05/A-06/A-08/A-11 is **RUNTIME_VERIFIED** on exact commit `c61273e99104c0dbdc61ee4790379d4ed2edd8a3`, source fingerprint `cfe0323c096eb253730c1751e37ecc3a0b4e77853d3048360271ed97e360f8c5`. Both heavy GitHub workflows report P3 productization success; full-system aggregate and Automated UAT PASS. Human Stage-20 remains PENDING and separate.

P4 subsequently removed verified-unused `/sale-returns*` and `/purchase-returns*` compatibility routes, retained `/returns/*` as the only return mutation authority, and documented nine required domain owners/source-of-truth contracts. P4 is now runtime-closed by the newer exact-source P4 checkpoint recorded above; this section is historical implementation context only.

## P1 Admin contextual workflow isolation — 2026-09-25
- P0 atomic source is complete; active product-completion phase moved to P1.
- 62/62 Admin contextual destinations now have explicit canonical renderer mappings in `config/admin-contextual-workflow-map.json`; Customer is split from Category/Subcategory after operator discoverability review.
- Six previously non-isolated workspaces and two partial workspaces now route active contextual destinations into dedicated component modes.
- P1 canonical navigation root and 62-route category/customer correction are runtime-verified by green exact-source Browser/R7 evidence. Human IA/Stage-20 acceptance remains a separate pending gate; user explicitly authorized continuation into Product Completion phases while preserving that human-pending truth.

## 2026-09-25 — P1 runtime verification / P2A Multi-UOM source implementation

P1 canonical Admin routing including the 62-route Master Data Category/Subcategory vs Customer split is runtime-verified on exact-source commit `abac92662cab4cc7352de4f9f9d2e2419aad9c29`: Browser UAT, Built Browser UAT, R7/R8, worker/API/runtime sweeps, Stage-18, Stage-19, automated Stage-20 and aggregate gates passed. Human IA/Stage-20 acceptance remains a separate PENDING gate and is not replaced by automation. The user explicitly instructed continuation, so current implementation work advances to P2 while preserving that human-pending truth.

P2A source implementation centralizes POS/storefront selling-UOM resolution in `apps/api/src/common/transaction-uom.ts`; expands OrderItem, OrderReturnItem, SaleReturnItem and PurchaseReturnItem with immutable UOM lineage; keeps inventory/serial/batch quantities in integer base units; carries selling-UOM snapshots into shipment/accounting traceability; and makes Storefront product/cart/return flows UOM-aware. Historical return/refund logic copies source snapshots and never reconstructs OrderReturn conversion from current ProductUnit configuration. A-03 is `IMPLEMENTED_RUNTIME_PENDING` until the required exact-source PostgreSQL mixed-UOM order -> fulfill -> ProductUnit-change -> return/refund journey passes with inventory/accounting/tax invariants.


## 2026-09-25 — P2 FULL source implementation

P2 is now executed as one atomic delivery wave rather than separate operator-facing P2A/P2B waves. Multi-UOM persistence/runtime proof and Payroll method/split-period completeness ship together. P2 source adds historical transaction-UOM authority and required mixed-UOM PostgreSQL probe; Payroll adds executable GROSS/GROSS_UP/NET, temporal amount allocation for effective-dated component/profile/rule changes, operator method selection, and an exact-source PostgreSQL probe that posts payroll, settles salary, creates a post-payment differential adjustment, creates employee-receivable recovery, and settles that recovery.

A-03 and A-04 remain `IMPLEMENTED_RUNTIME_PENDING` until both dedicated P2 runtime evidence files pass on the exact source. P3 must not start until the P2 FULL wave is committed/pushed/clean and aggregate exact-source GitHub evidence is green. Human Stage-20 remains PENDING and is not auto-promoted by P2.

## 2026-09-26 — P2 RUNTIME_VERIFIED / P3 FULL source implementation

P2 FULL is runtime-verified on exact-source commit `899685ce23c08c8a0246867afc0c78a36507e674`, source fingerprint `36af0df55489492e4389f7bf0a511bbaa60cae761937b77edcd310003cdfa04d`. Dedicated P2A mixed-UOM and P2 Payroll probes, Stage-19 (11/11), payroll staging, automated Stage-20, R8 and aggregate all PASS across the supplied GitHub evidence. A-03 and A-04 are now `RUNTIME_VERIFIED`. Human Stage-20 remains separately PENDING.

P3 FULL is implemented as one large wave covering A-05 retention/archive productization, A-06 API-key/session security lifecycle, A-08 capability maturity truth, and A-11 daily-summary ownership. Settings now contains a Data Governance operator workspace; API Keys supports explicit rotation; Security exposes active-session inventory/revoke/logout-all; runtime feature metadata distinguishes enabled state from maturity and preserves maturity truth through scoped overrides; Daily Summary ownership is explicitly `ADMIN_EXPLICIT`. A dedicated exact-source `ci:p3:probe` is mandatory in both heavy GitHub workflows and aggregate evidence. P3 remains `IMPLEMENTED_RUNTIME_PENDING` until that probe is green on the same source.

P5 V3.1 exact-source GitHub verification on commit `17539ad56114432ee940ab640612f7983294515f`, fingerprint `2a546c4ead9510eb936220b2698f580569ef86d4fe32e950cbbe140503be6e26`, passed build/source regression and the P5 V3 Tailwind source audit, but Built Browser UAT exposed a real mobile POS geometry regression at 390x844 (`scrollWidth=410-421`). P5 V3.2 is a presentation-only root fix: the POS topbar stacks below `sm`, warehouse/actions are explicitly shrink/wrap-safe, and permanent UI-P3/P5 V3 audits reject the prior intrinsic-width pattern. R7/P5/R8-release/aggregate failures are downstream of this Browser blocker and are not patched independently. P6 remains blocked.

## P5 V3.3 Admin shell grid-placement root fix — 2026-09-26
- Human runtime screenshot after green V3.2 automation exposed a severe Admin composition regression: the sidebar rendered in the second desktop grid column while the main workspace auto-placed into a narrow first-column row, leaving most of the viewport blank.
- Root cause was not Tailwind cosmetics: `app-shell.tsx` used the outer `.shell` itself as the desktop grid and contained a literal `/* compatibility source marker: className=\"sidebar */` text node. That text became an anonymous CSS-grid item, shifting sidebar/main auto-placement even though overflow-only Browser checks remained green.
- V3.3 removes the literal marker, moves the desktop two-column grid into a dedicated `data-admin-layout=\"primary\"` wrapper with only semantic layout children, and makes `.main` explicitly full-width/min-width-zero.
- Browser UAT now verifies Admin sidebar/main geometry at 1440/1024/390, not merely horizontal overflow; source audit/tests reject outer-shell grid ownership or literal source-marker nodes. Business/API/domain authority remains frozen and P6 remains blocked pending exact-source automation plus Human Visual Acceptance.

## P5 FULL V4 total presentation rebuild — 2026-09-26

Human review rejected the V3/V3.3 runtime despite prior automated green because the suite still looked like a legacy skin and did not show a sufficiently clear modern product identity. The user explicitly overrode the prior restrained/no-gradient visual direction and required a total presentation rebuild based on external modern UI references rather than additional CSS patching.

V4 is therefore the active P5 candidate. It rebuilds the four product shells and compatibility presentation layers while freezing business/API/permission/domain authority. Admin now uses a semantic dark command sidebar with a bright floating workspace; POS is explicitly bright and touch-first; Storefront uses a warm premium retail identity; Employee Portal uses a distinct violet self-service identity.

Permanent gate upgrades add computed runtime visual-identity checks (`P5_V4_*_VISUAL_IDENTITY`) in Browser UAT and require them in `ci:p5:probe`, in addition to the existing screenshot matrix, responsive matrices and Admin semantic geometry. Human Visual Acceptance remains PENDING and P6 remains BLOCKED.

## P5 V4.3 — deterministic Next typecheck isolation

V4.2 local verification exposed a verification-infrastructure race in Next.js generated types: standalone TypeScript checks were reading `.next/dev/types` while `next typegen` generated `.next/types`. P5 V4.3 isolates all four Next workspaces from mutable development artifacts during lint/typecheck by using a shared runner plus `tsconfig.typecheck.json`. Presentation/business semantics are unchanged; P6 remains blocked pending V4 local visual acceptance and exact-source closure.
## 2026-09-26 — P5 V4.4 deterministic Next build ownership

V4.3.1 proved the prior isolation was incomplete: standalone lint/typecheck no longer consumed `.next/dev/types`, but `next build` still used the same `.next` tree and could ingest stale/live dev-generated route types. P5 V4.4 makes the shared Next workspace runner the authority for both typecheck and production build on all four Next products. Production build now fails early if a live `next dev` lock belongs to an active PID, otherwise removes only stale generated `.next/dev` before invoking `next build`, then verifies production `.next/types` exists and no dev type tree reappeared. No UI/business/API/domain contract is changed.

## 2026-09-26 — P5 V4.5 phase-isolated generated-type authority

The repeated Employee Portal production-build failures are traced to Next 16 generated-type ownership rather than application route source. The previous V4.3 standalone `tsconfig.typecheck.json` did not govern the real `next build`, while V4.4 cleanup alone did not make Next's own build type input phase-specific.

V4.5 uses the framework-supported custom TypeScript config boundary: each Next product keeps `tsconfig.json` for development and uses `tsconfig.build.json` for non-development Next phases via `next.config.mjs`. The production config extends the canonical config without overriding compiler options, includes only production `.next/types`, and excludes `.next/dev`. Development isolation remains enabled with `experimental.isolatedDevBuild=true`.

The shared verification runner refuses a live dev writer, removes generated `.next` before typegen/build, requires fresh production route types, rejects production `next-env.d.ts` references to `.next/dev/types`, and never patches generated files. `ignoreBuildErrors` remains false and all business/API/security/visual UAT contracts remain unchanged. P6 remains BLOCKED until full production build, localhost Human Visual Acceptance, and exact-source GitHub evidence pass.

## P5 V4.5.1 — production tsconfig selection hardening — 2026-09-27

- Root-cause hardening adds an explicit `T360_NEXT_VERIFY=1` verification authority in all four `next.config.mjs` files.
- Development server continues to use canonical `tsconfig.json`; deterministic verification/typegen/build is forced to `tsconfig.build.json` even if Next invokes config under a non-build phase.
- This does not relax compiler options: `tsconfig.build.json` still extends canonical `tsconfig.json`, overrides no `compilerOptions`, excludes `.next/dev/**/*`, and keeps `ignoreBuildErrors=false`.
- Official Next.js 16 configuration supports `typescript.tsconfigPath`. **Corrected 2026-09-29:** this line previously also claimed `experimental.isolatedDevBuild` was a supported boundary. It is not — the key was removed from Next.js, and `node_modules/next/dist/server/config-schema.js` in 16.3.5 contains no such key. Carrying it produced an "Unrecognized key(s) in object" warning on every dev start and build while isolating nothing. The four configs no longer set it, and the generated-type isolation test now asserts both that the key is absent and that the installed Next's own schema agrees it is gone. The dev/build split is carried entirely by `tsconfig.build.json` excluding `.next/dev/**/*`.
- No business/API/UI presentation contract changes. Real production build remains mandatory before operator artifact release.

## 2026-09-27 — P5 V4.5.2 Node ESM-safe Next config import

The first real operator production build after V4.5.1 exposed a config-loader regression before application compilation: Node ESM could not resolve the extensionless `next/constants` import from each `next.config.mjs`. The four Next product configs now import `PHASE_DEVELOPMENT_SERVER` from the concrete package file subpath `next/constants.js`, and the generated-type isolation regression test now asserts this exact ESM-safe contract.

This is verification-infrastructure hardening only. Generated-type ownership, strict TypeScript, `ignoreBuildErrors=false`, browser/UAT gates, and all business/API/security/tenant/domain/presentation behavior remain unchanged. Static verification after the fix is green (Next authority 9/9, dependency-free 999/999, full audit chain PASS). Real Admin/POS/Storefront/Employee production builds remain mandatory before Human Visual Acceptance or any commit/push.

## P5 V4.6 — Admin reference-dashboard root presentation rebuild — 2026-09-27

The V4.5.2 R3 production-build blocker is closed by operator evidence: all four Next 16.3.5 production builds passed. Human review then rejected the Admin runtime presentation even though prior P5 automation was green. That rejection is valid regression evidence for P5 because the visual gate proved only markers/geometry/luminance/overflow/screenshot existence and did not prove the accepted composition quality.

V4.6 repairs the presentation authority instead of adding another skin patch. The Admin default presentation now follows the supplied clean inventory-dashboard reference: light sidebar, search-first topbar, compact Dashboard Overview header, six colored KPI cards, line and donut analytics, recent activity, stock watchlist, and quick actions. A persisted light/dark toggle is part of the runtime contract. Shared semantic CSS classes still consumed across active Admin modules are restored under the same theme authority so non-Dashboard routes no longer fall back to unstyled legacy structures.

Automated P5 gates are strengthened to fail closed unless the six KPI cards, six named dashboard panels, line+donut identity, light default sidebar, working light/dark toggle, and shared semantic class coverage are present. Business/API/permission/domain authority remains frozen. P5 stays OPEN until Human Visual Acceptance; P6 and commit/push remain blocked.

## P5 V4.7 — Full UI root presentation and capability-exposure hardening — 2026-09-27

Human Visual Acceptance expanded the P5 regression from Admin appearance to the complete frontend product family. Deep source audit proved the previous visual gate could remain green while semantic JSX classes no longer had CSS authority, creating asymmetric grids, unstyled controls and inconsistent product shells even when build/tests passed.

V4.7 closes that root condition across Admin, POS, Storefront and Employee Portal without changing business/API/permission/domain semantics. Admin retains the reference-style light dashboard plus persisted dark mode; POS is light-first, tenant/branch-aware and exposes the existing canonical digital receipt; Storefront retains its light premium retail identity with semantic style coverage; Employee Portal becomes tenant-aware and keeps all seven configured views reachable on mobile.

The exhaustive backend/UI scan covers 36 API controllers and 451 handlers. F2/F3/F4/F5/F6/F7/F8/F11 are currently exposed in operator UI. F9 remains legitimately partial because external notification-provider production readiness is incomplete. F10 remains legitimately partial because a first-class operator assistant/AI capability is not implemented. `edge-sync.controller.ts` remains intentionally API-only for device/system synchronization.

A permanent `audit:ui:domain-depth` gate now joins P5 visual verification. It fails on missing required semantic class authority, POS dark-root regression, tenant-context omissions, hidden Employee mobile subdomains, missing digital-receipt exposure, direct no-op controls, permanent-disabled controls and unexpected API-only/partial capability drift. Real production build and Human Visual Acceptance remain mandatory before P5 closure; P6 remains blocked.

## 2026-09-27 — P5 V4.8.1 runtime-video root UI foundation

Human runtime screencast is now authoritative regression evidence for P5 presentation quality. The accepted repair boundary is shared presentation/layout authority across all four frontend products plus explicit Admin domain/subdomain discoverability, not additional page-specific CSS patches. Admin contextual subdomains are visible under the active primary navigation item and remain available in the complete module directory; POS is light-first; Storefront/Employee forms use canonical grid/label/button primitives; tenant/branch context remains explicit. Static deep scan covers 52 frontend source files, 36 controllers, 451 handlers and 63/63 Admin contextual destinations. P5 stays OPEN pending real four-app build and Human Visual Acceptance; P6 remains BLOCKED.

## 2026-09-27 — P5 V4.8.2 runtime-integrity root fix

Fresh Ubuntu runtime evidence exposed a real React invariant failure in Admin Integrations: `ExtensionsView` returned its loading skeleton before registering a later loyalty `useEffect`, so the loading transition changed the hook count between renders. The same duplicated bootstrap path also omitted the customer-directory request used by loyalty. V4.8.2 removes both root causes: commerce/extension bootstrap now has one canonical load/apply path, all `ExtensionsView` hooks are registered before conditional rendering, and the loyalty customer directory is part of that single extension snapshot.

The runtime screenshots also showed POS rendering the rejected dark/stale presentation while authored V4.8 source was light-first. V4.8.2 therefore makes development-output freshness part of the frontend authority rather than relying on operator cache state: all four Next workspaces start through `scripts/run-next-dev-workspace.mjs`, which validates the exact workspace Next version, deletes isolated `.next/dev` output before `next dev`, and forces development tsconfig authority (`T360_NEXT_VERIFY=0`). A permanent runtime-integrity test and `audit:ui:domain-depth` contract reject hook-after-loading-guard regressions, extension bootstrap drift, dev-script bypass, stale-dev-reset removal, and POS dark-root regression. P5 remains OPEN pending real four-app build and Human Visual Acceptance; P6 and commit/push remain blocked.

## 2026-09-28 — P5 V4.9 unified four-product root design system

V4.8.2 repaired the Admin React hook invariant and stale isolated-dev output, but Human Visual Acceptance still found inconsistent presentation ownership between products. V4.9 replaces product-local theme behavior with one presentation protocol across Admin, POS, Storefront and Employee Portal.

- Shared persisted theme authority: `toko360:ui-theme`.
- Default is deterministic LIGHT on every product; dark is entered only from explicit saved user selection.
- All four layouts bootstrap the saved theme before hydration and all four shells synchronize it to the document root.
- Admin, POS, Storefront and Employee Portal each expose a functional light/dark toggle while preserving their distinct product identity.
- POS may no longer become dark merely because the operating system prefers dark mode.
- The presentation wave does not add API/business-domain imports to shells or layouts and therefore does not change canonical business behavior.
- V4.8.2 hook-order and fresh `.next/dev` contracts remain active.

Server verification after V4.9 staging: focused root-design/runtime suite 55/55 PASS, dependency-free 1030/1030 PASS, workflow validation PASS, repository validation PASS (977 files / 180 Prisma models), product/Admin/canonical/P5/UI/full-repository audits PASS (451 API handlers / 401 controls). *(Counts are as of 2026-09-27; the current figures are 1021 files, 454 API handlers, 420 controls, 1089 dependency-free tests, regenerated into `config/p5-full-ui-root-audit.json` by `npm run audit:p5:visual`.)* Frontend API-call signatures match the V4.8.2 baseline across all 25 files that contain API calls, and apps/api, apps/worker, packages, and database have zero source changes. Real production builds and Human Visual Acceptance remain pending on the Ubuntu operator environment. P5 remains OPEN; P6, commit and push remain blocked.

## P5 V4.10 — product-scoped theme integrity and safe Next bootstrap — 2026-09-28

Runtime screenshots invalidated the V4.9 shared-theme assumption. One global theme key caused cross-product leakage (a dark choice in Storefront/Admin could make POS dark), and raw `<script>` tags inside all four React root layouts produced a real runtime console error in Employee Portal. V4.10 isolates theme persistence per product, retains deterministic LIGHT default, switches pre-hydration bootstrap to `next/script` `beforeInteractive`, adds login-surface theme controls where the authenticated shell is absent, and neutralizes Storefront dark mode to charcoal/emerald instead of full-green.

No business/API/permission/domain implementation changes are included. Admin domain/subdomain authority remains 14 primary / 63 contextual. Static server gates are green (focused 66/66; dependency-free 1035/1035; workflow/repository/product/Admin/canonical/P5/UI/full-repository PASS). Real four-product Next build and explicit Human Visual Acceptance on Ubuntu are still required before commit/push or P6.

## 2026-09-29 — POST-1C audit: revoke-binding was unreachable, and a removed Next key was carried

Two real defects found while continuing work in the `test` copy, both fixed in product code with
negative controls.

**1. The "Cabut" (revoke) button on the Mobile Ops screen could never work.** `mobile-ops.tsx` sent
`{ platformUserId: revokeTarget.id }`, but `revokeTarget.id` is the binding row id, and
`listBindings` deliberately never returns `platformUserId` — it is credential-adjacent and the
service says so in a comment. The service then looked the record up by `platformUserId`, so every
revoke resolved to nothing and returned 404. The operator's only remedy would have been a support
ticket. Revocation is now keyed on the binding's own row id, still tenant-scoped
(`where: { id: bindingId, companyId }`), so a binding id from another company still resolves to
nothing. The security posture is unchanged and slightly better stated: the platform identity is
neither sent by the screen nor required by the route.

Regression: `tests/post1c-mobile-ops-security.test.mjs` gained `revoke is addressed by a key the
operator screen actually holds`, which parses the UI's revoke payload and the route's DTO and
requires them to name the same thing. Negative control: restoring the old UI payload, and separately
restoring the old service lookup, each turn the suite red (2 and 2 tests).

**2. All four `next.config.mjs` carried `experimental.isolatedDevBuild`, a key Next.js no longer
has.** Next 16.3.5 prints "Unrecognized key(s) in object: 'isolatedDevBuild'" on every dev start and
build, and `node_modules/next/dist/server/config-schema.js` contains no such key — so it isolated
nothing. The real dev/build split in this repo is `tsconfig.build.json` excluding `.next/dev/**/*`,
which was already enforced. The key is removed from the four configs, the machine contract records it
as `false`, and the isolation test now asserts the key is absent *and* that the installed Next's own
schema agrees it is gone — so if Next ever reintroduces it, the gate fails loudly instead of quietly
demanding the wrong thing. The P5 V4.5.1 note in this file claiming the key was a supported boundary
is corrected in place.

Negative control: reintroducing the key into one config turns 2 tests red.

No business, API, permission or tenant-scope semantics changed. Commit and push remain the owner's.
## 2026-10-03 — Pre-GitHub source-hardening reconciliation

The stale source gaps recorded after the 2026-09-29 audit are closed before GitHub UAT. Order creation and operational-finance creation now require a stable client operation key and fail closed on missing/mismatched keys; Storefront/POS preserve retry identity and the staging integration runner verifies order replay. Payroll component and employee-component reads are cursor-paginated, with bounded candidate scanning and branch validation instead of loading the whole active employee set.

F10 is no longer a legitimate PARTIAL capability at source level: explainable forecast/reorder, a deterministic permission-scoped operator assistant, anomaly insight, confidence/source links, interaction history and human-confirmation guardrails are implemented. Canonical F10 status is `IMPLEMENTED_RUNTIME_PENDING`; this does not claim an external LLM provider. F9 remains `PARTIAL` because live external notification-provider production readiness requires provider configuration/credentials and runtime evidence. `edge-sync` remains intentionally API-only.

P5 remains `IMPLEMENTED_RUNTIME_PENDING`, `humanStage20=PENDING`, and `productReady=false`. The next authority is exact-source GitHub UAT: dependency install/build, PostgreSQL authenticated multi-role mutation/replay/concurrency, four-Next production/browser matrix, then explicit Human Stage-20. No source-only result may promote product readiness.

