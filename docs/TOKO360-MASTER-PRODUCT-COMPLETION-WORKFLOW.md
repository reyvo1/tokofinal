# TOKO360 Master Product Completion Workflow — Post Full Audit 2026-09-25

## Status and authority

This workflow becomes the active source of truth for work after the 957/957 full functional/UI/script audit.

The historical `TOKO360-MASTER-RECOVERY-WORKFLOW.md` (R0-R8) remains evidence of recovery/runtime work already completed. It is **not** sufficient proof of product completeness because the final full audit found real functional-depth, operator-UI, product-maturity, and human-UX gaps while automated recovery gates were green.

Current product verdict:

- Source coverage: 957/957 audited.
- Dependency-free regression baseline: 928/928 PASS at the full-audit checkpoint.
- Automated R0-R8 recovery/runtime evidence: strong/green on latest uploaded evidence.
- Human UI acceptance: FAILED / rejected by operator video.
- Functional completeness: FAILED.
- Product ready: NO.

## Product-completion invariant

A capability is complete only when the entire chain is complete:

`data/schema/config -> domain rules -> service -> API -> permission/tenant/branch authority -> operator UI -> contextual navigation -> mutation/read lifecycle -> runtime evidence -> visual/human acceptance -> documentation truth`

The following **never** close a capability by themselves:

- route exists;
- button exists;
- component renders;
- regex/source marker exists;
- source-contract test passes;
- HTTP 2xx on one happy path;
- page has no horizontal overflow;
- GitHub workflow is green without the required product-level evidence.

## Global execution rules

1. **No phase skipping.** Execute `P0 -> P1 -> P2 -> P3 -> P4 -> P5 -> P6 -> P7`.
2. **Atomic wave rule.** After each implementation wave: local gates pass -> commit all wave files -> push -> working tree clean -> `HEAD == origin/main` -> exact-source runtime evidence when required. No next implementation wave before that checkpoint is stable.
3. **Root-cause rule.** Do not patch tests to match defective product behavior. A test expectation changes only when the old expectation is proven stale against the new documented product contract.
4. **Backend/UI parity.** If an operator-facing backend capability is in product scope, it must have an intentional operator surface or be explicitly classified as automatic/system-owned.
5. **Contextual-route isolation.** Every visible contextual menu item must render its own semantically correct workflow. Reusing one giant component for unrelated contextual routes is forbidden.
6. **Maturity truth.** `foundation`, `baseline`, `adapter-ready`, `disabled`, and `production-ready` are different states and must not look identical in navigation/product claims.
7. **Human acceptance cannot be automated away.** Browser automation is necessary but not sufficient for visual/product acceptance.
8. **Ubuntu-first operations.** Daily operator/developer commands use Bash/Linux/npm. Obsolete Windows launchers are not part of the canonical source flow.
9. **No hidden credentials/evidence clutter in active source.** Runtime evidence belongs in CI artifacts or dedicated untracked/generated paths.
10. **No fake closure.** Any known partial implementation keeps its capability open even if all unrelated automated tests are green.

---

# P0 — Truth Reset, Governance, Security Hygiene

**Depends on:** full audit complete.

**Audit findings:** A-02, A-09, A-12, A-14, A-15.

## Required work

- Replace marker-only/existence-only product-completeness logic with a machine-readable capability matrix.
- Reconcile `FEATURE-CATALOG`, functional-depth truth, recovery matrix, work items, `PROJECT-STATE`, and `STATUS-FINAL` from one canonical status source.
- Remove tracked credential-bearing environment files; keep only safe `.example` files and ignore real env files.
- Remove/move `.recovery-backup` and committed runtime logs/evidence from active tracked source, or explicitly exclude them from every source inventory/audit.
- Classify every capability as one of: `NOT_IMPLEMENTED`, `FOUNDATION`, `PARTIAL`, `IMPLEMENTED_RUNTIME_PENDING`, `RUNTIME_VERIFIED`, `HUMAN_ACCEPTED`.
- Replace “control exists = exposed/complete” audits with workflow-completeness checks.

## Exit criteria

- One canonical machine-readable product-completeness source exists.
- No active credential file is tracked.
- Source inventories exclude backup/runtime evidence noise.
- Documentation and work-item state are generated/reconciled from canonical truth.
- No CRITICAL/HIGH feature is classified complete from source markers alone.

---

# P1 — Admin Information Architecture and Operator Workflow Isolation

**Depends on:** P0.

**Audit findings:** A-01, A-07, A-15.

## Scope

14 Admin primary workspaces and Dashboard + 63 contextual views. The live count is in `config/admin-contextual-workflow-map.json`; `npm run audit:admin:contextual` is the fail-closed authority and currently reports 63/63.

## Required work

- Split the six confirmed non-isolated workspaces into real contextual surfaces:
  - Procurement
  - Commerce
  - Inventory Control
  - Operations Control
  - Assets & Fleet
  - Integrations
