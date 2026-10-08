# Keamanan Data Biometrik, Foto, Lokasi, dan Gaji

Data fingerprint, wajah, lokasi, identitas pajak, rekening, dan gaji adalah data berisiko tinggi. Implementasi production wajib menerapkan:

- Persetujuan dan pemberitahuan tujuan pemrosesan kepada karyawan.
- Pengumpulan data minimum; jangan simpan fingerprint mentah.
- Enkripsi saat transit dan tersimpan.
- Secret/reference token untuk NIK/NPWP, nomor BPJS, dan rekening; jangan log nilainya.
- Private object storage untuk foto dan slip gaji.
- Retention otomatis dan legal hold yang terdokumentasi.
- Akses berbasis role, branch scope, self-scope, dan audit log.
- Tautan slip gaji berumur pendek dan tidak dapat diteruskan tanpa autentikasi.
- Device bridge dengan API key/certificate, signed payload, nonce, timestamp, dan replay prevention.
- Dashboard review untuk absensi di luar geofence, lokasi tidak akurat, liveness rendah, dan event duplikat.
- Prosedur koreksi, penghapusan, backup, insiden, serta pencabutan akses setelah karyawan keluar.

Mode selfie/location harus memiliki alternatif resmi bagi karyawan ketika GPS/kamera rusak, kondisi darurat, atau kebijakan ketenagakerjaan mensyaratkan koreksi manual.
