# Storefront Productization (UI-P4)

## Scope

UI-P4 mengubah storefront dari satu halaman panjang menjadi customer journey yang terpisah tanpa mengganti contract commerce existing.

## Route / workspace

- `/` dan `/home` — landing storefront, summary katalog/keranjang/loyalty.
- `/catalog` — pencarian, sorting, stok, favorit, dan product browse.
- `/product` — detail produk terpilih, harga, stok per gudang, add-to-cart/favorite.
- `/cart` — cart, fulfillment, promo, checkout, order confirmation, payment selection.
- `/account` — login/register, contact verification, addresses, loyalty, order tracking, review, dan return.

## Security dan commerce invariants

- Customer session tetap diverifikasi oleh API.
- Order access token tetap wajib pada payment selection.
- Harga/promo/order total tetap authoritative di server.
- Stock reservation tetap terjadi pada order API, bukan di UI.
- Electronic payment tidak dianggap lunas sampai provider/backoffice mengonfirmasi.
- Human Stage-20 UAT tetap manual dan tidak auto-pass.

## Rollback

Rollback UI-P4 hanya mengembalikan presentation single-surface. Tidak ada schema/data migration.
