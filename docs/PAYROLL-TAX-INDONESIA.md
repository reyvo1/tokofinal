# Konfigurasi Payroll dan Pajak Indonesia

Toko360 menyediakan rule engine berversi dan tidak mengunci tarif pajak/iuran di source code. Untuk Indonesia, konfigurasi biasanya mencakup PPh Pasal 21, BPJS Kesehatan, dan program BPJS Ketenagakerjaan yang relevan.

Rule set seed berstatus `DRAFT` dan mencantumkan referensi PP 58/2023 serta PMK 168/2023 untuk pola TER PPh Pasal 21. Tabel tarif dan parameter resmi harus diimpor dari sumber resmi, diverifikasi, diuji, disetujui, lalu diaktifkan berdasarkan effective date.

Jangan mengubah rule set yang pernah dipakai payroll. Buat versi baru dan simpan hasil, input, calculation trace, approver, checksum, dan legal reference. Pembaruan peraturan setelah rilis harus diperlakukan sebagai migrasi konfigurasi, bukan perubahan diam-diam terhadap slip lama.

Checklist sebelum production:

- Status PTKP/tax category setiap pegawai lengkap.
- NPWP/NIK disimpan sebagai secret reference.
- Metode gross/net/gross-up disepakati.
- THR/bonus dan masa pajak terakhir diuji.
- Tarif/batas upah BPJS telah diperbarui dan disetujui.
- Hasil sistem dibandingkan dengan perhitungan tenaga pajak/payroll yang kompeten.
- Bukti potong, file pelaporan, dan integrasi resmi dibuat sebagai adapter terpisah.

## Guard aktivasi rule — 2026-09-11

Engine tidak mengaktifkan tarif PPh/BPJS dari asumsi aplikasi. Rule set baru tetap `DRAFT` sampai parameter resmi dimasukkan dan diverifikasi oleh operator yang berwenang. Approval server akan menolak rule apabila `requiresOfficialRateImport=true`, rate berada di luar 0..1, lookup/progressive band kosong atau tidak valid, program jaminan sosial tidak memiliki kode, atau terdapat versi APPROVED untuk kode yang sama dengan effective-date range yang overlap.

Perhitungan payroll selalu menyimpan calculation trace dan rule version. Jika profile/rule tidak tersedia atau tidak efektif pada periode yang dihitung, hasil menjadi `REQUIRES_REVIEW`; approval payroll kemudian diblokir. Dengan demikian sistem lebih memilih menghentikan payroll daripada menganggap pajak atau iuran bernilai nol tanpa dasar rule yang sah.

## Effective-dated profile safety

Employee tax and social-security profiles are versioned by `(employeeId, effectiveFrom)`. P2 evaluates every effective-dated profile and every APPROVED statutory rule version that overlaps the payroll period. The engine splits the period into deterministic UTC-day segments, allocates actual effective-dated component amounts to those segments with exact remainder handling, and applies profile/rule semantics only to their real active ranges. Coverage gaps still fail closed as `REQUIRES_REVIEW`; a valid mid-period change no longer does.

## Koreksi payroll setelah posting

Payroll yang sudah `POSTED` atau `PAID` tidak diubah. Koreksi dibuat sebagai differential adjustment run terhadap payroll sumber. Adjustment mewarisi rule set sumber kecuali operator memilih versi replacement yang sudah `APPROVED` dan valid; engine tetap tidak mengarang tarif PPh/BPJS.

Untuk kewajiban eksternal, koreksi negatif hanya dapat mengurangi bagian PPh/BPJS/potongan yang belum dibayar dan belum dicadangkan oleh settlement aktif. Draft/approval pembayaran yang akan menjadi terlalu besar setelah koreksi harus dibatalkan atau disesuaikan terlebih dahulu. Jika pembayaran ke otoritas/provider sudah terjadi, sistem fail-closed dan meminta rekonsiliasi refund/offset melalui workflow terpisah. Dengan cara ini perubahan payroll tidak dapat menghasilkan saldo kewajiban negatif atau settlement ganda secara diam-diam.

## Recovery R2 support truth — 2026-09-24

EmployeeTaxProfile, EmployeeSocialSecurityProfile, and PayrollAccountingMapping are operator-managed and effective-dated. P2 makes **GROSS**, **GROSS_UP**, and **NET** executable methods. GROSS deducts calculated tax from employee take-home; GROSS_UP solves a taxable allowance iteratively until allowance and tax converge to cent precision; NET records the tax as employer-borne cost without reducing employee take-home and preserves the gross-equivalent adjustment in calculation trace.

Effective-dated component assignments may split inside a payroll period when the component is marked `proratable`. Fixed/manual/formula amounts are prorated by actual active days; attendance/overtime components use attendance scoped to the assignment range. Tax/social profiles and APPROVED rule versions are evaluated by their real effective ranges. Unsupported or incomplete configuration still becomes `REQUIRES_REVIEW`, but supported method/split behavior must never do so merely because an engine is missing. Exact-source PostgreSQL closure is provided by the required P2 payroll runtime probe covering method differences, mid-period rule changes, balanced posting, paid-salary adjustment, employee-receivable recovery, and recovery settlement.
