# Video benchmark enhancement — 2026-10-04

Baseline authority: green commit `93e74f6b43aa4a77a38ae21a2cb459b59c0f4993`.

The supplied video is used as a refinement benchmark. It does not replace Toko360's tenant, inventory, accounting, permission, worker/outbox, migration or UAT contracts.

## Delivered in this wave

- Manufacturing: versioned BOM/recipe, production orders, atomic component consumption/output stock, WIP accounting, audit and moving-average output cost.
- PPOB foundation + Digiflazz adapter: encrypted connection, cached prepaid catalog, idempotent transaction/recheck, worker-owned provider HTTP.
- Product tooling: HET ceiling, bounded CSV dry-run import/export, Code128 label generation and A4/58mm print layout.
- Setup Readiness: server-derived operator checklist for company/branch/warehouse/users/products/accounts/payment references/costing/integrations. Deployment migration and seed remain outside the UI.
- POS RawBT: Android deep-link transport for the same canonical ESC/POS receipt bytes, additive to existing digital/browser/WebUSB/WebBluetooth paths.

## Deliberately not claimed

- FIFO cost-layer valuation is **not** implemented by changing a label or setting. The current canonical costing method remains `MOVING_AVERAGE`. True FIFO requires cost layers across receiving, production, sale, return, transfer and reversal and must be delivered with complete accounting/inventory evidence before it can replace the current method.
- PPOB external-provider readiness depends on a real Digiflazz account/credential and remains represented as adapter-required until provider acceptance evidence exists. Secrets are not stored in source.
- Setup Readiness is not a web installer. Schema migration/seed/deployment remain controlled operator/CI procedures.

## Release gates

No gate is removed or weakened. This wave must pass schema parity/rehearsal, dependency-free regression, TypeScript/lint/build, repository/UI/recovery audits, local pre-GitHub UAT, then the same exact-commit GitHub Workflow Governance + Full System Simulation + Full Automated UAT gates.
