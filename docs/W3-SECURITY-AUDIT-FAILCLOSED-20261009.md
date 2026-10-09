# W3 — npm production audit: fail-closed source contract (2026-10-09)

Work item: `T360-20261009-101100` (W3 cash/Accounting Core; current GitHub HIGH dependency audit blocker).

## Defect addressed

`ci-audit-production-deps.mjs` previously interpreted a missing `metadata.vulnerabilities` as zeros. A truncated response like `{}` with a successful process exit could therefore be reported as `PASS`; a report with `metadata.high=0` but a `vulnerabilities` entry marked HIGH could also pass. The diagnostic `ci-propose-security-dependency-refresh.mjs` had an additional false-clean path if npm returned a nonzero exit with clean metadata.

## Boundaries/invariants

- Both existing production security gates retain **HIGH and CRITICAL** as blocking, including real SHA/registry/npm audit and the unchanged local/GitHub UAT.
- A candidate must contain the complete npm audit v2 `metadata.vulnerabilities` count set (`info`, `low`, `moderate`, `high`, `critical`, `total`) and a `vulnerabilities` object. Counts must be nonnegative integers, sum to total, and correspond to the actual severity distribution in reported entries. Missing/malformed/inconsistent/registry-error results are failures, never zero findings.
- A valid zero-vulnerability report continues to PASS; a valid HIGH report continues to FAIL with package/advisory details. No security suppression, `npm audit fix`, `--force`, or deployment change was added.
- The isolated diagnostic proposal additionally refuses npm CLI nonzero exits that lack a legitimate HIGH/CRITICAL finding.
- Source, schema, payment/accounting behavior, work item phase, migration and main GitHub workflow identity are unchanged. `productReady=false`; Human Stage-20 remains PENDING.

## Verification

Focused, dependency-free tests include the genuine production audit CLI invoked with a deterministic fake npm executable (stdout/exit only). They cover normal clean reports, HIGH findings, missing metadata, hidden HIGH severity, missing HIGH details, incomplete totals, malformed entries and CLI/registry failures. The npm-v2 report is **simulated**, not evidence of a real registry audit or patched public dependency tree.

Local source-only verification command (when the authentic repo source is available):

```bash
node --test tests/github-production-dependency-audit.test.mjs tests/github-production-dependency-audit-failclosed.test.mjs tests/github-security-dependency-proposal.test.mjs tests/w3-security-github-recovery-gate.test.mjs tests/security-lock-resolver-contract.test.mjs tests/security-lock-real-npm-regression.test.mjs
```

Official gates still required **after an authentic npm lock resolution with public registry access**: `npm ci --include=optional --no-fund`, `npm run ci:audit:production`, `npm run uat:pre-github:local`, followed by exact-commit GitHub Full System Simulation and Full Automated UAT. The artifact **must not be promoted or pushed on these source tests alone**.
