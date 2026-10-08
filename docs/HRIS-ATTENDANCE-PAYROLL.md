# HRIS, Absensi, Payroll, Akuntansi Gaji, dan Portal Karyawan

Dokumen ini adalah acuan implementasi modul SDM Toko360 v0.4.0. Modul menggunakan feature flag sehingga perusahaan dapat memakai HRIS saja, absensi saja, atau seluruh payroll tanpa mengubah core perdagangan.

## 1. Ruang lingkup

- Data karyawan, departemen, posisi, mutasi penempatan, status kerja, kontrak, dan akun portal.
- Jadwal kerja, shift, hari libur, cuti, izin, sakit, lembur, koreksi absensi, serta approval.
- Absensi melalui fingerprint, face device, selfie + GPS, mobile GPS, QR, web, manual, dan import API.
- Geofence per toko/cabang, toleransi akurasi GPS, deteksi duplikasi, offline queue, dan audit log.
- Payroll berbasis komponen dinamis: gaji pokok, tunjangan, lembur, insentif, reimbursement, potongan, pajak, dan jaminan sosial.
- Slip gaji digital, pembayaran massal, jurnal akuntansi, utang gaji, utang pajak, dan utang jaminan sosial.
- Portal karyawan untuk melihat profil, riwayat absensi, slip gaji, serta pengajuan koreksi/cuti/lembur.
- Pengiriman notifikasi slip gaji melalui in-app, Telegram, WhatsApp, email, atau provider lain.

## 2. Prinsip fleksibilitas

Semua aturan dibuat sebagai konfigurasi berversi:

- `AttendancePolicy` untuk metode absensi, foto, lokasi, liveness, toleransi, dan mode offline.
- `TaxRuleSet` dan `TaxRule` untuk ketentuan pajak per negara/periode tanpa hard-code di source code.
- `SocialSecurityRuleSet` untuk iuran pekerja dan pemberi kerja.
- `PayrollComponentDefinition` untuk komponen gaji dan formula.
- `PayrollAccountingMapping` untuk mapping komponen payroll ke Chart of Accounts.
- `EmployeeNotificationPreference` untuk pilihan kanal setiap karyawan.

Perubahan peraturan tidak boleh mengubah hasil payroll periode lama. Payroll selalu menyimpan `calculationTrace`, snapshot absensi, rule-set version, dan slip snapshot.

## 3. Absensi fingerprint

Arsitektur:

```text
Mesin fingerprint/face
       ↓ LAN
Device Bridge di server toko
       ↓ signed API + externalEventId
Attendance API lokal
       ↓ outbox/sync
Server pusat
```

Mesin tidak menulis langsung ke database. Vendor adapter membaca log secara incremental, mengubahnya ke kontrak `AttendanceDeviceEvent`, lalu mengirim ke endpoint ingest. Setiap event wajib memiliki ID eksternal unik agar retry tidak menggandakan absensi.

Database tidak menyimpan gambar fingerprint mentah. `EmployeeBiometricCredential` hanya menyimpan `deviceUserCode`, reference template vendor, dan hash untuk validasi. Template biometrik tetap berada pada mesin atau vault khusus vendor.

## 4. Absensi foto dan lokasi

Alur:

1. Portal/aplikasi meminta izin kamera dan lokasi.
2. Sistem mendapatkan koordinat dan nilai akurasi GPS.
3. Foto dikirim langsung ke object storage melalui signed upload.
4. API menerima `objectKey`, lokasi, waktu, operation ID, liveness/face score jika digunakan.
5. Server menghitung jarak terhadap `AttendanceGeofence`.
6. Event ditolak atau masuk review bila lokasi/akurasi tidak sesuai kebijakan.
7. Bukti foto memiliki retention date dan dihapus otomatis setelah masa simpan.

Untuk production, nama file lokal atau base64 tidak boleh disimpan di database. Gunakan S3-compatible object storage, private bucket, encryption, signed URL, dan lifecycle retention.

## 5. Payroll

Tahapan payroll:

