# TOKO360 UI DESIGN SYSTEM — P5 V3

> Canonical visual authority for TOKO360 after the second human visual rejection.
> P5 V3 is a total presentation rebuild. Business rules, authorization, tenant/branch authority, API contracts, inventory/accounting/payroll/returns semantics, and server-side validation remain authoritative and unchanged.

## 1. Delivery model

- Tailwind CSS v4 is the canonical presentation layer for Admin, POS, Storefront, and Employee Portal.
- Product shells and high-value shared primitives use Tailwind utility classes directly in TSX.
- `globals.css` is a bounded Tailwind theme/component compatibility layer using `@theme` and `@apply`; it must not become an append-only patch log.
- Selectors that reactivate or override prior visual generations such as `[data-visual-version="p5-v2"]` are forbidden.
- Decorative `linear-gradient`, `radial-gradient`, and `conic-gradient` treatments are forbidden. Depth comes from solid/translucent surfaces, borders, backdrop blur, shadow, hierarchy, and whitespace.
- Lucide React is the canonical icon set. Emoji/text glyphs are not action icons.

## 2. Product identities

### Admin — Light Enterprise Command Center
- Canvas: `#F5F7FB`.
- Command navigation: deep navy `#0B1220`.
- Primary accent: sky `#0284C7`.
- Structure: one command sidebar, one contextual navigation layer, one bounded workspace surface.
- Dense operational content uses white elevated panels, restrained borders, meaningful shadows, clear table headers, compact forms, and high-signal KPI cards.
- Analytics uses a restrained series palette with clear axes/grid/legend hierarchy; charts must remain readable without relying on color alone.

### POS — Teal Transaction Cockpit
- Canvas: `#EEF4F6`.
- Primary accent: teal `#0F766E`.
- Touch-first composition: product search/catalog dominates discovery, cart/payment dominates checkout, shift/return/sync remain explicit workspaces.
- Primary action and payment state must be visually dominant without weakening offline/payment guards.
- Desktop retains a sticky cart; mobile collapses to a single-column transaction flow.

### Storefront — Light Premium Retail
- Canvas: `#F7F7F5`.
- Primary accent: deep retail green `#15261F`.
- Customer-facing hierarchy: clear retail header, product-first cards, prominent product detail, clean cart/checkout, restrained account/order surfaces.
- Storefront must not look like an Admin dashboard.
- Product cards prioritize name, price, availability/promo, and imagery space; operational metadata stays secondary.

### Employee Portal — Calm Violet Self-Service
- Canvas: `#F6F7FB`.
- Primary accent: violet `#7C3AED`.
- Calm self-service hierarchy with attendance, leave, overtime, payslip, history, and profile as explicit destinations.
- Desktop sidebar and mobile bottom/grid navigation are visually lighter than Admin and optimized for personal status/action comprehension.

## 3. Typography and spacing

- Font stack: Inter / Geist / system-ui.
- Body: 13–14px; helper/meta: 10–12px; page title: 24–32px depending viewport.
- Heading tracking may be slightly tightened; body copy must remain readable at normal browser zoom.
- Spacing uses a 4px rhythm with primary steps 4/8/12/16/20/24/32.
- Cards/panels use deliberate internal grouping; unrelated controls must not appear as one continuous wall.
- Main content is bounded by product-specific max widths and must never require page-level horizontal scrolling.

## 4. Surface/elevation system

- Canvas -> primary surface -> elevated/interactive surface is the canonical depth order.
- Glass is allowed only as restrained translucent solid surfaces with `backdrop-blur`; it is not a substitute for hierarchy.
- Border and shadow may be combined when subtle; avoid glow/neon effects.
- Typical panel radius: 20–28px for major surfaces, 12–18px for controls/cards, full pill only for status/filter chips.
- Hover elevation may move at most ~1–2px; motion must remain functional and respect reduced-motion preferences.

## 5. Navigation rules

- Admin: exactly one primary sidebar + one contextual domain navigation. No workspace rail/deck/breadcrumb/statusbar layer that competes with them.
- Sidebar item descriptions are secondary and truncate; they must not create tall stacked menu walls.
- Search must remain available for Admin navigation (`Cari menu, fitur, atau area kerja`).
- POS: four explicit workspaces; mobile navigation remains inside viewport.
- Storefront: desktop primary nav + mobile bottom navigation; customer journeys stay distinct.
- Employee Portal: desktop sidebar + mobile 4-column/grid navigation.
- Active state uses `aria-current="page"` where appropriate.

## 6. Forms, tables, states, and feedback

