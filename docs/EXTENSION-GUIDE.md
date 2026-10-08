# Panduan Menambah Fungsi Baru

## 1. Tentukan Jenis Penambahan

- **Field tambahan sederhana**: gunakan CustomFieldDefinition/Value.
- **Pengaturan perilaku**: gunakan SystemSetting.
- **Fitur opsional**: buat FeatureFlag.
- **Form/dashboard berbeda**: gunakan UiSchemaDefinition.
- **Otomasi kondisi-aksi**: gunakan BusinessRule.
- **Persetujuan**: gunakan ApprovalPolicy.
- **Provider eksternal**: implementasikan plugin adapter.
- **Domain baru**: buat NestJS module + Prisma model + event.

## 2. Membuat Modul Domain

```text
apps/api/src/<module>/
  dto/
  <module>.controller.ts
  <module>.service.ts
  <module>.module.ts
```

Daftarkan di `AppModule`, tambahkan permission, module definition, feature key, migration, test, dokumentasi, dan event outbox.

## 3. Kontrak Integrasi

Implementasikan interface di `packages/plugin-sdk`. Jangan panggil SDK provider langsung dari controller/domain service. Buat adapter, mapping error, idempotency, health check, dan contract tests.

## 4. Event

Setelah transaksi domain berhasil, tulis ke `EventOutbox` dalam database transaction yang sama. Worker kemudian mengirim webhook/notifikasi/sinkronisasi. Ini mencegah transaksi bisnis berhasil tetapi integrasi hilang.

## 5. Compatibility

- Jangan menghapus field/API tanpa deprecation.
- Gunakan versioned endpoint/event schema.
- Migration harus backward compatible.
- Feature baru default off untuk production existing tenant.
- Tambahkan rollback plan.
