# P1 — Admin Contextual Workflow Isolation

Status: **IMPLEMENTED_RUNTIME_PENDING**

## Scope

P1 isolates the Admin information architecture so contextual navigation changes the operator workflow, not only the selected tab. Canonical coverage is `config/admin-contextual-workflow-map.json` with 63 contextual destinations (the count grew 61 -> 62 -> 63 as destinations were split; the map and the fail-closed gate are the authority, not this sentence).

## Source implementation

- Procurement: Purchase Request, Purchase Order, Goods Receipt, Supplier are rendered independently.
- Commerce: Order, Fulfillment, Customer Return, and Channel surfaces are separated.
- Inventory Control: Overview, Batch/Serial, Transfer, Stock Opname, and Returns use explicit `OperationsView` modes.
- Operations Control: Inspection, Evidence, Gate Pass, and Delivery are isolated; Delivery uses the canonical `DeliveryLifecycle`.
- Assets & Fleet: Assets, Maintenance, Vehicles, and Trips/BBM render only their own lifecycle content.
- Integrations: Providers, Notification Center, External Connections, Devices/Sync, and Loyalty are isolated.
- Reports: Financial, Operations, Scheduled, and Owner Reporting are separated.
- Intelligence: Assistant, Forecast, Automation, and Report Schedules are separated.
- Existing isolated workspaces (Master Data, Organization, Finance, People, Settings) remain mode-routed.

## Governance

`npm run audit:admin:contextual` fails closed unless all 63 contextual destinations in `domain-workspaces.ts` have an exact source mapping and required mode contracts remain present.

## Remaining P1 evidence before closure

P1 is not HUMAN_ACCEPTED yet. Required next evidence after the atomic source wave is applied:

1. Admin TypeScript lint/build on the operator Ubuntu repo.
2. Browser navigation sweep for every visible contextual route with expected workflow heading.
3. Desktop screenshots for 14 primary workspaces plus representative contextual destinations.
4. Human IA acceptance confirming each submenu meaning matches the rendered content and no unrelated giant stacked surface remains.

P2 must not start until those P1 acceptance gates pass.
