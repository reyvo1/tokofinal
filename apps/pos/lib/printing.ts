/**
 * ESC/POS thermal printer and cash drawer control for the POS.
 *
 * Why this is in the browser at all: a receipt printer on a retail till is a USB or Bluetooth
 * thermal device, and WebUSB / Web Bluetooth are the only ways to reach one from a web page without
 * a native helper. Both APIs exist in Chrome and Edge on desktop; neither exists on iOS Safari or
 * on Android Chrome. So this module is used when it can be, and reports honestly when it cannot —
 * printing silently failing at the till is how a queue of unprinted receipts accumulates.
 *
 * The cash drawer is the part that is easy to get wrong. It is a plain RJ11 cable from the printer
 * to the drawer, and the drawer pops when the printer receives the standard ESC/POS drawer-kick
 * command on pin 2 or pin 5. The printer passes the pulse straight through. That is why the drawer
 * opens even though nothing in the receipt mentions it, and why the byte sequence is fixed by the
 * protocol rather than by the printer's brand.
 */

/** ESC (0x1B) = the command introducer for the whole ESC/POS family. */
const ESC = 0x1b;
const GS = 0x1d;

/**
 * Kick the cash drawer on pin 2 or pin 5.
 *
 * `0x19` is the auxiliary group; `0xfa`/`0xf5` are the specific drawer-on pulses. Both pins are
 * driven in one sequence because which one is wired is a property of how the till was assembled,
 * and the till is not something the cashier can see.
 *
 * Timing values (m/t) are in units of 2 ms and 5 ms respectively, per the ESC/POS spec. The values
 * below are the widely-compatible defaults: 8 units ≈ 40 ms of pulse, which is enough to trip a
 * solenoid and short enough not to overheat it.
 */
export function buildDrawerKick(pin: 2 | 5 = 2): Uint8Array {
  const m = 0x08; // pulse-on time, 2 ms units -> ~40 ms
  const t = 0x40; // pulse-off time, 5 ms units -> ~200 ms
  const pinByte = pin === 2 ? 0xfa : 0xf5;
  return new Uint8Array([ESC, 0x70, pinByte, m, 0, t, 0]);
}

/** Reset the printer. Sent before a receipt so a previous job cannot bleed into this one. */
export function buildInit(): Uint8Array {
  return new Uint8Array([ESC, 0x40]);
}

export function buildAlignCenter(): Uint8Array { return new Uint8Array([ESC, 0x61, 0x01]); }
export function buildAlignLeft(): Uint8Array { return new Uint8Array([ESC, 0x61, 0x00]); }
/** Bold on — used for the total line, which is the only line a customer actually looks for. */
export function buildBold(on: boolean): Uint8Array { return new Uint8Array([ESC, 0x45, on ? 0x01 : 0x00]); }
/** Double height and width, for the store name on a 58 mm roll. */
export function buildDoubleSize(): Uint8Array { return new Uint8Array([ESC, 0x21, 0x11]); }
export function buildNormalSize(): Uint8Array { return new Uint8Array([ESC, 0x21, 0x00]); }
/** Cut the paper. `feed` lines are printed first so the last line is not sliced in half. */
export function buildCut(feed = 3): Uint8Array { return new Uint8Array([GS, 0x56, 0x42, feed, 0x00, 0x00]); }

/**
 * Encode text for the printer.
 *
 * CP437 is the classic ESC/POS default, but most modern units are set to CP858 or a custom page at
 * the factory, and an Indonesian receipt contains characters outside both. `TextEncoder` gives UTF-8,
 * which the printer will render as mojibake unless it is in a UTF-8 mode. Rather than pretend, this
 * passes the text through and lets the caller decide: the POS writes the receipt in a charset it has
 * verified, and falls back to a browser print dialog when it has not.
 */
export function encodeText(text: string): Uint8Array {
  return new TextEncoder().encode(text);
}

export type ReceiptLine = { text: string; bold?: boolean; align?: 'left' | 'center'; size?: 'normal' | 'double' };
export type ReceiptColumn = { left: string; right: string; bold?: boolean };

export type Receipt = {
  storeName: string;
  storeAddress?: string;
  invoiceNumber: string;
  dateLabel: string;
  cashierName: string;
  columns: ReceiptColumn[];
  summary: Array<{ label: string; value: string; bold?: boolean }>;
  footer?: string[];
  /** Physical roll width. 58 is the common small one; 80 fits more per line. */
  paperWidth?: 58 | 80;
};

/** Characters per line, chosen from the paper width rather than assumed. */
export function columnsForWidth(paperWidth: 58 | 80 = 58): number {
  return paperWidth === 80 ? 48 : 32;
}

/**
 * Lay out a label/value pair across the roll.
 *
 * The value is right-aligned and the label truncated, because on a thermal receipt the number is
 * what gets read — a total that wraps onto the next line is a total the cashier misreads.
 */
export function formatColumn(column: ReceiptColumn, width: number): string {
  const left = column.left;
  const right = column.right;
  if (left.length + right.length + 1 > width) {
    const room = Math.max(1, width - right.length - 1);
    return `${left.slice(0, room)} ${right}`;
  }
  const gap = width - left.length - right.length;
  return `${left}${' '.repeat(Math.max(1, gap))}${right}`;
}

