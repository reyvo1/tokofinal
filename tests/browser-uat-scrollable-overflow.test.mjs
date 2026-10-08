// Elemen di dalam container scrollable boleh lebih lebar dari viewport - itu makna
// overflow-x auto. Check overflow harus membedakan "kelebihan yang ditangani container" dari
// "kelebihan yang berarti konten hilang".
//
// Bug yang ditemukan: `.table` punya overflow-x: auto dan `.tr` punya min-width: 660px, jadi
// setiap baris tabel PASTI lebih lebar dari area konten di 1440. Check menandai .tr sebagai
// overflow dokumen dan gagal di subdomain "Stock Opname" - padahal scrollWidth dokumen = 1440
// (sama dengan clientWidth), yang membuktikan tidak ada overflow dokumen sama sekali.
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import assert from 'node:assert/strict';

const uat = await readFile(new URL('../scripts/browser-uat.mjs', import.meta.url), 'utf8');
const css = await readFile(new URL('../apps/admin/app/globals.css', import.meta.url), 'utf8');

test('kondisi yang ditemukan benar-benar ada di CSS (tabel memang sengaja bisa di-scroll)', () => {
  assert.match(css, /\.table \{[^}]*overflow-x: auto/);
  assert.match(css, /\.tr \{[^}]*min-width: 660px/);
  // Kalau salah satu hilang, regresi ini tidak akan terpicu dan testnya jadi tidak berarti.
});

