'use client';
import { authFetch } from '../auth-fetch';
// Modul Operations Control — inspeksi, gate pass, approval konfirmasi.
import { useEffect, useState } from 'react';
import { usePermissions } from '../permissions';
import { readOptional } from '../read-path-contract';
import { Panel, Table, StatusChip, tanggal } from '../ui';

type OperationsControlMode = 'inspections' | 'evidence' | 'gate-pass';

const API = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000/api/v1';

type InspectionResult = { templateItemId?: string | null; code: string; label: string; result: string; productId?: string | null; expectedQty?: number | null; scannedQty?: number | null; acceptedQty?: number | null; rejectedQty?: number | null; damagedQty?: number | null; missingQty?: number | null; extraQty?: number | null; notes?: string | null };
type InspectionEvidence = { id: string; evidenceType: string; storageKey: string; sha256?: string | null };
type Inspection = { id: string; number: string; type: string; sourceType: string; sourceId: string; status: string; createdAt: string; results: InspectionResult[]; evidence: InspectionEvidence[] };
type GatePass = { id: string; number: string; direction?: string; status?: string; createdAt: string; sourceType?: string; sourceId?: string; movementAt?: string | null };
type OperationPolicy = { id: string; code: string; operationType: string; name: string; enabled: boolean; requireInspection: boolean; requirePhoto: boolean; requireBarcodeScan: boolean; requireGatePass: boolean; requiredConfirmations: number; blockOnMismatch: boolean };

