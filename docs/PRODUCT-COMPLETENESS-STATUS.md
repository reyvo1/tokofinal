# TOKO360 Product Completeness Status

`config/product-completeness.json` is the canonical machine-readable source of truth after the full product audit.

Rules:
- Source markers, routes, buttons, models, or source-contract tests alone cannot close a capability.
- `RUNTIME_VERIFIED` requires exact-source runtime evidence.
- UI/product completion additionally requires valid human acceptance where the canonical workflow requires it.
- Historical F1-F12 and R0-R8 material remains evidence/history only.
- `PRODUCT_READY` remains false until the canonical completion workflow and Human Stage-20 are satisfied.

## Current phase

**P5 — Full Visual Product Rebuild**
Status: **IMPLEMENTED_RUNTIME_PENDING**
Delivery boundary: **P5 FULL one atomic wave across all four products**

## P4 closure

P4 FULL is `RUNTIME_VERIFIED` on:
- commit `d305ade2050765de86c7f5ef1c54eb7426c5e25b`;
- source fingerprint `cf6165fcc74e94abb3866230aa1764cee9487d4de6b630377465d20bda7d9246`;
- P4 canonical ownership exact-runtime probe PASS;
- Stage-19 and automated Stage-20 PASS;
- R8 exact-source evidence PASS;
- full-system aggregate PASS and Automated UAT PASS.

A-10 is `RUNTIME_VERIFIED`. Canonical `/returns/*` remains authoritative, legacy `/sale-returns*` and `/purchase-returns*` are absent, and nine-domain ownership remains guarded by `audit:canonical:ownership`. Human Stage-20 remains separately PENDING.

## P5 FULL truth

- A-07: `IMPLEMENTED_RUNTIME_PENDING`; P5 is a page-level rebuild, not a global CSS or marker cleanup.
- Admin: 15 primary workspaces + 14 representative contextual screenshot routes.
- POS: 4 cashier-specific workspaces.
- Storefront: 5 customer journey views.
- Employee Portal: 7 authenticated self-service views.
- Responsive evidence: 1440 / 1024 / 390 with max 3px accepted overflow.
- Permanent source audit: `npm run audit:p5:visual`.
- Exact-source Browser evidence: `npm run ci:p5:probe` → `handoff/quality/github-p5-visual-rebuild-probe-latest.json`.

P5 automation must preserve `humanAcceptance=PENDING`. Human visual acceptance is mandatory and cannot be inferred from screenshot counts, source tests, or automated Browser UAT.

### P5 V1-V3 history / P5 V4 active total rebuild

- P5 V1 automated exact-source chain is green on commit `af7cb87bbdc1ee898f785a072993e79877326b27`, fingerprint `f7f2c6bf6f1a22c8df42afbe0cda001e0f926a09b9b2a33e27650eb2fc58bd3e`; human review rejected the result.
- P5 V2 automated exact-source chain is green on commit `fd2d29d9a8d7d6bd0db3c1e085fb4e376440f6bc`, fingerprint `8526da44eee5325f40a833e03d461533bb0ddf72bc35a781d560260ddb684e68`; the second human review also rejected the presentation.
- P5 V3/V3.3 is historical only; Human runtime review rejected it again because the suite still looked like a legacy visual skin.
- P5 V4 is the active candidate: `ONE_P5_FULL_V4_TOTAL_PRESENTATION_REBUILD`.
- V4 rebuilds the four product shells and canonical compatibility presentation layers using Tailwind CSS v4, distinct product identities, controlled brand/depth gradients, and stronger navigation/content separation.
- V4 keeps business logic, API contracts, permissions, tenant/branch authority, inventory/accounting/payroll/returns/tax/pricing semantics frozen.
- V4 authority: `config/p5-v4-total-ui-rebuild.json`, `docs/P5-V4-TOTAL-PRESENTATION-REBUILD.md`, `UI-DESIGN-SYSTEM.md`, and `scripts/audit-p5-v4-total-ui-rebuild.mjs`.
- `ci:p5:probe` must emit `visualGeneration=P5-V4`, require all four `P5_V4_*_VISUAL_IDENTITY` checks, preserve `productionTouched=false`, and keep `humanAcceptance=PENDING`.
- P6 remains blocked until V4 exact-source automation and explicit Human Visual Acceptance pass.

## P2 closure

P2 FULL is `RUNTIME_VERIFIED` on:
- commit `899685ce23c08c8a0246867afc0c78a36507e674`;
- source fingerprint `36af0df55489492e4389f7bf0a511bbaa60cae761937b77edcd310003cdfa04d`;
- P2A mixed-UOM PASS;
- P2 Payroll PASS;
- Stage-19 PASS 11/11;
- Payroll staging PASS;
- automated Stage-20 PASS;
- R8 PASS;
- aggregate PASS.

A-03 and A-04 are `RUNTIME_VERIFIED`. Human Stage-20 remains separately PENDING.

## P3 closure

P3 FULL is `RUNTIME_VERIFIED` on exact-source commit `c61273e99104c0dbdc61ee4790379d4ed2edd8a3`, source fingerprint `cfe0323c096eb253730c1751e37ecc3a0b4e77853d3048360271ed97e360f8c5`. A-05 Retention/archive, A-06 Security lifecycle, A-08 Maturity truth, and A-11 Admin-owned daily summary are closed by exact-source P3 probe, aggregate, and Automated UAT evidence. Human Stage-20 remains separately PENDING.