test('emulasi viewport memakai helper tunggal yang deterministik dan memverifikasi hasilnya', () => {
  // Runner: 390x844 diukur sebagai innerWidth=679. mobile:true membuat Chrome menerapkan
  // emulasi viewport-meta sehingga innerWidth mengikuti meta tag, bukan ukuran yang diminta.
  assert.match(uat, /async function applyViewportEmulation\(cdp, width, height\)/);
  // mobile:true TIDAK BOLEH dipakai lagi di mana pun - itu sumber ketidakpastiannya.
  assert.doesNotMatch(uat, /mobile: width <= 480/, 'mobile:true reintroduces viewport-meta emulation');
  // Metrik perangkat harus lengkap supaya tidak bergantung pada meta tag.
  assert.match(uat, /mobile: false,\n\s+screenWidth: width,\n\s+screenHeight: height,/);
  assert.match(uat, /Emulation\.setVisibleSize', \{ width, height \}/);
  // Hasil emulasi WAJIB diverifikasi, bukan diasumsikan berhasil.
  assert.match(uat, /if \(!actual \|\| actual\.innerWidth !== width\)/);
  assert.match(uat, /Emulasi viewport tidak diterapkan: diminta/);
  // Semua call site harus lewat helper yang sama.
  assert.doesNotMatch(uat, /cdp\.call\('Emulation\.setDeviceMetricsOverride', \{ width, height/);
  assert.match(uat, /await applyViewportEmulation\(cdp, width, height\);/);
  assert.match(uat, /await applyViewportEmulation\(cdp, 1440, 900\);/);
});

test('check overflow memverifikasi innerWidth benar-benar sesuai viewport yang diminta', () => {
  // scrollWidth dibandingkan terhadap lebar DIMINTA. Kalau device metrics override tidak
  // diterapkan, scrollWidth == innerWidth yang lebih besar dan akan dilaporkan sebagai overflow
  // padahal tidak ada yang bocor (terbukti: 390x844 -> scrollWidth=679, elements kosong).
  // Emulasi yang salah sama-sama adalah kegagalan dan harus merah.
  assert.match(uat, /const viewportMismatch = closed && closed\.innerWidth !== width;/);
  assert.match(uat, /if \(!closed \|\| viewportMismatch \|\| closed\.scrollWidth > width \+ 3/);
  assert.match(uat, /innerWidth=\$\{closed\?\.innerWidth\} diminta=\$\{width\}/);
});

test('check overflow melaporkan pelaku mentah beserta alasan pengecualian', () => {
  // Kegagalan runner sebelumnya hanya melaporkan scrollWidth=679 dengan elements kosong,
  // sehingga akar masalahnya tidak bisa diketahui. Diagnosa mentah wajib ada.
  assert.match(uat, /const rawOffenders = \[\.\.\.document\.querySelectorAll\('body \*'\)\]/);
  assert.match(uat, /const rawOverflowList = rawOffenders/);
  assert.match(uat, /rawOverflow: rawOverflowList/);
  // Setiap elemen yang tidak lolos harus punya alasan yang jelas, bukan sekadar hilang.
  assert.match(uat, /excludedBecause = !beyond \? 'tidak melewati viewport'/);
  assert.match(uat, /: parked \? 'drawer admin diparkir'/);
  assert.match(uat, /\(inScrollable \|\| inClipping\) \? 'ter-clip ancestor'/);
  // Diagnostik wajib ikut ke pesan error agar terlihat di log runner.
  assert.match(uat, /rawOverflow=\$\{JSON\.stringify\(closed\?\.rawOverflow \|\| \[\]\)\}/);
  // Diagnostik tidak boleh melemahkan gate: overflow dan clippedScrollables tetap syarat gagal.
  assert.match(uat, /closed\.overflow\.length \|\| closed\.clippedScrollables\.length/);
});

test('check overflow mengecualikan anak container scrollable, bukan elemen arbitrary', () => {
  assert.match(uat, /const isScrollable = \(el\)/);
  // Pengecualian harus berdasarkan overflowX/overflowY auto|scroll, bukan class tertentu.
  assert.match(uat, /\/\(auto\|scroll\)\/\.test\(cs\.overflowX\)/);
  assert.match(uat, /scrollableAncestors\(el\)/);
});

test('check overflow juga mengecualikan anak yang ter-clip ancestor overflow hidden|clip', () => {
  // Bukti runner: Employee Portal, lingkaran blur dekoratif `absolute -right-16` di dalam
  // panel overflow-hidden menjangkau R1471 pada viewport 1440, sementara scrollWidth dokumen
  // tetap 1440. Ancestor yang memotong harus diakui, bukan hanya ancestor yang bisa digeser.
  assert.match(uat, /const clipsChildren = \(el\)/);
  assert.match(uat, /\/\(auto\|scroll\|hidden\|clip\)\/\.test\(cs\.overflowX\)/);
  assert.match(uat, /const clippingAncestors = \(el\)/);
  // Ancestor walked sampai document.body, dan body sendiri TIDAK dianggap clipping.
  assert.match(uat, /parent !== document\.body/);
  // Ancestor ter-clip HARUS ikut dipakai di filter overflow, kalau tidak perbaikannya tidak berarti.
  assert.match(uat, /scrollableAncestors\(el\) \|\| clippingAncestors\(el\)/);
});

test('clipping ancestor tetap mengukur elemen yang TIDAK ter-clip', () => {
  // ancestor ter-clip hanya mengecualikan anak-nya; elemen yang benar-benar bocor dari
  // document-level ancestor tetap harus terbaca sebagai overflow.
  assert.match(uat, /const r = el\.getBoundingClientRect\(\);/);
  assert.match(uat, /r\.right > innerWidth \+ 3 \|\| r\.left < -3/);
});

test('kontainer scrollable yang isinya terpotong permanen tetap digagalkan', () => {
  // Ini yang membuat pengecualian tidak jadi jalan keluar tanpa pengawas.
  assert.match(uat, /const clippedScrollables = scrollables/);
  assert.match(uat, /el\.scrollWidth > el\.clientWidth \+ 1 && r\.right > innerWidth \+ 3/);
  // clippedScrollables harus ikut jadi syarat gagal di kedua state.
  assert.match(uat, /closed\.clippedScrollables\.length/);
  assert.match(uat, /metrics\.clippedScrollables\.length/);
});

test('check tidak hanya mengandalkan scrollWidth dokumen', () => {
  // scrollWidth=1440 = clientWidth adalah bukti tidak ada overflow dokumen; check lama sudah
  // benar soal itu, dan itu harus tetap diperiksa.
  assert.match(uat, /closed\.scrollWidth > width \+ 3/);
});

test('pengecualian tidak O(n^2) pada halaman besar', () => {
  // ancestor dicek terhadap daftar scrollable yang sudah dihitung sekali.
  assert.match(uat, /const scrollables = all\.filter\(isScrollable\)/);
  assert.ok(
    !/querySelectorAll\('body \*'\)\]\.some\(/.test(uat),
    'filter overflow masih_querySelectorAll ulang di dalam loop (O(n^2))',
  );
});