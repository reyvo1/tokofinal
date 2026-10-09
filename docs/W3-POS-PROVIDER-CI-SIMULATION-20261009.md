# W3 — POS hardware and Digiflazz provider CI simulation (2026-10-09)

## Authority and scope

Follow `docs/DEVELOPMENT-KIT.md` device-bridge and provider-adapter design, `AGENTS.md`, the W2 prepayment/refund ADR, and the active `T360-20261009-101100` W3 Accounting Core work item. This is an **additive verification milestone** for the existing W2/W3 source, not a new transport, ledger, schema, vendor integration, or production feature flag.

## Executable CI contract

`npm run ci:peripherals:simulation` runs on Node 22 and imports **the actual POS source** `apps/pos/lib/printing.ts` and `apps/pos/lib/barcode.ts`. It injects a memory-only printer connection and simulated keyboard events. It checks:

- Both 58 mm and 80 mm ESC/POS receipts include the current transaction number and correct total, start with reset, finish with cut, and produce byte-identical RawBT base64.
- Both cash drawer pin pulses, disconnected transport, and rejected device writes. Device write failures must be reported, not mistaken for success.
- Scanner timing burst with Enter, non-interference with manual input focus, shortcut keys, and a slow-scanner/typing barrier.
- Loopback Digiflazz catalog/transaction signatures, four terminal/pending/ambiguous outcomes, deterministic replay, rejection of changed destination under one provider reference, and rejection of unknown SKU or incorrect signature.
- Compatibility with existing generic Telegram/WhatsApp simulator requests. Never contact real hardware, provider accounts, or live endpoints.

The GitHub `Full System Simulation` and `Full Automated UAT` workflows run this gate. Both remain **FAIL** if it fails: Full System has a hard-failing step; Full Automated UAT includes its outcome in the existing final aggregate. Evidence is written to `handoff/quality/ci-peripheral-contract-simulation-latest.json` with source fingerprint, checks, `simulatedOnly: true`, `physicalAcceptance: PENDING`, `providerCertification: PENDING`, and `productionTouched: false`. Existing 12 source-critical UAT coverage, PostgreSQL, worker/browser probes, Stage-19/20, and Human Stage-20 are unchanged.

The combined provider simulator still listens only on `127.0.0.1`; Digiflazz is disabled unless `CI=true` and `T360_UAT_ENVIRONMENT=GITHUB_STAGING_SIMULATION` with explicit fake credentials for its CLI mode. The standalone test injects fake credentials in memory. Signatures, destination numbers, and credential headers are redacted from Digiflazz evidence. Unknown vendor statuses are `PENDING` at the real worker; this simulator exercises the provider wire response but is **not** proof of production Digiflazz certification or end-to-end paid PPOB fulfillment.

## Tests and rollback

Focused: `node --test tests/ci-peripherals-simulation-wiring.test.mjs && npm run ci:peripherals:simulation`.
Official: `npm run uat:pre-github:local` on Ubuntu; then exact-commit GitHub Full System Simulation + Full Automated UAT.

Rollback restores only the updated source/work item/handoff and removes added scripts/tests/docs. No database or posted cash/ledger row is altered. The device simulator is not enabled in production and does not change public cashier controls.

## Remaining release boundaries

A real printer's manufacturer-specific UTF-8 codepage, Android RawBT installation, electrical drawer pinout, fingerprint/GPS biometric hardware, and live Digiflazz provider acceptance cannot be certified from a GitHub simulation alone. These are integration acceptance tasks, **not blockers to writing or running deterministic protocol tests**. Human visual P5/Stage-20 must remain separate.
