# Integrasi Mesin Fingerprint dan Face Attendance

## Pola yang didukung

1. **Pull API vendor:** bridge menarik log berdasarkan cursor terakhir.
2. **Push webhook vendor:** perangkat/server vendor mengirim event ke bridge.
3. **Database/file export:** bridge membaca database atau file vendor secara read-only.
4. **SDK lokal:** bridge menggunakan SDK resmi mesin pada server toko.

## Kontrak event minimum

```json
{
  "companyId": "uuid",
  "deviceCode": "FP-TOKO-01",
  "deviceUserCode": "000123",
  "externalEventId": "vendor-event-unique-id",
  "occurredAt": "2026-07-28T08:00:00+08:00",
  "eventType": "CHECK_IN",
  "sourcePayload": {}
}
```

Endpoint bridge/API:

```http
POST /api/v1/attendance/devices/fingerprint/events
```

Endpoint wajib dilindungi JWT service account atau API key berscope `attendance.device_ingest`; jangan dibuka tanpa autentikasi. Waktu perangkat harus disinkronkan melalui NTP dan setiap device memiliki timezone.

## Vendor adapter

Template tersedia pada:

```text
packages/plugin-sdk/examples/fingerprint-device.template.ts
```

Adapter vendor harus menangani cursor, retry, duplicate event, mapping user, clock drift, device offline, health check, dan audit payload.
