'use client';

// POST-1C operator surface — Telegram identity binding and mobile stock-count drafts.
//
// This screen administers who may act through Telegram. It therefore follows one rule throughout: the
// platform identity is treated as a credential, so it is never displayed here and never returned by
// the list endpoint. An operator revokes a binding by employee, not by chat id.
//
// Nothing on this screen posts inventory. A draft is a count waiting to be filed; turning a count into
// stock is the canonical StockOpname lifecycle's job, with its own supervisor approval.

import { FormEvent, useEffect, useState } from 'react';
import { authFetch } from '../auth-fetch';
import { usePermissions } from '../permissions';
import { Panel, StatusChip, Table } from '../ui';

const API = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000/api/v1';

type Binding = { id: string; employeeId: string; displayName?: string | null; isActive: boolean; revokedAt?: string | null; revokedReason?: string | null; lastUsedAt?: string | null; createdAt: string };
type PageInfo = { hasMore?: boolean; nextCursor?: string | null };
type BindingPage = { items: Binding[]; pageInfo?: PageInfo };
type DraftRow = {
  id: string; deviceId: string; warehouseId: string; warehouseName?: string | null; warehouseCode?: string | null;
  locationId?: string | null; opnameId?: string | null; status: string; lineCount: number;
  lastScannedAt?: string | null; deviceLocalAt?: string | null; createdAt: string; updatedAt: string; awaitingFiling: boolean;
};
type DiscrepancyLine = { key: string; productId?: string | null; productName?: string | null; sku?: string | null; unit?: string | null; counted: number; system: number | null; difference: number | null; matched: boolean; resolved: boolean; note?: string | null };
type Discrepancy = { draftId: string; status: string; opnameId?: string | null; lines: DiscrepancyLine[]; unresolved: number; comparedCount: number; overCounted: number; shortCounted: number; matchedCount: number; netDifference: number; note: string };
type DraftList = {
  rows: DraftRow[];
  counts: { total: number; open: number; submitted: number; discarded: number; awaitingFiling: number };
  note: string;
  pageInfo?: PageInfo;
};

async function req<T>(token: string, path: string, init?: RequestInit) {
  const r = await authFetch(`${API}${path}`, token, { ...init, headers: { 'Content-Type': 'application/json', ...(init?.headers ?? {}) } });
  const d = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(`HTTP ${r.status}: ${Array.isArray(d.message) ? d.message.join(', ') : (d.message ?? 'Request gagal')}`);
  return d as T;
}

