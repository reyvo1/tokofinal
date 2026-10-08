# Project Checkpoints

Checkpoint adalah snapshot yang telah melewati quality gate, bukan sekadar nama ZIP.

Format:

```text
RC<major>.<minor>.<patch>.<sequence>_<MODULE>_<MILESTONE>
```

Contoh:

```text
RC0.5.1.1_WORKFLOW_GOVERNANCE_BASELINE
RC0.6.0.3_INVENTORY_ATOMIC_POSTING
```

Checkpoint wajib mencatat:

- Commit SHA dan tag.
- Work item yang masuk.
- Migration version.
- Feature flag state.
- Hasil CI/UAT/load test.
- Database backup/restore point.
- Known issues.
- Rollback procedure.

Hanya checkpoint terakhir yang dinyatakan resmi di release notes yang boleh menjadi basis sesi pengembangan berikutnya.

## RC0.5.2.1_ONE_CLICK_WORK_AUTOMATION

- Baseline: v0.5.2.
- Menambahkan backlog machine-readable, pemilih dependency-aware, work packet generator, branch automation, editor launcher, dan optional external-agent hook.
- Tidak mengubah schema atau data bisnis.
- Baseline resmi menggantikan RC0.5.1.1 untuk pekerjaan berikutnya.

## RC0.5.3.1_EMBEDDED_INSTRUCTIONS_DYNAMIC_CHAT_HANDOFF

- Baseline: v0.5.3.
- Menambahkan instruksi sistem canonical maksimal 8.000 karakter dan adapter untuk agent/Copilot/ChatGPT.
- Menambahkan generator chat pertama dinamis berdasarkan checkpoint, Git, work item, database profile, backlog, dan quality gate.
- Menambahkan tombol pindah akun/chat, clipboard automation, pencatatan quality gate, dan perlindungan secret.
- Tidak mengubah schema atau data bisnis.
- Baseline resmi menggantikan RC0.5.2.1 untuk pekerjaan berikutnya.
