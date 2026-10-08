'use client';

// POST-1A operator surface — edge topology and sync health.
//
// This screen exists because the roadmap's observability requirement ("last sync, lag, pending,
// failed, retrying, dead-letter, peer health") is not checkable from a service method nobody calls.
// An operator who cannot see that a branch fell 4,000 events behind cannot act on it.
//
// Every number rendered here comes from the server's own outbox and inbox. Nothing is computed in
// the browser and nothing is self-reported by a client, because a health screen that mirrors the
// caller's own optimism is worse than no screen at all.

import { FormEvent, useEffect, useState } from 'react';
import { authFetch } from '../auth-fetch';
import { usePermissions } from '../permissions';
import { Panel, StatusChip, Table } from '../ui';

const API = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000/api/v1';

type NodeRow = { id: string; code: string; name: string; role: 'CENTRAL' | 'BRANCH'; branchId?: string | null; isActive: boolean; lastHeartbeatAt?: string | null };
type HealthRow = {
  nodeId: string; code: string; role: 'CENTRAL' | 'BRANCH'; lastHeartbeatAt?: string | null;
  pending: number; publishing: number; failed: number; deadLettered: number; duplicatesSuppressed: number;
  peers: Array<{ peerNodeId: string; lastSyncAt?: string | null; lagCount: number }>;
};
type Health = { nodes: HealthRow[]; generatedAt: string };
type DeadLetter = { id: string; eventId: string; eventType: string; aggregateType: string; aggregateId: string; attempts: number; lastError?: string | null; deadLetteredAt?: string | null };
type PeerRow = { id: string; peerNodeId: string; direction: 'PUSH' | 'PULL' | 'BIDIRECTIONAL'; isActive: boolean; lastSyncAt?: string | null; lastError?: string | null };
type PendingTransfer = { transferId: string; state: 'AWAITING_DESTINATION' | 'CONVERGED' | 'DISCREPANT' | 'ABANDONED'; sourceQuantity: number; destinationQuantity?: number | null; destinationNodeId?: string | null; destinationState?: string; discrepancyReason?: string | null; updatedAt: string };
type ContinuityBranch = { nodeId: string; code: string; name: string; role: string; state: 'UNKNOWN' | 'ONLINE' | 'DEGRADED' | 'OFFLINE' | 'SUSPENDED'; lastSeenAt?: string | null; lastSyncAt?: string | null; pending: number; deadLettered: number; unresolvedConflicts: number; reason?: string | null };
type Consolidated = { branches: ContinuityBranch[]; totalPending: number; totalDeadLettered: number; generatedAt: string };
type CapabilityRow = { flowCode: string; label: string; offlineCapable: boolean; degradedImpact?: string | null; localAuthoritative: boolean };
type ConflictRow = { id: string; eventId: string; aggregateType: string; aggregateId: string; baseVersion: number; remoteVersion?: number | null; strategy: 'PENDING' | 'KEEP_LOCAL' | 'KEEP_REMOTE' | 'MANUAL_REVIEW'; resolvedBy?: string | null; resolvedAt?: string | null };

async function req<T>(token: string, path: string, init?: RequestInit) {
  const r = await authFetch(`${API}${path}`, token, { ...init, headers: { 'Content-Type': 'application/json', ...(init?.headers ?? {}) } });
  const d = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(Array.isArray(d.message) ? d.message.join(', ') : (d.message ?? 'Request gagal'));
  return d as T;
}

function lagTone(lag: number, dead: number) {
  // Dead letters outrank lag: a branch 100 events behind is catching up, a branch with a dead
  // letter has an event that will never arrive until someone looks at it.
  if (dead > 0) return 'ERROR';
  if (lag === 0) return 'OK';
  if (lag < 100) return 'WARN';
  return 'ERROR';
}