```text
Kunci periode absensi
→ tarik komponen gaji
→ hitung lembur/ketidakhadiran
→ hitung pajak dan jaminan sosial
→ review HR/payroll
→ approval
→ posting jurnal
→ pembayaran
→ terbitkan slip
→ kirim notifikasi aman
```

Status payroll: `DRAFT`, `CALCULATING`, `REVIEW`, `APPROVED`, `POSTED`, `PAID`, `CANCELLED`.

Perhitungan ulang menghapus line kalkulasi lama dalam run yang belum disetujui, lalu membangun kembali hasil dari snapshot input. Payroll yang sudah posted tidak boleh diedit; koreksi dilakukan melalui adjustment run.

## 6. Akuntansi payroll

Jurnal agregat contoh:

```text
Debit  Beban Gaji dan Tunjangan
Kredit Utang Gaji
Kredit Utang PPh Karyawan
Kredit Utang BPJS/Jaminan Sosial dan Potongan
```

Pembayaran gaji membuat jurnal terpisah:

```text
Debit  Utang Gaji
Kredit Bank/Kas
```

Pembayaran pajak dan jaminan sosial juga memakai jurnal pelunasan terpisah. Mapping akun tidak di-hard-code untuk semua perusahaan; `PayrollAccountingMapping` menentukan akun per cabang dan komponen.

## 7. Perpajakan dan jaminan sosial

Engine mendukung:

- Lookup table per kategori/status.
- Tarif progresif tahunan.
- Rekonsiliasi periode terakhir.
- Metode gross, gross-up, atau net melalui konfigurasi.
- Rule effective date, versi, approval, checksum, legal reference, dan audit.
- Iuran pekerja/pemberi kerja, batas upah minimum/maksimum, dan program yang dipilih.

Seed hanya membuat rule set berstatus `DRAFT`. Tarif resmi harus diimpor, ditinjau oleh bagian pajak, diuji dengan kasus pembanding, kemudian diubah menjadi `APPROVED`. Jangan menjalankan payroll production menggunakan rule set kosong.

## 8. Slip gaji dan notifikasi

Default delivery mode adalah `SECURE_LINK`:

- WhatsApp/Telegram hanya menerima pemberitahuan dan tautan aman.
- Karyawan harus login atau memakai token satu kali dengan masa berlaku pendek.
- PDF/slip tidak dikirim ke grup.
- Chat ID/nomor harus melalui proses binding dan verifikasi.
- Karyawan dapat menonaktifkan kanal tertentu.
- Semua percobaan kirim dicatat dan memiliki retry/dead-letter status.

## 9. Hak akses

Minimal permission:

- `employee.self`
- `employee.view`, `employee.manage`
- `attendance.record`, `attendance.view`, `attendance.manage`, `attendance.device_ingest`, `attendance.approve`
- `leave.manage`, `leave.approve`
- `overtime.manage`, `overtime.approve`
- `payroll.view`, `payroll.manage`, `payroll.calculate`, `payroll.approve`, `payroll.post`, `payroll.publish`
- `tax.view`, `tax.manage`

HR tidak otomatis berhak melihat jurnal; Finance tidak otomatis berhak mengubah absensi; karyawan hanya dapat melihat data miliknya sendiri.

## 10. Skala data

Attendance event, record, payroll line, notification delivery, dan audit log wajib memakai pagination dan indeks tanggal. Pada skala besar:

- Partition `AttendanceEvent` dan `AttendanceRecord` per bulan/tahun.
- Simpan event mentah sebagai append-only.
- Buat summary harian karyawan/cabang.
- Kalkulasi payroll dijalankan melalui worker per batch karyawan.
- Pembuatan slip dan pengiriman notifikasi melalui antrean.
- Foto dipindahkan ke cold storage atau dihapus sesuai retention.
- Laporan payroll besar menggunakan `ReportJob`.

## 11. Status implementasi v0.4.0

Sudah ada fondasi database, API dasar, kalkulasi komponen tetap, rule engine generik, jurnal agregat, portal karyawan dasar, event fingerprint adapter, GPS/geofence validation, payslip snapshot, notification queue, Telegram worker, dan WhatsApp provider webhook.

