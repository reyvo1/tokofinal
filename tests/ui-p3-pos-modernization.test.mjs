import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const page=readFileSync(new URL('../apps/pos/app/page.tsx',import.meta.url),'utf8');
const shell=readFileSync(new URL('../apps/pos/app/pos-shell.tsx',import.meta.url),'utf8');
const css=readFileSync(new URL('../apps/pos/app/globals.css',import.meta.url),'utf8');

test('UI-P3 splits POS into explicit operator workspaces',()=>{for(const label of ['Penjualan','Shift & Kas','Retur','Sinkronisasi']) assert.match(shell,new RegExp(label));for(const id of ["workspace === 'SALE'","workspace === 'SHIFT'","workspace === 'RETURNS'","workspace === 'SYNC'"]) assert.ok(page.includes(id));});
test('UI-P3 keeps payment and shift guards fail-closed',()=>{assert.ok(page.includes('!cart.length || !warehouseId || !shift || !activeQuote || quoteLoading || !!activeQuoteError || paying || !splitReady'));assert.ok(page.includes('cart.length > 0 || paying || !apiOnline || ownedOfflineQueue.length > 0'));});
test('UI-P3 preserves restrictive offline sale rules',()=>{assert.ok(page.includes('splitEnabled || normalizedOnAccount > 0 || !activeTender?.allowOffline'));assert.ok(page.includes('Promo membutuhkan koneksi server.'));assert.ok(page.includes('Penukaran poin membutuhkan koneksi server.'));assert.ok(page.includes('reservedOfflineQuantity'));});
test('UI-P3 preserves idempotent replay and conflict retention',()=>{assert.ok(page.includes('idempotencyKey'));assert.ok(page.includes("status: 'CONFLICT' as const"));assert.ok(page.includes('Data tidak dibuang dan tidak diduplikasi.'));});
test('UI-P3 V4 is an explicitly bright touch cockpit, not a legacy dark POS skin',()=>{// Light default preserved via .posV4 in the stylesheet; a Tailwind bg-* utility on the themed
  // root would outrank the [data-theme='dark'] rules and freeze the POS in light mode.
  const shellRootTag = shell.slice(shell.indexOf('<main'), shell.indexOf('>', shell.indexOf('<main')));
  assert.doesNotMatch(shellRootTag,/\bbg-slate-\d{2,3}\b/);assert.doesNotMatch(shellRootTag,/\btext-slate-950\b/);assert.match(shell,/posV4 min-h-screen min-w-0/);assert.match(shell,/data-visual-generation="p5-v4"/);assert.match(shell,/bg-gradient-to-br from-teal-500 to-cyan-600/);assert.match(css,/\.posV4\{background:radial-gradient/);assert.match(css,/\.cart\{@apply[^}]*xl:sticky[^}]*xl:top-\[164px\]/);assert.match(css,/\.products\{@apply[^}]*grid-cols-2/);assert.doesNotMatch(css,/@apply[^;]*\bgroup\b/);});
test('UI-P3 mobile header can wrap warehouse controls without horizontal overflow',()=>{assert.match(shell,/flex w-full max-w-\[1720px\] flex-col gap-3/);assert.match(shell,/posTopbarActions flex min-w-0 flex-wrap/);assert.match(css,/\.posTopbarActions label\{@apply[^}]*min-w-0[^}]*flex-\[1_1_13rem\]/);assert.match(css,/\.posTopbarActions label select\{@apply[^}]*min-w-0[^}]*flex-1/);});
