# POS Offline Transactions

POS offline Toko360 memakai **satu mesin transaksi server**. Browser tidak membuat sale final sendiri: saat API tidak terjangkau, POS menyimpan transaksi tunai ke antrean lokal; saat koneksi pulih, `/sales/offline/replay` menerapkan antrean melalui `SalesService.create()` yang sama dengan transaksi online.

## Aturan keselamatan

- Hanya pembayaran `CASH` yang boleh dibuat saat offline. QRIS/kartu/transfer membutuhkan konfirmasi online.
- Penukaran loyalty tidak diperbolehkan offline. Poin yang diperoleh dihitung saat replay server.
- Harga dan tax code berasal dari snapshot terakhir yang diterima dari server. Tidak ada tarif pajak hard-coded di POS.
- Snapshot hanya boleh dipakai selama `POS_OFFLINE_MAX_CACHE_MINUTES` (default 1440 menit / 24 jam).
- Stok yang sudah masuk antrean dikurangkan dari stok tersedia pada browser yang sama agar tidak dijual dua kali dari terminal itu.
- Setiap item memiliki `localId`, `sequence`, `capturedAt`, dan idempotency key. Replay yang sama tidak membuat sale kedua.
- `capturedAt` memakai estimasi jam server dari snapshot terakhir. Skew kecil sebelum `openedAt` dikoreksi ke waktu buka shift; skew besar menjadi konflik.
- Jika local storage/quota browser gagal, POS tidak mengosongkan keranjang dan tidak mengklaim transaksi sudah tersimpan.
- Antrean diikat ke `sub` JWT kasir asal. Logout tidak menghapus antrean; kasir yang sama harus login kembali untuk mengirim transaksi miliknya.
- Shift asal harus masih aktif ketika replay. Shift POS tidak dapat ditutup selama kasir tersebut masih mempunyai antrean lokal.
- Waktu bisnis sale/payment/movement/journal/tax mengikuti `capturedAt`, bukan waktu koneksi kembali.
- Sebelum commit, server menghitung quote ulang. Perubahan harga/pajak/stok atau aturan bisnis menjadi `CONFLICT`; data lokal tidak dibuang.
- Receipt replay memakai claim `PROCESSING` atomik dengan lease recovery untuk mencegah dua request memproses sale yang sama bersamaan.

## Konflik

`OFFLINE_CONFIG_STALE`, `OFFLINE_TOTAL_CHANGED`, `OFFLINE_PAYMENT_NOT_ALLOWED`, `OFFLINE_LOYALTY_REDEEM_NOT_ALLOWED`, dan penolakan stok/shift adalah konflik yang harus diperiksa. POS mempertahankan transaksi di antrean dan tidak melompati transaksi berikutnya dalam batch setelah konflik, sehingga urutan kasir tetap konservatif.

## Cache aplikasi

`apps/pos/public/sw.js` menyimpan shell/aset GET same-origin agar POS yang pernah dibuka dapat dimuat kembali ketika jaringan putus. Request `/api/*`, request lintas origin, dan seluruh mutasi tidak pernah dilayani dari cache service worker.
