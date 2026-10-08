# GitHub Repository Setup

Setelah repository dipush, atur GitHub agar workflow tidak dapat dilewati.

## Branches

Gunakan:

- `main`: baseline yang siap dirilis.
- `develop`: integrasi perubahan yang telah lolos review.
- Branch work item: `feature/...`, `fix/...`, `migration/...`, dan prefix resmi lainnya.

## Branch protection `main`

Aktifkan:

- Require pull request before merging.
- Require at least one approval; gunakan dua reviewer untuk HIGH/CRITICAL risk.
- Dismiss stale approvals when new commits are pushed.
- Require conversation resolution.
- Require status checks to pass.
- Require branches to be up to date.
- Block force pushes and deletion.

Status checks yang disarankan:

- Workflow Governance / manifest-policy
- Workflow Governance / pull-request-policy
- Toko360 CI / repository-tests
- Toko360 CI / sqlite-integration
- Toko360 CI / postgresql-integration

## Environment

Buat GitHub Environments:

- `staging`: approval opsional, memakai credential staging.
- `production`: required reviewer, deployment window, dan credential production.

Jangan menyimpan secret di `.env` repository. Gunakan GitHub Environment Secrets atau secret manager server.

## Labels

Buat label berikut:

- `type:feature`, `type:bug`, `type:migration`, `type:integration`, `type:security`, `type:release`
- `status:intake`, `status:analysis`, `status:design`, `status:implementation`, `status:verification`, `status:release-ready`, `status:blocked`
- `risk:low`, `risk:medium`, `risk:high`, `risk:critical`
- `wave:W0` sampai `wave:W7`

## Merge strategy

Gunakan squash merge untuk feature/bug kecil. Gunakan merge commit hanya apabila histori beberapa commit migration/release perlu dipertahankan. Hapus branch setelah merge.

## Release

1. Semua work item release berada pada RELEASE_READY.
2. Jalankan workflow `Release Candidate` dengan checkpoint resmi.
3. Unduh source artifact dan checksum.
4. Uji artifact pada staging.
5. Buat tag versi setelah UAT disetujui.
6. Perbarui `docs/PROJECT-STATE.md` dan release notes.
