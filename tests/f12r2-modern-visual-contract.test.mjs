import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const read=(path)=>fs.readFileSync(path,'utf8');
const adminCss=read('apps/admin/app/globals.css');
const adminShell=read('apps/admin/app/app-shell.tsx');
const posCss=read('apps/pos/app/globals.css');
const posShell=read('apps/pos/app/pos-shell.tsx');
const posPage=read('apps/pos/app/page.tsx');
const storePage=read('apps/storefront/app/page.tsx');
const employeeShell=read('apps/employee-portal/app/employee-portal-shell.tsx');
const employeePackage=JSON.parse(read('apps/employee-portal/package.json'));

test('F12R2 Admin V4.6 uses layered Tailwind reference dashboard with dual-theme authority',()=>{assert.match(adminCss,/@import\s+["']tailwindcss["']/);assert.match(adminShell,/data-theme=\{theme\}/);assert.match(adminCss,/linear-gradient\(135deg,#10b981,#2563eb\)/);assert.match(adminCss,/backdrop-filter:\s*blur/);assert.match(adminCss,/\.adminV4\[data-theme='dark'\]/);});
test('F12R2 POS V4 is light, touch-first and keeps safe Lucide actions',()=>{
// The light default still has to be expressed, but NOT as a Tailwind utility on the themed
// root: `bg-slate-100` on <main class="posV4"> outranks every [data-theme='dark'] rule by
// specificity, so it pinned the POS to a light page with a permanently dark <main> and made
// the theme toggle a no-op. The light surface now comes from .posV4 in the stylesheet, and
// colour-scheme is declared for both themes rather than light only.
const posRootTag=posShell.slice(posShell.indexOf('<main'),posShell.indexOf('>',posShell.indexOf('<main')));assert.doesNotMatch(posRootTag,/\bbg-slate-\d{2,3}\b/);assert.doesNotMatch(posRootTag,/\btext-slate-950\b/);
assert.match(posCss,/\.posV4\{[^}]*background/);assert.match(posCss,/color-scheme:light/);assert.match(posCss,/html\[data-t360-theme='dark'\]/);assert.match(posPage,/<Package size=\{24\}/);assert.match(posPage,/aria-label="Hapus metode pembayaran"/);assert.doesNotMatch(posPage,/window\.confirm|>×<|>\+ METODE</);assert.match(posPage,/pendingHeldRecall/);});
test('F12R2 Storefront uses Lucide verification icon instead of checkmark text',()=>{assert.match(storePage,/CircleCheck/);assert.doesNotMatch(storePage,/✓ Email terverifikasi|✓ Telepon terverifikasi/);});
test('F12R2 Employee Portal uses the same Lucide icon system as other surfaces',()=>{assert.equal(employeePackage.dependencies['lucide-react'],'^1.34.0');for(const icon of ['Home','MapPinCheckInside','CalendarDays','TimerReset','ReceiptText','History','UserRound','LogOut']) assert.match(employeeShell,new RegExp(`\\b${icon}\\b`));assert.match(employeeShell,/data-visual-generation="p5-v4"/);});
