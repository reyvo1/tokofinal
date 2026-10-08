# R7 — Full Tailwind UI / Information Architecture Rebuild

## Scope
R7 starts only after R1–R6 functional prerequisites are closed. Primary findings are F45 (canonical chart strategy) and F46 (information architecture). R8 owns final mutation/release UAT depth.

## Canonical operator architecture
Admin renders one primary sidebar, one contextual secondary navigation, and one content surface. The primary layer exposes 14 explicit workspaces: Dashboard, Penjualan & Order, Pembelian, Persediaan, Kontrol Operasional, Produk & Master Data, Keuangan, Laporan & Analitik, HRIS & Payroll, Aset & Armada, Forecast & Otomasi, Integrasi & Notifikasi, Tenant & Organisasi, and Pengaturan & Akses.

## Canonical analytics
Dashboard charts are built through reusable `charts.tsx` primitives. They use the canonical blue accent plus neutral surfaces, no decorative gradients, accessible SVG/figure semantics, native tooltips, and responsive geometry. Per-widget hard-coded palette strategies are forbidden.

## Runtime acceptance
`browser-uat.mjs` proves:
- canonical Admin analytics are rendered;
- every visible primary workspace and contextual destination can be navigated;
- Admin, POS, Storefront, and Employee Portal fit 1440x900, 1024x768, and 390x844 without page overflow;
- success screenshots exist.

`ci:r7:probe` binds those checks to the current source fingerprint. Both PostgreSQL workflows and aggregate release evidence require the R7 probe to PASS.

## Separation from R8
R7 does not claim final release readiness. R8 remains responsible for safe mutation journeys, exact release/UAT evidence, and all R8-owned finding closure. Human Stage-20 remains PENDING until operator visual/usability acceptance.
