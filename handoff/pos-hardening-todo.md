# Toko360 — POS Hardening & Feature Wave

Mulai 2026-09-29. Semua item di bawah hasil audit langsung ke `apps/pos` dan `apps/api/src/sales`,
bukan tebakan. Yang sudah ada dipertahankan; yang rusak diperbaiki; yang hilang dibangun.

## Prioritas 1 — merusak operasional (kasir tidak bisa bekerja)

- [x] **1.1 Paginasi katalog POS** — `page.tsx:179` memanggil `/products?limit=100` lalu
      `pageInfo.nextCursor` TIDAK PERNAH dibaca (hanya muncul di deklarasi tipe baris 13).
      Konsekuensi: produk ke-101 tidak bisa dicari/dijual, tanpa error. Pelanggan `limit=100` juga.
- [x] **1.2 Offline store localStorage → IndexedDB** — `lib/offline.ts` menyimpan seluruh snapshot
      katalog sebagai satu string JSON. Batas localStorage ±5MB; katalog 10k produk dengan
      units/barcodes/inventories akan menabrak `QuotaExceededError`, dan `saveOfflineSnapshot`
      tidak punya try/catch sehingga satu produk yang tak muat mematikan seluruh simpanan offline.
- [x] **1.3 Barcode keydown listener global** — tidak ada `keydown` listener di POS. Scanner hanya
      jalan kalau kolom pencarian terfokus. Butuh buffer karakter cepat + deteksi Enter.

## Prioritas 2 — kontrol akses (kasir biasa melakukan tindakan supervisor)

- [x] **2.1 Supervisor PIN dialog** — retur, price override, diskon kustom butuh supervisor.
      Backend sudah membedakan role (CASHER vs FINANCE untuk refund), tetapi tidak ada dialog PIN
      di POS. 0 hit untuk supervisorPin/requireSupervisor.
- [x] **2.2 Fuzzy search** — baris 269 hanya `String.includes()`. Ketik "gula" tidak match typo,
      tidak ada toleransi urutan karakter.

## Prioritas 3 — fitur yang diminta dan tidak ada (0 hit, sudah dikonfirmasi)

- [x] **3.1 ESC/POS thermal printer + cash drawer kick** — 0 hit untuk escpos/cashDrawer/WebUSB/
      WebBluetooth. Butuh byte kick-out RJ11.
- [x] **3.2 Reprint struk** — 0 hit. Tidak ada jalan cetak ulang struk dari riwayat.
- [x] **3.3 Click & Collect** — 0 hit. Bayar di Cabang A, ambil voucher di Cabang B.
- [x] **3.4 Service fee** — 0 hit untuk serviceFee/serviceCharge.

## Verifikasi (wajib, setiap item)

- [ ] Regression test dengan negative control (kembalikan bug → merah → pulihkan → hijau)
- [ ] UAT browser POS via cdp.py: login → render → console error 0 → 1440/1024/390
- [ ] test:dependency-free hijau
- [ ] quality:full exit 0 (dev server dimatikan, PATH="$PWD/node_modules/.bin:$PATH")
- [ ] audit:full:repo exit 0

## Yang TIDAK boleh dilanggar

- Tidak commit, tidak push. Milik Rey.
- Jangan menglonggarkan assertion test demi hijau — tulis ulang ke maksudnya.
- Jangan mengarang angka baseline — regenerate dari generator.
- Jangan mengklaim selesai sebelum UAT browser jalan.


## Log

### 1.1 DONE — cursor walk + server search
- `apps/pos/lib/catalog.ts` (BARU): `loadCatalog` (walk), `loadCatalogPage` (sisa halaman), `searchCatalog`
- `page.tsx`: `loadData` pakai walker; state `catalogCursor/catalogHasMore/serverMatches`; tombol
  "Muat lagi katalog"; `visibleProducts` memakai jawaban server saat online
- tsc POS: 0 error
- `tests/pos-catalog-pagination.test.mjs` 5 test — NEGCTL 3/3 merah (satu halaman / tanpa server
  search / tanpa dedup), restore hijau

### 1.2 DONE — IndexedDB store dengan migrasi
- `apps/pos/lib/offline-store.ts` (BARU): snapshot/catalog/queue + index barcode/sku/name
- `lib/offline.ts`: `readOfflineSnapshot` (IDB -> fallback localStorage), `persistOfflineSnapshot`
  (tulis IDB dulu, baru hapus key legacy — urutan ini mencegah kehilangan katalog saat disk penuh)
