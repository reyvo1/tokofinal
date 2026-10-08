# W6 edge sync receipts, credentials, retry/dead-letter

Expand migration for node credential rotation, server-issued pull receipts with explicit acknowledgement, and offline replay retry/dead-letter metadata.

The API never stores the plaintext device secret. Rotation returns the secret once and stores only a SHA-256 hash scoped by device/key id. Pull receipts are tenant/branch/device scoped and acknowledgements must echo the exact server checkpoint. Offline sales retry transient failures with bounded attempt metadata and move to `DEAD_LETTER` after five claims; operators can explicitly requeue after investigating the cause.
