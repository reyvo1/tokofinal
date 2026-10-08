'use client';

import { FormEvent, useEffect, useMemo, useState } from 'react';
import { authFetch } from '../auth-fetch';
import { usePermissions } from '../permissions';
import { readOptional } from '../read-path-contract';
import { Panel, StatusChip, Table, tanggal } from '../ui';
import { REPORT_TYPES, reportTypeLabel } from '../report-catalog';

const API = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000/api/v1';

type BusinessRule = { id: string; code: string; name: string; trigger: string; conditions?: unknown; actions: unknown; priority: number; isActive: boolean; updatedAt: string };
type AutomationJob = { id: string; eventType: string; sourceType: string; sourceId: string; ruleCode?: string | null; actionType: string; status: string; attempts: number; maxAttempts: number; scheduledAt: string; completedAt?: string | null; lastError?: string | null; createdAt: string };
type ReportSchedule = { id: string; name: string; reportType: string; format: string; frequency: string; localTime: string; dayOfWeek?: number | null; dayOfMonth?: number | null; timezone: string; isActive: boolean; nextRunAt: string; lastRunAt?: string | null; lastJobId?: string | null; lastError?: string | null };

const DEFAULT_ACTIONS = JSON.stringify([{ type: 'notification.enqueue', channel: 'IN_APP', recipient: 'ADMIN' }], null, 2);

