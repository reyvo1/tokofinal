# W3 — Akuntansi mutasi kas laci dan selisih shift (2026-10-09)

Authority: `T360-20261009-101100`, `docs/DEVELOPMENT-KIT.md`, `docs/DEVELOPMENT-WORKFLOW.md`, `apps/api/src/accounting-core/accounting-core.service.ts`.

## Scope

- `POST /sales/shifts/cash-movements`: transaction `SERIALIZABLE` mengikat `CashierCashMovement`, AccountingEvent `POSTED`, jurnal seimbang, audit, dan idempotency receipt secara atomik. Retry setelah shift tutup hanya mengembalikan transaksi awal jika jurnal POSTED terkait terbukti valid.
- `POST /sales/shifts/close`: selisih `closing - expected` disesuaikan melalui Accounting Core dalam transaksi yang sama dengan perubahan `CashierShift.status=CLOSED`. Selisih nol tidak membuat jurnal nol.
- Identitas company/branch dari `AuthUser` dan hubungan shift kasir. Tidak ada account code yang dikirim oleh POS.
- Rekap shift dan perhitungan kas fisik/retur/PPOB tetap menggunakan perhitungan sumber yang sama.

## Semantik wajib dan konfigurasi Finance sebelum memakai fitur

Akun kas laci `1101` harus `ASSET` aktif pada cabang. **Admin saat ini mengirim `accountCode` literal** pada editor aturan; gunakan `1101` (bukan teks `drawerCash`) di editor Admin. Core juga menerima `accountCodeKey: drawerCash` untuk konfigurasi API versi lanjut, tetapi tidak mewajibkan fitur editor yang belum ada. Finance harus menyediakan **akun lawan nyata, berbeda dari 1101**, memilihnya sesuai fakta dana/aset/kerugian, dan mengaktifkan empat `AccountingPostingRule` berversi untuk perusahaan yang berlaku pada business date. Aturan hanya dua baris berikut (semua `amountKey: "gross"`):

| eventType | debit | kredit | tipe akun lawan |
|---|---|---|---|
| `CASH_DRAWER_TRANSFER_IN` | `accountCode: 1101` | `accountCode: [kode ASSET lain yang disetujui Finance]` | ASSET |
| `CASH_DRAWER_TRANSFER_OUT` | `accountCode: [kode ASSET lain yang disetujui Finance]` | `accountCode: 1101` | ASSET |
| `CASHIER_SHIFT_SHORT` | `accountCode: [kode EXPENSE Finance]` | `accountCode: 1101` | EXPENSE |
| `CASHIER_SHIFT_OVER` | `accountCode: 1101` | `accountCode: [kode REVENUE Finance]` | REVENUE |

**Kode akun lawan dalam tanda kurung siku adalah placeholder dokumentasi, bukan kode rekening literal.** Finance membuat/menetapkan akun dan aturan melalui UI Accounting Core sebelum operator boleh melakukan transaksi. Tidak ada akun pendapatan/beban baru yang dibuat otomatis dan tidak ada tarif pajak yang diperkirakan. `CASH_IN/CASH_OUT` pada UI POS khusus **transfer antar-akun ASSET**; pengeluaran parkir, konsumsi, atau biaya operasional wajib memakai alur Finance Operations/Tax Core dengan perlakuan pajak sesuai kebijakan efektif, bukan melalui alasan bebas kasir.

Akun lawan dan jenisnya selalu diverifikasi terhadap cabang, aturan ACTIVE, window tanggal efektif, dan bentuk debit/kredit dua baris. Tidak valid → transaksi DITOLAK; tidak ada fallback jurnal palsu. Accounting Core tetap menolak periode fiskal SOFT_CLOSED/CLOSED serta AccountingCloseControl CLOSED dan menjamin saldo debit=kredit.

## Risiko dan batasan

- OpeningCash adalah **hitungan kas yang sudah ada**, bukan pendapatan baru: membuka shift tidak menambah jurnal.
- Tidak ada schema baru; AccountingEvent.sourceType/sourceId (`CashierCashMovement` atau `CashierShift`) menjadi referensi immutable audit. Transaksi historis **tidak dibackfill** menjadi POSTED tanpa bukti; retry receipt lama ditahan sampai rekonsiliasi Finance.
- Nominal awal dan akhir shift memakai 2 angka desimal maksimum; selisih lebih dari Rp10.000 di bawah expected tetap memerlukan persetujuan supervisor; setiap selisih yang tidak nol memerlukan aturan Accounting Core terlepas dari toleransi supervisor.
- `CASH_OUT` tetap membutuhkan persetujuan supervisor >5% kas tersedia. Operasi online dan tidak membuka path POS offline.
- Akun lawan bertipe ASSET untuk transfer tidak membuktikan kas penyimpanan telah benar-benar diserahkan; Finance wajib melakukan kontrol fisik/rekonsiliasi. Jurnal selisih yang sukses tidak menghapus kewajiban investigasi pencurian atau ketidaksesuaian kas.
- Rollback: hentikan mutasi/shift dengan aturan mapping tak sesuai, lakukan rekonsiliasi dan compensating journal melalui Accounting Core, jangan pernah menghapus event/jurnal atau memakai destructive schema migration.

## Verifikasi dan status

Tes sumber: `node --test tests/w3-cash-drawer-accounting.test.mjs tests/cash-ppob-financial-safety.test.mjs`. Gate wajib: `npm run workflow:validate`, `npm run validate:repo`, `npm run audit:full:repo`, `npm run uat:pre-github:local` dengan node_modules Ubuntu. Lalu PostgreSQL TEST untuk jurnal seimbang dan rollback/fault injection, exact-source GitHub Full System Simulation/Automated UAT, visual P5, dan Human Stage-20. Tidak ada status readiness yang dinaikkan oleh perubahan ini.

### Contoh baris format editor Admin (transfer IN, akun lawan 1199 HANYA bila Finance sudah membuatnya sebagai ASSET)

```text
DEBIT|1101|gross|Kas laci
CREDIT|1199|gross|Kas penyimpanan (contoh saja)
```

Angka `1199` hanya **contoh ilustrasi** dan tidak dibuat oleh installer/seed. Operator Finance harus memilih kode ASSET cabang yang sungguh ada; aturan OUT membalik DEBIT/CREDIT. SHORT menggunakan DEBIT akun EXPENSE / CREDIT 1101; OVER DEBIT 1101 / CREDIT akun REVENUE.
