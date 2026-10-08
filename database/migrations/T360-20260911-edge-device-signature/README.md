# Edge device signed-request authentication

Adds encrypted symmetric device credential material and a nonce ledger used to reject replayed edge-sync requests.

- The plaintext secret is returned only during credential rotation.
- `secretHash` remains a non-reversible fingerprint.
- `encryptedSecret` is AES-256-GCM protected by `SECRET_MASTER_KEY`/`ENCRYPTION_KEY`.
- `DeviceAuthNonce` makes `(credentialId, nonce)` one-time use and records the signed request hash.
