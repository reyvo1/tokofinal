import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
const read=(p)=>fs.readFileSync(p,'utf8');
const pos=read('apps/pos/app/globals.css');
const storefront=read('apps/storefront/app/globals.css');
const employee=read('apps/employee-portal/app/globals.css');
const audit=read('scripts/audit-ui-domain-surface-depth.mjs');
test('POS live semantic controls have presentation authority',()=>{for(const c of ['logout','syncButton','shiftClose','redeem'])assert.match(pos,new RegExp(`\\.${c}`));assert.match(pos,/\.posV4\{[^}]*#f8fafc/i);});
test('Storefront live semantic layout classes have presentation authority',()=>{for(const c of ['homeDeck','sectionTitle','catalogControls','productDetailBody','checkoutGrid','cartRow','paymentChooser','emptyIcon'])assert.match(storefront,new RegExp(`\\.${c}`));});
// `table` dan `tr` TIDAK boleh muncul di daftar ini: keduanya nama utilitas Tailwind
// (display:table dan utilitas warna). Memakainya sebagai class komponen berarti Tailwind
// menghasilkan utility yang menimpa styling hand-written - itulah penyebab .table terukur
// 642px di runner (computed display:table, sehingga overflow-x:auto tidak berlaku).
// Nama yang aman harus berprefiks dan tidak bisa dihasilkan Tailwind.
test('Employee portal live semantic layout classes have presentation authority',()=>{
  for(const c of ['welcomeDeck','dashboardGrid','cardHeading','formGrid','statusPill','hrTable','hrRow','hrHead','skeletonList'])
    assert.match(employee,new RegExp(`\\.${c}`));
  // Pengunci akar masalah: nama utilitas Tailwind tidak boleh kembali dipakai sebagai class.
  // Pemzah sebelumnya harus mencakup `}` juga: aturan CSS dipisah `}`, bukan `{` atau `,`.
  // Kalau `}` tidak diizinkan, selector `.hrTable{` yang diubah jadi `.table{` lolos dari
  // deteksi - persis celah yang membuat test ini hijau palsu saat diuji balik.
  for(const c of ['table','tr','th'])
    assert.doesNotMatch(employee,new RegExp(`[{},;]\\.${c}(?=[.{:, ])`),`.${c} menabrak utilitas Tailwind`);
});
test('deep UI audit binds presentation coverage to capability inventory',()=>{assert.match(audit,/config\/f1-backend-ui-audit\.json/);assert.match(audit,/config\/p5-visual-surface-map\.json/);assert.match(audit,/ui-domain-surface-depth-latest\.json/);});
