# T360-20260923 F10 Operator AI

Expand-only migration untuk `OperatorInsight` dan `AssistantInteraction`.

- Tidak mengubah atau menghapus data existing.
- ForecastRun/ReorderSuggestion existing tetap canonical untuk forecast.
- Migration tidak dijalankan otomatis oleh patch.
- Terapkan ke TEST/STAGING terlebih dahulu dengan backup/restore point sesuai workflow proyek.