- `page.tsx`: `loadData` await snapshot; outcome `stored.ok` diperiksa dan dilaporkan ke operator
- Angka terukur: 704 byte/produk -> 5MB hanya muat 7.447 SKU; 10.000 SKU MELEDAK
- `tests/pos-offline-store-idb.test.mjs` 5 test
- KOREKSI DIRI: NEGCTL 1 awalnya HIJAUL karena assertion cuma cari string "indexedDB.open(" —
  cabang mati `null && indexedDB.open(` juga memuatnya. Diperbaiki ke assertion call nyata.
  Ini bukti bahwa "hijau" tidak berarti "terbukti" tanpa negative control.

### 1.3 DONE — global scanner listener + fuzzy search
- `apps/pos/lib/barcode.ts` (BARU): `createBarcodeListener` (5 guard berlapis) + `fuzzyRank`
- `page.tsx`: effect mount listener di `window`; scan -> `setSearch(barcode)` (satu jalur lookup);
  `visibleProducts` pakai `fuzzyRank` bukan `includes()`
- `tests/helpers/import-ts.mjs` (BARU): transpile TS via esbuild supaya test MENGEKSEKUSI
  perilakunya, bukan cuma grep source — kontrak scanner itu timing, mustahil dibuktikan regex
- `tests/pos-barcode-scanner.test.mjs` 13 test
- NEGCTL 6/6 merah (A: semua guard input, B: semua timing, C: pause-reset, D: modifier,
  E: fuzzy no-op, F: ranking dibalik), restore hijau

TEMUAN SESAAT:
- `instanceof HTMLElement` di `defaultIsHumanTypingTarget` bikin crash di luar browser (HTMLElement
  tidak terdefinisi). Diganti duck-typing — juga benar untuk cross-realm iframe.
- Guard scanner saling menutupi: menghapus SATU guard tidak menjatuhkan test. Baru terbukti saat
  dilepas sebagai RANTAI. Test yang "hijau" tidak otomatis "terbukti".
- `fuzzyRank` versi awal memberi skor prefix(80) > word-start(60), jadi "coklat" mendahulukan
  "Coklat Bubuk" di atas "Susu Coklat UHT". Word-start harus lebih tinggi.
- Flake: `setTimeout(5)` diukur jadi 6ms di bawah beban suite paralel -> burst "cepat" salah
  diklasifikasi. Diganti busy-wait eksak + margin 0ms(scanner) vs 150ms(manusia).
- Skrip negative control sempat TRUNCATE `barcode.ts` ke 0 byte karena menulis sebelum menyimpan
  original.Sekarang restore di `finally`. File dipulihkan penuh.

### 2.1 DONE — supervisor approval (API + POS)
- Schema: `supervisorPinHash`, `canApprovePrivilegedActions`, `supervisorPinUpdatedAt` di 3 schema
  (prisma + sqlite + postgres). `db push` sukses, parity test 4/4.
- `apps/api/src/supervisor-approval/`: service + controller + module. Grant = capability 5 menit,
  single-use, scoped company, WAJIB role berflag. 5x PIN gagal -> 429. Audit GRANTED + FAILED.
- Gate diskon 20% di `create()` (commit path), bukan `quote()`.
- POS: `lib/supervisor.ts` hook + `SupervisorPinDialog`, grant dikirim via `supervisorApprovalId`.
- 3 error TS ditemukan & diperbaiki: guard path, `TooManyRequestsException` tidak ada di Nest,
  `User` tidak punya `companyId` (tenancy via `branch.companyId`).
- NEGCTL 8/8 merah.
- Test `tests/supervisor-approval-control.test.mjs` 10 test.

BUG YANG DITANGKAP TEST: gate diskon awalnya terpakai di `quote()` (baris 359), bukan `create()`.
`quote()` jalan tiap ketikan -> grant TERPAKAI saat preview, lalu transaksi asli DITOLAK. Test
"commit path not preview" yang menangkapnya.

### 2.2 DONE — fuzzy search (bagian 1.3)
`fuzzyRank`: exact 100 > word-start 80 > prefix 60 > contains 40. `isWordStart` pakai Unicode
property escape, bukan `\b` (yang ASCII-only dan salah untuk nama produk Indonesia).

