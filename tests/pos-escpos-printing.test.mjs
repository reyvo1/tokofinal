// ESC/POS bytes, asserted exactly.
//
// These are the one place in the POS where a wrong number is a physical failure a cashier cannot
// work around: the drawer stays shut, or a receipt prints as mojibake, or the paper cuts through
// the total. No amount of UI polish recovers that, and none of it is visible in a browser screenshot.
//
// The drawer command is fixed by the protocol, not by printer brand, so it is asserted byte for byte
// against the ESC/POS specification rather than against whatever the code happens to emit — a test
// written from the implementation would pass forever, including while the implementation is wrong.
import assert from 'node:assert/strict';
import test from 'node:test';

const { buildDrawerKick, buildInit, buildCut, buildBold, buildAlignCenter, buildReceipt, formatColumn,
        columnsForWidth, buildReceipt: build, printReceipt, openCashDrawer, detectCapabilities } =
  await import('./helpers/import-ts.mjs').then((m) => m.load('apps/pos/lib/printing.ts'));

const hex = (bytes) => Array.from(bytes).map((b) => b.toString(16).padStart(2, '0')).join(' ');

test('the cash drawer kick is the exact ESC/POS sequence, on both pins', () => {
  // ESC p m t1 t2 for pin 2, and ESC p ... with 0xf5 for pin 5. The printer passes the pulse
  // straight through the RJ11 to the drawer solenoid, so these bytes ARE the drawer.
  assert.equal(hex(buildDrawerKick(2)), '1b 70 fa 08 00 40 00');
  assert.equal(hex(buildDrawerKick(5)), '1b 70 f5 08 00 40 00');
  // Pin is a real choice: which one is wired is a property of how the till was assembled, and the
  // cashier cannot see it. Hardcoding one pin means the drawer fails on half the estates.
  assert.notEqual(hex(buildDrawerKick(2)), hex(buildDrawerKick(5)));
  // m/t are in 2 ms and 5 ms units. m = 8 -> ~40 ms pulse, which trips a solenoid without cooking it.
  const [, , , m, , t] = buildDrawerKick(2);
  assert.equal(m, 0x08);
  assert.equal(t, 0x40);
});

test('the printer control sequences use the documented opcodes', () => {
  assert.equal(hex(buildInit()), '1b 40', 'ESC @ — reset, so a previous job cannot bleed into this one');
  assert.equal(hex(buildAlignCenter()), '1b 61 01', 'ESC a 1');
  assert.equal(hex(buildBold(true)), '1b 45 01', 'ESC E 1');
  assert.equal(hex(buildBold(false)), '1b 45 00', 'ESC E 0');
  // GS V 66 — the "feed then cut" form. `cut` alone slices through the last line of text.
  assert.equal(hex(buildCut(3)), '1d 56 42 03 00 00', 'GS V B — paper cut');
});

test('a receipt is laid out to the physical roll width, not a guessed column count', () => {
  assert.equal(columnsForWidth(58), 32, 'a 58 mm roll is about 32 characters of 12 cpi text');
  assert.equal(columnsForWidth(80), 48, 'a wider roll fits more per line');
  // A total that wraps is a total the cashier misreads, so the label yields space to the value.
  const line = formatColumn({ left: 'TOTAL', right: 'Rp1.234.500' }, 32);
  assert.equal(line.length, 32, `expected 32 columns, got ${line.length}: ${JSON.stringify(line)}`);
  assert.ok(line.trimEnd().endsWith('Rp1.234.500'), 'the value must stay on the right');
  // An over-long label is truncated rather than allowed to push the value onto a second line.
  const long = formatColumn({ left: 'x'.repeat(60), right: '999' }, 32);
  assert.equal(long.length, 32);
  assert.ok(long.endsWith(' 999'));
});

test('the receipt stream opens with a reset and ends with a cut', () => {
  const bytes = buildReceipt({
    storeName: 'TOKO 360', invoiceNumber: 'INV/001', dateLabel: '29/09/2026 10:00', cashierName: 'Rina',
    columns: [{ left: 'Gula Aren 500g', right: '27.000' }],
    summary: [{ label: 'TOTAL', value: 'Rp27.000', bold: true }],
    paperWidth: 58,
  });
  // The reset MUST be first, or a half-finished job from a previous receipt prints over this one.
  assert.equal(bytes[0], 0x1b);
  assert.equal(bytes[1], 0x40);
  const tail = hex(bytes.slice(-6));
  assert.equal(tail, '1d 56 42 03 00 00', 'the stream must end with a paper cut');
  const text = new TextDecoder().decode(bytes);
  assert.ok(text.includes('TOKO 360'));
  assert.ok(text.includes('Rp27.000'), 'the total must be in the byte stream, not just in the DOM');
});

test('printing reports honestly instead of throwing when no transport exists', () => {
  // navigator.usb and navigator.bluetooth are simply ABSENT on Safari and Android Chrome, and
  // calling into them throws a TypeError that reads in the log like a printer fault.
  const capabilities = detectCapabilities();
  assert.equal(capabilities.any, capabilities.webUsb || capabilities.webBluetooth,
    '`any` must be derived, not asserted separately');
  assert.equal(typeof capabilities.webUsb, 'boolean');
});

test('printReceipt and openCashDrawer degrade to a message, not an exception', async () => {
  const noPrinter = await printReceipt({
    storeName: 'T', invoiceNumber: '1', dateLabel: 'x', cashierName: 'y', columns: [], summary: [],
  });
  assert.equal(noPrinter.ok, false);
  assert.match(noPrinter.reason, /printer|Printer/, 'the reason must name the actual problem');

  const drawer = await openCashDrawer();
  assert.equal(drawer.ok, false);
  assert.match(drawer.reason, /laci/i, 'a cashier needs to know the drawer will not open');
});

test('bytes reach the connection, and a fault is reported rather than thrown', async () => {
  const written = [];
  const ok = await printReceipt(
    { storeName: 'T', invoiceNumber: '1', dateLabel: 'x', cashierName: 'y', columns: [], summary: [] },
    { write: async (bytes) => { written.push(bytes); }, close: () => {} },
  );
  assert.equal(ok.ok, true);
  assert.equal(written.length, 1);
  assert.ok(written[0].length > 0);

  const drawer = await openCashDrawer({ write: async (b) => { written.push(b); }, close: () => {} });
  assert.equal(drawer.ok, true);
  assert.equal(hex(written[written.length - 1]), '1b 70 fa 08 00 40 00', 'the drawer kick must be the last thing written');

  // A printer that throws mid-write is a real failure mode (paper out, cable pulled).
  const failed = await openCashDrawer({ write: async () => { throw new Error('kabel lepas'); }, close: () => {} });
  assert.equal(failed.ok, false);
  assert.match(failed.reason, /kabel lepas/);
});