async function api<T>(token: string, path: string, init?: RequestInit): Promise<T> {
  const response = await authFetch(`${API}${path}`, token, { ...init, headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}`, ...(init?.headers ?? {}) } });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(Array.isArray(payload?.message) ? payload.message.join(', ') : payload?.message ?? `HTTP ${response.status}`);
  return payload as T;
}

type AutomationMode = 'automation' | 'schedules';

export default function AutomationWorkspace({ token, mode = 'automation' }: { token: string; mode?: AutomationMode }) {
  const [rules, setRules] = useState<BusinessRule[]>([]);
  const [jobs, setJobs] = useState<AutomationJob[]>([]);
  const [schedules, setSchedules] = useState<ReportSchedule[]>([]);
  const [jobStatus, setJobStatus] = useState('');
  const [message, setMessage] = useState('');
  const [editingRuleId, setEditingRuleId] = useState<string | null>(null);
  const [ruleForm, setRuleForm] = useState({ code: '', name: '', trigger: 'inventory.balance.changed', priority: 100, conditions: '{}', actions: DEFAULT_ACTIONS });
  const [scheduleForm, setScheduleForm] = useState({ name: '', reportType: 'PROFIT_LOSS', format: 'XLSX', frequency: 'DAILY', localTime: '08:00', dayOfWeek: 1, dayOfMonth: 1 });
  const { canAll, identity } = usePermissions(token);

  async function load() {
    try {
      const suffix = jobStatus ? `?status=${encodeURIComponent(jobStatus)}&limit=100` : '?limit=100';
      const [r, j, s] = await Promise.all([
        // Business rules are automation.manage, which the intelligence gate
        // (assistant|forecast|automation|report) does not cover for every role that passes it —
        // HR and PAYROLL hold none of the four. Report schedules additionally sit behind
        // report.export plus an @Roles list. Both degrade independently so one refusal does not
        // discard the automation job history alongside them.
        readOptional(identity, '/platform/business-rules', [] as BusinessRule[], () => api<BusinessRule[]>(token, '/platform/business-rules')),
        api<AutomationJob[]>(token, `/platform/automation-jobs${suffix}`),
        readOptional(identity, '/reports/schedules', [] as ReportSchedule[], () => api<ReportSchedule[]>(token, '/reports/schedules')),
      ]);
      setRules(r); setJobs(j); setSchedules(s); setMessage('');
    } catch (error) { setMessage(error instanceof Error ? error.message : 'Gagal memuat automation workspace.'); }
  }

  useEffect(() => { void load(); }, [token, jobStatus]);

  const failedJobs = useMemo(() => jobs.filter((job) => job.status === 'FAILED').length, [jobs]);

  function parseJson(value: string, label: string) {
    try { return JSON.parse(value); } catch { throw new Error(`${label} harus JSON valid.`); }
  }

  async function saveRule(event: FormEvent) {
    event.preventDefault();
    try {
      const payload = { name: ruleForm.name.trim(), trigger: ruleForm.trigger.trim(), priority: Number(ruleForm.priority), conditions: parseJson(ruleForm.conditions, 'Conditions'), actions: parseJson(ruleForm.actions, 'Actions') };
      if (editingRuleId) await api(token, `/platform/business-rules/${editingRuleId}`, { method: 'PATCH', body: JSON.stringify(payload) });
      else await api(token, '/platform/business-rules', { method: 'POST', body: JSON.stringify({ code: ruleForm.code.trim(), ...payload }) });
      setEditingRuleId(null); setRuleForm({ code: '', name: '', trigger: 'inventory.balance.changed', priority: 100, conditions: '{}', actions: DEFAULT_ACTIONS });
      await load(); setMessage('Business rule tersimpan.');
    } catch (error) { setMessage(error instanceof Error ? error.message : 'Gagal menyimpan business rule.'); }
  }

  function editRule(rule: BusinessRule) {
    setEditingRuleId(rule.id);
    setRuleForm({ code: rule.code, name: rule.name, trigger: rule.trigger, priority: rule.priority, conditions: JSON.stringify(rule.conditions ?? {}, null, 2), actions: JSON.stringify(rule.actions ?? [], null, 2) });
  }

  async function toggleRule(rule: BusinessRule) {
    try { await api(token, `/platform/business-rules/${rule.id}`, { method: 'PATCH', body: JSON.stringify({ isActive: !rule.isActive }) }); await load(); }
    catch (error) { setMessage(error instanceof Error ? error.message : 'Gagal mengubah rule.'); }
  }

  async function jobAction(job: AutomationJob, action: 'cancel' | 'replay') {
    try { await api(token, `/platform/automation-jobs/${job.id}/${action}`, { method: 'POST' }); await load(); }
    catch (error) { setMessage(error instanceof Error ? error.message : `Gagal ${action} job.`); }
  }

  async function createSchedule(event: FormEvent) {
    event.preventDefault();
    try {
      const payload = { ...scheduleForm, dayOfWeek: scheduleForm.frequency === 'WEEKLY' ? Number(scheduleForm.dayOfWeek) : undefined, dayOfMonth: scheduleForm.frequency === 'MONTHLY' ? Number(scheduleForm.dayOfMonth) : undefined };
      await api(token, '/reports/schedules', { method: 'POST', body: JSON.stringify(payload) });
      setScheduleForm((current) => ({ ...current, name: '' })); await load(); setMessage('Schedule report dibuat.');
    } catch (error) { setMessage(error instanceof Error ? error.message : 'Gagal membuat schedule report.'); }
  }

  async function scheduleAction(schedule: ReportSchedule, action: 'toggle' | 'run') {
    try {
      if (action === 'run') await api(token, `/reports/schedules/${schedule.id}/run-now`, { method: 'POST' });
      else await api(token, `/reports/schedules/${schedule.id}`, { method: 'PATCH', body: JSON.stringify({ isActive: !schedule.isActive }) });
      await load();
    } catch (error) { setMessage(error instanceof Error ? error.message : 'Gagal mengubah schedule report.'); }
  }

  return <div className="stack">
    <section className="stats">
      {mode === 'automation' && <article className="statCard"><small>Business rules</small><strong>{rules.length}</strong><span className="delta">{rules.filter((rule) => rule.isActive).length} aktif</span></article>}
      {mode === 'automation' && <article className="statCard"><small>Automation jobs</small><strong>{jobs.length}</strong><span className={failedJobs ? 'delta warnText' : 'delta'}>{failedJobs} gagal</span></article>}
      {mode === 'schedules' && <article className="statCard"><small>Scheduled reports</small><strong>{schedules.length}</strong><span className="delta">{schedules.filter((schedule) => schedule.isActive).length} aktif</span></article>}
    </section>

    <section className="grid2">
      {mode === 'automation' && <Panel eyebrow="RULE ENGINE" title={editingRuleId ? 'Edit business rule' : 'Business rule baru'} badge="tenant scoped">
        <form className="formStack" onSubmit={saveRule}>
          <label>Kode<input required disabled={Boolean(editingRuleId)} value={ruleForm.code} onChange={(e) => setRuleForm({ ...ruleForm, code: e.target.value })} /></label>
          <label>Nama<input required value={ruleForm.name} onChange={(e) => setRuleForm({ ...ruleForm, name: e.target.value })} /></label>
          <div className="inline"><label>Trigger<input required value={ruleForm.trigger} onChange={(e) => setRuleForm({ ...ruleForm, trigger: e.target.value })} /></label><label>Priority<input type="number" value={ruleForm.priority} onChange={(e) => setRuleForm({ ...ruleForm, priority: Number(e.target.value) })} /></label></div>
          <label>Conditions JSON<textarea value={ruleForm.conditions} onChange={(e) => setRuleForm({ ...ruleForm, conditions: e.target.value })} /></label>
          <label>Actions JSON<textarea value={ruleForm.actions} onChange={(e) => setRuleForm({ ...ruleForm, actions: e.target.value })} /></label>
          <div className="rowActions">{canAll('automation.manage') && <button>{editingRuleId ? 'Simpan perubahan' : 'Buat rule'}</button>}{editingRuleId && <button type="button" className="secondary" onClick={() => { setEditingRuleId(null); setRuleForm({ code: '', name: '', trigger: 'inventory.balance.changed', priority: 100, conditions: '{}', actions: DEFAULT_ACTIONS }); }}>Batal</button>}</div>
        </form>
      </Panel>}
      {mode === 'schedules' && <Panel eyebrow="SCHEDULED REPORT" title="Jadwal laporan" badge="worker">
        <form className="formStack" onSubmit={createSchedule}>
          <label>Nama schedule<input required value={scheduleForm.name} onChange={(e) => setScheduleForm({ ...scheduleForm, name: e.target.value })} /></label>
          <div className="inline"><label>Report<select value={scheduleForm.reportType} onChange={(e) => setScheduleForm({ ...scheduleForm, reportType: e.target.value })}>{REPORT_TYPES.map((type) => <option key={type} value={type}>{reportTypeLabel(type)}</option>)}</select></label><label>Format<select value={scheduleForm.format} onChange={(e) => setScheduleForm({ ...scheduleForm, format: e.target.value })}><option>CSV</option><option>XLSX</option><option>PDF</option></select></label></div>
          <div className="inline"><label>Frekuensi<select value={scheduleForm.frequency} onChange={(e) => setScheduleForm({ ...scheduleForm, frequency: e.target.value })}><option>DAILY</option><option>WEEKLY</option><option>MONTHLY</option></select></label><label>Jam lokal<input type="time" required value={scheduleForm.localTime} onChange={(e) => setScheduleForm({ ...scheduleForm, localTime: e.target.value })} /></label></div>
          {scheduleForm.frequency === 'WEEKLY' && <label>Hari (0 Minggu – 6 Sabtu)<input type="number" min="0" max="6" value={scheduleForm.dayOfWeek} onChange={(e) => setScheduleForm({ ...scheduleForm, dayOfWeek: Number(e.target.value) })} /></label>}
          {scheduleForm.frequency === 'MONTHLY' && <label>Tanggal (1–28)<input type="number" min="1" max="28" value={scheduleForm.dayOfMonth} onChange={(e) => setScheduleForm({ ...scheduleForm, dayOfMonth: Number(e.target.value) })} /></label>}
          {canAll('report.export') && <button>Buat schedule</button>}
        </form>
      </Panel>}
    </section>

    {mode === 'automation' && <Panel eyebrow="RULE LIFECYCLE" title="Business rules" badge={`${rules.length} rules`}>
      <Table head={['Rule','Trigger','Priority','Status','Aksi']} rows={rules.map((rule) => [<span><strong>{rule.code}</strong><small>{rule.name}</small></span>,rule.trigger,String(rule.priority),<StatusChip status={rule.isActive ? 'ACTIVE' : 'INACTIVE'} />,canAll('automation.manage')?<div className="rowActions"><button type="button" className="secondary" onClick={() => editRule(rule)}>Edit</button><button type="button" className="secondary" onClick={() => void toggleRule(rule)}>{rule.isActive ? 'Nonaktifkan' : 'Aktifkan'}</button></div>:<small>Butuh automation.manage.</small>])} empty="Belum ada business rule." />
    </Panel>}

    {mode === 'automation' && <Panel eyebrow="EXECUTION HISTORY" title="Automation jobs" badge={`${failedJobs} failed`}>
      <div className="toolbar"><label>Status<select value={jobStatus} onChange={(e) => setJobStatus(e.target.value)}><option value="">Semua</option>{['PENDING','PROCESSING','SUCCEEDED','RETRYING','FAILED','CANCELLED'].map((status) => <option key={status}>{status}</option>)}</select></label><button type="button" className="secondary" onClick={() => void load()}>Muat ulang</button></div>
      <Table head={['Waktu','Rule / action','Source','Attempt','Status','Aksi']} rows={jobs.map((job) => [tanggal(job.createdAt),<span><strong>{job.ruleCode ?? '-'}</strong><small>{job.actionType}</small></span>,`${job.sourceType}:${job.sourceId.slice(0, 8)}`,`${job.attempts}/${job.maxAttempts}`,<span><StatusChip status={job.status}/>{job.lastError && <small className="danger">{job.lastError}</small>}</span>,<div className="rowActions">{canAll('automation.manage') && <>{['PENDING','RETRYING'].includes(job.status) && <button type="button" className="secondary" onClick={() => void jobAction(job,'cancel')}>Batalkan</button>}{['FAILED','CANCELLED'].includes(job.status) && <button type="button" onClick={() => void jobAction(job,'replay')}>Replay</button>}</>}</div>])} empty="Belum ada automation execution." />
    </Panel>}

    {mode === 'schedules' && <Panel eyebrow="REPORT SCHEDULER" title="Scheduled reports" badge={`${schedules.filter((schedule) => schedule.isActive).length} aktif`}>
      <Table head={['Schedule','Frekuensi','Next run','Last run','Status','Aksi']} rows={schedules.map((schedule) => [<span><strong>{schedule.name}</strong><small>{schedule.reportType} · {schedule.format}</small></span>,`${schedule.frequency} ${schedule.localTime} ${schedule.timezone}`,tanggal(schedule.nextRunAt),schedule.lastRunAt ? tanggal(schedule.lastRunAt) : '-',<span><StatusChip status={schedule.isActive ? 'ACTIVE' : 'INACTIVE'} />{schedule.lastError && <small className="danger">{schedule.lastError}</small>}</span>,canAll('report.export')?<div className="rowActions"><button type="button" className="secondary" onClick={() => void scheduleAction(schedule,'toggle')}>{schedule.isActive ? 'Nonaktifkan' : 'Aktifkan'}</button><button type="button" onClick={() => void scheduleAction(schedule,'run')}>Jalankan sekarang</button></div>:<small>Butuh report.export.</small>])} empty="Belum ada scheduled report." />
    </Panel>}

    {message && <div className="notice">{message}</div>}
  </div>;
}