export default function BranchSyncView({ token }: { token: string }) {
  const [nodes, setNodes] = useState<NodeRow[]>([]);
  const [health, setHealth] = useState<Health | null>(null);
  const [deadLetters, setDeadLetters] = useState<Record<string, DeadLetter[]>>({});
  const [peersOf, setPeersOf] = useState<string | null>(null);
  const [conflicts, setConflicts] = useState<Record<string, ConflictRow[]>>({});
  const [recovery, setRecovery] = useState<Record<string, unknown>>({});
  const [consolidated, setConsolidated] = useState<Consolidated | null>(null);
  const [capabilities, setCapabilities] = useState<CapabilityRow[]>([]);
  const [transfers, setTransfers] = useState<PendingTransfer[]>([]);
  const [abandon, setAbandon] = useState<PendingTransfer | null>(null);
  const [abandonReason, setAbandonReason] = useState('');
  // Received quantities live in state keyed by transfer, not in a DOM lookup: reading the input back
  // through querySelector couples the handler to markup and silently posts 0 if the selector misses.
  const [received, setReceived] = useState<Record<string, number>>({});
  const [peers, setPeers] = useState<PeerRow[]>([]);
  const [code, setCode] = useState('');
  const [name, setName] = useState('');
  const [role, setRole] = useState<'CENTRAL' | 'BRANCH'>('BRANCH');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');
  const { canAll } = usePermissions(token);
  const canManage = canAll('integration.manage');

  async function loadContinuity() {
    const [c, caps, xfer] = await Promise.all([
      req<Consolidated>(token, '/branch-continuity/consolidated'),
      req<CapabilityRow[]>(token, '/branch-continuity/capabilities'),
      req<PendingTransfer[]>(token, '/branch-transfer/pending'),
    ]);
    setConsolidated(c); setCapabilities(caps); setTransfers(xfer);
  }
  // Acknowledging arrival records what was physically counted. It does not post inventory — that stays
  // with the existing receive flow — so the panel says so rather than implying the goods are booked in.
  async function ackArrival(transferId: string, receivedQuantity: number) {
    setBusy(true);
    try {
      const result = await req<{ state: string; needsReview: boolean }>(token, `/branch-transfer/transfers/${transferId}/arrival`, {
        method: 'POST', body: JSON.stringify({ receivedQuantity }),
      });
      await loadContinuity();
      setMsg(result.needsReview
        ? `Transfer ${transferId} ditandai DISCREPANT dan naik untuk ditinjau; jumlah kirim dan terima dicatat terpisah.`
        : `Transfer ${transferId} dikonfirmasi converge.`);
    } catch (err) { setMsg(err instanceof Error ? err.message : 'Gagal mengonfirmasi kedatangan'); }
    finally { setBusy(false); }
  }
  async function confirmAbandon(e: FormEvent) {
    e.preventDefault();
    if (!abandon) return;
    setBusy(true);
    try {
      await req(token, `/branch-transfer/transfers/${abandon.transferId}/abandon`, { method: 'POST', body: JSON.stringify({ reason: abandonReason }) });
      setAbandon(null); setAbandonReason(''); await loadContinuity();
      setMsg('Transfer dibatalkan. Stok tetap IN_TRANSIT di gudang asal sampai jurnal pengembalian dibuat.');
    } catch (err) { setMsg(err instanceof Error ? err.message : 'Gagal membatalkan transfer'); }
    finally { setBusy(false); }
  }
  async function load() {
    const [n, h] = await Promise.all([req<NodeRow[]>(token, '/branch-sync/nodes'), req<Health>(token, '/branch-sync/health')]);
    setNodes(n); setHealth(h);
  }
  useEffect(() => { void load().catch((e) => setMsg(e instanceof Error ? e.message : 'Gagal memuat status sinkronisasi')); }, [token]);
  useEffect(() => { void loadContinuity().catch((e) => setMsg(e instanceof Error ? e.message : 'Gagal memuat status kontinuitas')); }, [token]);

  async function openDeadLetters(nodeId: string) {
    setPeersOf(null);
    const rows = await req<DeadLetter[]>(token, `/branch-sync/nodes/${nodeId}/dead-letters`);
    setDeadLetters((prev) => ({ ...prev, [nodeId]: rows }));
  }
  async function openPeers(nodeId: string) {
    setDeadLetters((prev) => { const next = { ...prev }; delete next[nodeId]; return next; });
    setPeers(await req<PeerRow[]>(token, `/branch-sync/nodes/${nodeId}/peers`));
    setPeersOf(nodeId);
  }
  async function openConflicts(nodeId: string) {
    setPeersOf(null);
    const rows = await req<ConflictRow[]>(token, `/branch-sync/nodes/${nodeId}/conflicts`);
    setConflicts((prev) => ({ ...prev, [nodeId]: rows }));
  }
  async function openRecovery(nodeId: string) {
    setRecovery(await req<Record<string, unknown>>(token, `/branch-sync/nodes/${nodeId}/recovery-plan`));
  }
  // A conflict is only ever recorded as MANUAL_REVIEW — the API refuses an automatic winner — so the
  // operator's only action here is an explicit decision. The button label says so on purpose.
  async function review(nodeId: string, eventId: string) {
    setBusy(true);
    try {
      await req(token, `/branch-sync/nodes/${nodeId}/conflicts/${encodeURIComponent(eventId)}/resolve`, {
        method: 'POST', body: JSON.stringify({ strategy: 'MANUAL_REVIEW', note: 'Ditinjau dari panel operator' }),
      });
      await openConflicts(nodeId); await load();
      setMsg(`Konflik ${eventId} ditandai sudah ditinjau.`);
    } catch (err) { setMsg(err instanceof Error ? err.message : 'Gagal menyimpan hasil review'); }
    finally { setBusy(false); }
  }
  async function createNode(e: FormEvent) {
    e.preventDefault(); setBusy(true);
    try {
      await req(token, '/branch-sync/nodes', { method: 'POST', body: JSON.stringify({ code, name, role }) });
      setCode(''); setName('');
      await load();
      setMsg(`Node ${code.toUpperCase()} terdaftar. Daftarkan peer agar node ini boleh sinkron.`);
    } catch (err) { setMsg(err instanceof Error ? err.message : 'Gagal mendaftarkan node'); }
    finally { setBusy(false); }
  }
  // Requeue keeps the original eventId on purpose, so the receiver's duplicate suppression is what
  // proves the retry was not a second posting.
  async function requeue(nodeId: string, eventId: string) {
    setBusy(true);
    try { await req(token, `/branch-sync/nodes/${nodeId}/dead-letters/${encodeURIComponent(eventId)}/requeue`, { method: 'POST', body: '{}' }); await load(); await openDeadLetters(nodeId); setMsg(`Event ${eventId} dijadwalkan ulang dengan eventId yang sama.`); }
    catch (err) { setMsg(err instanceof Error ? err.message : 'Gagal requeue'); }
    finally { setBusy(false); }
  }
  async function togglePeer(nodeId: string, peerId: string, isActive: boolean) {
    setBusy(true);
    try { await req(token, `/branch-sync/nodes/${nodeId}/peers/${peerId}`, { method: 'PATCH', body: JSON.stringify({ isActive: !isActive, reason: isActive ? 'Dinonaktifkan dari panel operator' : 'Diaktifkan kembali' }) }); await openPeers(nodeId); }
    catch (err) { setMsg(err instanceof Error ? err.message : 'Gagal mengubah status peer'); }
    finally { setBusy(false); }
  }

  return <section className="stack">
    <Panel eyebrow="POST-1A EDGE TOPOLOGY" title="Branch & central node" badge={`${nodes.length} node`}>
      <p className="sectionHelp">Setiap node adalah server TOKO360. CENTRAL imperio; BRATCH ber originates. Satu tenant hanya boleh punya satu CENTRAL aktif — dua central akan menggandakan setiap transaksi yang terkonsolidasi.</p>
      <Table
        head={['Code', 'Nama', 'Role', 'Heartbeat', 'Status']}
        rows={nodes.map((n) => [
          <strong key={`${n.id}-code`}>{n.code}</strong>,
          <span key={`${n.id}-name`}>{n.name}</span>,
          <StatusChip key={`${n.id}-role`} status={n.role} />,
          <small key={`${n.id}-hb`}>{n.lastHeartbeatAt ? new Date(n.lastHeartbeatAt).toLocaleString('id-ID') : 'belum pernah'}</small>,
          <StatusChip key={`${n.id}-st`} status={n.isActive ? 'ACTIVE' : 'INACTIVE'} />,
        ])}
        empty="Belum ada node terdaftar"
      />
      {canManage && <form className="formStack" onSubmit={createNode}>
        <label>Code node<input required value={code} onChange={(e) => setCode(e.target.value)} placeholder="BR-01" /></label>
        <label>Nama<input required value={name} onChange={(e) => setName(e.target.value)} placeholder="Cabang Bandung" /></label>
        <label>Role<select value={role} onChange={(e) => setRole(e.target.value as 'CENTRAL' | 'BRANCH')}><option value="BRANCH">BRANCH</option><option value="CENTRAL">CENTRAL</option></select></label>
        <button disabled={busy}>Daftarkan node</button>
      </form>}
    </Panel>

    <Panel eyebrow="OBSERVABILITY" title="Kesehatan sinkronisasi" badge={health ? `diperbarui ${new Date(health.generatedAt).toLocaleTimeString('id-ID')}` : 'memuat'}>
      <p className="sectionHelp">Lag, pending, dan dead-letter dihitung server dari outbox dan inbox. Nilai yang dikirim klien diabaikan — angka yang dilaporkan klien adalah klaim, bukan bukti.</p>
      <Table
        head={['Node', 'Lag', 'Pending', 'Publishing', 'Failed', 'Dead letter', 'Duplikat ditekan', 'Peer cursor']}
        rows={(health?.nodes ?? []).map((h) => [
          <strong key={`${h.nodeId}-n`}>{h.code}</strong>,
          <span key={`${h.nodeId}-lag`}><StatusChip status={lagTone(h.pending, h.deadLettered)} /> <small>{h.pending}</small></span>,
          <span key={`${h.nodeId}-p`}>{h.pending}</span>,
          <span key={`${h.nodeId}-pub`}>{h.publishing}</span>,
          <span key={`${h.nodeId}-f`}>{h.failed}</span>,
          <span key={`${h.nodeId}-d`}>{h.deadLettered}</span>,
          <span key={`${h.nodeId}-dup`}>{h.duplicatesSuppressed}</span>,
          <span key={`${h.nodeId}-c`}>{h.peers.length ? h.peers.map((p) => `${p.peerNodeId.slice(0, 8)}: ${p.lastSyncAt ? new Date(p.lastSyncAt).toLocaleString('id-ID') : 'belum sync'}`).join(' · ') : 'belum ada peer'}</span>,
        ])}
        empty="Belum ada data kesehatan"
      />
      {canManage && <div className="actionRow">
        {(health?.nodes ?? []).map((h) => <button key={`${h.nodeId}-dl`} type="button" className="secondary" onClick={() => void openDeadLetters(h.nodeId)}>Dead letter · {h.code}</button>)}
        {(health?.nodes ?? []).map((h) => <button key={`${h.nodeId}-cf`} type="button" className="secondary" onClick={() => void openConflicts(h.nodeId)}>Konflik · {h.code}</button>)}
        {(health?.nodes ?? []).map((h) => <button key={`${h.nodeId}-rp`} type="button" className="secondary" onClick={() => void openRecovery(h.nodeId)}>Recovery plan · {h.code}</button>)}
      </div>}
    </Panel>

    {peersOf && <Panel eyebrow="PEER REGISTRY" title="Peer node" badge={String(peers.length)}>
      <p className="sectionHelp">Secret peer disimpan terenkripsi dan tidak pernah ditampilkan lagi di layar ini. Menonaktifkan peer menghentikan sinkronisasi ke arah itu tanpa mencabut event yang sudah diantrikan.</p>
      <Table
        head={['Peer', 'Arah', 'Last sync', 'Error', 'Status', 'Aksi']}
        rows={peers.map((p) => [
          <code key={`${p.id}-id`}>{p.peerNodeId.slice(0, 8)}</code>,
          <StatusChip key={`${p.id}-dir`} status={p.direction} />,
          <small key={`${p.id}-s`}>{p.lastSyncAt ? new Date(p.lastSyncAt).toLocaleString('id-ID') : 'belum'}</small>,
          <small key={`${p.id}-e`}>{p.lastError ?? '-'}</small>,
          <StatusChip key={`${p.id}-st`} status={p.isActive ? 'ACTIVE' : 'INACTIVE'} />,
          canManage
            ? <button key={`${p.id}-btn`} type="button" className="secondary" disabled={busy} onClick={() => void togglePeer(peersOf, p.id, p.isActive)}>{p.isActive ? 'Nonaktifkan' : 'Aktifkan'}</button>
            : <span key={`${p.id}-none`}>-</span>,
        ])}
        empty="Belum ada peer terdaftar"
      />
    </Panel>}

    {Object.entries(deadLetters).map(([nodeId, rows]) => <Panel key={nodeId} eyebrow="DEAD LETTER" title={`Event gagal-terkirim · ${nodeId.slice(0, 8)}`} badge={String(rows.length)}>
      <p className="sectionHelp">Event di sini sudah melewati batas retry. Requeue memakai eventId yang sama, jadi bila peer menerimanya lagi itu akan terdeteksi sebagai duplikat — bukan posting kedua.</p>
      <Table
        head={['Event', 'Tipe', 'Agregat', 'Percobaan', 'Error', 'Aksi']}
        rows={rows.map((d) => [
          <code key={`${d.id}-e`}>{d.eventId}</code>,
          <span key={`${d.id}-t`}>{d.eventType}</span>,
          <small key={`${d.id}-a`}>{d.aggregateType}/{d.aggregateId}</small>,
          <span key={`${d.id}-n`}>{d.attempts}</span>,
          <small key={`${d.id}-err`}>{d.lastError ?? '-'}</small>,
          canManage
            ? <button key={`${d.id}-btn`} type="button" className="secondary" disabled={busy} onClick={() => void requeue(nodeId, d.eventId)}>Requeue</button>
            : <span key={`${d.id}-none`}>-</span>,
        ])}
        empty="Tidak ada dead letter"
      />
    </Panel>)}

    {Object.entries(conflicts).map(([nodeId, rows]) => <Panel key={`cf-${nodeId}`} eyebrow="CONFLICT" title={`Konflik rekonsiliasi · ${nodeId.slice(0, 8)}`} badge={String(rows.length)}>
      <p className="sectionHelp">Konflik arise ketika dua node sama-sama meyakini state mereka benar — cabang menjual unit terakhir saat transfer masuk. Sistem sengaja tidak memilih pemenang: KEEP_LOCAL dan KEEP_REMOTE ditolak API, dan setiap konflik naik sebagai MANUAL_REVIEW. Memilih salah satu secara otomatis berarti menghapus penjualan yang sudah terjadi tanpa jejak.</p>
      <Table
        head={['Event', 'Agregat', 'Base', 'Remote', 'Strategi', 'Diputuskan oleh']}
        rows={rows.map((c) => [
          <code key={`${c.id}-e`}>{c.eventId}</code>,
          <small key={`${c.id}-a`}>{c.aggregateType}/{c.aggregateId}</small>,
          <span key={`${c.id}-b`}>{c.baseVersion}</span>,
          <span key={`${c.id}-r`}>{c.remoteVersion ?? '-'}</span>,
          <StatusChip key={`${c.id}-s`} status={c.strategy} />,
          c.strategy === 'PENDING' && canManage
            ? <button key={`${c.id}-btn`} type="button" className="secondary" disabled={busy} onClick={() => void review(nodeId, c.eventId)}>Tandai ditinjau</button>
            : <small key={`${c.id}-w`}>{c.resolvedBy ?? '-'} {c.resolvedAt ? new Date(c.resolvedAt).toLocaleString('id-ID') : ''}</small>,
        ])}
        empty="Tidak ada konflik"
      />
    </Panel>)}

    {Object.keys(recovery).length > 0 && <Panel eyebrow="RECOVERY" title="Rencana pemulihan server" badge="SETELAH PENGGANTIAN SERVER">
      <p className="sectionHelp">Server yang diganti kembali dengan database kosong. Pemulihan selalu derives dari cursor, tidak pernah menyalin tabel lintas node.</p>
      <pre className="codeBlock">{JSON.stringify(recovery, null, 2)}</pre>
    </Panel>}

    <Panel eyebrow="POST-1B BRANCH CONTINUITY" title="Status cabang & flow offline" badge={consolidated ? `${consolidated.branches.length} cabang` : 'memuat'}>
      <p className="sectionHelp">Tidak ada flow yang boleh berpura-pura data globalnya terkini saat cabang terputus. Branch yang tidak pernah dilaporkan muncul sebagai UNKNOWN, bukan disembunyikan — dashboard yang hanya menampilkan cabang yang menjawab akan menyembunyikan justru cabang yang butuh perhatian.</p>
      <Table
        head={['Cabang', 'Role', 'State', 'Terakhir terlihat', 'Last sync', 'Pending', 'Dead letter', 'Konflik']}
        rows={(consolidated?.branches ?? []).map((b) => [
          <strong key={`${b.nodeId}-c`}>{b.code}</strong>,
          <StatusChip key={`${b.nodeId}-r`} status={b.role} />,
          <span key={`${b.nodeId}-s`}><StatusChip status={b.state} />{b.reason ? <small> {b.reason}</small> : null}</span>,
          <small key={`${b.nodeId}-seen`}>{b.lastSeenAt ? new Date(b.lastSeenAt).toLocaleString('id-ID') : 'tidak pernah'}</small>,
          <small key={`${b.nodeId}-sync`}>{b.lastSyncAt ? new Date(b.lastSyncAt).toLocaleString('id-ID') : '-'}</small>,
          <span key={`${b.nodeId}-p`}>{b.pending}</span>,
          <span key={`${b.nodeId}-d`}>{b.deadLettered}</span>,
          <span key={`${b.nodeId}-x`}>{b.unresolvedConflicts}</span>,
        ])}
        empty="Belum ada cabang"
      />
    </Panel>

    <Panel eyebrow="OFFLINE CAPABILITY" title="Kontrak flow offline-capable" badge={`${capabilities.filter((c) => c.offlineCapable).length} diizinkan`}>
      <p className="sectionHelp">Flow yang offline-capable wajib menyebut apa yang operator korbankan. Flow yang tidak dideklarasi apa pun ditolak saat cabang terputus — default-nya tidak mengizinkan, jadi flow baru tidak bisabuta hanya karena belum terdaftar.</p>
      <Table
        head={['Flow', 'Offline?', 'Otoritatif lokal?', 'Dampak degraded']}
        rows={capabilities.map((c) => [
          <strong key={`${c.flowCode}-f`}>{c.flowCode}</strong>,
          <StatusChip key={`${c.flowCode}-o`} status={c.offlineCapable ? 'ALLOWED' : 'BLOCKED'} />,
          <span key={`${c.flowCode}-a`}>{c.localAuthoritative ? 'ya' : 'tidak'}</span>,
          <small key={`${c.flowCode}-i`}>{c.degradedImpact ?? '-'}</small>,
        ])}
        empty="Belum ada flow Capability dideklarasi"
      />
    </Panel>

    <Panel eyebrow="INTER-BRANCH TRANSFER" title="Transfer lintas cabang menunggu" badge={String(transfers.length)}>
      <p className="sectionHelp">Barang yang sudah berangkat tercatat IN_TRANSIT sejak meninggalkan gudang asal — stok itu ada di tidak satu pun tempat sebagai inventory siap pakai. Konfirmasi kedatangan hanya mencatat jumlah fisik yang dihitung; posting inventory tetap lewat alur receive yang sudah ada. Pembatalan wajib beralasan dan tidak mengembalikan stok secara otomatis.</p>
      <Table
        head={['Transfer', 'State', 'Kirim', 'Terima', 'Tujuan', 'Alasan/selisih', 'Aksi']}
        rows={transfers.map((t) => [
          <code key={`${t.transferId}-id`}>{t.transferId.slice(0, 8)}</code>,
          <StatusChip key={`${t.transferId}-s`} status={t.state} />,
          <span key={`${t.transferId}-q`}>{t.sourceQuantity}</span>,
          <span key={`${t.transferId}-d`}>{t.destinationQuantity ?? '-'}</span>,
          <StatusChip key={`${t.transferId}-c`} status={t.destinationState ?? 'UNKNOWN'} />,
          <small key={`${t.transferId}-r`}>{t.discrepancyReason ?? '-'}</small>,
          canAll('integration.manage')
            ? <div key={`${t.transferId}-a`} className="actionRow">
                <input
                  key={`${t.transferId}-i`}
                  type="number" min={0} defaultValue={t.sourceQuantity}
                  aria-label={`Jumlah diterima untuk ${t.transferId}`}
                  style={{ width: '5rem' }}
                />
                <button type="button" className="secondary" disabled={busy} onClick={() => {
                  const el = document.querySelector<HTMLInputElement>(`input[aria-label="Jumlah diterima untuk ${t.transferId}"]`);
                  void ackArrival(t.transferId, Number(el?.value ?? 0));
                }}>Konfirmasi</button>
                <button type="button" className="secondary" disabled={busy} onClick={() => { setAbandon(t); setAbandonReason(''); }}>Batalkan</button>
              </div>
            : <span key={`${t.transferId}-none`}>-</span>,
        ])}
        empty="Tidak ada transfer lintas cabang yang menunggu"
      />
    </Panel>

    {abandon && <Panel eyebrow="ABANDON TRANSFER" title={`Batalkan ${abandon.transferId.slice(0, 8)}`} badge="WAJIB BERALASAN">
      <form className="formStack" onSubmit={confirmAbandon}>
        <p className="sectionHelp">Tidak ada timeout otomatis yang mengembalikan barang. Stok sudah keluar dari gudang asal dan serial berstatus IN_TRANSIT; mengembalikannya membutuhkan jurnal manual yang tercatat.</p>
        <label>Alasan pembatalan<input required value={abandonReason} onChange={(e) => setAbandonReason(e.target.value)} placeholder="Cabang tujuan tidak dapat dihubungi selama 30 hari" /></label>
        <div className="actionRow">
          <button type="button" className="secondary" onClick={() => { setAbandon(null); setAbandonReason(''); }}>Batal</button>
          {canAll('integration.manage') && <button disabled={busy || !abandonReason.trim()}>Batalkan transfer</button>}
        </div>
      </form>
    </Panel>}

    {msg && <div className="notice">{msg}</div>}
  </section>;
}