export default function OperationsControlView({ token, mode = 'inspections' }: { token: string; mode?: OperationsControlMode }) {
  // D-3: inspection.approve gates the review decision, inspection.record gates completing an
  // inspection. A user holding only record could open the queue but never decide it, so the
  // decision controls must not be rendered for them.
  const { canAll, identity } = usePermissions(token);
  const [inspections, setInspections] = useState<Inspection[]>([]);
  const [gatePasses, setGatePasses] = useState<GatePass[]>([]);
  const [message, setMessage] = useState('');
  const [rejectReasons, setRejectReasons] = useState<Record<string, string>>({});
  const [evidenceInspectionId, setEvidenceInspectionId] = useState('');
  const [barcodeValue, setBarcodeValue] = useState('');
  const [photoFile, setPhotoFile] = useState<File | null>(null);
  const [policies, setPolicies] = useState<OperationPolicy[]>([]);
  const [policyForm, setPolicyForm] = useState({ code: 'STANDARD', operationType: 'PURCHASE_RECEIPT', name: 'Standard operation policy', requireInspection: true, requirePhoto: false, requireBarcodeScan: false, requireGatePass: false, requiredConfirmations: 1, blockOnMismatch: true });
  const [templateForm, setTemplateForm] = useState({ code: 'STANDARD_CHECK', name: 'Standard inspection checklist', type: 'PURCHASE_INBOUND', appliesTo: 'GoodsReceipt', itemCode: 'VISUAL_CHECK', itemLabel: 'Kondisi fisik sesuai', failureSeverity: 'BLOCKING' });

  async function api<T>(path: string, init?: RequestInit): Promise<T> {
    const response = await authFetch(`${API}${path}`, token, {
      ...init,
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}`, ...(init?.headers ?? {}) },
    });
    const data = await response.json();
    if (!response.ok) throw new Error(Array.isArray(data.message) ? data.message.join(', ') : data.message ?? 'Permintaan gagal.');
    return data as T;
  }

  async function refresh() {
    try {
      const [ins, gp, policyRows] = await Promise.all([
        api<{ items?: Inspection[] } | Inspection[]>('/operations-control/inspections?limit=15'),
        api<{ items?: GatePass[] } | GatePass[]>('/operations-control/gate-passes?limit=15'),
        // Policies are a separate capability (operations.policy.view) that the WAREHOUSE role
        // does not hold, and the workspace gate is operations|inspection|gate|fleet|shipment. In a
        // bare Promise.all that one 403 discarded the inspection queue and the gate-pass log too.
        readOptional(identity, '/operations-control/policies', [] as OperationPolicy[], (p) => api<OperationPolicy[]>(p)),
      ]);
      setInspections(Array.isArray(ins) ? ins : ins.items ?? []);
      setGatePasses(Array.isArray(gp) ? gp : gp.items ?? []);
      setPolicies(policyRows);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Sebagian data operasional kontrol gagal dimuat.');
    }
  }

  useEffect(() => { void refresh(); }, [token]);

  function fileToBase64(file: File): Promise<string> {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onerror = () => reject(new Error('Gagal membaca file evidence.'));
      reader.onload = () => {
        const value = String(reader.result ?? '');
        const comma = value.indexOf(',');
        resolve(comma >= 0 ? value.slice(comma + 1) : value);
      };
      reader.readAsDataURL(file);
    });
  }

  function updateInspectionResult(inspectionId: string, code: string, patch: Partial<InspectionResult>) {
    setInspections((current) => current.map((inspection) => inspection.id !== inspectionId
      ? inspection
      : { ...inspection, results: inspection.results.map((row) => row.code === code ? { ...row, ...patch } : row) }));
  }

  function setChecklistResult(inspectionId: string, code: string, result: 'PASS' | 'FAIL' | 'OBSERVATION') {
    updateInspectionResult(inspectionId, code, { result });
  }

  const selectedInspection = inspections.find((inspection) => inspection.id === evidenceInspectionId);

  async function uploadBarcode() {
    if (!evidenceInspectionId || !barcodeValue.trim()) return setMessage('Pilih inspeksi dan isi barcode terlebih dahulu.');
    setMessage('');
    try {
      await api(`/operations-control/inspections/${evidenceInspectionId}/evidence`, {
        method: 'POST', body: JSON.stringify({ evidenceType: 'BARCODE', value: barcodeValue.trim(), metadata: { source: 'admin-operations-control' } }),
      });
      setBarcodeValue('');
      setMessage('Barcode evidence tersimpan dan diverifikasi server.');
      await refresh();
    } catch (error) { setMessage(error instanceof Error ? error.message : 'Gagal menyimpan barcode evidence.'); }
  }

  async function uploadPhoto() {
    if (!evidenceInspectionId || !photoFile) return setMessage('Pilih inspeksi dan foto evidence terlebih dahulu.');
    setMessage('');
    try {
      const dataBase64 = await fileToBase64(photoFile);
      await api(`/operations-control/inspections/${evidenceInspectionId}/evidence`, {
        method: 'POST', body: JSON.stringify({ evidenceType: 'PHOTO', mimeType: photoFile.type, dataBase64, metadata: { fileName: photoFile.name, source: 'admin-operations-control' } }),
      });
      setPhotoFile(null);
      setMessage('Foto evidence tersimpan, di-hash, dan diverifikasi server.');
      await refresh();
    } catch (error) { setMessage(error instanceof Error ? error.message : 'Gagal mengunggah foto evidence.'); }
  }

  async function completeInspection(inspection: Inspection) {
    setMessage('');
    try {
      await api(`/operations-control/inspections/${inspection.id}/complete`, {
        method: 'POST',
        body: JSON.stringify({
          results: inspection.results.map((row) => ({
            templateItemId: row.templateItemId ?? undefined,
            code: row.code,
            label: row.label,
            result: row.result,
            productId: row.productId ?? undefined,
            expectedQty: row.expectedQty ?? undefined,
            scannedQty: row.scannedQty ?? undefined,
            acceptedQty: row.acceptedQty ?? undefined,
            rejectedQty: row.rejectedQty ?? undefined,
            damagedQty: row.damagedQty ?? undefined,
            missingQty: row.missingQty ?? undefined,
            extraQty: row.extraQty ?? undefined,
            notes: row.notes ?? undefined,
          })),
          notes: inspection.sourceType === 'Shipment' ? 'Finalisasi pemeriksaan outbound sesuai manifest shipment.' : ['SaleReturn','OrderReturn'].includes(inspection.sourceType) ? 'Finalisasi pemeriksaan barang retur pelanggan sebelum refund.' : inspection.sourceType === 'PurchaseReturn' ? 'Finalisasi pemeriksaan retur pembelian sebelum dikirim kembali.' : 'Finalisasi hasil penerimaan yang tercatat pada Goods Receipt.',
        }),
      });
      setMessage('Inspeksi selesai. Lakukan persetujuan jika diperlukan sebelum proses operasional berikutnya.');
      await refresh();
    } catch (error) { setMessage(error instanceof Error ? error.message : 'Gagal menyelesaikan inspeksi.'); }
  }

  async function savePolicy(event: React.FormEvent) {
    event.preventDefault();
    setMessage('');
    try {
      await api('/operations-control/policies', { method: 'POST', body: JSON.stringify(policyForm) });
      setMessage('Policy operasional tersimpan untuk tenant/cabang aktif.');
      await refresh();
    } catch (error) { setMessage(error instanceof Error ? error.message : 'Gagal menyimpan policy operasional.'); }
  }

  async function saveTemplate(event: React.FormEvent) {
    event.preventDefault();
    setMessage('');
    try {
      await api('/operations-control/inspection-templates', {
        method: 'POST',
        body: JSON.stringify({
          code: templateForm.code,
          name: templateForm.name,
          type: templateForm.type,
          appliesTo: templateForm.appliesTo,
          version: 1,
          items: [{ code: templateForm.itemCode, label: templateForm.itemLabel, responseType: 'PASS_FAIL', required: true, failureSeverity: templateForm.failureSeverity, sequence: 1 }],
        }),
      });
      setMessage('Template inspeksi tersimpan dan siap direferensikan oleh policy.');
    } catch (error) { setMessage(error instanceof Error ? error.message : 'Gagal menyimpan template inspeksi.'); }
  }

  async function approveGatePass(pass: GatePass) {
    setMessage('');
    try {
      await api(`/operations-control/gate-passes/${pass.id}/approve`, { method: 'POST' });
      setMessage(`Gate pass ${pass.number} disetujui.`);
      await refresh();
    } catch (error) { setMessage(error instanceof Error ? error.message : 'Gagal menyetujui gate pass.'); }
  }

  async function recordGateMovement(pass: GatePass) {
    setMessage('');
    try {
      await api(`/operations-control/gate-passes/${pass.id}/movement`, { method: 'POST' });
      setMessage(`Pergerakan gate ${pass.number} tercatat.`);
      await refresh();
    } catch (error) { setMessage(error instanceof Error ? error.message : 'Gagal mencatat pergerakan gate.'); }
  }

  async function confirmOperation(inspection: Inspection) {
    setMessage('');
    try {
      await api('/operations-control/confirmations', {
        method: 'POST',
        body: JSON.stringify({ sourceType: inspection.sourceType, sourceId: inspection.sourceId, confirmationType: 'OPERATOR_REVIEW', inspectionId: inspection.id, decision: { source: 'admin-operations-control', inspectionStatus: inspection.status } }),
      });
      setMessage(`Konfirmasi operasi untuk ${inspection.number} tersimpan.`);
    } catch (error) { setMessage(error instanceof Error ? error.message : 'Gagal mengonfirmasi operasi.'); }
  }

  async function reviewInspection(inspection: Inspection, decision: 'approve' | 'reject') {
    setMessage('');
    const isReject = decision === 'reject';
    // Backend: status FAILED -> REJECTED, selain itu -> APPROVED. Kita kirim notes yang
    // sesuai keputusan supaya audit trail tidak menulis "disetujui" untuk penolakan.
    const notes = isReject
      ? (rejectReasons[inspection.id] ?? '').trim() || 'Hasil inspeksi ditolak operator.'
      : 'Selisih penerimaan ditinjau dan disetujui dari Kontrol Operasional.';
    try {
      await api(`/operations-control/inspections/${inspection.id}/approve`, {
        method: 'POST',
        body: JSON.stringify({ notes }),
      });
      setMessage(isReject ? 'Hasil inspeksi ditolak. Dokumen sumber tidak dapat dilanjutkan.' : 'Inspeksi disetujui. Dokumen sumber sekarang dapat dilanjutkan sesuai policy.');
      if (isReject) setRejectReasons((current) => { const next = { ...current }; delete next[inspection.id]; return next; });
      await refresh();
    } catch (error) { setMessage(error instanceof Error ? error.message : (isReject ? 'Gagal menolak hasil inspeksi.' : 'Gagal menyetujui inspeksi.')); }
  }

  async function approveInspection(inspection: Inspection) {
    return reviewInspection(inspection, 'approve');
  }

  return (
    <>
      <section className="grid2">
        {mode === 'inspections' && <Panel eyebrow="KUALITAS" title="Inspeksi Barang" badge={`${inspections.length} record`}>
          <Table
            head={['Nomor', 'Jenis', 'Evidence', 'Dibuat', 'Status', 'Tindakan']}
            rows={inspections.map((i) => [
              <strong>{i.number}</strong>,
              <><span>{i.type}</span><small className="mutedText">{i.sourceType}</small></>,
              <small>{i.evidence?.filter((e) => e.evidenceType === 'PHOTO').length ?? 0} foto · {i.evidence?.filter((e) => e.evidenceType === 'BARCODE').length ?? 0} scan</small>,
              tanggal(i.createdAt),
              <StatusChip status={i.status} />,
              <div className="rowActions">
                {['GoodsReceipt','Shipment','SaleReturn','OrderReturn','PurchaseReturn'].includes(i.sourceType) && i.status === 'IN_PROGRESS' ? (canAll('inspection.record') ? <button type="button" className="secondary" onClick={() => void completeInspection(i)}>Finalisasi</button> : null) : null}
                {['GoodsReceipt','Shipment','SaleReturn','OrderReturn','PurchaseReturn'].includes(i.sourceType) && ['PASSED','PARTIAL','FAILED','REVIEW_REQUIRED'].includes(i.status) && i.status === 'FAILED' && <div className="stack">
                  <input placeholder="Alasan penolakan (opsional, default diisi sistem)" value={rejectReasons[i.id] ?? ''} onChange={(event) => setRejectReasons((current) => ({ ...current, [i.id]: event.target.value }))} />
                  <div className="rowActions">
                    {canAll('inspection.approve') && <><button type="button" className="dangerButton" onClick={() => void reviewInspection(i, 'reject')}>Tolak hasil</button>
                    <button type="button" className="secondary" onClick={() => void reviewInspection(i, 'approve')}>Setujui</button></>}
                  </div>
                </div>}
                {['GoodsReceipt','Shipment','SaleReturn','OrderReturn','PurchaseReturn'].includes(i.sourceType) && ['PASSED','PARTIAL','REVIEW_REQUIRED'].includes(i.status) && <button type="button" className="secondary" onClick={() => void reviewInspection(i, 'approve')}>Setujui</button>}
                {['PASSED','PARTIAL','APPROVED'].includes(i.status) ? (canAll('operations.confirm') ? <button type="button" className="secondary" onClick={() => void confirmOperation(i)}>Konfirmasi operasi</button> : null) : null}
                {!['IN_PROGRESS','PASSED','PARTIAL','FAILED','REVIEW_REQUIRED','APPROVED'].includes(i.status) && <span>-</span>}
              </div>,
            ])}
            empty="Belum ada inspeksi. Inspeksi dibuat otomatis untuk penerimaan dan fulfillment."
          />
        </Panel>}
        {mode === 'inspections' && <Panel eyebrow="POLICY" title="Policy Operasional" badge={`${policies.length} policy`}>
          {canAll('operations.policy.manage') && <form className="formStack" onSubmit={savePolicy}>
            <div className="formGrid">
              <label>Kode<input required value={policyForm.code} onChange={(e) => setPolicyForm({ ...policyForm, code: e.target.value })} /></label>
              <label>Tipe operasi<select value={policyForm.operationType} onChange={(e) => setPolicyForm({ ...policyForm, operationType: e.target.value })}><option value="PURCHASE_RECEIPT">Purchase receipt</option><option value="ORDER_OUTBOUND">Order outbound</option><option value="PURCHASE_RETURN">Purchase return</option><option value="SALE_RETURN">Sale return</option></select></label>
            </div>
            <label>Nama policy<input required value={policyForm.name} onChange={(e) => setPolicyForm({ ...policyForm, name: e.target.value })} /></label>
            <div className="permissionGrid">
              <label className="checkRow"><input type="checkbox" checked={policyForm.requireInspection} onChange={(e) => setPolicyForm({ ...policyForm, requireInspection: e.target.checked })} />Wajib inspeksi</label>
              <label className="checkRow"><input type="checkbox" checked={policyForm.requirePhoto} onChange={(e) => setPolicyForm({ ...policyForm, requirePhoto: e.target.checked })} />Wajib foto</label>
              <label className="checkRow"><input type="checkbox" checked={policyForm.requireBarcodeScan} onChange={(e) => setPolicyForm({ ...policyForm, requireBarcodeScan: e.target.checked })} />Wajib scan</label>
              <label className="checkRow"><input type="checkbox" checked={policyForm.requireGatePass} onChange={(e) => setPolicyForm({ ...policyForm, requireGatePass: e.target.checked })} />Wajib gate pass</label>
              <label className="checkRow"><input type="checkbox" checked={policyForm.blockOnMismatch} onChange={(e) => setPolicyForm({ ...policyForm, blockOnMismatch: e.target.checked })} />Blokir mismatch</label>
            </div>
            <label>Konfirmasi minimum<input type="number" min="1" value={policyForm.requiredConfirmations} onChange={(e) => setPolicyForm({ ...policyForm, requiredConfirmations: Number(e.target.value) })} /></label>
            <button>Simpan policy</button>
          </form>}
          {policies.length > 0 && <div className="table sectionBlock">{policies.slice(0, 10).map((policy) => <div className="receipt" key={policy.id}><div><strong>{policy.code} · {policy.name}</strong><small>{policy.operationType} · {policy.enabled ? 'ACTIVE' : 'INACTIVE'} · {policy.requiredConfirmations} konfirmasi</small></div><span className="statusChip info">{policy.requireInspection ? 'INSPECTION' : 'DIRECT'}</span></div>)}</div>}
        </Panel>}
        {mode === 'evidence' && <Panel eyebrow="EVIDENCE" title="Foto & Barcode Operasional" badge="server verified">
          <label>Inspeksi aktif
            <select value={evidenceInspectionId} onChange={(e) => setEvidenceInspectionId(e.target.value)}>
              <option value="">Pilih inspeksi penerimaan / shipment</option>
              {inspections.filter((i) => ['GoodsReceipt','Shipment','SaleReturn','OrderReturn','PurchaseReturn'].includes(i.sourceType) && i.status === 'IN_PROGRESS').map((i) => <option key={i.id} value={i.id}>{i.number} · {i.sourceType}</option>)}
            </select>
          </label>
          {selectedInspection && selectedInspection.results.filter((row) => !row.productId).length > 0 && (
            <div className="formStack">
              <strong>Checklist inspeksi</strong>
              {selectedInspection.results.filter((row) => !row.productId).map((row) => (
                <label key={row.code}>{row.label}
                  <select value={row.result} onChange={(e) => setChecklistResult(selectedInspection.id, row.code, e.target.value as 'PASS' | 'FAIL' | 'OBSERVATION')}>
                    <option value="OBSERVATION">Belum diputuskan</option>
                    <option value="PASS">PASS</option>
                    <option value="FAIL">FAIL</option>
                  </select>
                </label>
              ))}
            </div>
          )}
          {selectedInspection && selectedInspection.results.some((row) => row.productId) && (
            <div className="formStack">
              <small>Scan produk: {selectedInspection.results.filter((row) => row.productId).map((row) => `${row.label} ${row.scannedQty ?? 0}/${row.expectedQty ?? 0}`).join(' · ')}</small>
              {selectedInspection.sourceType === 'OrderReturn' && selectedInspection.results.filter((row) => row.productId).map((row) => <div key={row.code} className="receipt">
                <div><strong>{row.label}</strong><small>expected {row.expectedQty ?? 0} · scanned {row.scannedQty ?? 0}</small></div>
                <select value={row.result} onChange={(e) => { const result = e.target.value as 'PASS' | 'FAIL' | 'OBSERVATION'; const expected = row.expectedQty ?? 0; updateInspectionResult(selectedInspection.id, row.code, result === 'PASS' ? { result, acceptedQty: expected, rejectedQty: 0, damagedQty: 0, missingQty: 0, extraQty: 0 } : result === 'FAIL' ? { result, acceptedQty: 0, rejectedQty: expected, damagedQty: 0, missingQty: 0, extraQty: 0 } : { result }); }}>
                  <option value="OBSERVATION">Belum diputuskan</option><option value="PASS">PASS · layak restock</option><option value="FAIL">FAIL · jangan restock</option>
                </select>
              </div>)}
            </div>
          )}
          <label>Scan barcode / SKU
            <input value={barcodeValue} onChange={(e) => setBarcodeValue(e.target.value)} placeholder="Scan atau ketik barcode" />
          </label>
          <button type="button" className="secondary" onClick={() => void uploadBarcode()}>Simpan barcode</button>
          <label className="sectionBlock">Foto evidence
            <input type="file" accept="image/jpeg,image/png,image/webp" onChange={(e) => setPhotoFile(e.target.files?.[0] ?? null)} />
          </label>
          <button type="button" className="secondary" onClick={() => void uploadPhoto()}>Unggah foto</button>
          <small className="mutedText">Finalisasi inspeksi hanya dapat dilakukan bila policy evidence sudah terpenuhi.</small>
        </Panel>}
        {mode === 'evidence' && <Panel eyebrow="TEMPLATE" title="Template Inspeksi" badge="versioned">
          {canAll('inspection.manage') && <form className="formStack" onSubmit={saveTemplate}>
            <div className="formGrid"><label>Kode template<input required value={templateForm.code} onChange={(e) => setTemplateForm({ ...templateForm, code: e.target.value })} /></label><label>Nama<input required value={templateForm.name} onChange={(e) => setTemplateForm({ ...templateForm, name: e.target.value })} /></label></div>
            <div className="formGrid"><label>Jenis<select value={templateForm.type} onChange={(e) => setTemplateForm({ ...templateForm, type: e.target.value })}><option value="PURCHASE_INBOUND">Purchase inbound</option><option value="TRANSFER_INBOUND">Transfer inbound</option><option value="ORDER_OUTBOUND">Order outbound</option><option value="RETURN_INBOUND">Return inbound</option><option value="GATE_SECURITY">Gate security</option><option value="OTHER">Other</option></select></label><label>Berlaku untuk<input required value={templateForm.appliesTo} onChange={(e) => setTemplateForm({ ...templateForm, appliesTo: e.target.value })} /></label></div>
            <div className="formGrid"><label>Kode checklist<input required value={templateForm.itemCode} onChange={(e) => setTemplateForm({ ...templateForm, itemCode: e.target.value })} /></label><label>Label checklist<input required value={templateForm.itemLabel} onChange={(e) => setTemplateForm({ ...templateForm, itemLabel: e.target.value })} /></label></div>
            <label>Severity<select value={templateForm.failureSeverity} onChange={(e) => setTemplateForm({ ...templateForm, failureSeverity: e.target.value })}><option value="BLOCKING">Blocking</option><option value="WARNING">Warning</option></select></label>
            <button>Simpan template</button>
          </form>}
        </Panel>}
        {mode === 'gate-pass' && <Panel eyebrow="GATE CONTROL" title="Gate Pass Masuk / Keluar" badge={`${gatePasses.length} pass`}>
          <Table
            head={['Nomor', 'Arah', 'Dibuat', 'Status', 'Tindakan']}
            rows={gatePasses.map((g) => [
              <strong>{g.number}</strong>,
              g.direction ?? '-',
              tanggal(g.createdAt),
              <StatusChip status={g.status ?? '-'} />,
              <div className="rowActions">{g.status === 'DRAFT' && (canAll('gate_pass.approve') ? <button type="button" className="secondary" onClick={() => void approveGatePass(g)}>Setujui</button> : null)}{g.status === 'APPROVED' && (canAll('gate_pass.manage') ? <button type="button" onClick={() => void recordGateMovement(g)}>Catat {g.direction === 'INBOUND' ? 'masuk' : 'keluar'}</button> : null)}{['ENTERED','EXITED'].includes(g.status ?? '') && <span className="okText">Movement tercatat</span>}</div>,
            ])}
            empty="Belum ada gate pass."
          />
        </Panel>}
      </section>
      {message && <div className="notice">{message}</div>}
    </>
  );
}