### 3.1 DONE — ESC/POS + laci kasir
- `apps/pos/lib/printing.ts`: byte ESC/POS, drawer kick pin 2 (0xfa) & pin 5 (0xf5),
 GS V B cut, init ESC @, layout per lebar roll (58mm=32, 80mm=48).
- `tests/pos-escpos-printing.test.mjs` 7 test, byte drawer dikunci persis: `1b 70 fa 08 00 40 00`.
- NEGCTL 7/7 merah.
- BUG: `buildReceipt` mengirim `{label,value}` ke `formatColumn({left,right})` -> TypeError,
  struk total gagal build. Tertangkap test, diperbaiki.

### 3.2 DONE — reprint struk
Endpoint `GET /receipts/:saleNumber` sudah ada tapi HANYA untuk transaksi terakhir. Ditambah panel
"Struk transaksi" (10 terbaru) + tombol "Cetak ulang" per baris.

### 3.4 DONE — service fee (dengan akun jurnal)
- Schema: `Sale.serviceFee` di 3 schema, parity 4/4, `db push` + regenerate client.
- `serviceFeeFor()`: negatif -> 0, melebihi settlement -> di-clamp. Input dari body tidak dipercaya.
- Jurnal: `amounts.serviceRevenue` + `accountCodes.serviceRevenue: '4102'` (Pendapatan Jasa, di-seed).
- 3 aturan SALE (CASH/BANK/SPLIT) dapat credit line `serviceRevenue` dengan `skipIfZero`.
- POS: input + baris display + ikut `displayTotal`; offline DITOLAK (engine offline tidak model fee).

JEBAKAN YANG DIHINDARI: `postOperationalEvent` membangun baris jurnal dari `AccountingPostingRule.journalLines`
lalu CEK debit == kredit. Menambah fee ke `settlement` tanpa credit line akan melempar
"Jurnal tidak seimbang" dan MENOLAK SETIAP transaksi ber-fee — bukan menghasilkan jurnal salah.
Test `the ledger balances` + identitas aritmetikalah yang menangkap ini.
Fee juga TIDAK boleh masuk 4101 (penjualan barang) — laba rugi cabang akan salah.

### 3.3 DONE — Click & Collect dari POS
- `apps/api/src/inventory/cross-branch-stock.controller.ts` (BARU): `GET /inventory/cross-branch-stock/:productId`,
  tenant-scoped via `branch.companyId`, branch operator dari SESI (bukan query param), stok
  dijumlahkan per cabang lintas gudang, `warehouseId: null` bila tersebar.
- `apps/pos/lib/click-collect.ts` (BARU): `planPickup` (hanya cabang yang bisa memenuhi seluruh
  pesanan) + `pickupVoucherLines`.
- POS: tombol "Ambil di cabang lain" per item keranjang + panel voucher.

ALASAN ARSITEKTUR: pickup TIDAK lewat `/sales`. Penjualan POS memindahkan stok di gudang tempat
menjual; membayar di A untuk barang fisik di B akan membuat buku A kurang satu unit yang masih ada,
dan B tak bisa memenuhi. Jadi lewat pipeline ORDER (`fulfillmentType: 'PICKUP'`) yang me-reserve
tanpa menjual.
- NEGCTL 7/7 merah (termasuk "controller tidak didaftarkan" — Nest gagal saat BOOT, bukan build).

## Status gate (menjelang final)

- `test:dependency-free`: 1334/1334 hijau, naik dari 1286 baseline (+48 test baru)
- tsc API & POS: 0 error
- TypeScript authority (Next): 11 files PASS
- Route count: 503 -> **507** (3 supervisor-approval + 1 cross-branch-stock)
- Interactive controls: 443 -> **456**
- NEGCTL total yang dijalankan: 3+4+6+8+6+7+7+8 = **49 negative control, semua merah**

KOREKSI: assertion `route count` semula hardcode 503, harus di-bump dua kali dalam satu sesi
(506 lalu 507). Sekarang DIHITUNG dari dekorator controller di disk, jadi menambah route tetap
gagal — tapi gagal pada angka nyata, bukan angka yang diingat. NEGCTL (tambah 1 route tanpa
regenerate evidence) = merah, terbukti.

## MASIH BELUM SELESAI
- `quality:full` dan `audit:full:repo`: sedang dijalankan, hasil belum diketahui
- UAT browser POS: BELUM dijalankan. Semua 8 item terverifikasi lewat test terisolasi (byte ESC/POS
  dieksekusi, timing scanner dieksekusi, identitas jurnal dihitung), tapi belum ada satu pun
  screenshot atau klik manusia di port 3002.

