 'use client';

import { FormEvent, useEffect, useMemo, useState } from 'react';
import { clearEmployeeTokens, employeeAuthFetch, storeEmployeeTokens } from './auth-fetch';
import { EmployeePortalShell, type EmployeePortalView } from './employee-portal-shell';
import { T360ThemeToggle } from './theme-client';
import StaffMemoWidget from './staff-memo';

const API = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000/api/v1';

type Employee = {
  id: string;
  employeeNumber: string;
  fullName: string;
  branchId?: string | null;
  companyId: string;
};

type RuntimeManifest = { company?: { id: string; name: string }; branch?: { id: string; code?: string; name: string } };

type Attendance = {
  id: string;
  workDate: string;
  firstCheckInAt?: string;
  lastCheckOutAt?: string;
  status: string;
  lateMinutes: number;
};

type Payslip = {
  id: string;
  number: string;
  createdAt: string;
  generatedAt?: string | null;
  viewedAt?: string | null;
  acknowledgedAt?: string | null;
  dataSnapshot: {
    grossPay?: string;
    incomeTax?: string;
    netPay?: string;
    [key: string]: unknown;
  };
};

type LeaveType = {
  id: string;
  code: string;
  name: string;
  paid: boolean;
  annualQuota?: string | number | null;
  requiresDocument: boolean;
};

type LeaveRequest = {
  id: string;
  leaveTypeId: string;
  startDate: string;
  endDate: string;
  totalDays: string | number;
  reason?: string | null;
  status: string;
  createdAt: string;
};

type OvertimeRequest = {
  id: string;
  requestedStart: string;
  requestedEnd: string;
  approvedMinutes?: number | null;
  reason?: string | null;
  status: string;
  createdAt: string;
};

type ChannelBinding = { id: string; channel: string; externalUserId?: string | null; verifiedAt?: string | null; isPrimary: boolean };
type NotificationPreference = { id: string; eventCode: string; channel: string; enabled: boolean };
type AttendanceCorrection = { id: string; attendanceRecordId?: string | null; reason: string; proposedData: Record<string, unknown>; status: string; createdAt: string };

type Tone = 'info' | 'success' | 'error';

function localWorkDate(date = new Date()) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

function rupiah(value: string | number | undefined) {
  return new Intl.NumberFormat('id-ID', {
    style: 'currency',
    currency: 'IDR',
    maximumFractionDigits: 0,
  }).format(Number(value ?? 0));
}

function dateLabel(value: string) {
  return new Date(value).toLocaleDateString('id-ID');
}

function dateTimeLabel(value: string) {
  return new Date(value).toLocaleString('id-ID');
}

