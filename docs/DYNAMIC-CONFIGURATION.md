# Konfigurasi Dinamis

Urutan resolusi konfigurasi: global → company → branch → user. Nilai paling spesifik menang.

## Feature Flag

Mengaktifkan modul tanpa redeploy. `config` dapat berisi limit, rollout, provider, atau parameter lain.

## System Setting

Namespace contoh: `general`, `inventory`, `orders`, `pos`, `finance`, `shipping`, `notification`.

## Custom Field

Entity type dapat berupa `Product`, `Supplier`, `Customer`, `Order`, atau domain baru. Validation dan options disimpan JSON; frontend membaca definisinya untuk membangun form.

## UI Schema

Menyimpan layout, fields, columns, widgets, actions, dan navigation untuk admin/POS/storefront.

## Business Rule

Trigger contoh: `inventory.balance.changed`, `order.created`, `payment.paid`, `customer.tier.changed`. Action contoh: notification, approval, voucher, reorder suggestion, webhook.