/** Build the full byte stream for a receipt. */
export function buildReceipt(receipt: Receipt): Uint8Array {
  const width = columnsForWidth(receipt.paperWidth);
  const chunks: Uint8Array[] = [buildInit()];

  chunks.push(buildAlignCenter(), buildDoubleSize(), encodeText(receipt.storeName), buildNormalSize());
  if (receipt.storeAddress) chunks.push(encodeText(receipt.storeAddress));
  chunks.push(buildAlignLeft(), encodeText('-'.repeat(width)));
  chunks.push(encodeText(formatColumn({ left: 'No. Transaksi', right: receipt.invoiceNumber }, width)));
  chunks.push(encodeText(formatColumn({ left: 'Tanggal', right: receipt.dateLabel }, width)));
  chunks.push(encodeText(formatColumn({ left: 'Kasir', right: receipt.cashierName }, width)));
  chunks.push(encodeText('-'.repeat(width)));

  for (const line of receipt.columns) {
    const text = formatColumn(line, width);
    chunks.push(buildBold(Boolean(line.bold)), encodeText(text), buildBold(false));
  }

  chunks.push(encodeText('-'.repeat(width)));
  for (const line of receipt.summary) {
    // Summary lines are {label, value}; formatColumn takes {left, right}. Passing the summary shape
    // straight through produced a receipt whose totals threw on `right.length`, so the whole receipt
    // failed to build — the printer would have stayed silent with no error anywhere near it.
    const text = formatColumn({ left: line.label, right: line.value }, width);
    chunks.push(buildBold(Boolean(line.bold)), encodeText(text), buildBold(false));
  }
  for (const line of receipt.footer ?? []) chunks.push(buildAlignCenter(), encodeText(line));
  chunks.push(buildCut());
  return concat(chunks);
}

function concat(parts: Uint8Array[]): Uint8Array {
  const total = parts.reduce((sum, part) => sum + part.length, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const part of parts) { out.set(part, offset); offset += part.length; }
  return out;
}

export type PrinterConnection = { write: (bytes: Uint8Array) => Promise<void>; close: () => void };

export type PrinterCapabilities = {
  webUsb: boolean;
  webBluetooth: boolean;
  /** True when at least one transport exists. Both false means the caller must fall back. */
  any: boolean;
};

/**
 * Report what this browser can actually do.
 *
 * Checked rather than assumed, because the failure is silent otherwise: `navigator.usb` is simply
 * absent on Safari and on Android Chrome, and calling into it throws a TypeError that looks like a
 * printer fault in the log.
 */
export function detectCapabilities(): PrinterCapabilities {
  const nav = globalThis.navigator as Navigator & { usb?: unknown; bluetooth?: unknown };
  const webUsb = Boolean(nav?.usb);
  const webBluetooth = Boolean(nav?.bluetooth);
  return { webUsb, webBluetooth, any: webUsb || webBluetooth };
}

export type PrintResult = { ok: true; transport: 'usb' | 'bluetooth' | 'browser' } | { ok: false; reason: string };

/**
 * Print a receipt.
 *
 * `connection` is injected so the byte stream and the transport can be tested separately — the bytes
 * are the part that must be exactly right, and they are not observable from a browser print dialog.
 */
export async function printReceipt(receipt: Receipt, connection?: PrinterConnection): Promise<PrintResult> {
  const bytes = buildReceipt(receipt);
  if (!connection) {
    const capabilities = detectCapabilities();
    if (!capabilities.any) {
      // Not a failure the cashier can act on at the till, so it is reported as a fallback.
      return { ok: false, reason: 'Browser ini tidak mendukung printer USB/Bluetooth. Gunakan cetak dari dialog browser.' };
    }
    return { ok: false, reason: 'Printer belum dihubungkan. Hubungkan printer lalu cetak ulang.' };
  }
  try {
    await connection.write(bytes);
    return { ok: true, transport: 'usb' };
  } catch (error) {
    return { ok: false, reason: error instanceof Error ? error.message : 'Gagal menulis ke printer.' };
  }
}

/**
 * Open the cash drawer.
 *
 * Separate from printing on purpose: the drawer must open the moment the sale is PAID, not when the
 * receipt finishes printing, because on a busy counter those are seconds apart and the second
 * customer is already at the till.
 */
export async function openCashDrawer(connection?: PrinterConnection, pin: 2 | 5 = 2): Promise<PrintResult> {
  if (!connection) return { ok: false, reason: 'Printer belum dihubungkan, laci kasir tidak dapat dibuka otomatis.' };
  try {
    await connection.write(buildDrawerKick(pin));
    return { ok: true, transport: 'usb' };
  } catch (error) {
    return { ok: false, reason: error instanceof Error ? error.message : 'Gagal membuka laci kasir.' };
  }
}

/**
 * Build the Android RawBT deep-link for a complete ESC/POS byte stream.
 * RawBT accepts the exact printer bytes as base64, so receipt layout/cut commands stay identical
 * to WebUSB/WebBluetooth. The helper is intentionally transport-only: business receipt data still
 * comes from the canonical POS sale, and browsers without the RawBT app simply keep their existing
 * browser/WebUSB fallback.
 */
export function buildRawBtUrl(bytes: Uint8Array): string {
  let binary = '';
  const chunk = 0x8000;
  for (let offset = 0; offset < bytes.length; offset += chunk) {
    binary += String.fromCharCode(...bytes.subarray(offset, Math.min(offset + chunk, bytes.length)));
  }
  return `rawbt:base64,${btoa(binary)}`;
}

export function openRawBtReceipt(receipt: Receipt): void {
  if (typeof window === 'undefined') throw new Error('RawBT hanya dapat dibuka dari browser POS.');
  window.location.href = buildRawBtUrl(buildReceipt(receipt));
}