Canonical status, from `config/product-completeness.json` (this paragraph is the v0.4.0 narrative, not a closure claim):

| Feature key | Status |
|---|---|
| `hris` | FOUNDATION |
| `attendance` | PARTIAL |
| `attendance_photo` | FOUNDATION |
| `payroll` | IMPLEMENTED_RUNTIME_PENDING |
| `payroll_tax` | IMPLEMENTED_RUNTIME_PENDING |
| `employee_portal` | PARTIAL |

"Sudah ada fondasi" here means the foundation exists and is exercised in source. It does not mean the capability is product-complete; FOUNDATION and PARTIAL are explicitly non-complete states even when a feature flag is on. See `docs/COMPLETION-DOCS-INDEX.md`.

Masih memerlukan konfigurasi production: vendor mesin fingerprint, object storage, aturan pajak resmi yang telah diverifikasi, provider WhatsApp, bot Telegram, rekening pembayaran, face/liveness provider, migration production, serta load/security test.

## Payroll integrity hardening — 2026-09-11

Baseline HR/payroll kini memakai lifecycle yang eksplisit dan tidak boleh melewati kontrol berikut:

1. `PayrollPeriod` harus `OPEN`, tidak boleh overlap dengan periode company yang sudah ada, dan rentang tanggal memakai akhir hari penuh untuk input tanggal tanpa jam.
2. Absensi branch dikunci melalui `POST /payroll/periods/:id/lock-attendance`. Lock ditolak jika masih ada correction, leave, overtime, atau attendance record yang belum final.
3. Komponen `attendanceBased` tidak boleh diam-diam dihitung jika tidak ada record absensi terkunci. Kondisi tersebut masuk `REQUIRES_REVIEW`.
4. Payroll dihitung dalam transaksi `SERIALIZABLE`. Kegagalan di tengah kalkulasi harus rollback sebagai satu unit; tidak boleh meninggalkan hasil sebagian.
5. `taxableIncome` berasal dari komponen yang memang ditandai `taxable`, bukan otomatis sama dengan gross pay.
6. Tax profile, social-security profile, component assignment, dan rule set dievaluasi berdasarkan effective date periode payroll.
7. Tax/social rule set harus `APPROVED`, tidak boleh masih `requiresOfficialRateImport`, wajib mempunyai parameter rate yang valid, dan versi APPROVED untuk kode yang sama tidak boleh mempunyai rentang efektif yang overlap.
8. `PayrollRun` hanya boleh di-approve jika seluruh karyawan aktif tercakup dan tidak ada result/calculation trace `REQUIRES_REVIEW`.
9. Posting payroll menggunakan `PayrollAccountingMapping`; akun gaji tidak boleh ditentukan diam-diam di service. Canonical mapping default: beban payroll, Utang Gaji, Utang PPh Payroll, serta Utang BPJS/Potongan.
10. Posting payroll membuat kewajiban. Pembayaran gaji adalah event terpisah `PAYROLL_SALARY_PAYMENT` (Dr Utang Gaji / Cr Kas-Bank). Pembayaran bank wajib menyimpan referensi transfer.
11. PPh payroll dan BPJS/potongan diselesaikan melalui transaksi `PAYROLL_LIABILITY_PAYMENT` yang harus mereferensikan `PayrollRun`, hanya boleh mendebit akun kewajiban 2103/2104, dan tidak boleh melebihi saldo kewajiban yang belum diselesaikan.
12. Payslip baru boleh diterbitkan setelah seluruh `PayrollPayment` karyawan pada run selesai sehingga status run menjadi `PAID`.

