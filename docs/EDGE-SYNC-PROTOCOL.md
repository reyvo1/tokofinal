# Toko360 Edge Sync Signed Protocol v1

Node toko memakai credential yang dibuat dari Admin (`POST /api/v1/devices/:id/credentials/rotate`). Secret hanya ditampilkan sekali dan server menyimpan salinan terenkripsi dengan `SECRET_MASTER_KEY` serta fingerprint SHA-256.

## Headers wajib

- `x-toko360-device-id`
- `x-toko360-key-id`
- `x-toko360-timestamp` — ISO-8601, toleransi ±5 menit
- `x-toko360-nonce` — unik 16–128 karakter per request
- `x-toko360-signature` — HMAC-SHA256 hex

Canonical string:

```text
v1
<deviceId>
<keyId>
<timestamp-normalized-to-ISO>
<nonce>
<operation>
<sha256(stable-json-body)>
```

Operation adalah `sync.pull`, `sync.push`, atau `sync.ack`. Stable JSON menyortir key object secara rekursif. Array mempertahankan urutan.

Endpoint signed-device (tidak memakai JWT operator):

- `POST /api/v1/edge-sync/pull` body `{ since?, cursor? }`
- `POST /api/v1/edge-sync/push` body `{ transactions: [...] }`
- `POST /api/v1/edge-sync/ack` body `{ receiptId, checkpoint }`

Server menolak credential revoked/expired, timestamp stale, signature salah, tenant mismatch, dan nonce yang pernah digunakan. Nonce disimpan sebagai replay ledger; plaintext secret tidak disimpan.

Flow: pull → apply lokal → ack receipt. Push offline transaction memakai `localId + sequence` idempotent; payload berbeda untuk key yang sama ditolak.