export function EmployeePortalApp({ initialView = 'home' }: { initialView?: EmployeePortalView }) {
  const [token, setToken] = useState('');
  const [employee, setEmployee] = useState<Employee | null>(null);
  const [manifest, setManifest] = useState<RuntimeManifest | null>(null);
  const [attendance, setAttendance] = useState<Attendance[]>([]);
  const [payslips, setPayslips] = useState<Payslip[]>([]);
  const [selectedPayslip, setSelectedPayslip] = useState<Payslip | null>(null);
  const [leaveTypes, setLeaveTypes] = useState<LeaveType[]>([]);
  const [leaveRequests, setLeaveRequests] = useState<LeaveRequest[]>([]);
  const [overtimeRequests, setOvertimeRequests] = useState<OvertimeRequest[]>([]);
  const [channelBindings, setChannelBindings] = useState<ChannelBinding[]>([]);
  const [notificationPreferences, setNotificationPreferences] = useState<NotificationPreference[]>([]);
  const [attendanceCorrections, setAttendanceCorrections] = useState<AttendanceCorrection[]>([]);
  const [message, setMessage] = useState('');
  const [messageTone, setMessageTone] = useState<Tone>('info');
  const [position, setPosition] = useState<{ latitude: number; longitude: number; accuracy: number } | null>(null);
  const [selfie, setSelfie] = useState<File | null>(null);
  const [geofenceId, setGeofenceId] = useState<string | undefined>();
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);

  function notify(text: string, tone: Tone = 'info') {
    setMessage(text);
    setMessageTone(tone);
  }

  async function api(path: string, options: RequestInit = {}) {
    const response = await employeeAuthFetch(`${API}${path}`, token, {
      ...options,
      headers: {
        'Content-Type': 'application/json',
        ...(options.headers ?? {}),
      },
    });
    const data = await response.json();
    if (!response.ok) {
      throw new Error(Array.isArray(data.message) ? data.message.join(', ') : data.message ?? 'Permintaan gagal');
    }
    return data;
  }

  async function login(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const fd = new FormData(event.currentTarget);
    notify('Memeriksa akun…');
    try {
      const response = await fetch(`${API}/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: fd.get('email'),
          password: fd.get('password'),
          twoFactorCode: fd.get('twoFactorCode') || undefined,
        }),
      });
      const data = await response.json();
      if (!response.ok) {
        throw new Error(Array.isArray(data.message) ? data.message.join(', ') : data.message ?? 'Login gagal');
      }
      setToken(data.accessToken);
      storeEmployeeTokens(data.accessToken, data.refreshToken);
      notify('Login berhasil.', 'success');
    } catch (error) {
      notify(error instanceof Error ? error.message : 'Login gagal.', 'error');
    }
  }

  async function load() {
    if (!token) return;
    setLoading(true);
    try {
      const profile = await api('/employee/me');
      const [runtimeManifest, attendancePage, payslipPage, config, leaveTypeData, leaveData, overtimeData, bindings, preferences, corrections] = await Promise.all([
        api('/platform/manifest'),
        api('/employee/me/attendance?limit=31'),
        api('/employee/me/payslips?limit=12'),
        api(`/attendance/config?employeeId=${profile.id}`),
        api('/employee/me/leave-types'),
        api('/employee/me/leave-requests'),
        api('/employee/me/overtime-requests'),
        api('/employee/me/channels'),
        api('/employee/me/notification-preferences'),
        api('/employee/me/attendance-corrections'),
      ]);

      setEmployee(profile);
      setManifest(runtimeManifest);
      setAttendance(attendancePage.items ?? []);
      setPayslips(payslipPage.items ?? []);
      setGeofenceId(config.geofences?.[0]?.id);
      setLeaveTypes(leaveTypeData ?? []);
      setLeaveRequests(leaveData ?? []);
      setOvertimeRequests(overtimeData ?? []);
      setChannelBindings(bindings ?? []);
      setNotificationPreferences(preferences ?? []);
      setAttendanceCorrections(corrections ?? []);
      setMessage('');
    } catch (error) {
      notify(error instanceof Error ? error.message : 'Gagal memuat data', 'error');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    const stored = localStorage.getItem('employeeToken');
    if (stored) setToken(stored);
  }, []);

  useEffect(() => {
    const refreshed = (event: Event) => {
      setToken((event as CustomEvent<{ accessToken: string }>).detail.accessToken);
    };
    const expired = () => {
      setToken('');
      clearEmployeeTokens();
    };

    window.addEventListener('toko360:employee-auth-refreshed', refreshed);
    window.addEventListener('toko360:employee-auth-expired', expired);
    return () => {
      window.removeEventListener('toko360:employee-auth-refreshed', refreshed);
      window.removeEventListener('toko360:employee-auth-expired', expired);
    };
  }, []);

  useEffect(() => {
    void load();
  }, [token]);

  function locate() {
    notify('Mengambil lokasi perangkat…');
    navigator.geolocation.getCurrentPosition(
      ({ coords }) => {
        setPosition({
          latitude: coords.latitude,
          longitude: coords.longitude,
          accuracy: coords.accuracy,
        });
        notify('Lokasi berhasil diambil.', 'success');
      },
      (error) => notify(`Lokasi gagal: ${error.message}`, 'error'),
      { enableHighAccuracy: true, timeout: 15000 },
    );
  }

  async function record(eventType: 'CHECK_IN' | 'CHECK_OUT') {
    if (!employee) return;
    if (!position) {
      notify('Ambil lokasi terlebih dahulu.', 'error');
      return;
    }

    setBusy(true);
    try {
      let photoObjectKey: string | undefined;

      if (selfie) {
        const bytes = new Uint8Array(await selfie.arrayBuffer());
        let binary = '';
        for (const byte of bytes) binary += String.fromCharCode(byte);

        const upload = await api('/attendance/media/upload-local', {
          method: 'POST',
          body: JSON.stringify({
            fileName: selfie.name,
            contentType: selfie.type || 'image/jpeg',
            base64: btoa(binary),
          }),
        });
        photoObjectKey = upload.objectKey;
      }

      await api('/attendance/events', {
        method: 'POST',
        body: JSON.stringify({
          companyId: employee.companyId,
          branchId: employee.branchId,
          employeeId: employee.id,
          eventType,
          method: selfie ? 'SELFIE_GPS' : 'MOBILE_GPS',
          occurredAt: new Date().toISOString(),
          workDate: localWorkDate(),
          operationId: crypto.randomUUID(),
          latitude: position.latitude,
          longitude: position.longitude,
          accuracyMeters: position.accuracy,
          geofenceId,
          photoObjectKey,
        }),
      });

      notify(`${eventType === 'CHECK_IN' ? 'Masuk' : 'Pulang'} berhasil dicatat.`, 'success');
      setSelfie(null);
      await load();
    } catch (error) {
      notify(error instanceof Error ? error.message : 'Absensi gagal', 'error');
    } finally {
      setBusy(false);
    }
  }

  async function submitLeave(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const fd = new FormData(form);
    setBusy(true);
    try {
      await api('/employee/me/leave-requests', {
        method: 'POST',
        body: JSON.stringify({
          leaveTypeId: fd.get('leaveTypeId'),
          startDate: fd.get('startDate'),
          endDate: fd.get('endDate'),
          reason: fd.get('reason') || undefined,
          documentObjectKey: fd.get('documentObjectKey') || undefined,
        }),
      });
      notify('Pengajuan cuti berhasil dikirim untuk persetujuan.', 'success');
      form.reset();
      await load();
    } catch (error) {
      notify(error instanceof Error ? error.message : 'Pengajuan cuti gagal', 'error');
    } finally {
      setBusy(false);
    }
  }

  async function submitOvertime(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const fd = new FormData(form);
    setBusy(true);
    try {
      await api('/employee/me/overtime-requests', {
        method: 'POST',
        body: JSON.stringify({
          requestedStart: fd.get('requestedStart'),
          requestedEnd: fd.get('requestedEnd'),
          reason: fd.get('reason') || undefined,
        }),
      });
      notify('Pengajuan lembur berhasil dikirim untuk persetujuan.', 'success');
      form.reset();
      await load();
    } catch (error) {
      notify(error instanceof Error ? error.message : 'Pengajuan lembur gagal', 'error');
    } finally {
      setBusy(false);
    }
  }


  async function requestChannelBinding(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget; const fd = new FormData(form);
    setBusy(true);
    try {
      const result = await api('/employee/me/channels/request-verification', { method:'POST', body: JSON.stringify({ channel: fd.get('channel'), externalUserId: fd.get('externalUserId') }) });
      notify(`Kode verifikasi ${String(fd.get('channel'))} sudah diantrikan.${result.developmentCode ? ` Kode development: ${result.developmentCode}` : ''}`, 'success');
      form.reset(); await load();
    } catch (error) { notify(error instanceof Error ? error.message : 'Gagal meminta verifikasi kanal.', 'error'); }
    finally { setBusy(false); }
  }

  async function verifyChannelBinding(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget; const fd = new FormData(form);
    setBusy(true);
    try {
      await api('/employee/me/channels/verify', { method:'POST', body: JSON.stringify({ channel: fd.get('channel'), externalUserId: fd.get('externalUserId'), code: fd.get('code') }) });
      notify('Kanal berhasil diverifikasi.', 'success'); form.reset(); await load();
    } catch (error) { notify(error instanceof Error ? error.message : 'Verifikasi kanal gagal.', 'error'); }
    finally { setBusy(false); }
  }

  async function saveNotificationPreference(channel: 'TELEGRAM'|'WHATSAPP', enabled: boolean) {
    setBusy(true);
    try {
      await api('/employee/me/notification-preferences', { method:'POST', body: JSON.stringify({ eventCode:'PAYSLIP_PUBLISHED', channel, enabled }) });
      notify(`Preferensi ${channel} diperbarui.`, 'success'); await load();
    } catch (error) { notify(error instanceof Error ? error.message : 'Preferensi notifikasi gagal.', 'error'); }
    finally { setBusy(false); }
  }

  async function submitAttendanceCorrection(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget; const fd = new FormData(form);
    const record = attendance.find((item) => item.id === fd.get('attendanceRecordId'));
    if (!record) { notify('Pilih attendance record yang akan dikoreksi.', 'error'); return; }
    const proposedData: Record<string, unknown> = {};
    const firstCheckInAt = String(fd.get('firstCheckInAt') ?? '').trim();
    const lastCheckOutAt = String(fd.get('lastCheckOutAt') ?? '').trim();
    const status = String(fd.get('status') ?? '').trim();
    if (firstCheckInAt) proposedData.firstCheckInAt = new Date(`${record.workDate.slice(0,10)}T${firstCheckInAt}:00`).toISOString();
    if (lastCheckOutAt) proposedData.lastCheckOutAt = new Date(`${record.workDate.slice(0,10)}T${lastCheckOutAt}:00`).toISOString();
    if (status) proposedData.status = status;
    setBusy(true);
    try {
      await api('/employee/me/attendance-corrections', { method:'POST', body: JSON.stringify({ attendanceRecordId: record.id, reason: fd.get('reason'), proposedData }) });
      notify('Koreksi absensi dikirim untuk review HR.', 'success'); form.reset(); await load();
    } catch (error) { notify(error instanceof Error ? error.message : 'Koreksi absensi gagal dikirim.', 'error'); }
    finally { setBusy(false); }
  }

  async function logout() {
    try {
      await api('/auth/logout', { method: 'POST' });
    } catch {
      // Local logout must still complete.
    }
    localStorage.removeItem('employeeToken');
    setToken('');
    setEmployee(null);
    setManifest(null);
    setAttendance([]);
    setPayslips([]);
    setLeaveTypes([]);
    setLeaveRequests([]);
    setOvertimeRequests([]);
    setChannelBindings([]);
    setNotificationPreferences([]);
    setAttendanceCorrections([]);
    setPosition(null);
    setMessage('');
  }

  async function openPayslip(id: string) {
    setBusy(true); notify('Memuat detail slip gaji…');
    try {
      const detail = await api(`/employee/me/payslips/${encodeURIComponent(id)}`) as Payslip | null;
      if (!detail) throw new Error('Slip gaji tidak ditemukan.');
      setSelectedPayslip(detail);
      notify(`Slip ${detail.number} dibuka.`, 'success');
    } catch (error) { notify(error instanceof Error ? error.message : 'Detail slip gaji gagal dimuat.', 'error'); }
    finally { setBusy(false); }
  }

  const metrics = useMemo(() => ({
    records: attendance.length,
    late: attendance.filter((item) => Number(item.lateMinutes) > 0).length,
    payslips: payslips.length,
    pendingLeave: leaveRequests.filter((item) => item.status === 'SUBMITTED').length,
    pendingOvertime: overtimeRequests.filter((item) => item.status === 'SUBMITTED').length,
  }), [attendance, payslips, leaveRequests, overtimeRequests]);

  if (!token) {
    return (
      <main className="login">
        <T360ThemeToggle className="loginThemeToggle" />
        <form onSubmit={login}>
          <span>TOKO360 HR</span>
          <h1>Portal Karyawan</h1>
          <p>Lihat absensi dan slip gaji, lalu lakukan presensi berbasis lokasi sesuai kebijakan perusahaan.</p>
          {message && <div className={`notice ${messageTone}`}>{message}</div>}
          <label>
            Email
            <input name="email" type="email" autoComplete="username" placeholder="Email akun karyawan" required />
          </label>
          <label>
            Password
            <input name="password" type="password" autoComplete="current-password" placeholder="Password" required />
          </label>
          <label>
            Kode 2FA / recovery (jika aktif)
            <input name="twoFactorCode" autoComplete="one-time-code" placeholder="Opsional" />
          </label>
          <button>Masuk</button>
        </form>
      </main>
    );
  }

  const notice = message ? <div className={`notice ${messageTone}`}>{message}</div> : null;

  const attendanceCard = (
    <article className="card attendanceCard">
      <div className="cardHeading">
        <div>
          <small>PRESENSI HARI INI</small>
          <h3>Absensi berbasis lokasi</h3>
        </div>
        <span className={`statusPill ${position ? 'ready' : ''}`}>{position ? 'Lokasi siap' : 'Lokasi belum siap'}</span>
      </div>
      <p className="mutedText">Gunakan GPS dan foto selfie sesuai kebijakan perusahaan. Geofence divalidasi oleh server saat event dikirim.</p>
      <div className="coords">
        {position
          ? `${position.latitude.toFixed(6)}, ${position.longitude.toFixed(6)} · akurasi ${Math.round(position.accuracy)} m`
          : 'Lokasi belum diambil'}
      </div>
      <button disabled={busy} onClick={locate}>Ambil Lokasi</button>
      <label>
        Foto selfie
        <input
          type="file"
          accept="image/*"
          capture="user"
          disabled={busy}
          onChange={(event) => setSelfie(event.target.files?.[0] ?? null)}
        />
      </label>
      <div className="actions">
        <button disabled={busy || loading} onClick={() => void record('CHECK_IN')}>
          {busy ? 'Memproses…' : 'Absen Masuk'}
        </button>
        <button className="secondary" disabled={busy || loading} onClick={() => void record('CHECK_OUT')}>
          {busy ? 'Memproses…' : 'Absen Pulang'}
        </button>
      </div>
      <small>{geofenceId ? 'Geofence cabang aktif dan akan divalidasi server.' : 'Geofence belum dikonfigurasi; lokasi tetap dicatat untuk audit.'}</small>
    </article>
  );

  const payslipList = (
    <article className="card">
      <div className="cardHeading">
        <div>
          <small>PAYROLL SELF-SERVICE</small>
          <h3>Slip Gaji</h3>
        </div>
        <span className="statusPill">{payslips.length} slip</span>
      </div>
      {loading ? (
        <div className="skeletonList"><span /><span /><span /></div>
      ) : payslips.length ? (
        payslips.map((item) => (
          <div className="row" key={item.id}>
            <div>
              <strong>{item.number}</strong>
              <small>{dateLabel(item.createdAt)}</small>
            </div>
            <div className="actions"><b>{rupiah(item.dataSnapshot.netPay)}</b><button type="button" className="secondary" disabled={busy} onClick={() => void openPayslip(item.id)}>Detail</button></div>
          </div>
        ))
      ) : (
        <div className="emptyState">
          <strong>Belum ada slip gaji</strong>
          <small>Slip yang sudah dipublikasikan akan muncul di sini.</small>
        </div>
      )}
      {selectedPayslip && <div className="payslipDetail"><div className="cardHeading"><div><small>DETAIL SLIP</small><h3>{selectedPayslip.number}</h3></div><button type="button" className="secondary" onClick={() => setSelectedPayslip(null)}>Tutup</button></div><div className="payslipMetricGrid"><div><small>Gross pay</small><strong>{rupiah(selectedPayslip.dataSnapshot.grossPay as string | number | undefined)}</strong></div><div><small>Pajak penghasilan</small><strong>{rupiah(selectedPayslip.dataSnapshot.incomeTax as string | number | undefined)}</strong></div><div><small>Net pay</small><strong>{rupiah(selectedPayslip.dataSnapshot.netPay as string | number | undefined)}</strong></div><div><small>Dibuat</small><strong>{dateLabel(selectedPayslip.generatedAt ?? selectedPayslip.createdAt)}</strong></div></div><details className="payslipSnapshot"><summary>Rincian payroll snapshot</summary><pre>{JSON.stringify(selectedPayslip.dataSnapshot, null, 2)}</pre></details></div>}
    </article>
  );

  const leaveCard = (
    <article className="card">
      <div className="cardHeading">
        <div>
          <small>LEAVE SELF-SERVICE</small>
          <h3>Ajukan Cuti / Izin / Sakit</h3>
        </div>
        <span className="statusPill">{metrics.pendingLeave} pending</span>
      </div>
      <form className="formStack" onSubmit={submitLeave}>
        <label>
          Jenis cuti
          <select name="leaveTypeId" required defaultValue="">
            <option value="" disabled>Pilih jenis</option>
            {leaveTypes.map((item) => (
              <option key={item.id} value={item.id}>
                {item.name}{item.annualQuota != null ? ` · kuota ${item.annualQuota} hari` : ''}
              </option>
            ))}
          </select>
        </label>
        <div className="formGrid">
          <label>Tanggal mulai<input name="startDate" type="date" required /></label>
          <label>Tanggal akhir<input name="endDate" type="date" required /></label>
        </div>
        <label>Alasan<input name="reason" placeholder="Alasan pengajuan" /></label>
        <label>Referensi dokumen<input name="documentObjectKey" placeholder="Wajib untuk jenis cuti tertentu" /></label>
        <button disabled={busy || !leaveTypes.length}>{busy ? 'Memproses…' : 'Kirim Pengajuan Cuti'}</button>
      </form>
      <div className="hrTable">
        <div className="hrRow hrHead"><span>Periode</span><span>Hari</span><span>Status</span><span>Jenis</span></div>
        {leaveRequests.slice(0, 12).map((item) => (
          <div className="hrRow" key={item.id}>
            <span>{dateLabel(item.startDate)} – {dateLabel(item.endDate)}</span>
            <span>{String(item.totalDays)}</span>
            <span>{item.status}</span>
            <span>{leaveTypes.find((type) => type.id === item.leaveTypeId)?.name ?? '-'}</span>
          </div>
        ))}
      </div>
    </article>
  );

  const overtimeCard = (
    <article className="card">
      <div className="cardHeading">
        <div>
          <small>OVERTIME SELF-SERVICE</small>
          <h3>Ajukan Lembur</h3>
        </div>
        <span className="statusPill">{metrics.pendingOvertime} pending</span>
      </div>
      <form className="formStack" onSubmit={submitOvertime}>
        <div className="formGrid">
          <label>Mulai<input name="requestedStart" type="datetime-local" required /></label>
          <label>Selesai<input name="requestedEnd" type="datetime-local" required /></label>
        </div>
        <label>Alasan<input name="reason" placeholder="Pekerjaan lembur" /></label>
        <button disabled={busy}>{busy ? 'Memproses…' : 'Kirim Pengajuan Lembur'}</button>
      </form>
      <div className="hrTable">
        <div className="hrRow hrHead"><span>Waktu</span><span>Durasi Disetujui</span><span>Status</span><span>Alasan</span></div>
        {overtimeRequests.slice(0, 12).map((item) => (
          <div className="hrRow" key={item.id}>
            <span>{dateTimeLabel(item.requestedStart)} – {dateTimeLabel(item.requestedEnd)}</span>
            <span>{item.approvedMinutes == null ? '-' : `${item.approvedMinutes} menit`}</span>
            <span>{item.status}</span>
            <span>{item.reason ?? '-'}</span>
          </div>
        ))}
      </div>
    </article>
  );

  const attendanceHistory = (
    <article className="card">
      <div className="cardHeading">
        <div>
          <small>31 HARI TERAKHIR</small>
          <h3>Riwayat Absensi</h3>
        </div>
        <span className="statusPill">{attendance.length} rekaman</span>
      </div>
      {loading ? (
        <div className="skeletonList"><span /><span /><span /><span /></div>
      ) : attendance.length ? (
        <div className="hrTable">
          <div className="hrRow hrHead"><span>Tanggal</span><span>Masuk</span><span>Pulang</span><span>Status</span></div>
          {attendance.map((item) => (
            <div className="hrRow" key={item.id}>
              <span>{dateLabel(item.workDate)}</span>
              <span>{item.firstCheckInAt ? new Date(item.firstCheckInAt).toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' }) : '-'}</span>
              <span>{item.lastCheckOutAt ? new Date(item.lastCheckOutAt).toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' }) : '-'}</span>
              <span>{item.status}{item.lateMinutes ? ` · terlambat ${item.lateMinutes} menit` : ''}</span>
            </div>
          ))}
        </div>
      ) : (
        <div className="emptyState">
          <strong>Belum ada riwayat</strong>
          <small>Data presensi akan tampil setelah event pertama tercatat.</small>
        </div>
      )}
    </article>
  );


  const correctionCard = (
    <article className="card">
      <div className="cardHeading"><div><small>ATTENDANCE CORRECTION</small><h3>Ajukan Koreksi Absensi</h3></div><span className="statusPill">{attendanceCorrections.filter((item) => item.status === 'SUBMITTED').length} menunggu</span></div>
      <p className="mutedText">Koreksi tidak langsung mengubah absensi. HR wajib review; record yang sudah dikunci payroll akan ditolak dan harus masuk payroll adjustment.</p>
      <form className="formStack" onSubmit={submitAttendanceCorrection}>
        <label>Rekaman<select name="attendanceRecordId" required defaultValue=""><option value="" disabled>Pilih tanggal</option>{attendance.map(item=><option key={item.id} value={item.id}>{dateLabel(item.workDate)} · {item.status}</option>)}</select></label>
        <div className="formGrid"><label>Jam masuk usulan<input name="firstCheckInAt" type="time" /></label><label>Jam pulang usulan<input name="lastCheckOutAt" type="time" /></label></div>
        <label>Status usulan<select name="status" defaultValue=""><option value="">Tidak diubah</option><option value="PRESENT">Hadir</option><option value="LATE">Terlambat</option><option value="EARLY_LEAVE">Pulang cepat</option><option value="SICK">Sakit</option><option value="LEAVE">Cuti / izin yang disetujui</option><option value="ABSENT">Tidak hadir</option><option value="OFF_DAY">Hari libur</option><option value="INCOMPLETE">Belum lengkap</option><option value="NEEDS_REVIEW">Perlu review</option></select></label>
        <label>Alasan<textarea name="reason" minLength={5} required rows={3} /></label><button disabled={busy}>Kirim koreksi</button>
      </form>
      <div className="hrTable"><div className="hrRow hrHead"><span>Diajukan</span><span>Alasan</span><span>Status</span><span>Usulan</span></div>{attendanceCorrections.slice(0,12).map(item=><div className="hrRow" key={item.id}><span>{dateTimeLabel(item.createdAt)}</span><span>{item.reason}</span><span>{item.status}</span><span>{JSON.stringify(item.proposedData)}</span></div>)}</div>
    </article>
  );

  const channelCard = (
    <article className="card">
      <div className="cardHeading"><div><small>VERIFIED DELIVERY</small><h3>Telegram & WhatsApp</h3></div><span className="statusPill">{channelBindings.filter((item)=>item.verifiedAt).length} verified</span></div>
      <p className="mutedText">Slip gaji hanya dikirim melalui secure link ke binding yang sudah diverifikasi. Token/kredensial provider tidak pernah disimpan di portal.</p>
      <form className="formStack" onSubmit={requestChannelBinding}><label>Kanal<select name="channel" required defaultValue="TELEGRAM"><option value="TELEGRAM">Telegram</option><option value="WHATSAPP">WhatsApp</option></select></label><label>Chat ID / nomor E.164<input name="externalUserId" required /></label><button disabled={busy}>Kirim kode verifikasi</button></form>
      <form className="formStack" onSubmit={verifyChannelBinding}><label>Kanal<select name="channel" required defaultValue="TELEGRAM"><option value="TELEGRAM">Telegram</option><option value="WHATSAPP">WhatsApp</option></select></label><label>Chat ID / nomor yang sama<input name="externalUserId" required /></label><label>Kode 6 digit<input name="code" inputMode="numeric" minLength={6} maxLength={6} required /></label><button disabled={busy}>Verifikasi kanal</button></form>
      <div className="hrTable"><div className="hrRow hrHead"><span>Kanal</span><span>Tujuan</span><span>Verifikasi</span><span>Slip gaji</span></div>{channelBindings.map(binding=>{const pref=notificationPreferences.find(item=>item.eventCode==='PAYSLIP_PUBLISHED'&&item.channel===binding.channel);const enabled=pref?.enabled??true;return <div className="hrRow" key={binding.id}><span>{binding.channel}</span><span>{binding.externalUserId??'-'}</span><span>{binding.verifiedAt?'VERIFIED':'PENDING'}</span><span>{binding.verifiedAt&&['TELEGRAM','WHATSAPP'].includes(binding.channel)?<button className="secondary" type="button" disabled={busy} onClick={()=>void saveNotificationPreference(binding.channel as 'TELEGRAM'|'WHATSAPP',!enabled)}>{enabled?'Aktif':'Nonaktif'}</button>:'-'}</span></div>;})}</div>
    </article>
  );

  let content: React.ReactNode;

  switch (initialView) {
    case 'attendance':
      content = (
        <>
          {notice}
          <section className="statGrid" aria-busy={loading}>
            <article className="pStat"><small>REKAMAN 31 HARI</small><strong>{loading ? '—' : metrics.records}</strong></article>
            <article className="pStat"><small>TERLAMBAT</small><strong>{loading ? '—' : metrics.late}</strong></article>
            <article className="pStat"><small>LOKASI PRESENSI</small><strong>{position ? 'Siap' : 'Belum'}</strong></article>
          </section>
          <section className="singleWorkspace">{attendanceCard}</section>
        </>
      );
      break;
    case 'leave':
      content = <>{notice}<section className="singleWorkspace">{leaveCard}</section></>;
      break;
    case 'overtime':
      content = <>{notice}<section className="singleWorkspace">{overtimeCard}</section></>;
      break;
    case 'payslips':
      content = <>{notice}<section className="singleWorkspace">{payslipList}</section></>;
      break;
    case 'history':
      content = <>{notice}<section className="singleWorkspace">{attendanceHistory}{correctionCard}</section></>;
      break;
    case 'profile':
      content = (
        <>
          {notice}
          <section className="profileGrid">
            <article className="card profileCard">
              <small>IDENTITAS EMPLOYEE</small>
              <h3>{employee?.fullName ?? 'Karyawan'}</h3>
              <dl>
                <div><dt>Nomor karyawan</dt><dd>{employee?.employeeNumber ?? '-'}</dd></div>
                <div><dt>Company</dt><dd>{employee?.companyId ?? '-'}</dd></div>
                <div><dt>Branch</dt><dd>{employee?.branchId ?? 'Tidak terikat cabang'}</dd></div>
              </dl>
            </article>
            <article className="card">
              <small>SELF-SERVICE SECURITY</small>
              <h3>Akses saya</h3>
              <p className="mutedText">Portal hanya membaca data employee yang terikat pada sesi autentikasi. Scope employee, tenant, branch, payslip, absensi, cuti, dan lembur tetap divalidasi oleh backend.</p>
            </article>
          </section>
          <section className="singleWorkspace">{channelCard}</section>
        </>
      );
      break;
    case 'home':
    default:
      content = (
        <>
          {notice}
          <section className="welcomeDeck">
            <article>
              <small>EMPLOYEE PORTAL</small>
              <h2>Employee Portal authenticated self-service</h2>
              <p>Satu tempat untuk presensi, cuti, lembur, slip gaji, dan riwayat kerja tanpa mencampur workflow.</p>
            </article>
          </section>
          <section className="statGrid" aria-busy={loading}>
            <article className="pStat"><small>REKAMAN 31 HARI</small><strong>{loading ? '—' : metrics.records}</strong></article>
            <article className="pStat"><small>TERLAMBAT</small><strong>{loading ? '—' : metrics.late}</strong></article>
            <article className="pStat"><small>SLIP GAJI TERSEDIA</small><strong>{loading ? '—' : metrics.payslips}</strong></article>
            <article className="pStat"><small>PENGAJUAN PENDING</small><strong>{metrics.pendingLeave + metrics.pendingOvertime}</strong></article>
          </section>
          <section className="dashboardGrid">
            {attendanceCard}
            {payslipList}
          </section>
        </>
      );
      break;
  }

  return (
    <EmployeePortalShell
      activeView={initialView}
      employeeName={employee?.fullName}
      employeeNumber={employee?.employeeNumber}
      companyName={manifest?.company?.name ?? 'Toko360'}
      branchName={manifest?.branch?.name ?? manifest?.branch?.code ?? 'Cabang aktif'}
      loading={loading}
      onLogout={() => void logout()}
    >
      <StaffMemoWidget token={token} />
      {content}
    </EmployeePortalShell>
  );
}
