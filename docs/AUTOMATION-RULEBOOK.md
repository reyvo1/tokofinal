# Automation Rulebook

## Arsitektur

```text
Domain transaction
→ EventOutbox
→ Worker
→ BusinessRule evaluation
→ AutomationJob
→ approval / notification / webhook / integration event
→ retry / dead-letter / audit
```

Transaksi inti tidak menunggu Telegram, WhatsApp, GPS, provider pajak, marketplace, atau sistem eksternal. Semua efek eksternal diproses worker dengan idempotency dan retry.

## Pemicu yang didukung

- sale/order/payment created, paid, cancelled, returned;
- goods receipt created, inspected, confirmed, rejected;
- stock low, transfer shipped/received, opname completed;
- accounting event posted, tax document missing, period closing;
- asset acquired, assigned, maintenance due, depreciated, disposed;
- vehicle inspection failed, trip dispatched/delivered/closed, fuel anomaly;
- attendance, payroll, payslip, employee notification;
- custom webhook atau scheduled check.

## Tindakan

- membuat approval request;
- membuat notification dan memilih template/channel;
- mengirim outbox event/webhook;
- membuat work order;
- membuat reorder suggestion;
- memblokir status/operasi melalui policy;
- menghubungkan ke adapter payment, tax, accounting export, GPS, shipping, WA, atau Telegram;
- membuat report/export job.

## Ketentuan keamanan

- setiap job mempunyai `idempotencyKey`;
- retry memakai exponential backoff;
- secret hanya dari environment/secret manager;
- payload sensitif diminimalkan dan dienkripsi bila diperlukan;
- semua perubahan status dicatat audit;
- otomatisasi finansial bernilai tinggi dapat diwajibkan approval;
- kegagalan provider tidak membatalkan transaksi bisnis yang sudah committed;
- dead-letter harus dapat diproses ulang secara aman.
