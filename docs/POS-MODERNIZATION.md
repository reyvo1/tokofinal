# UI-P3 POS Modernization

UI-P3 memecah terminal POS menjadi empat workspace operator tanpa mengubah kontrak transaksi backend:

- **Penjualan** — katalog, scan/search, hold/recall, cart, customer, promo/loyalty, quote dan pembayaran.
- **Shift & Kas** — buka/tutup shift dan cash in/out.
- **Retur** — pemilihan sale, item return, alasan dan refund method.
- **Sinkronisasi** — antrean offline, conflict state dan retry.

`PosShell` adalah presentation shell. Quote server-authoritative, stock validation, idempotency, offline restrictions, replay ordering/conflict retention, auth dan tenant guard tetap berada pada logic/API yang sudah ada.

Human Stage-20 UAT tetap terpisah dari automated GitHub simulation dan tidak diubah oleh UI-P3.
