# Customer contact verification

Adds email/phone verification timestamps and short-lived, single-use verification tokens. Verification codes are stored only as bcrypt hashes; the target email/phone is represented by SHA-256 so the code cannot verify a contact changed after issuance.