## UAT LIVE (API nyata + DB nyata) — menemukan 2 bug yang TIDAK terlihat oleh test source-level

### BUG 1 — DI: `@UseGuards(JwtAuthGuard)` menduplikasi guard global
`JwtAuthGuard` didaftarkan global via `APP_GUARD`. Menulis `@UseGuards` di controller memaksa Nest
membuat instance KEDUA yang harus resolve `ApiKeysService` dari module itu sendiri:
`UnknownDependenciesException ... argument ApiKeysService at index [3]`.
**API tidak bisa boot sama sekali.** tsc hijau, 1334 test hijau, 6 build hijau — tidak ada gate yang
melihatnya. Hanya `node dist/main.js` yang triumphant.
Perbaikan: hapus `@UseGuards`, andalkan guard global.
Test: `tests/api-module-dependency-closure.test.mjs` +2 test (guard global tak boleh diulang; guard
lokal harus punya dependency di module-nya). NEGCTL: pasang ulang `@UseGuards` -> merah.

### BUG 2 — akun 4102 DUPLIKAT
Saya pilih 4102 untuk "Pendapatan Jasa". Seed SUDAH punya `['4102','Retur dan Potongan Penjualan']`.
Seed adalah upsert per kode, jadi definisi kedua diam-diam menang: jurnal tetap balanced, angka
benar, tapi TAFSIRNYA SALAH — pendapatan jasa masuk ke akun RETUR.
Baru terlihat saat membaca `JournalEntry` di DB. Diganti ke **4104** (kode kosong).
Test: seed tidak boleh punya satu kode dengan dua nama berbeda. NEGCTL: pasang 4102 lagi -> merah.

### BUG 3 (tertangkap UAT, sudah dikoreksi) — aturan jurnal di DB tidak ter-update
Uji pertama service fee: `Jurnal SALE-CASH tidak seimbang. Debit 59000, kredit 54000`.
Seed SOURCE sudah benar, tapi `AccountingPostingRule` tersimpan di DB dan belum di-seed ulang.
Artinya: **setiap transaksi ber-fee akan DITOLAK di kasir**. Test source-level tetap hijau.
Perbaikan: `prisma:seed:sqlite` dijalankan; aturan live terverifikasi punya `serviceRevenue`.

## Bukti live (angka nyata, bukan asumsi)
- `GET /supervisor-approval/status` -> 200 `{"configured":false,"approverName":null}`
- `POST /supervisor-approval/approve` -> **403 "Belum ada supervisor terdaftar di cabang ini"**
  (bukan "PIN salah" — perbedaan yang sengaja dirancang)
- `GET /inventory/cross-branch-stock/:id` -> 200, stok 25, `isCurrent:true`
- `?companyId=<asing>` -> **403** (tenant scope terbukti/request nyata)
- Sale diskon 60% tanpa grant -> **403** "Diskon di atas 20% memerlukan persetujuan supervisor."
- Sale diskon 10% tanpa grant -> **201** (gate tidak ikut memblokir)
- Sale serviceFee 7000 -> **201**, jurnal:
  `1101 Kas D=71000 | 4101 Penjualan C=64000 | 4104 Pendapatan Jasa C=7000 |
   5101 HPP D=44000 | 1301 Persediaan C=44000` -> **BALANCED 115000 = 115000**

## CACAT UI: dialog POS tidak bisa dijangkau (ditemukan UAT browser, hilang dari semua gate)

### Gejala
Dialog Click & Collect diukur **723 x 1490 px di dalam viewport 900 px**. Judul terpotong di
atas, tombol "Buat voucher" jatuh di bawah lipatan. Tidak ada cara menggulir ke sana.
Audit responsif tidak menangkapnya: ia hanya mengecek `overflowX`, dan dijalankan saat dialog tertutup.

### Akar masalah (bukan CSS, tapi containing block)
`.posWorkspaceSurface` memakai `backdrop-blur-xl`. **`backdrop-filter` membuat elemen itu menjadi
containing block untuk descendant `position: fixed`.** Jadi `position: fixed; inset: 0` pada modal
tidak lagi resolve ke viewport, tapi ke kotak section itu.
Terukur: overlay melaporkan `top=174 height=1190` di viewport 900 — terikat ke panel yang bisa
di-scroll, bukan ke layar.
**`max-h` pada card tidak menolong**, karena persentasenya dihitung dari kotak yang salah.

