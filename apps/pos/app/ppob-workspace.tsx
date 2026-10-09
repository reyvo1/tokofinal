'use client';

import { type FormEvent, useCallback, useEffect, useRef, useState } from 'react';
import { AlertTriangle, RefreshCw, Search, ShieldCheck } from 'lucide-react';
import { posAuthFetch } from './auth-fetch';

const API = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000/api/v1';

type DigitalProduct = {
  id: string;
  providerSku: string;
  name: string;
  brand?: string | null;
  category: string;
  kind: string;
  salePrice: string | number;
  buyerProductStatus: boolean;
  sellerProductStatus: boolean;
  unlimitedStock: boolean;
  stock?: number | null;
  costPrice?: string | number | null;
  metadata?: { taxTreatment?: string } | null;
};
type DigitalTransaction = {
  id: string;
  number: string;
  providerSku: string;
  customerNo: string;
  status: string;
  sellingPrice: string | number;
  serialNumber?: string | null;
  message?: string | null;
  createdAt: string;
  lastCheckedAt?: string | null;
  paymentAccountingEventId?: string | null;
  settlementAccountingEventId?: string | null;
  refundAccountingEventId?: string | null;
};
type CursorPage<T> = { items: T[]; pageInfo: { nextCursor: string | null } };

function rupiah(value: string | number): string {
  return new Intl.NumberFormat('id-ID', { currency: 'IDR', style: 'currency', maximumFractionDigits: 0 }).format(Number(value));
}

async function getJson<T>(token: string, path: string, init?: RequestInit): Promise<T> {
  const response = await posAuthFetch(`${API}${path}`, token, {
    ...init,
    headers: { 'Content-Type': 'application/json', ...(init?.headers ?? {}) },
  });
  const body = await response.json().catch(() => ({})) as Record<string, unknown>;
  if (!response.ok) {
    const message = Array.isArray(body.message) ? body.message.join(', ') : body.message;
    throw new Error(typeof message === 'string' && message ? message : `HTTP ${response.status}`);
  }
  return body as unknown as T;
}

