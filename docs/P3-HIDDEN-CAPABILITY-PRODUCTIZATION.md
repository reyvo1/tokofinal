# P3 FULL — Hidden Capability Productization and Maturity Truth

Status: **IMPLEMENTED_RUNTIME_PENDING**
Delivery boundary: **one P3 FULL atomic wave**
Findings: **A-05, A-06, A-08, A-11**

## P2 prerequisite

P2 FULL is `RUNTIME_VERIFIED` on exact source:

- commit `899685ce23c08c8a0246867afc0c78a36507e674`
- source fingerprint `36af0df55489492e4389f7bf0a511bbaa60cae761937b77edcd310003cdfa04d`
- P2A mixed-UOM PASS
- P2 Payroll PASS
- Stage-19 PASS (11/11)
- Payroll staging PASS
- automated Stage-20 PASS
- R8 PASS
- aggregate PASS

Human Stage-20 remains PENDING and is not replaced by that automation.

## A-05 — Retention / archive operator ownership

Canonical Admin destination: **Settings → Data Governance**.

The operator can:
- list, create, update, enable and disable retention policies;
- explicitly execute an archive;
- inspect archive history, status and error;
- inspect rows processed, provider, artifact URI and SHA-256 checksum.

Archive execution is fail-closed without the exact confirmation `ARCHIVE`. Runtime storage remains provider-controlled; P3 does not claim local storage is a universal production provider.

## A-06 — Security lifecycle productization

Canonical Admin destinations:
- **Settings → API Keys**: create, rotate, one-time secret display, usage/expiry visibility and revoke;
- **Settings → Security**: 2FA plus active-session inventory, individual session revoke and logout-all.

Individual session revocation is same-user scoped and audited. API-key create/rotate/revoke is tenant scoped and audited. High-impact actions use explicit in-app confirmations rather than native browser prompts.

## A-11 — Daily summary ownership

P3 chooses exactly one owner: **ADMIN_EXPLICIT**.

`DailySalesSummary` and `DailyFinanceSummary` are materialized from authoritative Sale/Journal data through **Settings → Data Governance**. The worker is **not** claimed as automatic owner. Any future automatic materialization requires an explicit workflow change with freshness/health ownership and regression evidence.

## A-08 — Runtime maturity truth

Every seeded feature catalog record carries:
- source `maturity`;
- normalized `maturityClass`;
- `operatorVisibility`;
- `ownership`;
- operator `helpText`.

Normalized maturity classes:
- `OPERATIONAL` — Toko360 runtime capability intended to be operable;
- `LIMITED` — operator-visible but deliberately limited capability;
- `FOUNDATION` — platform foundation, not a finished operator capability;
- `ADAPTER_REQUIRED` — requires external/configured adapter and must not masquerade as complete.

Feature flag `enabled` and product completeness are separate facts. Scoped flag overrides merge with the catalog metadata so tenant/branch overrides cannot erase maturity truth.

## Exact-runtime closure

`npm run ci:p3:probe` must PASS on the exact non-production PostgreSQL source and prove together:
- active-session inventory;
- individual session revoke and revoked-token denial;
- API-key create, rotate and revoke;
- explicit Admin daily-summary materialization/read contract;
- retention policy lifecycle;
- invalid archive confirmation rejected;
- successful archive status, checksum, artifact URI/provider and history;
- runtime feature catalog maturity truth;
- expected audit events;
- `productionTouched=false`.

The P3 probe is mandatory in both GitHub full-system simulation and automated Full UAT and is consumed by aggregate reporting. P3 remains `IMPLEMENTED_RUNTIME_PENDING` until that exact-source evidence is green.
