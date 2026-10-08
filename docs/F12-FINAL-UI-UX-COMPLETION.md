# F12 Final UI/UX Polish — Source Completion

F12 is a presentation-only closure over the already-authoritative F2–F11 business flows. It does not add a second API, business rule, database table, accounting path, tax path, inventory path, or permission boundary.

## Admin
- Final dark enterprise density aligns panels, tables, forms, modals, notices, domain tabs, and related-workspace rails.
- Dense tables receive contained horizontal scrolling, sticky headers, subtle zebra/hover treatment, and mobile-safe minimum widths.
- Form controls and destructive/feedback surfaces keep explicit focus, disabled, success, warning, and error semantics.

## POS
- Final cashier surface is flat, touch-first, and denser on wide terminals while remaining two-column/single-column responsive.
- Product density scales 4 → 3 → 2 → 1 columns without changing cart, quote, shift, return, sync, offline, payment, or stock guards.
- Checkout/cart and workspace navigation remain visually stable on compact terminals.

## Storefront
- Final customer surface uses restrained light cards, consistent control sizing, auto-fill catalog density, compact checkout actions, and bottom navigation on mobile.
- No merchandising, pricing, inventory, payment, account, favorite, review, or return authority is moved to the browser.

## Employee Portal
- Final self-service shell uses compact sidebar density, consistent cards/forms/tables, sticky table headings, and a single-column mobile KPI layout.
- Attendance, leave, overtime, payslip, history, profile, GPS/selfie/geofence, and employee-self-scope contracts are unchanged.

## Guardrails
- F12 adds no decorative gradients to the final override blocks.
- Existing accessibility baseline remains: skip links, `focus-visible`, reduced-motion, touch targets, semantic active navigation.
- Runtime/browser/human UAT remains deliberately deferred until the implementation roadmap is source-complete.

## Verification
- Focused F12 + existing UI guards: **40/40 PASS**.
- Workflow validation: **PASS**.
- Repository validation: **PASS** (918 files at the time of this wave, 180 Prisma models, SQLite/PostgreSQL profiles valid). The current count is 1021 files; the model count has not moved.
- Full dependency-free regression: **814/814 PASS**.
- Runtime/browser/human UAT: **DEFERRED** by operator instruction until source implementation is complete.

