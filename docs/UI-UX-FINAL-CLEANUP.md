# UI/UX Final Cleanup — 2026-09-11

## Tujuan

Tahap ini membersihkan empat surface pengguna Toko360 tanpa merombak business logic yang sudah lolos regression:

- Admin;
- POS;
- Storefront;
- Employee Portal.

Prinsip utamanya adalah **UI harus mengatakan keadaan runtime yang sebenarnya**. Kontrol dekoratif, angka hard-coded, status kesehatan palsu, promo palsu, dan aksi yang terlihat aktif tetapi tidak mempunyai workflow nyata dihapus atau diganti dengan state yang jujur.

## Admin

- Sidebar hanya menampilkan work area yang mempunyai view nyata.
- Duplikasi menu `Kas & Bank` dan menu placeholder lama dihapus.
- Mobile navigation ditambahkan ketika sidebar desktop disembunyikan.
- Search/company/notification controls yang sebelumnya dekoratif dihapus dari topbar.
- Footer tidak lagi mengklaim database/queue/storage sehat tanpa evidence runtime.
- Feature flag ber-impact tinggi memakai confirmation modal aplikasi.
- Payroll settlement dan Storefront fulfillment tidak lagi memakai native `window.prompt`.
- Retur/Transfer, Asset/Fleet, dan Owner Suite membedakan **loading**, **empty**, dan **HTTP error**.
- Owner Suite memakai local business date, jurnal POSTED sebagai bahasa UI, serta ikon Lucide alih-alih emoji dekoratif.

## POS

- Credential demo tidak lagi diprefill.
- Logout mencoba revoke server session sebelum membersihkan token lokal.
- Catalog membedakan loading dengan katalog kosong.
- Degradasi direktori pelanggan opsional ditampilkan sebagai warning; tidak disamarkan sebagai daftar kosong.
- Offline queue, server quote, tax cache, shift, dan payment safety yang sudah ada tetap dipertahankan.

## Storefront

- Klaim merchandising palsu seperti flash sale, diskon generik, rating bintang palsu, dan metode `MOCK_QRIS` dihapus dari customer UI.
- Quantity cart tidak dapat dinaikkan di atas stok katalog yang diterima dari server.
- Payment selection mempunyai busy/error state yang eksplisit.
- Public manifest tetap branch-scoped.
- Layout katalog/checkout dirapikan dan dibuat responsive tanpa mengubah lifecycle fulfillment/payment backend.

## Employee Portal

- Angka tugas/cuti hard-coded dihapus.
- Statistik yang terlihat berasal dari attendance dan payslip nyata.
- Work date menggunakan tanggal lokal browser, bukan `toISOString()` UTC yang dapat bergeser satu hari di zona WITA.
- Logout merevoke server session.
- Loading, success, error, dan empty state dipisahkan.

## Guard anti-regression

`tests/ui-final-cleanup.test.mjs` mengunci antara lain:

- hanya menu Admin yang benar-benar diimplementasikan yang boleh tampil;
- tidak ada fake health controls / demo credential prefill;
- tidak ada browser-native prompt/alert/confirm pada workflow yang dibersihkan;
- Employee Portal tidak boleh kembali ke angka hard-coded;
- Storefront tidak boleh memunculkan fake promotion/rating/MOCK_QRIS;
- cart quantity harus dikunci ke stok;
- operator modules harus membedakan HTTP error dari empty result;
- Owner Suite harus menggunakan local date + professional icon;
- POS harus menampilkan warning jika direktori pelanggan opsional gagal.

## Validasi tahap ini

- UI cleanup guard: **10/10 PASS**.
- Full repository regression: **321/321 PASS**.
- TypeScript/TSX files touched by UI pass: syntax transpile **13/13 PASS**.
- Repository validator + workflow validator: **PASS** sebelum final handoff regeneration; lihat `handoff/quality/latest.json` untuk recount final.

## Batas validasi yang tetap berlaku

Tahap ini adalah source/static cleanup. Karena workspace dependency penuh tidak tersedia di environment pengerjaan, belum diklaim:

- full Next.js production build keempat frontend;
- visual browser run dengan API/NestJS/PostgreSQL nyata;
- cross-browser/mobile device visual certification;
- real staging E2E dan performance/load certification.

Hal-hal tersebut adalah gate runtime berikutnya dan harus dilakukan di TEST/STAGING dengan dependency serta service nyata.

## UI-P7 final interface hardening

UI-P7 menyelesaikan cross-app accessibility/responsive layer untuk Admin, POS, Storefront, dan Employee Portal:
- keyboard skip-link ke primary workspace;
- focus-visible yang konsisten;
- `prefers-reduced-motion` untuk meminimalkan animasi/transisi;
- minimum 44px coarse-pointer touch target;
- semantic active navigation dengan `aria-current`;
- polite live status untuk connection/runtime state yang relevan;
- mobile horizontal workspace navigation tetap scrollable tanpa mengubah business flow.

Browser UAT literal contracts tetap dipertahankan. UI-P7 tidak memindahkan authorization atau business authority ke frontend.
