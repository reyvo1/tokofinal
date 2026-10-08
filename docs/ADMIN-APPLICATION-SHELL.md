# Admin Application Shell — UI-P1

UI-P1 mengubah Admin dari single-page menu state menjadi application shell dengan information architecture yang dapat tumbuh mengikuti Development Kit, tanpa mengubah business logic backend.

## Canonical workspace routes

- `/dashboard`
- `/owner`
- `/master-data`
- `/procurement`
- `/commerce`
- `/inventory-control`
- `/operations-control`
- `/finance`
- `/people`
- `/assets-fleet`
- `/extensions`
- `/platform`

`apps/admin/app/[section]/page.tsx` mempertahankan satu authenticated shell untuk direct load/reload setiap route. Route yang tidak dikenal dikembalikan ke `/dashboard` setelah sesi terautentikasi.

## Runtime navigation contract

Navigation tidak lagi berasal dari satu array menu hard-coded di `page.tsx`. `apps/admin/app/navigation.ts` membentuk workspace dari empat sumber runtime:

1. `ModuleDefinition` aktif dari `/platform/manifest`;
2. feature flag efektif company/branch/user;
3. role/permission pada access token untuk visibility UI;
4. `UiSchemaDefinition` surface `admin` untuk override `navigation`.

Backend permission/tenant guard tetap menjadi security boundary. JWT decoding di frontend hanya dipakai untuk menyembunyikan workspace yang jelas tidak relevan; frontend tidak pernah menganggap visibility sebagai authorization.

### UI schema navigation override

Schema Admin dapat menyediakan:

```json
{
  "navigation": [
    { "route": "/finance", "label": "Keuangan", "order": 20 },
    { "route": "/extensions", "hidden": true }
  ]
}
```

Hanya canonical route yang sudah mempunyai implementasi workspace yang dapat dipengaruhi. UI schema tidak membuat halaman atau aksi bisnis baru secara otomatis.

## Shell behavior

- sidebar desktop 240px dan dapat collapse;
- pencarian workspace;
- mobile workspace selector;
- breadcrumb dan canonical route badge;
- company + branch runtime context;
- related-workspace rail per kelompok;
- dark restrained token sesuai `UI-DESIGN-SYSTEM.md`;
- seluruh module view lama tetap digunakan sebagai isi workspace.

## Batas UI-P1

UI-P1 adalah fondasi information architecture. Pemecahan workflow besar menjadi detail page/data-grid/drawer khusus domain adalah UI-P2 dan seterusnya. UI-P1 tidak mengubah schema, transaksi, accounting, tax, inventory movement, payroll, atau provider integration.
