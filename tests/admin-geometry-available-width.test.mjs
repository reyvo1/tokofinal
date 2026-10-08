// Regression untuk kelas defect "check membandingkan terhadap ukuran viewport yang DIMINTA
// (innerWidth/width), bukan lebar yang benar-benar TERSEDIA untuk konten (clientWidth)".
//
// Di Chrome headless viewport 1440x900 dengan konten yang memaksa scrollbar:
//   innerWidth = 1440, clientWidth = 1425  (scrollbar memakan 15px)
//   100vh = 100dvh = 100svh = 100% = 900px (scrollbar TIDAK memengaruhi tinggi)
//
// Karena itu check yang menghitung ekspektasi lebar dari `width` akan selalu gagal pada layout
// yang justru benar. Test ini mengunci bahwa setiap check lebar di assertAdminShellGeometry
// memakai availableWidth, dan tidak ada yang tersisa memakai `width` mentah.
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import assert from 'node:assert/strict';

const script = await readFile(new URL('../scripts/browser-uat.mjs', import.meta.url), 'utf8');

// Batasi ke fungsi geometry Admin saja agar tidak ikut menguji check lain.
const start = script.indexOf('async function assertAdminShellGeometry');
assert.ok(start > 0, 'assertAdminShellGeometry harus ada');
const end = script.indexOf('\nasync function ', start + 10);
const body = script.slice(start, end > 0 ? end : start + 6000);

test('geometry Admin membandingkan lebar terhadap availableWidth, bukan ukuran yang diminta', () => {
  assert.match(body, /availableWidth\s*=\s*geometry\.clientWidth\s*\?\?\s*width/);

  // Setiap check lebar harus/task availableWidth. `width` mentah hanya boleh muncul sebagai
  // nilai fallback dalam deklarasi availableWidth itu sendiri dan pada pesan error.
  const widthChecks = body
    .split('\n')
    .filter((line) => /(^|[\s(])width\b/.test(line))
    .filter((line) => !/availableWidth\s*=/.test(line))
    .filter((line) => !/\/\//.test(line.split('width')[0].slice(-2)))
    .filter((line) => !/tidak mengisi viewport/.test(line))
    .filter((line) => !/JSON\.stringify/.test(line))
    .filter((line) => !/clientWidth/.test(line))
    .filter((line) => !/innerWidth/.test(line));

  for (const line of widthChecks) {
    assert.ok(
      !/[-+]\s*width\b|\bwidth\s*[-+]/.test(line) || line.includes('availableWidth'),
      `check lebar masih memakai \`width\` mentah: ${line.trim()}`,
    );
  }
});

test('ketiga check lebar (layout desktop, main desktop, content mobile) memakai availableWidth', () => {
  assert.match(body, /layout\.width - availableWidth/);
  assert.match(body, /main\.width < availableWidth - sidebar\.width/);
  assert.match(body, /content\.width < availableWidth - 40/);
});

test('availableWidth punya fallback yang aman kalau clientWidth tidak terbaca', () => {
  // Tanpa fallback, `undefined` membuat perbandingan NaN dan check jadi diam-diam lolos.
  assert.match(body, /geometry\.clientWidth\s*\?\?\s*width/);
});

test('parse() di dalam template literal memakai escape ganda agar regex benar-benar match', () => {
  // Bug yang ditemukan: /\d+/ ditulis di dalam template literal, jadi satu backslash ditelan
  // JavaScript sebelum string dikirim ke evaluateValue. Regex yang sampai ke browser menjadi
  // /d+/ yang tidak pernah match "rgb(244, 247, 251)". Akibatnya luminance selalu null dan
  // check tema praktis tidak pernah menguji apa pun - ia gagal karena null, bukan karena warna.
  // Prove: single-escaped \d is swallowed by the template literal.
  const single = `const n = "x".match(/\d+/g)`;
  assert.ok(!single.includes('\\d'), 'sanity: single-escaped \\d harus hilang dari template literal');
  assert.ok(single.includes('/d+/'), 'sanity: single-escaped \\d berubah jadi /d+/');

  // Perbaikan harus memakai escape ganda, yang bertahan sampai ke regex.
  assert.match(
    script,
    /match\(\/\\\\d\+\(\?:\\\\\.\\\\d\+\)\?\/g\)/,
    'parse() harus memakai /\\d+(?:\\.\\d+)?/g (double-escaped) di dalam template literal',
  );
  // Dan single-escaped version tidak boleh ada lagi di file.
  assert.ok(
    !/match\(\/\\d\+/.test(script),
    'masih ada single-escaped /\\d+/ di dalam template literal yang tidak akan match',
  );
});

test('check tema benar-benar bisa membedakan terang dan gelap lewat luminance', () => {
  // Kalau parse selalu null, check ini hanya membandingkan null - ia tidak pernah menguji warna.
  // Ambang 190 sudah ada; yang hilang sebelumnya adalah nilai yang dihitung.
  assert.match(script, /const luminance = \(rgb\)/);
  assert.match(script, /rootLuminance === null \|\| metrics\.rootLuminance < 190/);
  // Fail-closed: null HARUS dianggap gagal, bukan lolos.
  assert.match(script, /sidebarLuminance === null \|\| metrics\.sidebarLuminance < 190/);
});

test('sidebarVisible hanya true bila benar-benar berada di dalam viewport', () => {
  // Bug yang ditemukan: `visible()` hanya mengecek display/visibility/ukuran. Drawer off-canvas
  // di left:-286 punya display block dan ukuran 286x844, jadi terbaca "visible" - padahal
  // main/content mobile sudah benar selebar viewport dan check menyimpulkan layout salah.
  assert.match(body, /r\.right > 1 && r\.left < innerWidth - 1/);
  // Implementation lama tidak punya pemeriksaan posisi sama sekali.
  assert.ok(
    !/return style\.display !== 'none' && style\.visibility !== 'hidden' && r\.width > 0/.test(body),
    'visible() masih hanya memeriksa display/visibility/ukuran tanpa posisi di viewport',
  );
});

test('check drawer off-canvas memverifikasi keterjangkauan, bukan hanya mengecualikan', () => {
  // Fungsi yang memegang logika ini adalah assertViewportIntegrity, bukan assertAdminShellGeometry.
  const oStart = script.indexOf('async function assertViewportIntegrity');
  assert.ok(oStart > 0, 'assertViewportIntegrity harus ada');
  const oEnd = script.indexOf('\nasync function ', oStart + 10);
  const overflowBody = script.slice(oStart, oEnd > 0 ? oEnd : oStart + 8000);

  // Drawer tertutup yang disengaja tidak boleh dilaporkan overflow, TAPI isinya harus
  // dibuktikan bisa dibuka lewat tombol sungguhan - kalau tidak, check ini hanya pengecualian
  // yang membuat drawer rusak lolos.
  assert.match(overflowBody, /adminV4Sidebar:not\(\.mobileOpen\)/);
  assert.match(overflowBody, /button\[aria-label="Buka menu"\]/);
  assert.match(overflowBody, /drawerVerified/);

  // Drawer yang TIDAK punya toggle akan terdeteksi, bukan lolos diam-diam.
  assert.match(overflowBody, /opened\?\.found/);
});