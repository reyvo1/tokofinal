'use client';

import { FormEvent, useEffect, useMemo, useState } from 'react';
import { authFetch } from '../auth-fetch';
import { usePermissions } from '../permissions';
import { readOptional } from '../read-path-contract';
import { Panel, StatusChip, Table, tanggal } from '../ui';

const API = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000/api/v1';

type ForecastSuggestion = { id: string; productId: string; currentStock: number; reservedStock: number; averageDailySales: string | number; leadTimeDays: number; safetyStock: number; suggestedQty: number; reason?: Record<string, unknown> | null; status: string };
type ForecastRun = { id: string; warehouseId?: string | null; model: string; horizonDays: number; parameters?: Record<string, unknown> | null; status: string; createdAt: string; completedAt?: string | null; suggestions: ForecastSuggestion[] };
type OperatorInsight = { id: string; category: string; severity: string; title: string; summary: string; explanation: Record<string, unknown>; sourceLinks: Array<Record<string, unknown>>; recommendedAction?: Record<string, unknown> | null; status: string; lastObservedAt: string };
type AssistantInteraction = { id: string; question: string; intent: string; response: { answer?: string; confidence?: number; guardrail?: string }; sourceLinks: Array<Record<string, unknown>>; confidence: string | number; createdAt: string };
type AssistantAnswer = { id: string; answer: string; intent: string; confidence: number; capabilityType: 'DETERMINISTIC_RULE_BASED'; aiProvider: null; guardrail: string; recommendedNextStep?: { execution?: string; deepLink?: string | null } | null; sources: Array<Record<string, unknown>> };

