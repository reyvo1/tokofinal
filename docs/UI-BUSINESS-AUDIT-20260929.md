# Audit UI dan alur operator — 29 September 2026

Work item: **T360-20260928-053000**, fase **VERIFICATION**, belum release-ready.
Branch: `codex/T360-20260928-053000-ui-business-audit`.
Baseline Git: `585891f3282fd2c600ca923afc0304360c4a3a43` ditambah perubahan working tree yang sudah ada sebelum sesi. Tidak ada commit/push atau checkpoint baru.

## Cakupan dan batas bukti

Audit source mencakup empat frontend, 14 domain Admin, 63 tujuan kontekstual, 420 kontrol yang terinventarisasi, dan pemetaan API/UI yang sudah tersedia. Review manual menelusuri bootstrap Admin, role/permission controller, pergantian cabang, pembelian/penerimaan, dan tema empat shell. Ini bukan bukti bahwa seluruh transaksi bisnis sudah diuji end-to-end.

Perubahan lama dipertahankan. Sesi ini tidak membuat ulang accounting/tax/inventory core, tidak mengubah schema, tidak menjalankan seed/reset/db push, dan tidak memakai data produksi. Fondasi domain tetap menjadi sumber kebenaran.

## Temuan yang diperbaiki

| ID | Prioritas | Masalah terverifikasi | Perbaikan |
|---|---|---|---|
| UIA-01 | Tinggi | `Promise.all` bootstrap Admin membuang seluruh hasil ketika satu API ditolak; HR/Finance dapat gagal memuat konteks karena endpoint supplier/gudang berbeda role. | Feed dibatasi sesuai guard controller, kegagalan diisolasi per feed, data lain tetap dimuat, kegagalan terlihat dengan tombol coba lagi. |
| UIA-02 | Tinggi | Respons lambat cabang/sesi lama dapat menimpa data cabang baru; draft menyimpan referensi gudang/PO lama. | Pemeriksaan token dan sequence, layar pemuatan saat konteks berubah, reset draft/modal serta operation key ketika pindah cabang. Komponen domain dilepas selama pergantian konteks. |
| UIA-03 | Tinggi | Workspace role-only yang tidak cocok tetap lolos karena tidak mempunyai permission prefix. | Dashboard/Organisasi role-only benar-benar dibatasi; identitas tidak tersedia tidak menampilkan navigasi; SUPER_ADMIN tetap mengikuti bypass permission untuk subdomain. |
| UIA-04 | Sedang | Header menampilkan subdomain pertama, sementara root `/master-data` dan `/people` dapat merender subdomain berbeda; label dari UiSchema dapat menyebabkan redirect berulang. | Resolver root memakai subdomain pertama yang terlihat; pemeriksaan workspace memakai key stabil, bukan label. |
| UIA-05 | Tinggi | Audit permission sebelumnya mencakup modules tetapi melewatkan mutasi pembelian/penerimaan yang langsung berada di `page.tsx`. | Tombol PR, PO, supplier, penerimaan/konfirmasi/penolakan, dan feature flags memakai kombinasi role dan permission controller. API tetap authoritative. |
| UIA-06 | Sedang | Teks operasional 8–11px, label menu panjang terpotong, baris aksi sulit membungkus; sidebar ponsel tertutup masih masuk accessibility tree. | Tipografi Admin diperbesar, label menu membungkus, kontrol minimum 40px, receipt row membungkus; sidebar tertutup memakai inert/aria-hidden dan dapat ditutup dengan Escape. |
| UIA-07 | Sedang | Browser menunjukkan judul POS gelap di latar gelap; panel judul, menu aktif dan kartu identitas Portal terang dengan teks putih; pengumuman Storefront menggunakan token warna latar sebagai warna teks. | POS memakai token teks semantik; Portal memiliki ownership surface tema untuk heading/identity/active nav; Storefront memakai token foreground. Tombol akun mobile diberi accessible name. |
| UIA-08 | Sedang | Audit kontrol berhenti pada operator `>` di atribut JSX, sehingga tombol notifikasi aktif dilaporkan inert. Audit POS masih mewajibkan utility latar terang yang bertentangan dengan dukungan dark mode. | Scanner atribut memperhitungkan string dan expression braces; gate POS memeriksa default light, CSS surface, dan dukungan dark eksplisit. Tidak ada penurunan gate API/domain. |

## Verifikasi

- Pemeriksaan awal workflow/repository: PASS.
- `npm run quality:fast`: PASS, termasuk lint/typecheck seluruh workspace dan 1083 test pada saat dijalankan.
- Regresi akhir `npm run test:dependency-free`: **1085/1085 PASS**, termasuk dua test tambahan; tidak ada skip.
- Regresi khusus resolver/loader/branch/theme: **8/8 PASS**; resolver dan loader asli dieksekusi, bukan hanya dicari sebagai string.
- `npm run audit:full:repo`: PASS, termasuk product completeness, 63/63 contextual destinations, canonical ownership, P5 visual, dan UI-domain-depth.
- `npm run build`: PASS untuk API, worker, Storefront, Admin, POS, Employee Portal. Storefront/Portal kemudian dibangun ulang setelah koreksi visual terakhir; keduanya PASS dengan exit code 0, dicatat di `logs/ui-audit-20260929/final-build-exit.json`.
- `git diff --check`: PASS.

