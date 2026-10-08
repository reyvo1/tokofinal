# P5 V3 — Tailwind Total UI Rebuild

## Status

`IMPLEMENTED_RUNTIME_PENDING`

P5 V2 exact-source automation passed on commit `fd2d29d9a8d7d6bd0db3c1e085fb4e376440f6bc`, source fingerprint `8526da44eee5325f40a833e03d461533bb0ddf72bc35a781d560260ddb684e68`, but the second human runtime review rejected the presentation. The rejection was not a business-function regression: the UI still looked like layered CSS remediation, navigation hierarchy felt stacked/misaligned, product identities were insufficiently professional, and charts/cards/forms lacked the requested modern visual quality.

P5 V3 therefore replaces the presentation layer as one atomic wave. P6 stays blocked.

## Non-negotiable boundary

- No business logic changes.
- No API contract changes.
- No permission/tenant/branch authority changes.
- No inventory/accounting/payment/payroll/return/tax/pricing semantic changes.
- No weakening of Browser UAT, exact-source fingerprinting, R7, R8, aggregate, or Human Stage-20.

## Rebuild model

The previous P5 V2 override strategy is not reused. The V3 model is:

1. Tailwind CSS v4 utility-first product shells.
2. Direct Tailwind shared primitives for high-value Admin cards/states/tables/analytics.
3. `globals.css` fully replaced by bounded Tailwind `@theme` + `@apply` compatibility layers for existing business modules.
4. No `[data-visual-version="p5-v2"]` presentation override selectors.
5. No decorative gradients.
6. Four intentionally different product identities.

## Product identities

### Admin
Light enterprise command center: light bounded workspace, dark navy command sidebar, sky accent, layered/elevated panels, stronger page heading/context, responsive contextual navigation, rebuilt KPI/chart primitives.

### POS
Teal transaction cockpit: touch-first high-contrast workspace, explicit four-workspace navigation, dominant product/cart/payment hierarchy, sticky desktop cart and safe mobile collapse.

### Storefront
Light premium retail: customer-facing header, product-first catalog/cards/detail, stronger retail whitespace and price hierarchy, clean cart/account separation, mobile bottom navigation.

### Employee Portal
Calm violet self-service: personal status/action hierarchy, light sidebar/cards, explicit attendance/leave/overtime/payslip/history/profile destinations, mobile self-service navigation.

## Permanent source gate

`config/p5-v3-tailwind-rebuild.json` is the machine-readable V3 contract.

`npm run audit:p5:visual` now runs:

- original page/screenshot coverage audit; then
- `scripts/audit-p5-v3-tailwind-rebuild.mjs`.

The V3 audit rejects:

- missing P5 V3 shell generation markers;
- non-Tailwind canonical CSS;
- P5 V2 override selectors;
- decorative gradients;
- page-level horizontal scrolling;
- shells that are not utility-first;
- missing Admin shared Tailwind primitives/analytics;
- broken POS cart, Storefront product, Employee mobile-navigation contracts;
- collapsed product identities;
- any change that reopens business/API authority.

## Verification

Before local delivery:

- focused UI compatibility: PASS;
- workflow/repository/product/contextual/canonical/full/UI audits: PASS;
- dependency-free regression: PASS;
- Ubuntu verifier must still run `npm ci`, `db:local:generate`, focused V3 gates, full governance/audits, dependency-free tests, and `quality:full`.

Exact-source GitHub must then rerun Browser UAT and `ci:p5:probe` on the committed V3 source. Human visual acceptance remains mandatory after automation is green.
