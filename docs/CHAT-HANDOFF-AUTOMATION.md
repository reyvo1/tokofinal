# Instruksi Tertanam dan Chat Pertama Otomatis

## Tujuan

Repository menyimpan satu instruksi sistem resmi maksimal 8.000 karakter dan generator konteks untuk perpindahan akun, chat, komputer, atau developer. Generator membaca keadaan proyek saat dijalankan; teks tidak bergantung pada catatan lama yang ditulis manual.

## Sumber instruksi resmi

```text
instructions/SYSTEM-INSTRUCTIONS.md
```

Batas dikontrol oleh `config/chat-handoff.json`. Generator gagal apabila panjang instruksi melebihi 8.000 karakter. Salinan yang dikenali tool lain disinkronkan otomatis ke:

```text
AGENTS.md
.github/copilot-instructions.md
.chatgpt/SYSTEM-INSTRUCTIONS.md
handoff/generated/SYSTEM-INSTRUCTIONS.txt
```

Jangan mengedit salinan. Edit hanya file canonical, lalu jalankan `npm run chat:generate`.

## Pindah akun atau chat

Untuk chat baru pada akun yang sama:

```bash
npm run chat:handoff
```

Untuk akun baru, salin instruksi sistem lebih dulu lalu buat handoff:

```bash
npm run chat:system
npm run chat:handoff
```

Alur canonical:

1. memastikan tidak ada perubahan tracked atau staged yang belum di-commit;
2. membuat ZIP otomatis dari `git archive HEAD` pada `handoff/generated/`;
3. mencatat nama file, commit, ukuran, dan SHA-256 ZIP pada `CHECKPOINT.json` serta `FIRST-CHAT.md`;
4. membaca checkpoint, version, Git, database profile, work item, backlog, dan quality gate;
5. menyalin instruksi sistem ke clipboard untuk akun baru;
6. menyalin chat pertama ke clipboard;
7. membuka lokasi ZIP/checkpoint dan ChatGPT sesuai kemampuan desktop;
8. pengguna mengunggah ZIP yang disorot, menekan `Ctrl+V`, lalu mengirim keduanya.

Perintah terkait:

```bash
npm run chat:generate
npm run chat:system
npm run chat:first
npm run chat:checkpoint
```

## Isi dinamis

`FIRST-CHAT.md` memuat:

- checkpoint dan version;
- fingerprint keadaan proyek;
- checksum instruksi sistem;
- branch, commit, dan perubahan Git;
- profil database tanpa URL/credential;
- work item aktif, task file, `SESSION-HANDOFF.md`, dan `IMPLEMENTATION-CHECKLIST.md`;
- backlog READY berikutnya;
- hasil quality gate terakhir bila direkam;
- langkah aman pertama untuk sesi baru.

Generator menyertakan progres aktual dari handoff dan checklist, tetapi menyensor nilai `DATABASE_URL`, password, token, secret, API key, dan credential vendor sebelum menulis `FIRST-CHAT.md`.

## Integrasi workflow

Paket chat diperbarui secara eksplisit dengan `npm run chat:generate` atau saat `npm run chat:handoff` dijalankan. Workflow pekerjaan dan quality gate tidak bergantung pada launcher OS.

Output dinamis dan ZIP checkpoint diabaikan Git agar tidak membuat working tree kotor. ZIP hanya berisi source yang sudah tercatat pada commit `HEAD`; perubahan tracked atau staged yang belum di-commit tidak ikut dibawa dan akan memblokir launcher. File untracked seperti ZIP transfer lama, source sementara, atau installer tidak masuk `git archive HEAD`, sehingga tidak menghalangi pembuatan checkpoint.

## Batas otomatisasi

Aplikasi tidak dapat mengetahui bahwa pengguna membuka akun/chat baru pada platform eksternal. Karena itu perpindahan tetap dipicu secara eksplisit melalui perintah npm; pembentukan checkpoint dan konteks tetap source-bound dan fail-closed.
