# T360 auth refresh rotation

Adds an opaque refresh token hash and rotation timestamp to `AuthSession`.
Only SHA-256 hashes are persisted. Existing sessions remain valid as access-token-only sessions until they expire; new logins receive rotatable refresh tokens.
