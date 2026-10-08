> **Post-audit status authority:** this F1-F12 roadmap is historical source-implementation context. Current capability status is authoritative only in `config/product-completeness.json` and execution order is defined by `docs/TOKO360-MASTER-PRODUCT-COMPLETION-WORKFLOW.md`.

# TOKO360 Functional Product Completion — Locked F1→F12

Roadmap ini mengunci pola kerja functional completion. Urutan fase tidak boleh diubah tanpa keputusan eksplisit.

## Aturan tetap

1. Kerjakan fase aktif sampai exit criteria lengkap.
2. Jangan lompat ke fase berikutnya karena UI terlihat mudah atau test sudah hijau.
3. `CLOSED` pada work-item lama tidak otomatis berarti produk/operator experience lengkap.
4. UI-only, backend-only, atau test-only tidak cukup untuk menutup fase.
5. Final UAT/release gate dikejar setelah F2–F11 functional closure; F12 adalah final polish.

## Status saat ini

| Fase | Status |
|---|---|
| F1 Audit backend vs UI exposure | IN PROGRESS |
| F2 Master Product + Multi-UOM | SOURCE IMPLEMENTATION COMPLETE — UAT DEFERRED |
| F3 Inventory/batch/expiry/condition | SOURCE IMPLEMENTATION COMPLETE — UAT DEFERRED |
| F4 Accounting workspace enterprise | SOURCE IMPLEMENTATION COMPLETE — UAT DEFERRED |
| F5 Tax workspace dinamis | SOURCE IMPLEMENTATION COMPLETE — UAT DEFERRED |
| F6 Financial reporting + drill-down | SOURCE IMPLEMENTATION COMPLETE — UAT DEFERRED |
| F7 AR/AP/Cash/Bank/Reconciliation | SOURCE IMPLEMENTATION COMPLETE — UAT DEFERRED |
| F8 Automation + scheduled reports | SOURCE IMPLEMENTATION COMPLETE — UAT DEFERRED |
| F9 WhatsApp/Telegram notification center | SOURCE IMPLEMENTATION COMPLETE — UAT DEFERRED |
| F10 AI/forecasting/operator assistant | SOURCE IMPLEMENTATION COMPLETE — UAT DEFERRED |
| F11 Purchase/Sales/POS integration ke UOM baru | SOURCE IMPLEMENTATION COMPLETE — UAT DEFERRED |
| F12 Final UI/UX polish | SOURCE IMPLEMENTATION COMPLETE — UAT DEFERRED |

## F1 wajib menghasilkan audit matrix

Setiap capability Development Kit diklasifikasikan:

- `EXPOSED`: backend + operator UI + flow tersedia.
- `HIDDEN`: backend tersedia tetapi UI/operator flow belum mengeksposnya.
- `PARTIAL`: sebagian backend/UI/flow ada tetapi belum memenuhi kontrak produk.
- `MISSING`: capability kontrak belum diimplementasikan.
- `DEFERRED_BY_DESIGN`: sengaja ditunda dengan alasan dan target fase jelas.

F1 tidak boleh selesai selama masih ada capability `UNKNOWN`.

## Definition of complete per fase

```text
DATABASE / CONFIGURATION MODEL
+ BUSINESS LOGIC
+ API CONTRACT
+ VALIDATION / PERMISSION
+ OPERATOR UI
+ END-TO-END OPERATOR FLOW
+ REPORT / EVIDENCE
+ REGRESSION TEST
= COMPLETE
```

Detail deliverable dan dependency machine-readable berada pada `config/functional-depth-roadmap.json`.

## F5 completion note — 2026-09-23
F5 Dynamic Tax is **SOURCE IMPLEMENTATION COMPLETE**: versioned/effective-dated tax configuration, immutable historical versions, account mapping validation, tax ledger, tax-document visibility, reconciliation, and operator UI are implemented. Runtime/browser/human UAT is deferred. Next phase is F6 Reporting / drill-down.


## F6 completion note — 2026-09-23
F6 Financial Reporting + Drill-down is **SOURCE IMPLEMENTATION COMPLETE**: journal-backed core finance reports, inventory valuation/margin, period and branch/cost-center comparison, account→journal→event→source drill-down, validated async CSV/XLSX/PDF ReportJob exports, and operator workspace are implemented. Runtime/browser/human UAT remains deferred. Next phase is F7 AR/AP/Cash/Bank/Reconciliation.

F7 AR/AP/Cash/Bank/Reconciliation is **SOURCE IMPLEMENTATION COMPLETE**: tenant-scoped AR/AP aging, journal-backed cash/bank position, source→settlement→accounting→journal trace, and canonical bank statement/reconciliation operator flow are implemented. Runtime/browser/human UAT remains deferred. Next phase is F8 Automation + scheduled reports.

F8 Automation + Scheduled Reports is **SOURCE IMPLEMENTATION COMPLETE**: business-rule lifecycle, tenant-scoped automation execution history/cancel/replay, report-trigger actions, and first-class DAILY/WEEKLY/MONTHLY report schedules materialized atomically into canonical ReportJob are implemented. Runtime/browser/human UAT remains deferred. Next phase is F9 WhatsApp/Telegram notification center.


F9 WhatsApp / Telegram Notification Center is **SOURCE IMPLEMENTATION COMPLETE**: encrypted tenant-scoped provider connections, template/queue lifecycle, connected Telegram and provider-neutral WhatsApp delivery, provider health, delivery history, cancel/replay, and Admin Notification Center are implemented. Runtime/browser/human UAT remains deferred. Next phase is F10 AI/forecasting/operator assistant.
