# Toko360 Work Automation

Dokumen ini menjelaskan perintah npm/Node yang menyiapkan pekerjaan berdasarkan Development Kit dan roadmap pada lingkungan Ubuntu-first.

## Tujuan

Saat `npm run work:auto` atau `npm run work:custom` dijalankan, sistem dapat:

1. membaca backlog pada `config/implementation-backlog.json`;
2. memastikan dependency pekerjaan telah selesai;
3. memilih tugas READY dengan prioritas tertinggi;
4. membuat work item lengkap pada `work-items/active/`;
5. membuat branch Git jika kondisi repository aman;
6. membuat paket kerja di `work-items/generated/<WORK_ITEM_ID>/`;
7. menjalankan workflow validation;
8. membuka `TASK.md` di VS Code atau Notepad;
9. menjalankan external agent hanya bila dikonfigurasi secara eksplisit.

## Perintah terminal

```bash
npm run work:auto
npm run work:custom
npm run work:resume
npm run work:status
```

## Isi paket otomatis

Setiap pekerjaan menghasilkan:

```text
work-items/generated/<WORK_ITEM_ID>/
├── TASK.md
├── IMPLEMENTATION-CHECKLIST.md
├── AI-PROMPT.md
└── SESSION-HANDOFF.md
```

`TASK.md` menjadi titik mulai developer. `AI-PROMPT.md` adalah instruksi lengkap yang dapat diberikan kepada coding agent. `SESSION-HANDOFF.md` digunakan saat berpindah sesi atau developer.

## Backlog machine-readable

Backlog resmi berada di:

```text
config/implementation-backlog.json
```

Setiap item mempunyai:

- key dan priority;
- dependency;
- module dan delivery wave;
- risk;
- feature flag;
- dampak database, inventory, accounting, tax, payment, payroll, sync, security, dan performance;
- business rules;
- acceptance criteria;
- test plan;
- dokumentasi sumber.

Tugas otomatis hanya dipilih apabila seluruh dependency backlog sudah mempunyai work item `CLOSED` pada `work-items/completed/`.

## Git branch

Apabila Git tersedia dan working tree aman, script membuat branch seperti:

```text
feature/t360-20260729-220800-atomic-stock-mutation
security/t360-20260729-220800-tenant-isolation
```

Apabila repository sudah mempunyai perubahan yang belum disimpan, script tidak memindahkan branch agar pekerjaan pengguna tidak hilang.

## Optional external agent

Konfigurasi berada di:

```text
config/work-automation.json
```

Default:

```json
{
  "agent": {
    "enabled": false,
    "command": "",
    "args": ["{promptFile}"]
  }
}
```

Agent tidak aktif secara bawaan. Untuk menjalankan coding agent eksternal, isi command yang memang tersedia pada komputer dan aktifkan `agent.enabled`. Script akan memberikan `AI-PROMPT.md` kepada command tersebut.

## Batas otomatisasi

Otomatisasi terminal dapat menyiapkan pekerjaan, branch, paket instruksi, checklist, dan optional agent hook. Ia tidak boleh menandai fitur sebagai selesai tanpa:

- perubahan source code;
- test sesuai work item;
- quality gate;
- staging/UAT bila diperlukan;
- release evidence.

Keputusan bisnis, credential vendor, tarif pajak resmi, migration production, dan konflik data tetap membutuhkan review manusia.