### Perbaikan
`apps/pos/app/modal-portal.tsx` (baru): portal ke `document.body` + Escape + focus trap.
`.modalOverlay` -> `items-start justify-items-center overflow-y-auto` (bukan `place-items-center`,
yang memusatkan child yang lebih tinggi dari viewport sehingga memotong kedua ujungnya).
`.modalCard` -> `max-h-[88vh] overflow-y-auto`.

### Bukti setelah perbaikan (diukur, bukan diklaim)
- overlay: `top=0 height=900` — persis viewport, **tidak ada ancestor containing-block lagi**
- isi pendek: card 263px, `fits: true`
- isi panjang (60 baris cabang): card ter-cap di **792px**, `cardFullyInViewport: true`
  (top 73 -> bottom 865 dari 900), `cardScrolls: true`, setelah scroll tombol `VISIBLE: true`
- Escape dengan keypress nyata, fokus di luar dialog: dialog tertutup
- UAT penuh: 0 console error, 0 exception, 0 failed request, no overflow di 1440/1024/390

Screenshot: `pos-cc-long.png`, `pos-after-esc.png`, `pos-uat.png`, `pos-clickcollect.png`

## Test: `tests/pos-modal-reachability.test.mjs` (8 test, 4 negative control merah)
Menkunksi CSS yang menentukan keterjangkauan, portal, Escape, guard SSR, dan **hook React nested**.
NEGCTL: `place-items-center` / tanpa `max-h` / `max-h 10vh` / escape balik ke `onKeyDown` overlay /
dialog inline / hapus mounted guard / hook di-nest di dalam `useEffect`.

## Catatan jujur soal dua test yang saya tulis salah
1. Heuristik **brace-depth** untuk mendeteksi hook nested **LULUS** terhadap bug persis yang ia
   tuju (NEGCTL hijau saat seharusnya merah). Src teks tidak tahu apa itu callback.
2. Versi berikutnya (paren-walk) **menandai yang BENAR sebagai salah**.
Akhirnya pakai **AST TypeScript** (`ts.createSourceFile`) — baru menangkapnya, dengan nomor baris.
Pelajaran: dua "test" pertama itu **vacuous**, dan NEGCTL yang hijau itulah yang membongkar, bukan
kebetulan.

## Koreksi evidence: urutan regenerate

`npm run audit:ui:domain-depth` **menurun** dari `config/f1-backend-ui-audit.json`. Menjalankan
hanya yang pertama menghasilkan angka **LAMA (503)** dan test route-count jadi merah, padahal
source-nya memang 507.

```
node scripts/run-f1-backend-ui-audit.mjs   -> config/f1-backend-ui-audit.json   (source of truth)
npm run audit:ui:domain-depth              -> config/p5-full-ui-root-audit.json (MEMBACA f1)
```

Setelah urutan benar: `apiRoutes: 507`, `apiControllers: 40`, `prismaModels: 195`.

## Status gate (run terakhir pada tree sekarang)

- `test:dependency-free`: **1351/1351 PASS** (dari 1334, +17 dari pekerjaan modal + DI)
- `tests/pos-modal-reachability.test.mjs`: 8/8, 4 NEGCTL merah
- `tests/api-module-dependency-closure.test.mjs`: 4/4, 1 NEGCTL merah
- `tests/pos-service-fee.test.mjs`: 8/8, 1 NEGCTL merah
- `tests/mutation-payload-dto-parity.test.mjs`: 5/5 (route count dihitung dari disk, bukan hardcode)
- tsc POS & API: 0 error
- Route: 507 · Control interaktif: 456
- NEGCTL kumulatif: 3+4+6+8+6+7+7+8 (POS) + 1 (DI) + 1 (service fee) + 4 (modal) = **55**

## Yang MASIH belum terverifikasi
- `quality:full` & `audit:full:repo`: sedang berjalan pada run ini; hasil belum diketahui
- Supervisor PIN **belum pernah diuji end-to-end dengan PIN asli** — seed tidak punya supervisor
  (`configured: false`), jadi jalur `approve` hanya terbukti menolak, belum terbukti menerima.
- Tujuh form operator masih belum pernah diklik manusia dengan token asli.
