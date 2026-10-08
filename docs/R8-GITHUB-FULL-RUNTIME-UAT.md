# R8 — GitHub Full Runtime UAT and Release Evidence

Status: SOURCE IMPLEMENTED / EXACT-RUNTIME VERIFICATION PENDING.

R8 is the final automated recovery evidence layer. It does not replace Human Stage-20 and it cannot be declared CLOSED until the exact-source R7 gate is PASS.

## F04/F05 — evidence separation

`npm run ci:uat:coverage` remains a source-contract inventory only. Its evidence is explicitly marked `evidenceClass: SOURCE_CONTRACT` and `runtimeClosure: false`.

`npm run ci:r8:probe` is the runtime closure layer. It binds the current source fingerprint and verified six-app build artifact to executed evidence from R1-R7, R8 reporting/security, Built Browser UAT, OpenAPI runtime sweep, provider simulation, worker execution, PostgreSQL DR, payroll recovery, and automated Stage-20.

The 12 critical UAT IDs are emitted with `executedEvidence` references; test filenames are not accepted as R8 runtime closure evidence.

## F06 — safe Browser mutation journeys

Built Browser UAT must emit `R8_SAFE_MUTATION_JOURNEYS` with at least two PASS journeys from distinct domains:

- HR Employee Master create/edit/deactivate/reactivate.
- Owner Daily Digest configuration mutation followed by restoration of the original hour.

Both run only in the synthetic GitHub UAT environment. The final R8 probe rejects missing mutation evidence or `productionTouched !== false`.

## F23/F24/F25/F44 — PostgreSQL runtime revalidation

`npm run ci:r8:reporting-security-probe` proves on the exact runtime:

- digest mutations are denied for an unauthorized restricted operator;
- disabled digest rejects manual send;
- low-stock preview includes a fixture where `available <= product.minStock`;
- unverified Telegram binding IDs are rejected;
- the same binding is accepted only after verification and remains the canonical stored recipient reference.

Fixtures/config are restored or deleted after the probe. Production targets are not used.

## Final R8 closure gate

Both PostgreSQL GitHub workflows execute the reporting/security probe and final `ci:r8:probe`. Full-system summary and GitHub UAT report surface both gates. Automated Stage-20 must pass while Human Stage-20 remains PENDING.