async function api<T>(token: string, path: string, init?: RequestInit): Promise<T> {
  const response = await authFetch(`${API}${path}`, token, { ...init, headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}`, ...(init?.headers ?? {}) } });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(Array.isArray(payload?.message) ? payload.message.join(', ') : payload?.message ?? `HTTP ${response.status}`);
  return payload as T;
}

type IntelligenceMode = 'ai' | 'forecast';

export default function AiWorkspace({ token, mode = 'ai' }: { token: string; mode?: IntelligenceMode }) {
  const [forecasts, setForecasts] = useState<ForecastRun[]>([]);
  const [insights, setInsights] = useState<OperatorInsight[]>([]);
  const [history, setHistory] = useState<AssistantInteraction[]>([]);
  const [answer, setAnswer] = useState<AssistantAnswer | null>(null);
  const [question, setQuestion] = useState('Apa yang paling perlu perhatian operator hari ini?');
  const [intent, setIntent] = useState('AUTO');
  const [forecastForm, setForecastForm] = useState({ warehouseId: '', lookbackDays: 30, horizonDays: 14, leadTimeDays: 7 });
  const [warehouses, setWarehouses] = useState<Array<{ id: string; code: string; name: string }>>([]);
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const { canAll, identity } = usePermissions(token);

  async function load() {
    try {
      const [fc, ins, hist, wh] = await Promise.all([
        api<ForecastRun[]>(token, '/forecasts'),
        api<OperatorInsight[]>(token, '/operator-insights'),
        api<AssistantInteraction[]>(token, '/operator-assistant/history'),
        // The intelligence gate is assistant|forecast|automation|report, none of which implies
        // master_data.view. An HR or PAYROLL operator passes that gate and is refused here, which
        // used to reject all four reads and blank the workspace they were entitled to.
        readOptional(identity, '/master-data/warehouses', [] as Array<{ id: string; code: string; name: string }>, () => api<Array<{ id: string; code: string; name: string }>>(token, '/master-data/warehouses')),
      ]);
      setForecasts(fc); setInsights(ins); setHistory(hist); setWarehouses(wh);
      setForecastForm((current) => ({ ...current, warehouseId: current.warehouseId || wh[0]?.id || '' }));
      setMessage('');
    } catch (error) { setMessage(error instanceof Error ? error.message : 'Gagal memuat forecast & automation workspace.'); }
  }

  useEffect(() => { void load(); }, [token]);

  const openInsights = useMemo(() => insights.filter((item) => item.status === 'OPEN'), [insights]);
  const highInsights = useMemo(() => openInsights.filter((item) => ['HIGH','CRITICAL'].includes(item.severity)).length, [openInsights]);
  const latestForecast = forecasts[0];

  async function runForecast(event: FormEvent) {
    event.preventDefault(); setBusy(true); setMessage('');
    try {
      if (!forecastForm.warehouseId) throw new Error('Gudang wajib dipilih.');
      await api(token, '/forecasts/run', { method: 'POST', body: JSON.stringify(forecastForm) });
      await load(); setMessage('Forecast selesai dihitung dari data penjualan dan inventory tenant aktif.');
    } catch (error) { setMessage(error instanceof Error ? error.message : 'Forecast gagal.'); }
    finally { setBusy(false); }
  }

  async function refreshInsights() {
    setBusy(true); setMessage('');
    try { await api(token, '/operator-insights/refresh', { method: 'POST' }); await load(); setMessage('Insight diperbarui dari sumber operasional yang diizinkan.'); }
    catch (error) { setMessage(error instanceof Error ? error.message : 'Gagal memperbarui insight.'); }
    finally { setBusy(false); }
  }

  async function insightAction(item: OperatorInsight, status: 'ACKNOWLEDGED'|'DISMISSED') {
    setBusy(true); setMessage('');
    try { await api(token, `/operator-insights/${item.id}/status`, { method: 'PATCH', body: JSON.stringify({ status }) }); await load(); }
    catch (error) { setMessage(error instanceof Error ? error.message : 'Gagal mengubah insight.'); }
    finally { setBusy(false); }
  }

  async function askAssistant(event: FormEvent) {
    event.preventDefault(); setBusy(true); setMessage('');
    try {
      const result = await api<AssistantAnswer>(token, '/operator-assistant/query', { method: 'POST', body: JSON.stringify({ question, intent }) });
      setAnswer(result); await load();
    } catch (error) { setMessage(error instanceof Error ? error.message : 'Assistant gagal menjawab.'); }
    finally { setBusy(false); }
  }

  return <div className="stack">
    <section className="stats">
      {mode === 'forecast' && <article className="statCard"><small>Forecast run</small><strong>{forecasts.length}</strong><span className="delta">{latestForecast?.model ?? 'belum ada model'}</span></article>}
      {mode === 'ai' && <article className="statCard"><small>Insight terbuka</small><strong>{openInsights.length}</strong><span className={highInsights ? 'delta warnText' : 'delta'}>{highInsights} high/critical</span></article>}
      {mode === 'ai' && <article className="statCard"><small>Assistant deterministik</small><strong>{history.length}</strong><span className="delta">rule-based · tanpa LLM/provider AI</span></article>}
    </section>

    <section className="grid2">
      {mode === 'forecast' && <Panel eyebrow="FORECASTING" title="Explainable stock forecast" badge="moving average">
        <form className="formStack" onSubmit={runForecast}>
          <label>Gudang<select required value={forecastForm.warehouseId} onChange={(e) => setForecastForm({ ...forecastForm, warehouseId: e.target.value })}><option value="">Pilih gudang</option>{warehouses.map((warehouse) => <option key={warehouse.id} value={warehouse.id}>{warehouse.code} · {warehouse.name}</option>)}</select></label>
          <div className="inline"><label>Lookback hari<input type="number" min="7" value={forecastForm.lookbackDays} onChange={(e) => setForecastForm({ ...forecastForm, lookbackDays: Number(e.target.value) })} /></label><label>Horizon hari<input type="number" min="1" value={forecastForm.horizonDays} onChange={(e) => setForecastForm({ ...forecastForm, horizonDays: Number(e.target.value) })} /></label><label>Lead time<input type="number" min="0" value={forecastForm.leadTimeDays} onChange={(e) => setForecastForm({ ...forecastForm, leadTimeDays: Number(e.target.value) })} /></label></div>
          {canAll('forecast.run') && <button disabled={busy}>Jalankan forecast</button>}
          <small>Formula, input, confidence, dan source disimpan pada setiap reorder suggestion. Assistant tidak membuat PO otomatis.</small>
        </form>
      </Panel>}

      {mode === 'ai' && <Panel eyebrow="DETERMINISTIC ASSISTANT" title="Tanya berdasarkan rule & sumber" badge="tanpa LLM">
        <form className="formStack" onSubmit={askAssistant}>
          <label>Intent<select value={intent} onChange={(e) => setIntent(e.target.value)}>{['AUTO','STOCK','FINANCE','AUTOMATION','REPORTING'].map((value) => <option key={value}>{value}</option>)}</select></label>
          <label>Pertanyaan<textarea required maxLength={500} value={question} onChange={(e) => setQuestion(e.target.value)} /></label>
          {canAll('assistant.use') && <button disabled={busy}>Analisis sumber</button>}
        </form>
        {answer && <div className="notice"><strong>{answer.intent} · deterministic · confidence {Math.round(answer.confidence * 100)}%</strong><p>{answer.answer}</p><small>{answer.guardrail}</small><div className="rowActions">{answer.sources.map((source, index) => <span key={index} className="pill">{String(source.type ?? 'source')} {source.id ? `· ${String(source.id).slice(0,8)}` : ''}</span>)}</div></div>}
      </Panel>}
    </section>

    {mode === 'ai' && <Panel eyebrow="ANOMALY & RECOMMENDATION" title="Operator insights" badge={`${openInsights.length} open`}>
      <div className="toolbar">{canAll('assistant.manage') && <button type="button" onClick={() => void refreshInsights()} disabled={busy}>Refresh insight</button>}<small>Hanya data yang diizinkan oleh permission pengguna yang dipakai.</small></div>
      <Table head={['Kategori','Severity','Insight','Sumber','Status','Aksi']} rows={insights.map((item) => [item.category,<StatusChip status={item.severity}/>,<span><strong>{item.title}</strong><small>{item.summary}</small></span>,Array.isArray(item.sourceLinks) ? item.sourceLinks.map((source, index) => <small key={index}>{String(source.type ?? 'source')} {source.id ? `· ${String(source.id).slice(0,8)}` : ''}</small>) : '-',<StatusChip status={item.status}/>,item.status === 'OPEN' ? (canAll('assistant.use') ? <div className="rowActions"><button type="button" className="secondary" disabled={busy} onClick={() => void insightAction(item,'ACKNOWLEDGED')}>Acknowledge</button><button type="button" className="secondary" disabled={busy} onClick={() => void insightAction(item,'DISMISSED')}>Dismiss</button></div> : '-') : '-'])} empty="Belum ada insight. Jalankan refresh setelah forecast atau saat ada operational exception." />
    </Panel>}

    {mode === 'forecast' && <Panel eyebrow="FORECAST EXPLAINABILITY" title="Reorder suggestions" badge={latestForecast ? tanggal(latestForecast.createdAt) : 'belum ada'}>
      <Table head={['Product','Available','Reserved','Avg/day','Safety','Suggestion','Status']} rows={(latestForecast?.suggestions ?? []).map((item) => [item.productId.slice(0,8),String(item.currentStock),String(item.reservedStock),String(item.averageDailySales),String(item.safetyStock),<strong key={item.id}>{item.suggestedQty}</strong>,<StatusChip status={item.status}/>])} empty="Belum ada reorder suggestion." />
    </Panel>}

    {mode === 'ai' && <Panel eyebrow="RULE-BASED ASSISTANT AUDIT" title="Interaction history" badge={`${history.length} query`}>
      <Table head={['Waktu','Intent','Pertanyaan','Jawaban','Confidence']} rows={history.slice(0,30).map((item) => [tanggal(item.createdAt),item.intent,item.question,item.response?.answer ?? '-',`${Math.round(Number(item.confidence) * 100)}%`])} empty="Belum ada interaction history." />
    </Panel>}

    {message && <div className="notice">{message}</div>}
  </div>;
}