### Forms
- Label above control, helper/error inline, required/disabled/read-only state explicit.
- Inputs/selects/buttons must share radius, height, focus ring, and spacing rhythm per product.
- Destructive actions use explicit confirmation modal, never native `confirm()`.

### Tables and lists
- Strong header hierarchy, subtle row separators/hover, readable numeric alignment, clear status chips.
- Wide operational content must adapt before causing page overflow; stacked responsive presentation is preferred over horizontal page scroll.
- Empty tables use purposeful empty states rather than blank frames.

### Loading / empty / error / success
- Loading uses skeletons or local progress state rather than an unexplained blank screen.
- Empty state explains what is absent and, where allowed, gives the canonical next action.
- Errors distinguish transport failure from a valid empty response.
- Action feedback uses toast/status surfaces with semantic colors.

## 7. Charts and analytics

- Charts must have visible hierarchy: title/context, axis/grid reference, data marks, legend/labels where useful.
- Use a small consistent palette per product; success/warning/danger colors preserve semantic meaning.
- KPI cards must not become decorative tiles with no drill-down/context.
- Admin analytics must remain legible at desktop/tablet/mobile screenshots and must not overflow its panel.

## 8. Accessibility and responsive baseline

- Every primary shell provides `.skipLink` to focusable main content.
- `:focus-visible` is clearly visible on all interactive controls.
- `prefers-reduced-motion: reduce` is mandatory.
- Coarse-pointer interactive targets are at least 44px.
- Runtime/connection states use `role="status"` + `aria-live="polite"` where applicable.
- Canonical responsive evidence is 1440px desktop, 1024px tablet, and 390px mobile.
- Page `scrollWidth` must remain within viewport tolerance at all canonical widths.

## 9. Business-authority boundary

- Presentation may hide/rearrange only what existing visibility/runtime constraints already authorize; it cannot create permissions.
- UI never becomes inventory, accounting, payment, payroll, return, tax, or pricing authority.
- Server validation, canonical mutation paths, tenant/branch scope, idempotency, and fail-closed business gates remain unchanged.
- Runtime UiSchema overrides remain presentation-only and cannot invent routes/actions.

## 10. P5 V3 permanent acceptance contract

P5 V3 is accepted only when all of the following are true:

1. Source audit proves utility-first shells, Tailwind-only compatibility layers, four distinct identities, no prior-generation override blocks, no decorative gradients, and no horizontal page scroll.
2. All existing UI/business source regression suites remain green; visual rebaseline may update obsolete color/layout expectations but must preserve structural/security/business assertions.
3. Exact-source Browser UAT captures the configured Admin/POS/Storefront/Employee screenshot matrix at desktop/tablet/mobile geometry.
4. `ci:p5:probe` passes on the same source fingerprint and records `visualGeneration=P5-V3`, `productionTouched=false`, and `humanAcceptance=PENDING`.
5. A human reviews the actual runtime and explicitly accepts the visual/usability result. Automated screenshots cannot auto-promote this gate.
6. P6 remains blocked until item 5 is recorded.

# P5 V4 — Total Presentation Rebuild

P5 V4 supersedes the rejected V3/V3.3 visual generation. The presentation architecture is rebuilt around four distinct product identities while all business, API, permission, tenant/branch, accounting, inventory, payment, payroll, returns, tax and pricing semantics remain unchanged.

## V4 visual principles

- Tailwind CSS v4 remains the canonical presentation layer.
- Controlled gradients are now allowed only for brand/depth accents; they may not carry business meaning or reduce readability.
- Admin uses a semantic two-region layout: dark command sidebar + bright bounded workspace. Auxiliary nodes may not participate in desktop grid auto-placement.
- POS must render as a bright, touch-first retail cockpit. A dark legacy root skin is a V4 failure.
- Storefront must remain customer-facing with warm/light retail surfaces and image-led cards.
- Employee Portal uses a distinct dark-violet navigation identity with bright personal self-service surfaces.
- Main cards use layered border + shadow + translucent surfaces; visual hierarchy must remain readable without glow-only styling.
- Browser UAT must verify not only overflow and screenshots but computed root visual identity (`P5_V4_*_VISUAL_IDENTITY`) and Admin sidebar/main geometry.
- Human visual acceptance remains mandatory and cannot be auto-promoted by automated screenshots.

## External design references used for V4

- Tailwind CSS official responsive application shell patterns.
- shadcn/ui dashboard/sidebar composition and explicit sidebar inset separation.
- Shopify POS guidance emphasizing touch speed, workflow focus, and cross-device consistency.
- Atlassian navigation layout separation between root, side navigation, and main content.