- Finish semantic isolation for the two partial workspaces:
  - Reports
  - Intelligence
- Each contextual destination must:
  - have a unique route/state contract;
  - render only its own primary workflow;
  - expose only actions relevant to that workflow;
  - avoid unrelated giant vertically stacked panels;
  - preserve tenant/branch/permission authority from the server.
- Introduce stable page composition primitives: page header, action bar, filter bar, content grid, data table, form drawer/modal or dedicated form page, empty/error/loading states.
- Eliminate page layouts where unrelated functions are stacked simply because they share a primary workspace.
- Master Data must keep Category/Subcategory and Customer as separate contextual destinations; a capability existing in source is not considered discoverable when unrelated masters share one operator surface.

## Required evidence

- Browser test visits every visible contextual route and proves route -> expected heading/workflow mapping.
- Screenshot evidence for every Admin primary workspace at desktop and representative contextual destinations.
- Human check confirms navigation meaning matches rendered content.

## Exit criteria

- 14/14 primary workspaces valid.
- 63/63 contextual destinations mapped to semantically correct content or intentionally removed/merged with documented rationale.
- 0 visible contextual menu items that merely change selection while leaving unrelated content unchanged.
- Human IA acceptance PASS before moving to P2.

---

# P2 — Critical Transaction and Payroll Functional Completeness

**Depends on:** P1.

**Audit findings:** A-03, A-04.

**Atomic delivery boundary:** P2 is one complete delivery wave. P2A and P2B are internal implementation streams only; do not require operator apply/test/commit between them. Run focused tests internally as needed, then deliver one P2 FULL package, one full exact-source GitHub gate, and one atomic commit/push boundary.

## P2A — Multi-UOM end-to-end

Complete UOM lineage across all transaction families, not only POS/Purchase:

- online order item;
- fulfillment;
- sales return;
- order return;
- purchase return;
- refund/reversal;
- inventory/accounting/tax traceability.

Required persisted lineage where applicable:

- product unit identity;
- unit code/name;
- transaction quantity;
- conversion factor;
- base quantity;
- historical price/tax interpretation required for correct refund/reversal.

### Exit criteria

- Mixed-UOM order -> fulfill -> return/refund runtime journey preserves original UOM semantics.
- No reconstruction from current product-unit configuration for historical transactions.
- Accounting/tax/inventory amounts remain consistent after reversal.

## P2B — Payroll method completeness

Implement or explicitly remove from product scope:

- `GROSS`;
- `GROSS_UP`;
- `NET` / net-to-gross;
- effective-dated split-period/proration.

### Exit criteria

- UI no longer hard-locks a method that product documentation claims is supported.
- Runtime payroll scenarios cover method differences, mid-period effective-date changes, accounting posting, and rollback/recovery.
- No supported configuration returns `REQUIRES_REVIEW` merely because engine implementation is absent.

---

# P3 — Hidden Capability Productization and Maturity Truth

**Depends on:** P2.

**Audit findings:** A-05, A-06, A-08, A-11.

## Required work

### Retention/archive

Provide Admin operator surface for:

- policy list/create/update/enable-disable;
- archive execution;
- run history;
- status/error;
- checksum;
- artifact URI/provider;
- explicit safety confirmation.

### Security lifecycle

Expose:

- API-key rotate;
- active sessions inventory;
- logout-all/revoke sessions;
- audit feedback and confirmation.

### Daily summary ownership

Choose exactly one authoritative model:

- automatic worker-owned materialization with freshness/health evidence, **or**
- explicit Admin operations controls.

Do not leave ownership ambiguous.

### Capability maturity

For every feature catalog entry:

- align navigation visibility;
- align labels/help text;
- align feature flags;
- align permissions;
- align documentation maturity state.

Foundation/adapter-ready capabilities must not masquerade as finished production modules.

## Exit criteria

- No in-scope operator backend endpoint is unintentionally hidden.
- Every intentionally backend-only capability is documented as system-owned with runtime health evidence.
- Capability catalog matches actual runtime/product maturity.

---

# P4 — Legacy Surface Cleanup and Canonical Domain Ownership

**Depends on:** P3.

**Audit findings:** A-10 plus duplicated/ambiguous ownership discovered during P1-P3.

## Required work

- Deprecate/remove legacy `/sale-returns*` and `/purchase-returns*` aliases after compatibility verification; canonical `/returns/*` remains authoritative.
- Search for duplicate endpoints/services/workflows created during historical recovery.
- For each business concept, document exactly one canonical write path and one canonical ledger/source of truth.
- Remove compatibility aliases only after client/runtime evidence proves no active consumer remains.

## Exit criteria

- No duplicate public mutation surface without explicit compatibility/deprecation status.
- Canonical ownership documented for inventory, returns, accounting, payments, notifications, payroll, assets, marketplace, and summaries.

---

# P5 — Full Visual Product Rebuild

**Depends on:** P1-P4 functional/operator routes stable.

