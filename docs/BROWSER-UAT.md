# Browser UAT Gate

`npm run uat:browser` is a fail-closed, dependency-free browser gate for a running **non-production** Toko360 stack. It drives a real Chromium/Chrome instance through the Chrome DevTools Protocol and writes evidence to `handoff/quality/browser-uat-latest.json`.

## Prerequisites

1. A complete dependency install and successful production build.
2. API and all four web surfaces running:
   - Storefront `http://127.0.0.1:3000`
   - Admin `http://127.0.0.1:3001`
   - POS `http://127.0.0.1:3002`
   - Employee Portal `http://127.0.0.1:3003`
   - API `http://127.0.0.1:4000/api/v1`
3. A dedicated non-production Admin account.
4. Chromium/Chrome installed. Set `T360_CHROMIUM` only when the browser is not in a standard path.

Set credentials in the shell; the runner intentionally contains no embedded demo password:

```bash
export T360_UAT_ADMIN_EMAIL=uat-admin@example.test
export T360_UAT_ADMIN_PASSWORD='<staging-password>'
npm run uat:browser
```

Optional URL overrides: `T360_API_URL`, `T360_ADMIN_URL`, `T360_STOREFRONT_URL`, `T360_POS_URL`, `T360_EMPLOYEE_URL`.

## What this gate proves

- API health is reachable.
- Storefront, Admin, POS and Employee Portal return successful HTTP responses.
- Admin API login succeeds using the supplied UAT identity.
- A real browser loads the Admin login surface and authenticated shell.
- The browser can navigate to **Aset & Fleet**.
- **Outbound / Delivery Lifecycle** and **TRIP WORKBENCH** render after authentication.
- Delivery lifecycle read-model loading does not show its operator error state.
- The browser can navigate to **HRIS & Payroll**.
- **PAYROLL LIFECYCLE**, **Riwayat Payroll Runs**, and **PPh / BPJS / Potongan** render after authentication.
- Payroll read-model loading does not show its operator error state.

This gate is intentionally read-only after authentication. Business mutation UAT remains covered by the Stage-20 UAT matrix and must be signed off against staging data. A browser-gate PASS alone is not release approval.

## Source binding

Evidence browser menyimpan `sourceIdentity` SHA-256 dari source executable Toko360. Verifikasi kandidat UAT menolak browser evidence lama bila fingerprint source berbeda. Untuk menjalankan stack hasil build secara otomatis di non-production gunakan `npm run uat:browser:built`.


## Built-stack wrapper untuk kandidat UAT

Untuk jalur kandidat UAT gunakan `npm run uat:browser:built`, bukan hanya runner browser standalone. Wrapper ini:

- mengharuskan enam build artifact tersedia;
- memuat target efektif dari `.env` + environment dan menolak `NODE_ENV`/target production-live;
- untuk PostgreSQL mengharuskan `T360_UAT_EXPECTED_HOST` dan `T360_UAT_EXPECTED_DATABASE` cocok persis;
- menyimpan hash host/database tanpa menyimpan credential/URL mentah;
- menyalakan enam process hasil build dan mengikat inner browser evidence ke fingerprint source yang sama;
- selalu menulis `handoff/quality/built-browser-uat-latest.json`, termasuk saat preflight gagal, sehingga FAIL baru tidak meninggalkan PASS lama sebagai evidence terbaru;
- menghentikan process tree setelah pengujian.

Final `uat:candidate:verify` hanya menerima built-browser PostgreSQL yang target hash-nya sama dengan Stage-20 dan yang dijalankan setelah build gate PASS.