/** Cash capture is server-atomic with the Accounting Core prepayment event and outbox. */
export default function PpobOperatorWorkspace({ token, online, active, shiftOpen }: { token: string; online: boolean; active: boolean; shiftOpen: boolean }) {
  const [query, setQuery] = useState('');
  const [purchase, setPurchase] = useState({ providerSku: '', customerNo: '', cashReceived: '', confirmed: false, changeReturned: false });
  const pendingPurchaseRef = useRef<{ fingerprint: string; key: string } | null>(null);
  const [purchasing, setPurchasing] = useState(false);

  const currentSearchRef = useRef(query);
  const currentTokenRef = useRef(token);
  currentSearchRef.current = query;
  currentTokenRef.current = token;
  const [products, setProducts] = useState<DigitalProduct[]>([]);
  const [transactions, setTransactions] = useState<DigitalTransaction[]>([]);
  const [catalogCursor, setCatalogCursor] = useState<string | null>(null);
  const [transactionCursor, setTransactionCursor] = useState<string | null>(null);
  const [catalogError, setCatalogError] = useState('');
  const [historyError, setHistoryError] = useState('');
  const [feedback, setFeedback] = useState('');
  const [busy, setBusy] = useState(false);
  const [catalogBusy, setCatalogBusy] = useState(false);
  const [historyBusy, setHistoryBusy] = useState(false);

  useEffect(() => { pendingPurchaseRef.current = null; setPurchase({ providerSku: '', customerNo: '', cashReceived: '', confirmed: false, changeReturned: false }); }, [token]);
  const chosenProduct = products.find((product) => product.providerSku === purchase.providerSku);

  async function captureCashAndOrder(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!active || !online || !shiftOpen || !chosenProduct || purchasing) return;
    if (chosenProduct.metadata?.taxTreatment !== 'NO_TAX_VERIFIED') { setFeedback('Perlakuan pajak produk belum diverifikasi Finance.'); return; }
    if (!purchase.confirmed || !Number.isFinite(Number(purchase.cashReceived)) || Number(purchase.cashReceived) < Number(chosenProduct.salePrice)) {
      setFeedback('Kas yang benar-benar diterima wajib minimal sebesar harga layanan dan dikonfirmasi.'); return;
    }
    if (Number(purchase.cashReceived) > Number(chosenProduct.salePrice) && !purchase.changeReturned) {
      setFeedback('Uang kembalian harus diberikan dan dikonfirmasi sebelum mencatat penerimaan kas.'); return;
    }
    const fingerprint = JSON.stringify([token, chosenProduct.providerSku, purchase.customerNo.trim(), String(chosenProduct.costPrice ?? '')]);
    if (pendingPurchaseRef.current?.fingerprint !== fingerprint) pendingPurchaseRef.current = { fingerprint, key: `pos-ppob:${crypto.randomUUID()}` };
    const idempotencyKey = pendingPurchaseRef.current.key;
    setPurchasing(true); setFeedback('');
    try {
      const result = await getJson<DigitalTransaction>(token, '/digital-services/transactions', {
        method: 'POST',
        body: JSON.stringify({ providerSku: chosenProduct.providerSku, customerNo: purchase.customerNo.trim(), paymentMethod: 'CASH',
          idempotencyKey, ...(chosenProduct.costPrice != null ? { maxPrice: Number(chosenProduct.costPrice) } : {}) }),
      });
      pendingPurchaseRef.current = null;
      setPurchase({ providerSku: '', customerNo: '', cashReceived: '', confirmed: false, changeReturned: false });
      setFeedback(`Pembayaran kas dan jurnal uang muka ${result.number} berhasil dicatat. Pengiriman provider masih menunggu hasil worker; jangan menganggap produk sudah sukses.`);
      await loadHistory();
    } catch (error) {
      setFeedback(error instanceof Error ? `${error.message} — retry gunakan nomor operasi yang sama selama detail tidak berubah.` : 'Transaksi tidak pasti; ulangi tanpa mengganti detail.');
    } finally { setPurchasing(false); }
  }

  const loadHistory = useCallback(async (cursor?: string) => {
    if (!active || !online || !token) return;
    setHistoryBusy(true);
    setHistoryError('');
    try {
      const params = new URLSearchParams({ limit: '50' });
      if (cursor) params.set('cursor', cursor);
      const result = await getJson<CursorPage<DigitalTransaction>>(token, `/digital-services/transactions?${params}`);
      setTransactions((previous) => cursor ? [...previous, ...result.items.filter((row) => !previous.some((item) => item.id === row.id))] : result.items);
      setTransactionCursor(result.pageInfo?.nextCursor ?? null);
    } catch (error) {
      setHistoryError(error instanceof Error ? error.message : 'Riwayat PPOB gagal dimuat.');
    } finally { setHistoryBusy(false); }
  }, [active, online, token]);

  useEffect(() => {
    if (!active || !online || !token) return;
    void loadHistory();
  }, [active, online, token, loadHistory]);

  useEffect(() => {
    if (!active || !online || !token) return;
    let cancelled = false;
    setCatalogBusy(true);
    setCatalogError('');
    const timeout = window.setTimeout(() => {
      const params = new URLSearchParams({ limit: '50' });
      if (query.trim()) params.set('search', query.trim());
      void getJson<CursorPage<DigitalProduct>>(token, `/digital-services/products?${params}`)
        .then((result) => {
          if (cancelled) return;
          setProducts(result.items);
          setCatalogCursor(result.pageInfo?.nextCursor ?? null);
        })
        .catch((error) => {
          if (!cancelled) { setProducts([]); setCatalogCursor(null); setCatalogError(error instanceof Error ? error.message : 'Katalog PPOB gagal dimuat.'); }
        })
        .finally(() => { if (!cancelled) setCatalogBusy(false); });
    }, 250);
    return () => { cancelled = true; window.clearTimeout(timeout); };
  }, [active, online, token, query]);

  async function loadMoreProducts() {
    if (!token || !active || !online || !catalogCursor || catalogBusy) return;
    setCatalogBusy(true);
    setCatalogError('');
    const requestQuery = query.trim();
    const requestToken = token;
    const params = new URLSearchParams({ limit: '50', cursor: catalogCursor });
    if (requestQuery) params.set('search', requestQuery);
    try {
      const page = await getJson<CursorPage<DigitalProduct>>(token, `/digital-services/products?${params}`);
      if (currentSearchRef.current.trim() !== requestQuery || currentTokenRef.current !== requestToken) return;
      setProducts((previous) => [...previous, ...page.items.filter((item) => !previous.some((old) => old.id === item.id))]);
      setCatalogCursor(page.pageInfo?.nextCursor ?? null);
    } catch (error) { setCatalogError(error instanceof Error ? error.message : 'Halaman katalog PPOB gagal dimuat.'); }
    finally { setCatalogBusy(false); }
  }

  async function recheck(transaction: DigitalTransaction) {
    if (!online || !token || busy || !['PENDING', 'PROCESSING'].includes(transaction.status)) return;
    setBusy(true);
    setFeedback('');
    try {
      await getJson(token, `/digital-services/transactions/${encodeURIComponent(transaction.id)}/recheck`, { method: 'POST', body: '{}' });
      setFeedback(`Recheck ${transaction.number} masuk antrean provider. Status tidak dianggap berhasil sebelum dikonfirmasi server.`);
      await loadHistory();
    } catch (error) { setFeedback(error instanceof Error ? error.message : 'Recheck provider gagal.'); }
    finally { setBusy(false); }
  }

  if (!active) return null;
  return <section className="ppobWorkspace" aria-label="PPOB dan produk digital" data-ppob-mode="paid-cash-only">
    <div className="ppobSafety" role="status">
      <ShieldCheck size={19}/>
      <div><strong>Produk digital & PPOB · katalog dan pelacakan</strong>
        <p>Transaksi hanya tunai di shift aktif. Server harus berhasil memposting jurnal uang muka sebelum provider dipanggil. Hasil provider harus dipantau; penyelesaian dan refund memerlukan otorisasi Admin/Finance terpisah.</p>
      </div>
    </div>
    {!online && <p className="fieldWarning" role="alert"><AlertTriangle size={15}/> PPOB memerlukan server online. Riwayat lokal tidak digunakan sebagai bukti transaksi.</p>}
    <form className="ppobPanel formStack" onSubmit={(event) => void captureCashAndOrder(event)} aria-label="Bayar PPOB tunai terjurnal">
      <h2>Pembayaran PPOB tunai</h2>
      <p className="panelNote">Hanya produk bebas pajak yang telah diverifikasi Finance dan memiliki harga provider. Tidak ada transaksi PPOB offline.</p>
      <label>Produk layanan
        <select required value={purchase.providerSku} disabled={!shiftOpen || purchasing} onChange={(event) => { pendingPurchaseRef.current = null; setPurchase({ providerSku: event.target.value, customerNo: '', cashReceived: '', confirmed: false, changeReturned: false }); }}>
          <option value="">Pilih produk dari katalog yang dimuat</option>
          {products.filter((row) => row.metadata?.taxTreatment === 'NO_TAX_VERIFIED').map((row) => <option key={row.id} value={row.providerSku}>{row.name} · {rupiah(row.salePrice)}</option>)}
        </select>
      </label>
      <label>Nomor tujuan<input required minLength={3} maxLength={80} value={purchase.customerNo} disabled={!shiftOpen || purchasing} onChange={(event) => setPurchase((old) => ({ ...old, customerNo: event.target.value.trim(), confirmed: false }))}/></label>
      {chosenProduct && <p>Harga resmi server: <strong>{rupiah(chosenProduct.salePrice)}</strong>. Batas biaya provider: {chosenProduct.costPrice == null ? 'belum tersedia' : rupiah(chosenProduct.costPrice)}.</p>}
      <label>Uang tunai diterima<input type="number" min="0" step="0.01" required value={purchase.cashReceived} disabled={!shiftOpen || purchasing} onChange={(event) => setPurchase((old) => ({ ...old, cashReceived: event.target.value, confirmed: false, changeReturned: false }))}/></label>
      {chosenProduct && Number.isFinite(Number(purchase.cashReceived)) && Number(purchase.cashReceived) > Number(chosenProduct.salePrice) && <div className="panelNote"><strong>Uang kembalian: {rupiah(Number(purchase.cashReceived) - Number(chosenProduct.salePrice))}</strong><label><input type="checkbox" checked={purchase.changeReturned} disabled={!shiftOpen || purchasing} onChange={(event) => setPurchase((old) => ({ ...old, changeReturned: event.target.checked, confirmed: false }))}/> Saya sudah menyerahkan kembalian kepada pelanggan.</label></div>}
      <label><input type="checkbox" checked={purchase.confirmed} disabled={!shiftOpen || purchasing} onChange={(event) => setPurchase((old) => ({ ...old, confirmed: event.target.checked }))}/> Saya sudah menerima tunai fisik dari pelanggan dan memeriksa nomor tujuan.</label>
      {!shiftOpen && <p role="alert">Buka shift kasir sebelum menjual PPOB.</p>}
      <button type="submit" disabled={!online || !shiftOpen || purchasing || !chosenProduct || chosenProduct.costPrice == null || !purchase.confirmed}>{purchasing ? 'MENCATAT PEMBAYARAN…' : 'Catat uang muka & antre provider'}</button>
    </form>
    <div className="ppobPanels">
      <section className="ppobPanel">
        <div className="cartTitle"><div><small>KATALOG PROVIDER</small><h2>Pulsa, PLN, paket data & voucher</h2></div></div>
        <label className="ppobSearch"><Search size={15}/><input aria-label="Cari produk PPOB" placeholder="Cari nama layanan, brand, atau SKU" value={query} maxLength={100} onChange={(event) => setQuery(event.target.value)} disabled={!online}/></label>
        {catalogError && <p role="alert" className="fieldWarning">{catalogError}</p>}
        {catalogBusy && <p role="status">Memuat katalog dari server…</p>}
        {!catalogBusy && !catalogError && products.length === 0 && <div className="syncEmpty">Katalog provider belum tersedia pada cabang ini.</div>}
        <ul className="ppobList">{products.map((product) => <li key={product.id}>
          <div><strong>{product.name}</strong><small>{product.brand ?? product.category} · {product.providerSku} · {product.kind}</small></div>
          <div><strong>{rupiah(product.salePrice)}</strong><small>{product.unlimitedStock ? 'Stok provider fleksibel' : `Stok ${product.stock ?? 'belum diketahui'}`}</small></div>
        </li>)}</ul>
        {catalogCursor && <button type="button" className="secondary" onClick={() => void loadMoreProducts()} disabled={catalogBusy || !online}>{catalogBusy ? 'MEMUAT…' : 'Muat layanan lain'}</button>}
      </section>
      <section className="ppobPanel">
        <div className="cartTitle"><div><small>RIWAYAT PROVIDER</small><h2>Status transaksi tercatat</h2></div><button type="button" className="secondary" onClick={() => void loadHistory()} disabled={!online || historyBusy}><RefreshCw size={14}/> Refresh</button></div>
        {historyError && <p role="alert" className="fieldWarning">{historyError}</p>}
        {feedback && <p role="status" className="notice">{feedback}</p>}
        {historyBusy && <p role="status">Memuat status dari server…</p>}
        {!historyBusy && !historyError && transactions.length === 0 && <div className="syncEmpty">Belum ada transaksi digital pada cabang ini.</div>}
        <ul className="ppobList">{transactions.map((row) => <li key={row.id}>
          <div><strong>{row.number}</strong><small>{row.providerSku} · {row.customerNo} · {new Date(row.createdAt).toLocaleString('id-ID')}</small><small>{row.serialNumber ? `SN: ${row.serialNumber}` : row.message ?? 'Belum ada pesan provider'}</small></div>
          <div><span className="ppobStatus">{row.status}</span><strong>{rupiah(row.sellingPrice)}</strong>{['PENDING', 'PROCESSING'].includes(row.status) && <button type="button" className="secondary" onClick={() => void recheck(row)} disabled={!online || busy}>Recheck</button>}</div>
        </li>)}</ul>
        {transactionCursor && <button type="button" className="secondary" disabled={!online || historyBusy} onClick={() => void loadHistory(transactionCursor)}>Riwayat berikutnya</button>}
      </section>
    </div>
  </section>;
}