Log lokal: `logs/ui-audit-20260929/`. Folder ini diabaikan Git; ringkasan bukti pada dokumen ini adalah catatan yang ditinjau bersama perubahan.

### Browser

Browser merender shell asli dan stylesheet Tailwind asli melalui fixture React lokal dengan data simulasi. Screenshot diperiksa untuk Admin, POS, Storefront, Portal; toggle tema, menu ponsel dan Escape diperiksa. Panel dummy pada fixture hanya menguji form/layout dan **bukan** bukti checkout/payroll/penerimaan bekerja.

- Admin: desktop dan 390px; menu panjang, root kategori, buka/tutup sidebar, menu tersembunyi tidak masuk accessibility tree.
- POS: light dan dark, desktop dan ponsel; masalah judul teramati lalu hasil perbaikannya diperiksa.
- Portal: light/dark desktop dan 390px; tujuh link mobile terlihat; heading dark diperiksa setelah perbaikan.
- Storefront: light/dark desktop dan 390px; pengumuman dan accessible name tombol akun diperiksa setelah perbaikan.
- Pengukuran DOM pada 390px: root Admin/POS/Storefront masing-masing `scrollWidth = clientWidth = 390`.
- Upaya matriks otomatis tambahan terhenti karena timeout browser; **jangan klaim** seluruh matriks 1024/1440 atau semua halaman domain telah lulus Browser UAT.

## Status pre-GitHub UAT — 3 Oktober 2026

1. **Idempotency source gap ditutup**: create order dan finance operation sekarang fail-closed tanpa operation key stabil, body/header key harus konsisten, Storefront/POS mempertahankan key yang sama untuk retry payload yang sama, dan staging integration runner menguji replay order tidak menggandakan resource. PostgreSQL concurrency tetap menjadi bukti runtime GitHub, bukan klaim source-only.
2. **Pagination payroll source gap ditutup**: component catalogue dan employee-component assignment memakai cursor pagination; assignment melakukan bounded candidate scan lalu branch-filter hanya kandidat tersebut. Admin menyediakan continuation controls dan tidak lagi memuat seluruh employee aktif cabang sebagai prasyarat.
3. **F10 direkonsiliasi menjadi `IMPLEMENTED_RUNTIME_PENDING`**: source memiliki explainable forecast/reorder, permission-scoped deterministic operator assistant, anomaly insight, confidence/source links, interaction history, dan human-confirmation guardrail. Tidak ada klaim external LLM/provider. **F9 tetap PARTIAL** sampai provider notifikasi eksternal benar-benar dikonfigurasi dan dibuktikan pada runtime.
4. **Masih wajib di GitHub/UAT**: exact-source PostgreSQL/authenticated multi-role runtime, replay/concurrency mutation, real four-Next production build/browser matrix, dan Human Stage-20. `productReady=false` sampai gate tersebut benar-benar lulus.
5. ~~Peringatan Next yang sudah ada~~ **SUDAH REKONSILIASI 2026-09-29**: `experimental.isolatedDevBuild` dihapus dari keempat `next.config.mjs`. Key itu memang sudah tidak dikenal oleh Next 16.3.5 (`node_modules/next/dist/server/config-schema.js` tidak memuatnya), jadi selama masih dibawa ia hanya mencetak warning "Unrecognized key(s) in object" pada setiap build tanpa mengisolasi apa pun. Pemisahan dev/build yang sebenarnya tetap dibawa `tsconfig.build.json` yang mengecualikan `.next/dev/**/*`, dan tidak dilonggarkan. Test isolasi sekarang mengunci key itu absen sekaligus memverifikasi bahwa schema Next yang terpasang memang sudah tidak mengenalnya.

## Dampak dan rollback

Database/migration, accounting core, tax core, payment core, payroll core, aset/armada core, inspection core dan sync protocol: **NONE pada perubahan sesi ini**. Inventory/procurement operator: role-aware action dan reset referensi cabang. Security/privacy: role navigation serta pencegahan tampilan data konteks lama. Performance: request yang pasti tidak diizinkan tidak dijalankan; bootstrap tetap bounded oleh limit endpoint yang sudah ada. Tidak ada data rahasia ditambahkan.

Rollback hanya hunk sesi ini pada navigation/domain resolver, bootstrap/page, empat presentation shells/CSS dan audit parser. Jangan reset working tree atau revert seluruh file, karena file-file tersebut sudah berisi perubahan pengguna sebelumnya. Tidak ada rollback database.

Work item tetap **VERIFICATION**. P6, commit/push, dan release mengikuti gate visual/UAT yang masih terbuka; build hijau tidak mengubah status product-ready.