**Audit findings:** A-07 and video rejection.

This is a real visual rebuild, not a marker/test cleanup.

## Global visual requirements

- Consistent max content width and responsive gutters.
- Intentional 1/2/3-column grids with equal alignment where appropriate.
- No uncontrolled vertical “everything on one page” stacking.
- Consistent typography hierarchy.
- Consistent field heights, label spacing, action placement, section spacing, and card density.
- Tables prioritize information; row actions do not visually dominate data.
- Forms use dedicated pages/drawers/modals where needed instead of endless mixed panels.
- Empty/loading/error/success states use the same system.
- Sidebar hierarchy must clearly separate primary workspace, contextual destination, and account/system actions.
- Responsive layouts tested at desktop/tablet/mobile.
- POS, Storefront, Employee Portal, and Admin each receive product-specific composition rather than generic admin panels.

## Page-by-page rule

No workspace is accepted from global CSS alone. Each primary workspace and each high-value contextual workflow receives visual review against real content/data.

## Required evidence

- Baseline and after screenshots.
- Browser screenshot matrix at representative routes.
- Human operator review using real navigation, forms, tables, dialogs, error states, and long datasets.
- Visual defects become tracked work items; “tests green” cannot override rejection.

## Exit criteria

- Human UI acceptance PASS for Admin, POS, Storefront, and Employee Portal.
- No known severe asymmetry, excessive unused space, uncontrolled vertical stacks, misleading hierarchy, or unusable mobile geometry.

---

# P6 — Ubuntu-First Developer / Operator Experience and Repo Hygiene

**Depends on:** may begin after P0; must close before P7.

**Audit findings:** A-12, A-13, A-14.

## Required work

- Canonical Bash commands for setup, dev, seed, test, runtime UAT, backup/checkpoint, logs, and release verification.
- Remove obsolete Windows `.cmd`/`.ps1` launchers and keep npm/Node/Bash commands as the canonical operator path.
- README and handoff default to Ubuntu commands for the current operator environment.
- Remove committed generated logs/backups from normal source flow.
- Make checkpoint/handoff generation one-command and source-bound.

## Exit criteria

- A new Ubuntu operator can set up, run, inspect, test, and create evidence without CMD/PowerShell.
- No handoff instructs Windows commands as the primary path.

---

# P7 — Final Runtime Simulation, Human Stage-20, and Release Acceptance

**Depends on:** P0-P6 CLOSED.

## Automated final simulation

Run exact-source/exact-artifact evidence for:

- migrations;
- six-app build;
- API route sweep;
- critical mutation journeys;
- tenant/branch/permission denial matrix;
- multi-UOM order/return/refund;
- payroll methods and split-period;
- retention/archive;
- security lifecycle;
- worker/provider chains;
- accounting/tax/inventory consistency;
- load/index/DR/restore;
- browser contextual-route matrix;
- visual screenshot matrix;
- Ubuntu local preflight.

All CRITICAL/HIGH capability closures must reference executed evidence, not test filenames.

## Human Stage-20

Human Stage-20 is mandatory and cannot be auto-PASS.

Operator must validate at minimum:

1. Admin navigation and every major contextual workflow.
2. Master data lifecycle.
3. Procurement -> receiving -> inventory.
4. Commerce/order/POS -> payment -> fulfillment -> return/refund.
5. Multi-UOM transaction chain.
6. Finance/accounting/tax and close controls.
7. HR/attendance/payroll including supported tax methods.
8. Assets/fleet lifecycle.
9. Integrations/providers/marketplace/edge diagnostics.
10. Retention/security/session/API-key controls.
11. POS/Storefront/Employee Portal usability.
12. Desktop/tablet/mobile visual acceptance.

## Final release invariant

`PRODUCT_READY = true` only if all are true:

- P0-P6 CLOSED.
- Final exact-source automated simulation PASS.
- Human Stage-20 PASS.
- No unresolved CRITICAL/HIGH product finding.
- No known security credential leakage.
- Working tree clean and release commit == origin/main.
- Product status documents generated from canonical truth.

---

# Active priority order from the 2026-09-25 full audit

1. P0 truth/security/hygiene foundation.
2. P1 contextual workflow isolation.
3. P2A Multi-UOM completion.
4. P2B Payroll completeness.
5. P3 hidden capability productization.
6. P4 canonical/legacy cleanup.
7. P5 visual rebuild.
8. P6 Ubuntu/operator cleanup.
9. P7 final automated + human acceptance.

# Mandatory checkpoints

At the end of every wave, record:

- exact commit SHA;
- source fingerprint;
- files changed;
- product findings closed/remaining;
- static tests;
- runtime evidence where required;
- screenshots where UI changed;
- Human acceptance status;
- working-tree/remote sync state.

A checkpoint may say `SOURCE_IMPLEMENTED`, `RUNTIME_VERIFIED`, or `HUMAN_ACCEPTED`. These are distinct states and must never be collapsed into one generic “done”.
