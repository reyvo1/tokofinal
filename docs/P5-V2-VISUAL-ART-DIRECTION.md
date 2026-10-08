# P5 V2 — Visual Art Direction & Modernization

Status: **IMPLEMENTED_RUNTIME_PENDING**
Delivery boundary: **one P5 FULL V2 atomic presentation wave**
Automated P5 V1 baseline commit: `af7cb87bbdc1ee898f785a072993e79877326b27`
Automated P5 V1 source fingerprint: `f7f2c6bf6f1a22c8df42afbe0cda001e0f926a09b9b2a33e27650eb2fc58bd3e`
Human visual review: **REJECTED**

## Why P5 V2 exists

Exact-source P5 V1 automation is green, but human review of the real runtime recording rejected the visual result. The observed problems were product-level rather than isolated component bugs: the four products still looked too similar, most surfaces were dark/flat, menu hierarchy felt stacked, visual depth was weak, and Storefront did not feel like a customer retail product.

Automation remains valid technical evidence for route coverage, geometry and runtime behavior, but it does not supersede human visual acceptance.

## Non-negotiable scope

P5 V2 is presentation-only. It must not change business rules, API contracts, authorization, persistence, inventory/accounting/payroll behavior, or canonical domain ownership.

The wave changes all four products together:

- **Admin:** deep-indigo enterprise canvas, compact primary navigation, one contextual navigation layer, translucent layered surfaces, strong hierarchy, refined forms/tables/states.
- **POS:** teal operational identity, touch-first cards, clear sale/cart dominance, stronger online/offline and payment hierarchy.
- **Storefront:** light premium retail identity, white/translucent customer surfaces, stronger product cards and retail hierarchy, explicitly unlike Admin/POS.
- **Employee Portal:** light violet self-service identity, personal workspace hierarchy, lighter cards/forms/tables, explicitly unlike Admin.

## Visual rules

- Tailwind CSS v4 + Lucide remain canonical.
- Decorative gradients remain forbidden.
- Glass layering is allowed and required through translucent solid surfaces plus `backdrop-filter`.
- Elevation is allowed and required through intentional `box-shadow`.
- Solid-color ambient glows may be used as non-interactive blurred shapes; they are not gradients.
- Primary navigation must not require horizontal scrolling.
- Admin keeps exactly one primary navigation plus one contextual navigation layer.
- Reduced-motion and coarse-pointer accessibility contracts remain mandatory.
- Storefront and Employee Portal must not remain all-black surfaces.
- Product identities must be visibly distinct before human acceptance can pass.

## Machine-readable contract

`config/p5-v2-art-direction.json` records the baseline human rejection, presentation-only boundary, four distinct themes, required glass/elevation primitives, and human-review focus.

Permanent source audit:

```bash
npm run audit:p5:visual
```

The command runs both the original P5 route/screenshot contract and `scripts/audit-p5-v2-art-direction.mjs`.

## Closure

P5 V2 requires:

1. focused and full source regression green;
2. local full quality gate green;
3. one atomic commit/push;
4. exact-source Browser/R7/P5/R8/aggregate green on the V2 source;
5. human visual review of the real V2 runtime;
6. explicit human acceptance.

P6 remains blocked until all six conditions are satisfied.
