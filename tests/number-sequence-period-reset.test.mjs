import assert from 'node:assert/strict';
import { test } from 'node:test';
import fs from 'node:fs';
import path from 'node:path';

const repoRoot = path.resolve(import.meta.dirname, '..');
const numbering = fs.readFileSync(path.join(repoRoot, 'apps', 'api', 'src', 'common', 'numbering.ts'), 'utf8');

// BUG NYATA yang ditemukan lewat UAT: saat fixture penjualan pertama kali dicoba, API
// membalas 500 "Konflik sequence SALE; ulangi transaksi" - padahal hanya ada SATU request,
// tidak ada request paralel sama sekali.
//
// Penyebabnya di allocateNumber():
//
//   let current = row.nextNumber;              // mis. 500
//   if (rowPeriod !== period) current = 1;    // periode berganti -> current = 1
//   updateMany({ where: { id: row.id, nextNumber: current }, ... })
//
// Guard CAS memakai `current` (=1) padahal nilai yang benar-benar tersimpan masih 500.
// updateMany tidak menemukan baris -> count 0 -> lempar Konflik sequence.
//
// Akibatnya SETIAP transaksi pertama pada bulan/tahun baru akan gagal, selamanya. Ini
// bukan race condition yang wajar - ini bug yang pasti terjadi pada batas periode.

test('CAS guard memakai nilai tersimpan, bukan current yang sudah di-reset', () => {
  assert.match(
    numbering,
    /where:\s*\{\s*id:\s*row\.id,\s*nextNumber:\s*row\.nextNumber\s*\}/,
    'guard CAS harus membandingkan nextNumber yang tersimpan (row.nextNumber)',
  );
  assert.doesNotMatch(
    numbering,
    /where:\s*\{\s*id:\s*row\.id,\s*nextNumber:\s*current\s*\}/,
    'guard CAS tidak boleh memakai `current`, karena current bisa = 1 saat reset periode',
  );
});

test('nomor yang dialokasikan tetap memakai current sehingga reset periode bekerja', () => {
  // Guard yang diperbaiki hanya mengubah WHERE. Nilai yang ditulis dan yang dikembalikan
  // harus tetap `current`, kalau tidak reset periode jadi tidak pernah terjadi.
  assert.match(numbering, /data:\s*\{\s*nextNumber:\s*current \+ 1,/);
  assert.match(numbering, /return formatNumber\(opts\.prefix, scopeCode, now, current,/);
});

test('reset periode masih memaksa current ke 1', () => {
  assert.match(numbering, /if \(rowPeriod !== period\) current = 1;/);
});

test('penolakan hanya terjadi bila baris benar-benar berubah di bawah kita', () => {
  // Guard harus tetap ada - inilah yang mencegah dua kasir mendapat nomor sama.
  assert.match(numbering, /if \(bumped\.count !== 1\) throw new Error\(`Konflik sequence/);
});

test('alasan bug ini tercatat agar tidak diubah kembali', () => {
  assert.match(numbering, /reset periode|reset period|bulan\/tahun baru/);
  assert.match(numbering, /tidak ada request paralel/);
});