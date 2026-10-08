# P5 FULL V4 — Total Presentation Rebuild

## Trigger

Human runtime review rejected P5 V3/V3.3 because the applications still looked like a legacy skin: Admin retained an overly generic panel language, POS could still present as a dark cockpit, and the four products did not feel like a coherent modern suite.

## Scope

Presentation only. The following authorities are frozen and must not change in this wave:

- API contracts and route semantics;
- permission, tenant and branch authority;
- inventory, accounting, tax, payment, payroll and returns semantics;
- canonical mutation paths and idempotency rules;
- offline/sync business safety.

## Rebuild boundary

V4 replaces the primary visual composition for all four products:

1. **Admin** — floating enterprise command center: dark semantic command sidebar, glass topbar, bounded bright workspace, layered panels and clearer analytics.
2. **POS** — light touch retail cockpit: compact cashier header, segmented workspaces, bright product catalog, elevated sticky cart and dominant payment action.
3. **Storefront** — premium natural retail: warm neutral canvas, customer-oriented navigation, image-led product cards and bright checkout/account surfaces.
4. **Employee Portal** — violet self-service workspace: compact dark navigation identity with bright personal status/action surfaces.

## Runtime acceptance upgrades

Automation is no longer allowed to treat geometry-only green as visual success. Browser UAT records:

- `P5_V4_ADMIN_VISUAL_IDENTITY`
- `P5_V4_POS_VISUAL_IDENTITY`
- `P5_V4_STOREFRONT_VISUAL_IDENTITY`
- `P5_V4_EMPLOYEE_VISUAL_IDENTITY`
- `ADMIN_SHELL_GEOMETRY`

The V4 identity gate verifies the runtime generation marker and computed root luminance. POS, Storefront and Employee Portal must be bright roots; Admin must have a bright workspace root plus a dark command sidebar.

## Human gate

Exact-source automation remains necessary but not sufficient. P6 stays blocked until a human reviews the real V4 runtime on desktop/tablet/mobile and explicitly accepts the result.
