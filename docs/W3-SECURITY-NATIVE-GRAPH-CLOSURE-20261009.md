# W3 — Native lockfile closure before GitHub release (2026-10-09)

Work item: `T360-20261009-101100` (IMPLEMENTATION). This hardens the existing
security-dependency resolver; it does not change Accounting Core, schema,
application manifest dependency classification, or policy thresholds.

## Failure class

The exact-source GitHub audit rejected `sharp 0.35.4` and `source-map-js 1.2.1`.
Earlier attempted scripts either kept the vulnerable lock, or dropped optional
Sharp from the new lock. The current candidate resolver creates an authentic
npm graph from all workspace manifests with scratch-only security pins, merges
only security package nodes, and retains their original optional flags.

A further failure mode occurs if the resolver emits only a *partial* patched
Sharp platform graph. npm may have omitted one or more platform-specific
packages during resolution on one host. `npm ci` on another host would then
fail or use a different image-processing binary. To prevent another terminal
trial, the merger and verifier now require each `@img/sharp-*` optional
package declared by patched `sharp` to exist in the candidate lock at its
exact declared version, with `optional: true`. Both Sharp and libvips
families remain mandatory. Real npm registry tarball integrity is still
required, and only the original lock's security subgraph may change.

## Quality and authority

A real npm 10 CLI exercise against an isolated local registry reproduces a
vulnerable optional dependency lock, regenerates patched native packages,
performs merge, then actually `npm ci --include=optional` and
`npm ci --omit=optional`. Negative controls reject missing platform packages,
required instead of optional native packages, wrong versions and a stale lock.
These are contract tests, **not** public npm registry attestation.

The read-only `w3-security-lock-recovery.yml` GitHub feature-branch workflow
remains responsible for authentic registry resolution, `npm ci`, unchanged
production HIGH/CRITICAL audit, and complete local UAT. Its output remains a
reviewable lock artifact, with exact-commit full-system GitHub and Human
Stage-20 still separate. Do not present a source-only green as a release.

## Operator boundary

No automatic promotion or GitHub push is made by this work item. Until an
authentic lockfile, audit, and official gate succeed, W3 remains IMPLEMENTATION.
Protect all previously posted journal evidence and all P5 gates.

## Actual installed runtime gate

The read-only GitHub lock-recovery workflow now runs
`node scripts/ci-verify-security-runtime.mjs` **after** authentic `npm ci`
and **before** the unchanged production audit and UAT. It checks installed
manifest versions, loads the real Sharp libvips binding and creates a 1x1
PNG in memory, and exercises `source-map-js` generator/consumer round-trip.
A missing native binding or wrong installed version is a hard failure.
The workflow still cannot push code or claim exact-commit release.
