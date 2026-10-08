# PostgreSQL large-scale migrations

Folder ini menyimpan template migration production yang tidak diterapkan pada SQLite development.

- Jalankan hanya melalui migration/release terkontrol.
- Uji pada staging dengan ukuran data representatif.
- Untuk index tabel besar, gunakan `CREATE INDEX CONCURRENTLY` di luar transaction migration biasa.
- Partitioning memerlukan rencana migrasi data dan rollback; jangan menyalin template langsung ke production.