13. Koreksi payroll yang sudah `POSTED`/`PAID` dilakukan sebagai **differential adjustment run**, bukan edit atau repost run sumber. Adjustment menyimpan `adjustmentOfRunId`, urutan, alasan, dan tanggal posting; angka hasilnya adalah selisih terhadap source + adjustment yang sudah diakui.
14. Jika koreksi menurunkan net pay sebelum transfer, instruksi `PayrollPayment` yang masih `PENDING`/`FAILED` dikurangi atau dibatalkan. Jika gaji sudah terbayar, selisih menjadi `Piutang Karyawan / Payroll Recovery` dan harus diselesaikan sebagai settlement `RECOVERY`; tidak boleh diam-diam mengurangi kas.
15. Koreksi negatif PPh/BPJS/potongan hanya boleh mengurangi kewajiban yang belum dibayar **dan belum dicadangkan oleh settlement aktif** (`DRAFT`/`WAITING_APPROVAL`/`APPROVED`). Jika draft/approval lama akan membuat pembayaran melebihi kewajiban setelah koreksi, adjustment dihentikan sampai settlement itu dibatalkan/diubah. Jika kewajiban eksternal sudah terbayar dan diperlukan refund/offset, posting adjustment dihentikan sampai workflow rekonsiliasi eksternal tersedia.
16. Adjustment berikutnya hanya boleh dibuat setelah adjustment sebelumnya selesai (`PAID`), sehingga chain koreksi berurutan dan audit trail tidak bercabang. Liability snapshot, report PAYROLL, payslip, dan ringkasan periode membaca source + chain adjustment secara kumulatif.
17. Run `DRAFT`, `REVIEW`, atau `APPROVED` yang belum mempunyai jurnal/settlement dapat dibatalkan dengan alasan audit. `POSTED`/`PAID` tidak dapat dibatalkan melalui endpoint ini; koreksinya wajib adjustment/reversal yang dapat diaudit.

Untuk existing database, jalankan migration `database/migrations/T360-20260911-payroll-liability-integrity/` lalu canonical seed melalui proses deployment aman. Jangan menggunakan demo reset/seed terhadap production data.

## Effective-dated profile safety

Employee tax and social-security profiles are versioned by `(employeeId, effectiveFrom)`. P2 builds effective-day segments across employee profiles and APPROVED statutory rule versions. Proratable employee components preserve their own active ranges and actual calculated amounts; temporal allocation maps those amounts into the statutory segments instead of stretching one monthly total across the period. Missing coverage or unsupported configuration remains `REQUIRES_REVIEW`, while valid mid-period changes are executable.

## Recovery R2 operator implementation — 2026-09-24

R2 adds permissioned operator/API lifecycle for WorkShift, EmployeeSchedule roster, AttendancePolicy, AttendanceCorrection review, effective-dated EmployeeAssignment, attendance devices/geofences/biometric credentials, and employee channel/preferences. Attendance corrections cannot mutate payroll-locked records and approved corrections only apply an allowlisted AttendanceRecord patch. Employee Portal exposes separate self-service surfaces for attendance correction, leave/permission/sick through configured LeaveType, overtime, payslips, and verified Telegram/WhatsApp delivery preferences.

Both heavy GitHub workflows require `ci:r2:probe` on the live PostgreSQL exact-runtime chain. Source/static evidence alone is not sufficient to close R2.


## P2 payroll method and split-period completion

- `GROSS`: income tax is employee deduction and reduces take-home.
- `GROSS_UP`: engine iteratively solves a taxable tax allowance to cent precision; the generated allowance is persisted as `TAX_GROSS_UP_ALLOWANCE`.
- `NET`: income tax is employer-borne; employee take-home is not reduced, while tax payable and employer-borne trace remain auditable.
- `PayrollComponentDefinition.proratable=true` enables day-based split assignment proration. Attendance/overtime calculations remain range-scoped to actual attendance rather than double-prorated.
- Tax/social profiles and APPROVED rule families may change mid-period. The engine uses all overlapping versions for the selected rule family and records segment/profile/rule IDs in calculation trace.
- Temporal amount allocation preserves actual component timing and allocates any cent remainder to the last overlapping segment, preventing split-period rounding drift.
- P2 exact-runtime evidence must prove calculation without `REQUIRES_REVIEW`, balanced regular posting, salary settlement, differential adjustment after payment, employee-receivable recovery, and recovery settlement on PostgreSQL.
