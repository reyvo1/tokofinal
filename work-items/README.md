# Work Items Toko360

Setiap perubahan non-trivial harus mempunyai satu file JSON di `work-items/active/`.

Buat work item:

```bash
npm run workflow:new -- feature nama-fitur --module inventory --wave W1 --risk HIGH
```

Periksa seluruh manifest:

```bash
npm run workflow:validate
npm run workflow:status
```

Setelah dirilis dan diverifikasi, pindahkan file ke `work-items/completed/` dan ubah fase menjadi `CLOSED`.
Jangan memasukkan credential, data pelanggan, data karyawan, foto absensi, atau data production ke work item.

## Pembuatan otomatis

Jalankan `npm run work:auto`. Sistem memilih backlog READY, membuat manifest lengkap, branch Git, task packet, checklist, AI prompt, dan session handoff.

Backlog resmi: `config/implementation-backlog.json`. Detail: `docs/AUTOMATED-WORK-STARTER.md`.

