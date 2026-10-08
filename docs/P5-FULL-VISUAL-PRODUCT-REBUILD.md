# P5 FULL — Visual Product Rebuild

Status: **IMPLEMENTED_RUNTIME_PENDING**
Delivery boundary: **one P5 FULL atomic wave**
Baseline P4 commit: `d305ade2050765de86c7f5ef1c54eb7426c5e25b`
Baseline source fingerprint: `cf6165fcc74e94abb3866230aa1764cee9487d4de6b630377465d20bda7d9246`

## Purpose

P5 closes audit finding A-07 by rebuilding the four operator/customer products at page-composition level. A global stylesheet, route marker, or source-contract test is not sufficient evidence. Admin, POS, Storefront, and Employee Portal must each retain a product-specific hierarchy and must be verified through exact-source browser screenshots and responsive geometry.

## Product contracts

### Admin

- Keep one primary navigation, one contextual navigation, and one content surface.
- Give every primary workspace a clear title row, workspace identity, tenant/branch context, and intentional content density.
- Cover every current canonical primary workspace and one representative contextual route for every non-Dashboard workspace.
- Tables, panels, stats, forms, and contextual tabs must remain readable at desktop/tablet/mobile widths without uncontrolled horizontal overflow.

### POS

- Keep the cashier flow visually distinct from Admin.
- Surface current workspace, operational description, and online/offline state before the workspace body.
- Preserve touch-first sale/cart density, shift, return, and synchronization workspaces.
- Avoid generic dashboard composition for the sale terminal.

### Storefront

- Keep customer browsing visually distinct from operator products.
- Give non-home journeys an explicit view heading and branch/store context.
- Preserve separate home, catalog, product detail, cart, and account compositions.
- Product cards, checkout/cart regions, and account surfaces must remain responsive without decorative dashboard treatment.

### Employee Portal

- Keep self-service identity distinct from Admin.
- Surface current self-service context and authenticated state clearly.
- Preserve home, attendance, leave, overtime, payslips, history, and profile as explicit routes.
- Cards, tables, forms, and status surfaces must remain usable at desktop/tablet/mobile widths.

## Machine-readable visual map

`config/p5-visual-surface-map.json` is the P5 visual coverage contract:

- Admin primary: 15
- Admin representative contextual: 14
- POS views: 4
- Storefront views: 5
- Employee Portal views: 7
- Responsive widths: 1440 / 1024 / 390
- Maximum accepted horizontal overflow: 3 px
- Human acceptance: mandatory and separate

## Permanent source audit

Run:

```bash
npm run audit:p5:visual
```

The audit fails closed when:

- a product loses its page-level visual identity;
- required product-specific composition primitives disappear;
- configured Admin visual routes disappear;
- responsive/accessibility CSS contracts disappear;
- decorative gradients return to canonical surfaces;
- Browser UAT no longer produces the P5 screenshot matrix.

## Exact-source browser gate

Both heavy GitHub workflows execute:

```bash
npm run ci:p5:probe
```

The probe consumes exact-source `handoff/quality/browser-uat-latest.json` and requires:

- Browser UAT PASS on the current source fingerprint;
- 15 Admin primary screenshots;
- 14 Admin contextual screenshots;
- 4 POS screenshots;
- 5 Storefront screenshots;
- 7 authenticated Employee Portal screenshots;
- responsive matrices at 1440 / 1024 / 390 for all four products;
- no browser runtime exception;
- `productionTouched=false`;
- `humanAcceptance=PENDING` until a human review is explicitly recorded.

Evidence is written to:

`handoff/quality/github-p5-visual-rebuild-probe-latest.json`

## Closure rule

P5 source remains `IMPLEMENTED_RUNTIME_PENDING` after local tests and after source implementation. Automated GitHub evidence must be green on the exact committed source before any runtime closure statement. Automated screenshots do **not** replace human visual acceptance. P6 must not start until the canonical P5 sequencing rule is satisfied by the project workflow.
## P5 V2 human visual rework

P5 V1 exact-source automation later passed on commit `af7cb87bbdc1ee898f785a072993e79877326b27`, fingerprint `f7f2c6bf6f1a22c8df42afbe0cda001e0f926a09b9b2a33e27650eb2fc58bd3e`. Human review of the real runtime recording nevertheless rejected the presentation: navigation still felt stacked, surfaces remained too flat and predominantly black, depth/elevation was weak, and Storefront did not read as a customer retail product.

P5 V2 therefore reopens only the presentation layer as one atomic wave. `config/p5-v2-art-direction.json` is the machine-readable art-direction contract. The existing route/screenshot/geometry gates stay intact; V2 adds product-specific glass/elevation and distinct color identity while retaining the no-decorative-gradient rule. Prior V1 automation is historical evidence only for the rejected visual source.

P5 cannot close and P6 cannot start until V2 exact-source automation is green and the human explicitly accepts the new runtime presentation.

## P5 V3 — Total Tailwind UI rebuild

P5 V2 exact-source automation passed on `fd2d29d9a8d7d6bd0db3c1e085fb4e376440f6bc` / `8526da44eee5325f40a833e03d461533bb0ddf72bc35a781d560260ddb684e68`, but the second human review rejected the runtime appearance. V3 does not append another CSS override layer. It replaces the canonical presentation layer as one atomic wave.

Canonical V3 authority:

- `config/p5-v3-tailwind-rebuild.json`;
- `docs/P5-V3-TAILWIND-TOTAL-UI-REBUILD.md`;
- `UI-DESIGN-SYSTEM.md`;
- `scripts/audit-p5-v3-tailwind-rebuild.mjs`.

V3 requires utility-first Tailwind shells, bounded `globals.css` compatibility layers, four distinct product identities, rebuilt Admin primitives/analytics/charts, no decorative gradients, no P5 V2 override selectors, no page-level horizontal scrolling, unchanged business/API authority, exact-source screenshot evidence, and explicit human acceptance before P6.

## P5 V4 — Total presentation rebuild after Human rejection

P5 V3/V3.3 remains historical implementation evidence only. Human runtime review rejected the visual result again and explicitly required a total presentation rebuild rather than another patch layer.

V4 is now the only active visual candidate. It supersedes the rejected V3 no-gradient rule and allows controlled brand/depth gradients while keeping business/API/permission authority frozen.

Canonical V4 authority:

- `config/p5-v4-total-ui-rebuild.json`;
- `docs/P5-V4-TOTAL-PRESENTATION-REBUILD.md`;
- `UI-DESIGN-SYSTEM.md` P5 V4 section;
- `scripts/audit-p5-v4-total-ui-rebuild.mjs`.

V4 Browser UAT must prove the four computed runtime visual identity checks in addition to screenshot/overflow coverage and `ADMIN_SHELL_GEOMETRY`. Exact-source automation remains insufficient to close P5 without explicit Human Visual Acceptance.
