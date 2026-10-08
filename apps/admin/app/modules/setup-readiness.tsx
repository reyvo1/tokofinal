'use client';
import { useEffect, useState } from 'react';
import { authFetch } from '../auth-fetch';
import { ErrorState, Panel, Skeleton, StatusChip } from '../ui';

const API = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000/api/v1';
type Step = { key: string; label: string; complete: boolean; detail: string; route: string; required?: boolean };
type Readiness = {
  score: number;
  readyForOperations: boolean;
  completed: number;
  required: number;
  optionalConnectedIntegrations: number;
  steps: Step[];
};

export default function SetupReadinessView({ token }: { token: string }) {
  const [data, setData] = useState<Readiness | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);

  async function load() {
    setLoading(true);
    setError('');
    try {
      const response = await authFetch(`${API}/platform/setup-readiness`, token);
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(Array.isArray(body.message) ? body.message.join(', ') : body.message ?? `HTTP ${response.status}`);
      setData(body as Readiness);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Setup readiness gagal dimuat.');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { void load(); }, [token]);
  if (error) return <ErrorState message={error} />;
  if (loading || !data) return <Skeleton rows={6} />;

  return <>
    <div className="pageHeader">
      <div>
        <p className="eyebrow">SETUP READINESS</p>
        <h2>Checklist kesiapan operasional</h2>
        <p>Assistant ini memandu konfigurasi bisnis setelah deployment. Migrasi database dan seed tetap dijalankan oleh workflow deployment, bukan dari browser admin.</p>
      </div>
      <button type="button" className="secondary" onClick={() => void load()}>Refresh</button>
    </div>
    <section className="metricGrid">
      <div className="metricCard"><span>Readiness</span><strong>{data.score}%</strong><small>{data.completed}/{data.required} langkah wajib selesai</small></div>
      <div className="metricCard"><span>Status</span><strong>{data.readyForOperations ? 'READY' : 'BELUM READY'}</strong><small>{data.optionalConnectedIntegrations} integrasi opsional terhubung.</small></div>
    </section>
    <Panel eyebrow="BUSINESS SETUP" title="Langkah konfigurasi">
      <div className="table">
        <div className="tr th"><span>Langkah</span><span>Status</span><span>Tindakan</span></div>
        {data.steps.map((step) => <div className="tr" key={step.key}>
          <span><strong>{step.label}</strong><small>{step.detail}</small></span>
          <span><StatusChip status={step.complete ? 'COMPLETE' : 'PENDING'} />{step.required === false && <small>Opsional</small>}</span>
          <span>{step.route ? <a className="buttonLink" href={step.route}>{step.complete ? 'Tinjau' : 'Konfigurasi'}</a> : '-'}</span>
        </div>)}
      </div>
    </Panel>
  </>;
}