export default function MobileOpsView({ token }: { token: string }) {
  const [bindings, setBindings] = useState<Binding[]>([]);
  const [bindingPageInfo, setBindingPageInfo] = useState<PageInfo>({});
  const [drafts, setDrafts] = useState<DraftList | null>(null);
  const [employeeId, setEmployeeId] = useState('');
  const [platformUserId, setPlatformUserId] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [revokeTarget, setRevokeTarget] = useState<Binding | null>(null);
  const [revokeReason, setRevokeReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');
  const [reviewTarget, setReviewTarget] = useState<DraftRow | null>(null);
  const [review, setReview] = useState<Discrepancy | null>(null);
  const [reviewError, setReviewError] = useState('');
  const { canAll } = usePermissions(token);
  const canManageUsers = canAll('user.manage');
  const canCountStock = canAll('inventory.opname');

  async function load() {
    const tasks: Promise<void>[] = [];
    if (canManageUsers) {
      tasks.push(req<BindingPage>(token, '/mobile-ops/telegram/bindings?limit=50').then((page) => {
        setBindings(page.items);
        setBindingPageInfo(page.pageInfo ?? {});
      }));
    } else {
      setBindings([]);
      setBindingPageInfo({});
    }
    if (canCountStock) {
      tasks.push(req<DraftList>(token, '/mobile-ops/drafts?limit=50').then(setDrafts));
    } else {
      setDrafts(null);
    }
    const results = await Promise.allSettled(tasks);
    const failures = results.filter((result): result is PromiseRejectedResult => result.status === 'rejected');
    if (failures.length) {
      throw new Error(failures.map((failure) => failure.reason instanceof Error ? failure.reason.message : String(failure.reason)).join(' · '));
    }
  }
  useEffect(() => { void load().catch((e) => setMsg(e instanceof Error ? e.message : 'Gagal memuat data mobile ops')); }, [token, canManageUsers, canCountStock]);

  async function loadMoreBindings() {
    const cursor = bindingPageInfo.nextCursor;
    if (!cursor || busy || !canManageUsers) return;
    setBusy(true);
    try {
      const page = await req<BindingPage>(token, `/mobile-ops/telegram/bindings?limit=50&cursor=${encodeURIComponent(cursor)}`);
      setBindings((current) => [...current, ...page.items.filter((row) => !current.some((existing) => existing.id === row.id))]);
      setBindingPageInfo(page.pageInfo ?? {});
    } catch (err) { setMsg(err instanceof Error ? err.message : 'Gagal memuat binding berikutnya'); }
    finally { setBusy(false); }
  }

  async function loadMoreDrafts() {
    const cursor = drafts?.pageInfo?.nextCursor;
    if (!cursor || busy || !canCountStock || !drafts) return;
    setBusy(true);
    try {
      const page = await req<DraftList>(token, `/mobile-ops/drafts?limit=50&cursor=${encodeURIComponent(cursor)}`);
      setDrafts((current) => current ? {
        ...page,
        rows: [...current.rows, ...page.rows.filter((row) => !current.rows.some((existing) => existing.id === row.id))],
      } : page);
    } catch (err) { setMsg(err instanceof Error ? err.message : 'Gagal memuat draft berikutnya'); }
    finally { setBusy(false); }
  }

  async function bind(e: FormEvent) {
    e.preventDefault(); setBusy(true);
    try {
      await req(token, '/mobile-ops/telegram/bindings', { method: 'POST', body: JSON.stringify({ employeeId, platformUserId, displayName }) });
      setEmployeeId(''); setPlatformUserId(''); setDisplayName('');
      await load();
      setMsg('Binding dibuat. Satu platform identity hanya dapat terikat ke satu employee aktif.');
    } catch (err) { setMsg(err instanceof Error ? err.message : 'Gagal membuat binding'); }
    finally { setBusy(false); }
  }
  async function reviewDiscrepancy(draftId: string) {
    setReviewError('');
    try { setReview(await req<Discrepancy>(token, `/mobile-ops/drafts/${draftId}/discrepancy`)); }
    catch (err) { setReview(null); setReviewError(err instanceof Error ? err.message : 'Gagal memuat selisih'); }
  }

  async function revoke(e: FormEvent) {
    e.preventDefault();
    if (!revokeTarget) return;
    setBusy(true);
    try {
      await req(token, '/mobile-ops/telegram/bindings/revoke', { method: 'PUT', body: JSON.stringify({ bindingId: revokeTarget.id, reason: revokeReason }) });
      setRevokeTarget(null); setRevokeReason(''); await load();
      setMsg('Binding dicabut dan tercatat beserta alasannya.');
    } catch (err) { setMsg(err instanceof Error ? err.message : 'Gagal mencabut binding'); }
    finally { setBusy(false); }
  }

  return <section className="stack">
    {canManageUsers && <Panel eyebrow="POST-1C TELEGRAM IDENTITY" title="Binding identitas Telegram" badge={`${bindings.filter((b) => b.isActive).length} aktif`}>
      <p className="sectionHelp">
        sebuah platform identity hanya menghasilkan izin lewat employee yang terikat: tenant, branch, role,
        dan permission selalu dibaca dari employee, tidak pernah dari obrolan dan tidak pernah dari payload.
        Employee yang sudah berhenti tidak dapat diikat, dan binding-nya diverifikasi ulang pada setiap perintah.
        Platform identity tidak ditampilkan di layar ini karena nilainya setara kredensial.
      </p>
      <Table
        head={['Employee', 'Nama tampilan', 'Status', 'Terakhir dipakai', 'Dicabut', 'Aksi']}
        rows={bindings.map((b) => [
          <code key={`${b.id}-e`}>{b.employeeId.slice(0, 8)}</code>,
          <span key={`${b.id}-d`}>{b.displayName ?? '-'}</span>,
          <StatusChip key={`${b.id}-s`} status={b.isActive ? 'ACTIVE' : 'REVOKED'} />,
          <small key={`${b.id}-u`}>{b.lastUsedAt ? new Date(b.lastUsedAt).toLocaleString('id-ID') : 'belum pernah'}</small>,
          <small key={`${b.id}-r`}>{b.revokedAt ? `${new Date(b.revokedAt).toLocaleDateString('id-ID')} · ${b.revokedReason ?? ''}` : '-'}</small>,
          canManageUsers && b.isActive
            ? <button key={`${b.id}-btn`} type="button" className="secondary" disabled={busy} onClick={() => { setRevokeTarget(b); setRevokeReason(''); }}>Cabut</button>
            : <span key={`${b.id}-none`}>-</span>,
        ])}
        empty="Belum ada binding Telegram"
      />
      {canManageUsers && <form className="formStack" onSubmit={bind}>
        <label>Employee ID<input required value={employeeId} onChange={(e) => setEmployeeId(e.target.value)} placeholder="UUID employee" /></label>
        <label>Platform user ID<input required value={platformUserId} onChange={(e) => setPlatformUserId(e.target.value)} placeholder="id dari platform" /></label>
        <label>Nama tampilan (opsional)<input value={displayName} onChange={(e) => setDisplayName(e.target.value)} /></label>
        <button disabled={busy}>Ikat binding</button>
      </form>}
      {bindingPageInfo.hasMore && <button type="button" className="secondary" disabled={busy} onClick={() => void loadMoreBindings()}>Muat binding berikutnya</button>}
    </Panel>}

    {canCountStock && drafts && <Panel eyebrow="POST-1C MOBILE COUNT" title="Draft hitung stok" badge={`${drafts.counts.open} terbuka`}>
      <p className="sectionHelp">
        Setiap draft adalah hitungan yang diambil perangkat di gudang. Draft yang masih terbuka dan belum
        punya opnameId belum masuk ke penghitungan kanonik — itulah yang perlu dicermati supervisor
        berikutnya. Jumlah baris dihitung dari isi draft perangkat; isi penuhnya tidak ditampilkan di
        layar ini.
      </p>
      <Table
        head={['Gudang', 'Perangkat', 'Baris', 'Status', 'Scan terakhir', 'Filed ke opname', 'Aksi']}
        rows={drafts.rows.map((d) => [
          <span key={`${d.id}-w`}>{d.warehouseName ?? d.warehouseCode ?? d.warehouseId.slice(0, 8)}</span>,
          <code key={`${d.id}-d`}>{d.deviceId.slice(0, 12)}</code>,
          <span key={`${d.id}-l`}>{d.lineCount}</span>,
          <StatusChip key={`${d.id}-s`} status={d.status} />,
          <small key={`${d.id}-t`}>{d.lastScannedAt ? new Date(d.lastScannedAt).toLocaleString('id-ID') : 'belum scan'}</small>,
          <small key={`${d.id}-o`}>{d.opnameId ? d.opnameId.slice(0, 8) : d.awaitingFiling ? 'belum filed' : '-'}</small>,
          <button key={`${d.id}-v`} type="button" className="secondary" onClick={() => { setReviewTarget(d); setReview(null); setReviewError(''); void reviewDiscrepancy(d.id); }}>Lihat selisih</button>,
        ])}
        empty="Belum ada draft hitung stok"
      />
      {drafts.pageInfo?.hasMore && <button type="button" className="secondary" disabled={busy} onClick={() => void loadMoreDrafts()}>Muat draft berikutnya</button>}
      <p className="sectionHelp">{drafts.note}</p>
    </Panel>}

    {reviewTarget && <Panel eyebrow="DISCREPANCY" title={`Selisih draft ${reviewTarget.warehouseCode ?? reviewTarget.id.slice(0, 8)}`} badge={review ? `${review.comparedCount} dibandingkan` : 'MEMUAT'}>
      <p className="sectionHelp">
        Selisih dihitung terhadap snapshot sistem saat penghitungan kanonik dibuka — bukan stok saat
        ini — supaya hasilnya tetap berarti meski draft ini beberapa hari lalu. Baris tanpa snapshot
        ditampilkan sebagai belum dibandingkan, bukan sebagai cocok.
      </p>
      {reviewError && <p className="notice">{reviewError}</p>}
      {review && <Table
        head={['Produk', 'SKU', 'Dihitung', 'Sistem', 'Selisih']}
        rows={review.lines.map((l) => [
          <span key={`${l.key}-p`}>{l.productName ?? <em>belum ter-resolve</em>}</span>,
          <small key={`${l.key}-s`}>{l.sku ?? '-'}</small>,
          <span key={`${l.key}-c`}>{l.counted}</span>,
          <span key={`${l.key}-y`}>{l.system ?? '-'}</span>,
          <span key={`${l.key}-d`} className={l.difference === null ? '' : l.difference === 0 ? 'muted' : l.difference < 0 ? 'danger font-semibold' : 'font-semibold'}>
            {l.difference === null ? 'belum ada snapshot' : l.difference > 0 ? `+${l.difference}` : l.difference}
          </span>,
        ])}
        empty="Draft ini belum punya baris hitungan"
      />}
      {review && <p className="sectionHelp">
        Cocok {review.matchedCount} · lebih {review.overCounted} · kurang {review.shortCounted} · belum
        ter-resolve {review.unresolved}. Selisih bersih {review.netDifference > 0 ? `+${review.netDifference}` : review.netDifference}.
        {' '}Penyesuaian stok tetap lewat penghitungan kanonik dengan persetujuan supervisor.
      </p>}
      <div className="actionRow">
        <button type="button" className="secondary" onClick={() => { setReviewTarget(null); setReview(null); }}>Tutup</button>
      </div>
    </Panel>}

    <Panel eyebrow="AUTHORITY" title="Apa yang boleh dan tidak boleh">
      <p className="sectionHelp">
        Izin bot hanya berasal dari role employee lewat tabel yang sama dengan guard API, sehingga tidak ada
        definisi kedua yang bisa menyimpang diam-diam. Perintah yang merusak atau berdampak finansial tetap
        mengikuti aturan konfirmasi dan persetujuan TOKO360 yang ada. Draft hitung stok tidak pernah menulis
        inventory maupun menyelesaikan StockOpname; pengirimannya hanya mencatat draft dan menunjuk opname
        kanonik yang menerimanya.
      </p>
    </Panel>

    {revokeTarget && <Panel eyebrow="REVOKE BINDING" title="Cabut binding" badge="WAJIB BERALASAN">
      <form className="formStack" onSubmit={revoke}>
        <p className="sectionHelp">Cabut berlaku pada perintah berikutnya. Alasan disimpan karena audit harus bisa menjawab "pernah dicabut atau memang tidak pernah sah".</p>
        <label>Alasan<input required value={revokeReason} onChange={(e) => setRevokeReason(e.target.value)} placeholder="Ganti perangkat" /></label>
        <div className="actionRow">
          <button type="button" className="secondary" onClick={() => { setRevokeTarget(null); setRevokeReason(''); }}>Batal</button>
          {canManageUsers && <button disabled={busy || !revokeReason.trim()}>Cabut binding</button>}
        </div>
      </form>
    </Panel>}

    {msg && <div className="notice">{msg}</div>}
  </section>;
}
