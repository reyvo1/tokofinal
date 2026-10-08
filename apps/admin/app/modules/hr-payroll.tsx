'use client';
import { authFetch } from '../auth-fetch';
// Modul HR & Payroll — karyawan, periode, payroll run, pembayaran, dan kewajiban payroll.
import { useEffect, useMemo, useState } from 'react';
import { usePermissions } from '../permissions';
import { canReadHrPath, shiftStatusPayload, payrollRulePayload } from '../hr-api-contract';
import { readOptional } from '../read-path-contract';
import { Panel, Table, StatusChip, rupiah, tanggal } from '../ui';

const API = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000/api/v1';

type Employee = { id: string; employeeNumber: string; fullName: string; isActive?: boolean; departmentId?: string | null; positionId?: string | null };
type WorkShift = { id: string; code: string; name: string; startMinute: number; endMinute: number; isActive: boolean };
type EmployeeSchedule = { id: string; employeeId: string; shiftId?: string | null; workDate: string; isDayOff: boolean; notes?: string | null };
type AttendancePolicy = { id: string; code: string; name: string; allowedMethods: string[]; requirePhoto: boolean; requireLocation: boolean; requireLiveness?: boolean; allowOutsideGeofence?: boolean; maxLocationAccuracyMeters?: number | null; duplicateWindowSeconds?: number | null; offlineAllowed?: boolean; isActive: boolean };
type AttendanceCorrection = { id: string; employeeId: string; attendanceRecordId?: string | null; reason: string; status: string; proposedData: Record<string, unknown>; createdAt: string };
type AttendanceDevice = { id: string; code: string; name: string; deviceType: string; vendor?: string | null; status: string };
type AttendanceGeofence = { id: string; code: string; name: string; latitude: string | number; longitude: string | number; radiusMeters: number; allowedAccuracyMeters?: number | null; isActive: boolean };
type BiometricCredential = { id: string; employeeId: string; attendanceDeviceId?: string | null; biometricType: string; deviceUserCode: string; status: string; revokedAt?: string | null };
type AttendanceRecord = { id: string; employeeId: string; workDate: string; status?: string; checkInAt?: string | null; checkOutAt?: string | null; workedMinutes?: number | null; lateMinutes?: number | null; overtimeMinutes?: number | null };
type CursorPageInfo = { hasMore?: boolean; nextCursor?: string | null };
type CursorRows<T> = { items: T[]; pageInfo?: CursorPageInfo };

type Department = { id: string; code: string; name: string };
type Position = { id: string; code: string; name: string; departmentId?: string | null };
type Account = { id: string; code: string; name: string; isActive?: boolean };
type PayrollAccountingMapping = { id: string; componentCode: string; debitAccountId?: string | null; creditAccountId?: string | null; isActive: boolean };
type EmployeeProfiles = { employeeId: string; supportedTaxMethods: string[]; taxProfiles: Array<{ id: string; taxStatusCode?: string | null; taxMethod: string; effectiveFrom: string; effectiveTo?: string | null }>; socialSecurityProfiles: Array<{ id: string; wageBase?: string | number | null; programs: string[]; effectiveFrom: string; effectiveTo?: string | null }> };
type PayrollPeriod = { id: string; code: string; year: number; month: number; startDate: string; endDate: string; status: string };
type RuleSet = { id: string; code: string; name: string; version: number; status: string; effectiveFrom: string; effectiveTo?: string | null; legalReference?: string | null; calculationMode?: string; parameters?: Record<string, unknown> };
type PayrollComponent = { id: string; code: string; name: string; componentType: string; calculationType: string; defaultAmount?: string | number | null; taxable?: boolean; affectsGross?: boolean; affectsNet?: boolean; proratable?: boolean; attendanceBased?: boolean; isActive?: boolean };
type EmployeeComponent = { id: string; employeeId: string; componentId: string; amount?: string | number | null; percentage?: string | number | null; effectiveFrom: string; effectiveTo?: string | null; isActive: boolean };
type PayrollRun = {
  id: string; number: string; status: string; payrollPeriodId: string; taxRuleSetId?: string | null; socialSecurityRuleSetId?: string | null;
  employeeCount: number; grossTotal: string | number; deductionTotal: string | number; taxTotal: string | number; employerContributionTotal: string | number; netTotal: string | number; createdAt: string;
  adjustmentOfRunId?: string | null; adjustmentSequence?: number; adjustmentReason?: string | null; adjustmentPostingDate?: string | null;
};
type PayrollResult = { id: string; employeeId: string; status: string; grossPay: string | number; taxableIncome: string | number; incomeTax: string | number; employeeContribution: string | number; netPay: string | number };
type PayrollPayment = { id: string; employeeId: string; amount: string | number; status: string; paymentMethod: string; direction?: 'OUTBOUND' | 'RECOVERY' | string; settlementAccountCode?: string | null; paidAt?: string | null };
type LiabilityBucket = { recognized: string; paid: string; pending: string; outstanding: string; availableToPay?: string };
type PayrollLiability = { payrollRunId: string; number: string; status: string; salary: LiabilityBucket; tax: LiabilityBucket; socialAndOther: LiabilityBucket; recovery?: LiabilityBucket };
type LeaveRequest = { id: string; employeeId: string; leaveTypeId: string; startDate: string; endDate: string; totalDays: string | number; reason?: string | null; status: string; createdAt: string };
type OvertimeRequest = { id: string; employeeId: string; requestedStart: string; requestedEnd: string; approvedMinutes?: number | null; reason?: string | null; status: string; createdAt: string };
type LeaveType = { id: string; code: string; name: string; paid?: boolean | null; annualQuota?: string | number | null; requiresDocument?: boolean | null; isActive?: boolean | null };

function monthParts(date = new Date()) {
  const year = date.getFullYear();
  const month = date.getMonth() + 1;
  const mm = String(month).padStart(2, '0');
  const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return { year, month, mm, startDate: `${year}-${mm}-01`, endDate: `${year}-${mm}-${String(lastDay).padStart(2, '0')}` };
}

function requestKey(prefix: string, id: string, account: string) {
  return `${prefix}:${id}:${account}`;
}

function appendUniqueById<T extends { id: string }>(current: T[], incoming: T[]) {
  const seen = new Set(current.map((row) => row.id));
  return [...current, ...incoming.filter((row) => !seen.has(row.id))];
}

function minuteLabel(value: number) {
  const h = Math.floor(value / 60) % 24;
  const m = value % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}
function minuteValue(value: string) {
  const [h, m] = value.split(':').map(Number);
  return h * 60 + m;
}

function R2HrConfiguration({ token, employees, mode }: { token: string; employees: Employee[]; mode: 'attendance' | 'payroll' | 'compliance' | string }) {
  const { canAll, identity } = usePermissions(token);
  const [shifts, setShifts] = useState<WorkShift[]>([]);
  const [schedules, setSchedules] = useState<EmployeeSchedule[]>([]);
  const [policies, setPolicies] = useState<AttendancePolicy[]>([]);
  const [corrections, setCorrections] = useState<AttendanceCorrection[]>([]);
  const [devices, setDevices] = useState<AttendanceDevice[]>([]);
  const [geofences, setGeofences] = useState<AttendanceGeofence[]>([]);
  const [biometrics, setBiometrics] = useState<BiometricCredential[]>([]);
  const [departments, setDepartments] = useState<Department[]>([]);
  const [positions, setPositions] = useState<Position[]>([]);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [mappings, setMappings] = useState<PayrollAccountingMapping[]>([]);
  const [profileEmployeeId, setProfileEmployeeId] = useState('');
  const [profiles, setProfiles] = useState<EmployeeProfiles | null>(null);
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const [attendanceEmployeeId, setAttendanceEmployeeId] = useState('');
  const [attendanceRecords, setAttendanceRecords] = useState<AttendanceRecord[]>([]);

  async function api<T>(path: string, init?: RequestInit): Promise<T> {
    const response = await authFetch(`${API}${path}`, token, {
      ...init,
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}`, ...(init?.headers ?? {}) },
    });
    const data = await response.json();
    if (!response.ok) throw new Error(`HTTP ${response.status}: ${Array.isArray(data.message) ? data.message.join(', ') : data.message ?? 'Permintaan HR gagal.'}`);
    return data as T;
  }


  async function refreshAttendance() {
    const from = new Date(); from.setDate(1);
    const to = new Date(from.getFullYear(), from.getMonth() + 1, 0);
    const [shiftRows, scheduleRows, policyRows, correctionRows, deviceRows, geofenceRows, biometricRows, departmentRows, positionRows] = await Promise.all([
      readOptional(identity, '/attendance/work-shifts', [] as WorkShift[], (path) => api<WorkShift[]>(path)),
      readOptional(identity, `/attendance/schedules?from=${from.toLocaleDateString('en-CA')}&to=${to.toLocaleDateString('en-CA')}`, [] as EmployeeSchedule[], (path) => api<EmployeeSchedule[]>(path)),
      readOptional(identity, '/attendance/policies', [] as AttendancePolicy[], (path) => api<AttendancePolicy[]>(path)),
      readOptional(identity, '/attendance/corrections', [] as AttendanceCorrection[], (path) => api<AttendanceCorrection[]>(path)),
      readOptional(identity, '/attendance/devices', [] as AttendanceDevice[], (path) => api<AttendanceDevice[]>(path)),
      readOptional(identity, '/attendance/geofences', [] as AttendanceGeofence[], (path) => api<AttendanceGeofence[]>(path)),
      readOptional(identity, '/attendance/biometrics', [] as BiometricCredential[], (path) => api<BiometricCredential[]>(path)),
      readOptional(identity, '/hr/departments', [] as Department[], (path) => api<Department[]>(path)),
      readOptional(identity, '/hr/positions', [] as Position[], (path) => api<Position[]>(path)),
    ]);
    setShifts(shiftRows); setSchedules(scheduleRows); setPolicies(policyRows); setCorrections(correctionRows);
    setDevices(deviceRows); setGeofences(geofenceRows); setBiometrics(biometricRows); setDepartments(departmentRows); setPositions(positionRows);
  }

  async function refreshPayrollConfig(employeeId = profileEmployeeId || employees[0]?.id || '') {
    const [mappingRows, accountRows] = await Promise.all([
      readOptional(identity, '/payroll/accounting-mappings', [] as PayrollAccountingMapping[], (path) => api<PayrollAccountingMapping[]>(path)),
      readOptional(identity, '/accounting-core/accounts', [] as Account[], (path) => api<Account[]>(path)),
    ]);
    setMappings(mappingRows); setAccounts(accountRows);
    if (employeeId && canAll('payroll.view')) { setProfileEmployeeId(employeeId); setProfiles(await readOptional(identity, `/payroll/employee-profiles/${employeeId}`, null as EmployeeProfiles | null, (path) => api<EmployeeProfiles>(path))); } else { setProfiles(null); }
  }

  useEffect(() => {
    const load = mode === 'attendance' ? refreshAttendance() : refreshPayrollConfig();
    load.catch((error) => setMessage(error instanceof Error ? error.message : 'Gagal memuat konfigurasi HR.'));
  }, [token, mode]);

  async function loadAttendanceEmployee(employeeId: string) {
    setAttendanceEmployeeId(employeeId);
    if (!employeeId) { setAttendanceRecords([]); return; }
    try {
      const data = await api<CursorRows<AttendanceRecord> | AttendanceRecord[]>(`/attendance/employee?employeeId=${encodeURIComponent(employeeId)}&limit=50`);
      setAttendanceRecords(Array.isArray(data) ? data : data.items ?? []);
    } catch (error) { setMessage(error instanceof Error ? error.message : 'Gagal memuat histori absensi karyawan.'); }
  }

  async function toggleAttendancePolicy(policy: AttendancePolicy) {
    await run(async () => {
      await api(`/attendance/policies/${policy.id}`, { method: 'PATCH', body: JSON.stringify({
        code: policy.code, name: policy.name, allowedMethods: policy.allowedMethods,
        requirePhoto: policy.requirePhoto, requireLocation: policy.requireLocation,
        requireLiveness: policy.requireLiveness ?? false, allowOutsideGeofence: policy.allowOutsideGeofence ?? false,
        maxLocationAccuracyMeters: policy.maxLocationAccuracyMeters ?? undefined,
        duplicateWindowSeconds: policy.duplicateWindowSeconds ?? undefined,
        offlineAllowed: policy.offlineAllowed ?? false, isActive: !policy.isActive,
      }) });
      await refreshAttendance();
      setMessage(policy.isActive ? 'Attendance policy dinonaktifkan.' : 'Attendance policy diaktifkan.');
    });
  }

  async function run(work: () => Promise<void>) {
    setBusy(true); setMessage('');
    try { await work(); } catch (error) { setMessage(error instanceof Error ? error.message : 'Operasi HR gagal.'); }
    finally { setBusy(false); }
  }

  if (mode === 'attendance') return <>
    <Panel eyebrow="R2 · ROSTER" title="Shift & Jadwal Karyawan" badge={`${shifts.length} shift · ${schedules.length} roster bulan ini`}>
      <form className="inline" onSubmit={(event) => { event.preventDefault(); const form = event.currentTarget; const fd = new FormData(form); void run(async () => {
        await api('/attendance/work-shifts', { method:'POST', body: JSON.stringify({ code:fd.get('code'), name:fd.get('name'), startMinute:minuteValue(String(fd.get('start'))), endMinute:minuteValue(String(fd.get('end'))), crossesMidnight: Boolean(fd.get('crossesMidnight')), breakMinutes:Number(fd.get('breakMinutes') || 0) }) });
        form.reset(); await refreshAttendance(); setMessage('WorkShift berhasil dibuat.');
      }); }}>
        <label>Kode<input name="code" required placeholder="SHIFT-PAGI" /></label><label>Nama<input name="name" required placeholder="Shift Pagi" /></label>
        <label>Mulai<input name="start" type="time" required defaultValue="08:00" /></label><label>Selesai<input name="end" type="time" required defaultValue="17:00" /></label>
        <label>Istirahat (menit)<input name="breakMinutes" type="number" min="0" defaultValue="60" /></label><label className="checkboxLabel"><input name="crossesMidnight" type="checkbox" />Lintas tengah malam</label>
        <button disabled={!canAll('attendance.manage') || busy}>Tambah shift</button>
      </form>
      <Table head={['Kode','Nama','Jam','Status','Aksi']} rows={shifts.map((shift) => [shift.code, shift.name, `${minuteLabel(shift.startMinute)}–${minuteLabel(shift.endMinute)}`, <StatusChip status={shift.isActive?'ACTIVE':'INACTIVE'} />, <button type="button" className="secondary" disabled={!canAll('attendance.manage') || busy} onClick={() => void run(async()=>{ await api(`/attendance/work-shifts/${shift.id}`, {method:'PATCH',body:JSON.stringify(shiftStatusPayload(shift))}); await refreshAttendance(); })}>{shift.isActive?'Nonaktifkan':'Aktifkan'}</button>])} empty="Belum ada WorkShift." />
      <form className="inline" onSubmit={(event) => { event.preventDefault(); const form = event.currentTarget; const fd = new FormData(form); void run(async()=>{ await api('/attendance/schedules',{method:'POST',body:JSON.stringify({employeeId:fd.get('employeeId'),workDate:fd.get('workDate'),shiftId:fd.get('isDayOff')?undefined:fd.get('shiftId'),isDayOff:Boolean(fd.get('isDayOff')),notes:fd.get('notes')||undefined})}); await refreshAttendance(); setMessage('Roster diperbarui.'); }); }}>
        <label>Karyawan<select name="employeeId" required defaultValue=""><option value="" disabled>Pilih</option>{employees.map(e=><option key={e.id} value={e.id}>{e.employeeNumber} · {e.fullName}</option>)}</select></label>
        <label>Tanggal<input type="date" name="workDate" required /></label><label>Shift<select name="shiftId" defaultValue=""><option value="">Pilih shift</option>{shifts.filter(s=>s.isActive).map(s=><option key={s.id} value={s.id}>{s.code} · {s.name}</option>)}</select></label>
        <label className="checkboxLabel"><input type="checkbox" name="isDayOff" />Hari libur</label><label>Catatan<input name="notes" /></label><button disabled={!canAll('attendance.manage') || busy}>Simpan roster</button>
      </form>
      <Table head={['Tanggal','Karyawan','Shift','Status']} rows={schedules.slice(0,100).map(row=>[tanggal(row.workDate), employees.find(e=>e.id===row.employeeId)?.fullName ?? row.employeeId, row.shiftId ? shifts.find(s=>s.id===row.shiftId)?.name ?? row.shiftId : '-', row.isDayOff?'OFF':'WORK'])} empty="Belum ada roster bulan ini." />
    </Panel>

    <section className="grid2">
      <Panel eyebrow="R2 · POLICY" title="Attendance Policy" badge={`${policies.length} policy`}>
        <form className="formGrid" onSubmit={(event)=>{event.preventDefault(); const form = event.currentTarget; const fd = new FormData(form); void run(async()=>{ await api('/attendance/policies',{method:'POST',body:JSON.stringify({code:fd.get('code'),name:fd.get('name'),allowedMethods:String(fd.get('allowedMethods')||'').split(',').map(v=>v.trim()).filter(Boolean),requirePhoto:Boolean(fd.get('requirePhoto')),requireLocation:Boolean(fd.get('requireLocation')),allowOutsideGeofence:Boolean(fd.get('allowOutsideGeofence')),maxLocationAccuracyMeters:Number(fd.get('accuracy')||0)||undefined})}); form.reset(); await refreshAttendance(); setMessage('AttendancePolicy berhasil dibuat.'); });}}>
          <label>Kode<input name="code" required /></label><label>Nama<input name="name" required /></label><label>Metode (koma)<input name="allowedMethods" defaultValue="MOBILE_GPS,SELFIE_GPS,FINGERPRINT" required /></label><label>Akurasi maks (m)<input name="accuracy" type="number" min="1" defaultValue="100" /></label>
          <label className="checkboxLabel"><input name="requirePhoto" type="checkbox" />Wajib foto</label><label className="checkboxLabel"><input name="requireLocation" type="checkbox" />Wajib lokasi</label><label className="checkboxLabel"><input name="allowOutsideGeofence" type="checkbox" />Izinkan luar geofence</label><button disabled={!canAll('attendance.manage') || busy}>Tambah policy</button>
        </form>
        <Table head={['Kode','Nama','Metode','Status','Aksi']} rows={policies.map(p=>[p.code,p.name,Array.isArray(p.allowedMethods)?p.allowedMethods.join(', '):String(p.allowedMethods),<StatusChip status={p.isActive?'ACTIVE':'INACTIVE'} />,<button type="button" className="secondary" disabled={!canAll('attendance.manage') || busy} onClick={()=>void toggleAttendancePolicy(p)}>{p.isActive?'Nonaktifkan':'Aktifkan'}</button>])} empty="Belum ada policy." />
      </Panel>
      <Panel eyebrow="R2 · PLACEMENT" title="Effective-dated Assignment" badge="Tenant-safe">
        <form className="formGrid" onSubmit={(event)=>{event.preventDefault(); const form = event.currentTarget; const fd = new FormData(form); void run(async()=>{ await api('/hr/assignments',{method:'POST',body:JSON.stringify({employeeId:fd.get('employeeId'),departmentId:fd.get('departmentId')||undefined,positionId:fd.get('positionId')||undefined,managerEmployeeId:fd.get('managerEmployeeId')||undefined,effectiveFrom:fd.get('effectiveFrom'),effectiveTo:fd.get('effectiveTo')||undefined,isPrimary:true})}); form.reset(); setMessage('EmployeeAssignment berhasil dibuat.'); });}}>
          <label>Karyawan<select name="employeeId" required defaultValue=""><option value="" disabled>Pilih</option>{employees.map(e=><option key={e.id} value={e.id}>{e.fullName}</option>)}</select></label>
          <label>Department<select name="departmentId" defaultValue=""><option value="">-</option>{departments.map(d=><option key={d.id} value={d.id}>{d.name}</option>)}</select></label>
          <label>Position<select name="positionId" defaultValue=""><option value="">-</option>{positions.map(x=><option key={x.id} value={x.id}>{x.name}</option>)}</select></label>
          <label>Manager<select name="managerEmployeeId" defaultValue=""><option value="">-</option>{employees.map(e=><option key={e.id} value={e.id}>{e.fullName}</option>)}</select></label>
          <label>Berlaku dari<input name="effectiveFrom" type="date" required /></label><label>Sampai<input name="effectiveTo" type="date" /></label><button disabled={!canAll('employee.manage') || busy}>Tambah assignment</button>
        </form>
        <div className="notice">Primary assignment tidak boleh overlap. Assignment aktif menyinkronkan branch/department/position/manager pada Employee master.</div>
      </Panel>
    </section>

    <Panel eyebrow="R2 · ATTENDANCE CORRECTION" title="Koreksi Absensi" badge={`${corrections.filter(c=>c.status==='SUBMITTED').length} menunggu`}>
      <Table head={['Karyawan','Alasan','Usulan','Status','Aksi']} rows={corrections.map(c=>[employees.find(e=>e.id===c.employeeId)?.fullName ?? c.employeeId,c.reason,<code>{JSON.stringify(c.proposedData)}</code>,<StatusChip status={c.status} />,c.status==='SUBMITTED'?<div className="rowActions"><button type="button" disabled={!canAll('attendance.approve') || busy} onClick={()=>void run(async()=>{await api(`/attendance/corrections/${c.id}/review`,{method:'POST',body:JSON.stringify({status:'APPROVED',reviewNotes:'Disetujui operator HR'})});await refreshAttendance();})}>Approve</button><button type="button" className="secondary" disabled={!canAll('attendance.approve') || busy} onClick={()=>void run(async()=>{await api(`/attendance/corrections/${c.id}/review`,{method:'POST',body:JSON.stringify({status:'REJECTED',reviewNotes:'Ditolak operator HR'})});await refreshAttendance();})}>Reject</button></div>:'-'])} empty="Tidak ada koreksi absensi." />
      <div className="notice">Approval ditolak otomatis bila attendance record sudah dikunci payroll; periode terkunci harus dikoreksi lewat payroll adjustment.</div>
    </Panel>

    <section className="grid2">
      <Panel eyebrow="R2 · DEVICE" title="Attendance Devices" badge={`${devices.length} device`}>
        <form className="formGrid" onSubmit={(event)=>{event.preventDefault();const form = event.currentTarget; const fd = new FormData(form);void run(async()=>{await api('/attendance/devices',{method:'POST',body:JSON.stringify({code:fd.get('code'),name:fd.get('name'),deviceType:fd.get('deviceType'),vendor:fd.get('vendor')||undefined,serialNumber:fd.get('serialNumber')||undefined})});form.reset();await refreshAttendance();});}}>
          <label>Kode<input name="code" required /></label><label>Nama<input name="name" required /></label><label>Jenis<input name="deviceType" required defaultValue="FINGERPRINT" /></label><label>Vendor<input name="vendor" /></label><label>Serial<input name="serialNumber" /></label><button disabled={!canAll('attendance.manage') || busy}>Daftarkan device</button>
        </form>
        <Table head={['Kode','Nama','Jenis','Status','Aksi']} rows={devices.map(d=>[d.code,d.name,d.deviceType,<StatusChip status={d.status}/>,<button type="button" className="secondary" disabled={!canAll('attendance.manage') || busy} onClick={()=>void run(async()=>{await api(`/attendance/devices/${d.id}`,{method:'PATCH',body:JSON.stringify({status:d.status==='ACTIVE'?'INACTIVE':'ACTIVE'})});await refreshAttendance();})}>{d.status==='ACTIVE'?'Nonaktifkan':'Aktifkan'}</button>])} empty="Belum ada device." />
      </Panel>
      <Panel eyebrow="R2 · GEOFENCE" title="Geofence" badge={`${geofences.length} area`}>
        <form className="formGrid" onSubmit={(event)=>{event.preventDefault();const form = event.currentTarget; const fd = new FormData(form);void run(async()=>{await api('/attendance/geofences',{method:'POST',body:JSON.stringify({code:fd.get('code'),name:fd.get('name'),latitude:Number(fd.get('latitude')),longitude:Number(fd.get('longitude')),radiusMeters:Number(fd.get('radiusMeters')),allowedAccuracyMeters:Number(fd.get('accuracy')||0)||undefined})});form.reset();await refreshAttendance();});}}>
          <label>Kode<input name="code" required /></label><label>Nama<input name="name" required /></label><label>Latitude<input name="latitude" type="number" step="any" required /></label><label>Longitude<input name="longitude" type="number" step="any" required /></label><label>Radius m<input name="radiusMeters" type="number" min="5" required /></label><label>Akurasi m<input name="accuracy" type="number" min="1" /></label><button disabled={!canAll('attendance.manage') || busy}>Tambah geofence</button>
        </form>
        <Table head={['Kode','Nama','Radius','Status','Aksi']} rows={geofences.map(g=>[g.code,g.name,`${g.radiusMeters} m`,<StatusChip status={g.isActive?'ACTIVE':'INACTIVE'} />,<button type="button" className="secondary" disabled={!canAll('attendance.manage') || busy} onClick={()=>void run(async()=>{await api(`/attendance/geofences/${g.id}`,{method:'PATCH',body:JSON.stringify({isActive:!g.isActive})});await refreshAttendance();})}>{g.isActive?'Nonaktifkan':'Aktifkan'}</button>])} empty="Belum ada geofence." />
      </Panel>
    </section>

    <section className="grid2">
      <Panel eyebrow="R2 · BIOMETRIC" title="Biometric / Fingerprint Credentials" badge={`${biometrics.length} credential`}>
        <form className="formGrid" onSubmit={(event)=>{event.preventDefault();const form = event.currentTarget; const fd = new FormData(form);void run(async()=>{await api('/attendance/biometrics/enroll',{method:'POST',body:JSON.stringify({employeeId:fd.get('employeeId'),attendanceDeviceId:fd.get('attendanceDeviceId')||undefined,biometricType:fd.get('biometricType'),deviceUserCode:fd.get('deviceUserCode'),externalTemplateRef:fd.get('externalTemplateRef')||undefined})});form.reset();await refreshAttendance();setMessage('Biometric credential terdaftar.');});}}>
          <label>Karyawan<select name="employeeId" required defaultValue=""><option value="" disabled>Pilih</option>{employees.map(e=><option key={e.id} value={e.id}>{e.employeeNumber} · {e.fullName}</option>)}</select></label>
          <label>Device<select name="attendanceDeviceId" defaultValue=""><option value="">Tanpa device tertentu</option>{devices.filter(d=>d.status==='ACTIVE').map(d=><option key={d.id} value={d.id}>{d.code} · {d.name}</option>)}</select></label>
          <label>Biometric type<select name="biometricType" defaultValue="FINGERPRINT"><option value="FINGERPRINT">Fingerprint</option><option value="FACE">Face</option></select></label>
          <label>Device user code<input name="deviceUserCode" required /></label>
          <label>External template ref<input name="externalTemplateRef" /></label>
          <button disabled={!canAll('attendance.manage') || busy}>Enroll credential</button>
        </form>
        <Table head={['Karyawan','Jenis','Device user','Status','Aksi']} rows={biometrics.map(b=>[employees.find(e=>e.id===b.employeeId)?.fullName??b.employeeId,b.biometricType,b.deviceUserCode,<StatusChip status={b.status}/>,!b.revokedAt?<button type="button" className="secondary" disabled={!canAll('attendance.manage') || busy} onClick={()=>void run(async()=>{await api(`/attendance/biometrics/${b.id}`,{method:'PATCH',body:JSON.stringify({revoke:true})});await refreshAttendance();})}>Revoke</button>:'-'])} empty="Belum ada biometric credential." />
      </Panel>
      <Panel eyebrow="R2 · HISTORY" title="Histori Absensi Karyawan" badge={`${attendanceRecords.length} record`}>
        <label>Karyawan<select value={attendanceEmployeeId} onChange={(e)=>void loadAttendanceEmployee(e.target.value)}><option value="">Pilih karyawan</option>{employees.map(e=><option key={e.id} value={e.id}>{e.employeeNumber} · {e.fullName}</option>)}</select></label>
        <Table head={['Tanggal','Masuk','Keluar','Menit','Status']} rows={attendanceRecords.map(r=>[tanggal(r.workDate),r.checkInAt?new Date(r.checkInAt).toLocaleTimeString('id-ID',{hour:'2-digit',minute:'2-digit'}):'-',r.checkOutAt?new Date(r.checkOutAt).toLocaleTimeString('id-ID',{hour:'2-digit',minute:'2-digit'}):'-',String(r.workedMinutes??0),<StatusChip status={r.status??'RECORDED'} />])} empty="Pilih karyawan untuk melihat histori absensi." />
      </Panel>
    </section>
    {message && <div className="notice sectionBlock">{message}</div>}
  </>;

  return <>
    <Panel eyebrow="R2 · PAYROLL COMPLIANCE" title="Employee Tax & Social Security Profile" badge={profiles ? `${profiles.supportedTaxMethods.join(', ')} supported` : 'Pilih karyawan'}>
      <label>Karyawan<select value={profileEmployeeId} onChange={(event)=>{const id=event.target.value;setProfileEmployeeId(id);void refreshPayrollConfig(id);}}><option value="">Pilih karyawan</option>{employees.map(e=><option key={e.id} value={e.id}>{e.employeeNumber} · {e.fullName}</option>)}</select></label>
      <section className="grid2">
        <form className="formGrid" onSubmit={(event)=>{event.preventDefault();const form = event.currentTarget; const fd = new FormData(form);void run(async()=>{if(!profileEmployeeId)throw new Error('Pilih karyawan.');await api('/payroll/employee-tax-profiles',{method:'POST',body:JSON.stringify({employeeId:profileEmployeeId,taxStatusCode:fd.get('taxStatusCode')||undefined,taxMethod:String(fd.get('taxMethod')||'GROSS'),annualizationMethod:fd.get('annualizationMethod')||undefined,effectiveFrom:fd.get('effectiveFrom'),effectiveTo:fd.get('effectiveTo')||undefined})});await refreshPayrollConfig(profileEmployeeId);setMessage('Tax profile tersimpan.');form.reset();});}}>
          <h3>Tax Profile</h3><label>Status pajak<input name="taxStatusCode" placeholder="TK/0 / K/1" /></label><label>Tax method<select name="taxMethod" defaultValue="GROSS">{(profiles?.supportedTaxMethods??['GROSS','GROSS_UP','NET']).map(method=><option key={method} value={method}>{method}</option>)}</select><small>GROSS memotong pajak dari net; GROSS_UP membuat tunjangan pajak iteratif; NET menanggung pajak sebagai biaya perusahaan tanpa mengurangi take-home.</small></label><label>Annualization<input name="annualizationMethod" placeholder="MONTHLY / ANNUALIZED" /></label><label>Berlaku dari<input name="effectiveFrom" type="date" required /></label><label>Sampai<input name="effectiveTo" type="date" /></label><button disabled={!canAll('payroll.manage') || busy||!profileEmployeeId}>Simpan tax profile</button>
        </form>
        <form className="formGrid" onSubmit={(event)=>{event.preventDefault();const form = event.currentTarget; const fd = new FormData(form);void run(async()=>{if(!profileEmployeeId)throw new Error('Pilih karyawan.');await api('/payroll/employee-social-security-profiles',{method:'POST',body:JSON.stringify({employeeId:profileEmployeeId,wageBase:Number(fd.get('wageBase')||0)||undefined,programs:String(fd.get('programs')||'').split(',').map(v=>v.trim()).filter(Boolean),effectiveFrom:fd.get('effectiveFrom'),effectiveTo:fd.get('effectiveTo')||undefined})});await refreshPayrollConfig(profileEmployeeId);setMessage('Social-security profile tersimpan.');});}}>
          <h3>BPJS / Social Security</h3><label>Wage base<input name="wageBase" type="number" min="0" /></label><label>Program (koma)<input name="programs" required placeholder="JKN,JHT,JP,JKK,JKM" /></label><label>Berlaku dari<input name="effectiveFrom" type="date" required /></label><label>Sampai<input name="effectiveTo" type="date" /></label><button disabled={!canAll('payroll.manage') || busy||!profileEmployeeId}>Simpan social profile</button>
        </form>
      </section>
      {profiles && <Table head={['Jenis','Berlaku','Metode/Program','Sampai']} rows={[...profiles.taxProfiles.map(p=>['Tax',tanggal(p.effectiveFrom),`${p.taxMethod} · ${p.taxStatusCode??'-'}`,p.effectiveTo?tanggal(p.effectiveTo):'-']),...profiles.socialSecurityProfiles.map(p=>['Social',tanggal(p.effectiveFrom),Array.isArray(p.programs)?p.programs.join(', '):String(p.programs),p.effectiveTo?tanggal(p.effectiveTo):'-'])]} empty="Belum ada profile effective-dated." />}
    </Panel>

    <Panel eyebrow="R2 · ACCOUNTING" title="Payroll Accounting Mapping" badge={`${mappings.length} mapping`}>
      <form className="formGrid" onSubmit={(event)=>{event.preventDefault();const form = event.currentTarget; const fd = new FormData(form);void run(async()=>{await api('/payroll/accounting-mappings',{method:'POST',body:JSON.stringify({componentCode:fd.get('componentCode'),debitAccountId:fd.get('debitAccountId')||undefined,creditAccountId:fd.get('creditAccountId')||undefined,isActive:true})});await refreshPayrollConfig(profileEmployeeId);setMessage('Payroll accounting mapping tersimpan.');});}}>
        <label>Mapping<select name="componentCode" required defaultValue=""><option value="" disabled>Pilih</option><option value="__PAYROLL_EXPENSE__">Payroll Expense</option><option value="__SALARY_PAYABLE__">Salary Payable</option><option value="__PAYROLL_TAX_PAYABLE__">Payroll Tax Payable</option><option value="__PAYROLL_OTHER_PAYABLE__">Payroll Other/BPJS Payable</option><option value="__PAYROLL_RECEIVABLE__">Employee Receivable</option></select></label>
        <label>Debit account<select name="debitAccountId" defaultValue=""><option value="">-</option>{accounts.filter(a=>a.isActive!==false).map(a=><option key={a.id} value={a.id}>{a.code} · {a.name}</option>)}</select></label>
        <label>Credit account<select name="creditAccountId" defaultValue=""><option value="">-</option>{accounts.filter(a=>a.isActive!==false).map(a=><option key={a.id} value={a.id}>{a.code} · {a.name}</option>)}</select></label><button disabled={!canAll('payroll.manage') || !canReadHrPath(identity, '/accounting-core/accounts') || busy}>Simpan mapping</button>
      </form>
      <Table head={['Kode','Debit','Credit','Status']} rows={mappings.map(m=>[m.componentCode,accounts.find(a=>a.id===m.debitAccountId)?.code??'-',accounts.find(a=>a.id===m.creditAccountId)?.code??'-',<StatusChip status={m.isActive?'ACTIVE':'INACTIVE'} />])} empty="Belum ada mapping payroll branch." />
      <div className="notice">Posting payroll tetap fail-closed bila mapping wajib tidak lengkap atau akun tidak aktif/milik branch lain. Assignment bertanda proratable dan profile/rule effective-dated kini dihitung per segmen hari; gap konfigurasi tetap REQUIRES_REVIEW.</div>
      {message && <div className="notice sectionBlock">{message}</div>}
    </Panel>
  </>;
}

export default function HrPayrollView({ token, mode = 'payroll' }: { token: string; mode?: string }) {
  // D-3: the API gates each lifecycle step behind a distinct permission, so each control is
  // rendered only when the token can actually perform it.
  const { canAll, identity } = usePermissions(token);
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [employeePageInfo, setEmployeePageInfo] = useState<CursorPageInfo>({});
  const [periods, setPeriods] = useState<PayrollPeriod[]>([]);
  const [taxRules, setTaxRules] = useState<RuleSet[]>([]);
  const [socialRules, setSocialRules] = useState<RuleSet[]>([]);
  const [ruleKind, setRuleKind] = useState('tax');
  const [components, setComponents] = useState<PayrollComponent[]>([]);
  const [componentPageInfo, setComponentPageInfo] = useState<CursorPageInfo>({});
  const [employeeComponents, setEmployeeComponents] = useState<EmployeeComponent[]>([]);
  const [employeeComponentPageInfo, setEmployeeComponentPageInfo] = useState<CursorPageInfo>({});
  const [runs, setRuns] = useState<PayrollRun[]>([]);
  const [results, setResults] = useState<PayrollResult[]>([]);
  const [payments, setPayments] = useState<PayrollPayment[]>([]);
  const [liabilities, setLiabilities] = useState<PayrollLiability[]>([]);
  const [leaveTypes, setLeaveTypes] = useState<LeaveType[]>([]);
  const [leaveRequests, setLeaveRequests] = useState<LeaveRequest[]>([]);
  const [overtimeRequests, setOvertimeRequests] = useState<OvertimeRequest[]>([]);
  const [selectedPeriodId, setSelectedPeriodId] = useState('');
  const [selectedRunId, setSelectedRunId] = useState('');
  const [selectedTaxRuleId, setSelectedTaxRuleId] = useState('');
  const [selectedSocialRuleId, setSelectedSocialRuleId] = useState('');
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const [settleTarget, setSettleTarget] = useState<PayrollPayment | null>(null);
  // Rekening tujuan pelunasan payroll. Kosong sampai kasir memilih: versi lama mengirim kode '1102'
  // yang tertanam di source, jadi pelunasan bisa mendarat di akun yang bukan milik perusahaan ini.
  const [payrollAccounts, setPayrollAccounts] = useState<Account[]>([]);
  const [payrollSettlementChoice, setPayrollSettlementChoice] = useState('');
  const [payrollLiabilityChoice, setPayrollLiabilityChoice] = useState<Record<string, string>>({});
  const [settlementReference, setSettlementReference] = useState('');
  const [adjustmentSource, setAdjustmentSource] = useState<PayrollRun | null>(null);
  const [adjustmentReason, setAdjustmentReason] = useState('');
  const [adjustmentPostingDate, setAdjustmentPostingDate] = useState(() => new Date().toLocaleDateString('en-CA'));
  const [cancelTarget, setCancelTarget] = useState<PayrollRun | null>(null);
  const [cancelReason, setCancelReason] = useState('');

  async function api<T>(path: string, init?: RequestInit): Promise<T> {
    const response = await authFetch(`${API}${path}`, token, {
      ...init,
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}`, ...(init?.headers ?? {}) },
    });
    const data = await response.json();
    if (!response.ok) throw new Error(`HTTP ${response.status}: ${Array.isArray(data.message) ? data.message.join(', ') : data.message ?? 'Permintaan gagal.'}`);
    return data as T;
  }


  async function refreshCore() {
    const now = monthParts();
    const [emp, periodData, runData, taxData, socialData, componentData, employeeComponentData, liabilityData, leaveTypeData, leaveData, overtimeData, accountData] = await Promise.all([
      readOptional(identity, '/hr/employees?limit=50', { items: [], pageInfo: {} } as CursorRows<Employee>, (path) => api<CursorRows<Employee>>(path)),
      readOptional(identity, `/payroll/periods?year=${now.year}`, [] as PayrollPeriod[], (path) => api<PayrollPeriod[]>(path)),
      readOptional(identity, '/payroll/runs', [] as PayrollRun[], (path) => api<PayrollRun[]>(path)),
      readOptional(identity, '/payroll/tax-rule-sets', [] as RuleSet[], (path) => api<RuleSet[]>(path)),
      readOptional(identity, '/payroll/social-security-rule-sets', [] as RuleSet[], (path) => api<RuleSet[]>(path)),
      readOptional(identity, '/payroll/components?limit=50', { items: [], pageInfo: {} } as CursorRows<PayrollComponent>, (path) => api<CursorRows<PayrollComponent>>(path)),
      readOptional(identity, '/payroll/employee-components?limit=50', { items: [], pageInfo: {} } as CursorRows<EmployeeComponent>, (path) => api<CursorRows<EmployeeComponent>>(path)),
      readOptional(identity, '/payroll/liabilities', [] as PayrollLiability[], (path) => api<PayrollLiability[]>(path)),
      readOptional(identity, '/hr/leave-types', [] as LeaveType[], (path) => api<LeaveType[]>(path)),
      readOptional(identity, '/hr/leave-requests', [] as LeaveRequest[], (path) => api<LeaveRequest[]>(path)),
      readOptional(identity, '/hr/overtime-requests', [] as OvertimeRequest[], (path) => api<OvertimeRequest[]>(path)),
      // Chart of accounts untuk choosing rekening pelunasan. Permission-aware optional read only
      // degrades authorization gaps; transport/server failures still fail the workspace load.
      readOptional(identity, '/accounting-core/accounts', [] as Account[], (path) => api<Account[]>(path)),
    ]);
    setEmployees(emp.items);
    setEmployeePageInfo(emp.pageInfo ?? {});
    setPeriods(periodData);
    setRuns(runData);
    setTaxRules(taxData);
    setSocialRules(socialData);
    setComponents(componentData.items);
    setComponentPageInfo(componentData.pageInfo ?? {});
    setEmployeeComponents(employeeComponentData.items);
    setEmployeeComponentPageInfo(employeeComponentData.pageInfo ?? {});
    setLiabilities(liabilityData);
    setLeaveTypes(leaveTypeData);
    setLeaveRequests(leaveData);
    setOvertimeRequests(overtimeData);
    setPayrollAccounts(Array.isArray(accountData) ? accountData : []);
    const currentPeriod = periodData.find((p) => p.year === now.year && p.month === now.month) ?? periodData[0];
    setSelectedPeriodId((current) => current || currentPeriod?.id || '');
    const firstRun = runData[0];
    setSelectedRunId((current) => current || firstRun?.id || '');
    const approvedTax = taxData.find((r) => r.status === 'APPROVED');
    const approvedSocial = socialData.find((r) => r.status === 'APPROVED');
    setSelectedTaxRuleId((current) => current || approvedTax?.id || '');
    setSelectedSocialRuleId((current) => current || approvedSocial?.id || '');
  }

  async function loadMoreEmployees() {
    const cursor = employeePageInfo.nextCursor;
    if (!cursor || busy) return;
    await action(async () => {
      const page = await readOptional(identity, `/hr/employees?limit=50&cursor=${encodeURIComponent(cursor)}`, { items: [], pageInfo: {} } as CursorRows<Employee>, (path) => api<CursorRows<Employee>>(path));
      setEmployees((current) => appendUniqueById(current, page.items));
      setEmployeePageInfo(page.pageInfo ?? {});
    });
  }

  async function loadMoreComponents() {
    const cursor = componentPageInfo.nextCursor;
    if (!cursor || busy) return;
    await action(async () => {
      const page = await readOptional(identity, `/payroll/components?limit=50&cursor=${encodeURIComponent(cursor)}`, { items: [], pageInfo: {} } as CursorRows<PayrollComponent>, (path) => api<CursorRows<PayrollComponent>>(path));
      setComponents((current) => appendUniqueById(current, page.items));
      setComponentPageInfo(page.pageInfo ?? {});
    });
  }

  async function loadMoreEmployeeComponents() {
    const cursor = employeeComponentPageInfo.nextCursor;
    if (!cursor || busy) return;
    await action(async () => {
      const page = await readOptional(identity, `/payroll/employee-components?limit=50&cursor=${encodeURIComponent(cursor)}`, { items: [], pageInfo: {} } as CursorRows<EmployeeComponent>, (path) => api<CursorRows<EmployeeComponent>>(path));
      setEmployeeComponents((current) => appendUniqueById(current, page.items));
      setEmployeeComponentPageInfo(page.pageInfo ?? {});
    });
  }

  async function refreshRun(runId: string) {
    if (!runId) { setResults([]); setPayments([]); return; }
    const [resultData, paymentData] = await Promise.all([
      readOptional(identity, `/payroll/runs/${runId}/results`, [] as PayrollResult[], (path) => api<PayrollResult[]>(path)),
      readOptional(identity, `/payroll/runs/${runId}/payments`, [] as PayrollPayment[], (path) => api<PayrollPayment[]>(path)),
    ]);
    setResults(resultData);
    setPayments(paymentData);
  }

  async function refreshAll(runId = selectedRunId) {
    await refreshCore();
    if (runId) await refreshRun(runId);
  }

  useEffect(() => {
    refreshCore().catch((error) => setMessage(error instanceof Error ? error.message : 'Gagal memuat HR/Payroll.'));
  }, [token]);

  useEffect(() => {
    refreshRun(selectedRunId).catch((error) => setMessage(error instanceof Error ? error.message : 'Gagal memuat detail payroll.'));
  }, [selectedRunId, token]);

  const selectedRun = runs.find((run) => run.id === selectedRunId);
  const selectedLiability = liabilities.find((row) => row.payrollRunId === (selectedRun?.adjustmentOfRunId ?? selectedRunId));
  const employeeById = useMemo(() => new Map(employees.map((row) => [row.id, row])), [employees]);
  const current = monthParts();

  // `HrPayrollView` is the canonical renderer for the `attendance` and `compliance` views, but
  // the R2 configuration surface lives in a separate component that was never mounted. As a
  // result /people/attendance and /people/compliance both rendered the payroll lifecycle, and
  // ten operator panels — roster, attendance policy, effective-dated assignment, corrections,
  // devices, geofence, biometric credentials, attendance history, employee tax/social profiles,
  // payroll accounting mapping — had no reachable path from any role.
  //
  // This return sits after every hook above so hook order stays stable when `mode` changes.
  // That is the V4.8.2 invariant: a conditional return placed before the last hook changes the
  // hook count between renders and React throws.
  if (mode === 'attendance' || mode === 'compliance') {
    return <R2HrConfiguration token={token} employees={employees} mode={mode} />;
  }

  async function action(work: () => Promise<void>) {
    setBusy(true); setMessage('');
    try { await work(); } catch (error) { setMessage(error instanceof Error ? error.message : 'Operasi payroll gagal.'); }
    finally { setBusy(false); }
  }

  async function ensureCurrentPeriod() {
    await action(async () => {
      const existing = periods.find((p) => p.year === current.year && p.month === current.month);
      if (existing) { setSelectedPeriodId(existing.id); setMessage(`Periode ${existing.code} sudah tersedia.`); return; }
      const created = await api<PayrollPeriod>('/payroll/periods', {
        method: 'POST',
        body: JSON.stringify({ code: `PAY-${current.year}-${current.mm}`, year: current.year, month: current.month, startDate: current.startDate, endDate: current.endDate }),
      });
      setSelectedPeriodId(created.id);
      setMessage(`Periode ${created.code} berhasil dibuat.`);
      await refreshCore();
    });
  }

  async function createRun() {
    await action(async () => {
      if (!selectedPeriodId) throw new Error('Pilih/buat periode payroll terlebih dahulu.');
      if (!selectedTaxRuleId) throw new Error('Belum ada tax rule APPROVED. Import/verifikasi tarif resmi lalu approve rule sebelum menghitung payroll.');
      const created = await api<PayrollRun>('/payroll/runs', {
        method: 'POST',
        body: JSON.stringify({ payrollPeriodId: selectedPeriodId, taxRuleSetId: selectedTaxRuleId, socialSecurityRuleSetId: selectedSocialRuleId || undefined }),
      });
      setSelectedRunId(created.id);
      setMessage(`Payroll run ${created.number} siap diproses.`);
      await refreshAll(created.id);
    });
  }

  async function createAdjustmentRun() {
    if (!adjustmentSource) return;
    await action(async () => {
      const reason = adjustmentReason.trim();
      if (reason.length < 5) throw new Error('Alasan adjustment minimal 5 karakter agar audit trail jelas.');
      const created = await api<PayrollRun>(`/payroll/runs/${adjustmentSource.id}/adjustments`, {
        method: 'POST',
        body: JSON.stringify({ reason, postingDate: adjustmentPostingDate || undefined }),
      });
      setAdjustmentSource(null); setAdjustmentReason('');
      setSelectedRunId(created.id);
      setMessage(`Adjustment ${created.number} dibuat dari ${adjustmentSource.number}. Hitung hanya selisihnya lalu review sebelum posting.`);
      await refreshAll(created.id);
    });
  }

  async function cancelPayrollRun() {
    if (!cancelTarget) return;
    await action(async () => {
      const reason = cancelReason.trim();
      if (reason.length < 5) throw new Error('Alasan pembatalan minimal 5 karakter.');
      await api(`/payroll/runs/${cancelTarget.id}/cancel`, { method: 'POST', body: JSON.stringify({ reason }) });
      const label = cancelTarget.adjustmentOfRunId ? 'Adjustment' : 'Payroll run';
      setCancelTarget(null); setCancelReason('');
      setMessage(`${label} ${cancelTarget.number} dibatalkan sebelum posting. Riwayat audit tetap disimpan.`);
      await refreshAll(selectedRunId);
    });
  }

  async function runStep(path: string, success: string) {
    if (!selectedRunId) return;
    await action(async () => {
      await api(path, { method: 'POST' });
      setMessage(success);
      await refreshAll(selectedRunId);
    });
  }

  async function lockAttendance() {
    if (!selectedRun) return;
    await action(async () => {
      await api(`/payroll/periods/${selectedRun.payrollPeriodId}/lock-attendance`, { method: 'POST' });
      setMessage('Absensi periode berhasil dikunci untuk branch ini.');
      await refreshAll(selectedRunId);
    });
  }

  async function settleSalary(payment: PayrollPayment, externalReference: string) {
    const reference = externalReference.trim();
    if (!reference) { setMessage('Pembayaran belum dikonfirmasi: referensi transfer bank wajib diisi.'); return; }
    await action(async () => {
      await api(`/payroll/payments/${payment.id}/settle`, {
        method: 'POST',
        body: JSON.stringify({ settlementAccountCode: '1102', paymentMethod: 'BANK_TRANSFER', externalReference: reference }),
      });
      setMessage(payment.direction === 'RECOVERY' ? 'Penerimaan recovery dikonfirmasi dan Piutang Karyawan berkurang.' : 'Transfer bank dikonfirmasi dan jurnal pelunasan Utang Gaji terbentuk.');
      setSettleTarget(null); setSettlementReference('');
      await refreshAll(selectedRunId);
    });
  }

  /**
   * `liabilityAccountCode` dan `settlementAccount` dulu dua konstanta yang tertanam di sini
   * ('2103'/'2104' untuk utang, '1102' untuk kas). Kode '1102' milik template, bukan milik
   * perusahaan ini — kalau tidak ada, pembayaran payroll gagal atau mendarat di akun keliru.
   * Sekarang keduanya datang dari chart of accounts dan kasir memilih.
   */
  async function createLiabilityDraft(liabilityAccountCode: string, settlementAccountCode: string, amount: number) {
    if (!liabilityAccountCode) throw new Error('Pilih akun kewajiban payroll terlebih dahulu.');
    if (!settlementAccountCode) throw new Error('Pilih akun kas/bank tujuan pelunasan.');
    if (!selectedRun || amount <= 0) return;
    await action(async () => {
      await api('/finance-operations', {
        method: 'POST',
        body: JSON.stringify({
          type: 'PAYROLL_LIABILITY_PAYMENT',
          description: `Pelunasan kewajiban payroll ${selectedRun.number}`,
          amount,
          debitAccountCode: liabilityAccountCode,
          creditAccountCode: settlementAccountCode,
          paymentMethod: 'BANK_TRANSFER',
          referenceType: 'PayrollRun',
          referenceId: selectedRun.id,
          idempotencyKey: requestKey('payroll-liability', selectedRun.id, liabilityAccountCode),
        }),
      });
      setMessage('Draft settlement kewajiban payroll dibuat. Posting final dilakukan dari menu Akuntansi setelah pembayaran eksternal benar-benar dilakukan.');
      await refreshAll(selectedRunId);
    });
  }


  async function reviewLeaveRequest(id: string, status: 'APPROVED' | 'REJECTED') {
    await action(async () => {
      await api(`/hr/leave-requests/${id}/review`, { method: 'POST', body: JSON.stringify({ status }) });
      setMessage(status === 'APPROVED' ? 'Pengajuan cuti disetujui.' : 'Pengajuan cuti ditolak.');
      await refreshCore();
    });
  }

  async function reviewOvertimeRequest(row: OvertimeRequest, status: 'APPROVED' | 'REJECTED') {
    await action(async () => {
      const requestedMinutes = Math.round((new Date(row.requestedEnd).getTime() - new Date(row.requestedStart).getTime()) / 60000);
      await api(`/hr/overtime-requests/${row.id}/review`, { method: 'POST', body: JSON.stringify({ status, ...(status === 'APPROVED' ? { approvedMinutes: requestedMinutes } : {}) }) });
      setMessage(status === 'APPROVED' ? 'Pengajuan lembur disetujui.' : 'Pengajuan lembur ditolak.');
      await refreshCore();
    });
  }

  return (
    <>
      <section className="grid2">
        <Panel eyebrow="HRIS" title="Daftar Karyawan" badge={`${employees.length} orang`}>
          <Table head={['NIP', 'Nama', 'Status']} rows={employees.map((e) => [<strong>{e.employeeNumber}</strong>, e.fullName, <StatusChip status={e.isActive === false ? 'NONAKTIF' : 'AKTIF'} />])} empty="Belum ada karyawan." />
          {employeePageInfo.hasMore && <button type="button" className="secondary" disabled={busy} onClick={() => void loadMoreEmployees()}>Muat karyawan berikutnya</button>}
        </Panel>
    <Panel eyebrow="P0 · KONFIGURASI DASAR" title="Komponen gaji, pajak & BPJS" badge={`${components.length} komponen`}>
      <div className="notice">Tanpa komponen gaji dan rule pajak/social yang berstatus APPROVED, payroll tidak dapat dihitung. Formulir ini yang sebelumnya tidak tersedia di UI sama sekali.</div>

      <form className="formGrid" onSubmit={(event)=>{event.preventDefault();const form = event.currentTarget; const fd = new FormData(form);void action(async()=>{
        await api('/payroll/components',{method:'POST',body:JSON.stringify({
          code:String(fd.get('code')||'').trim().toUpperCase(), name:String(fd.get('name')||'').trim(),
          componentType:String(fd.get('componentType')||'EARNING'), calculationType:String(fd.get('calculationType')||'FIXED'),
          defaultAmount:Number(fd.get('defaultAmount')||0)||undefined,
          taxable:fd.get('taxable')==='on', affectsGross:fd.get('affectsGross')==='on', affectsNet:fd.get('affectsNet')==='on',
          proratable:fd.get('proratable')==='on', attendanceBased:fd.get('attendanceBased')==='on',
        })});
        form.reset(); await refreshCore(); setMessage('Komponen gaji dibuat.');
      });}}>
        <h3>Buat komponen gaji</h3>
        <label>Kode<input name="code" required placeholder="BASIC_SALARY" /></label>
        <label>Nama<input name="name" required placeholder="Gaji Pokok" /></label>
        <label>Tipe<select name="componentType" defaultValue="EARNING"><option>EARNING</option><option>DEDUCTION</option><option>EMPLOYER_CONTRIBUTION</option><option>REIMBURSEMENT</option><option>TAX</option></select></label>
        <label>Perhitungan<select name="calculationType" defaultValue="FIXED"><option>FIXED</option><option>FORMULA</option><option>PERCENTAGE</option><option>ATTENDANCE</option><option>OVERTIME</option><option>MANUAL</option></select></label>
        <label>Nominal default<input name="defaultAmount" type="number" min="0" step="0.01" /></label>
        <label className="checkRow"><input name="taxable" type="checkbox" defaultChecked /> Kena pajak</label>
        <label className="checkRow"><input name="affectsGross" type="checkbox" defaultChecked /> Masuk gross</label>
        <label className="checkRow"><input name="affectsNet" type="checkbox" defaultChecked /> Mengurangi net</label>
        <label className="checkRow"><input name="proratable" type="checkbox" /> Proratable (dihitung per hari aktif)</label>
        <label className="checkRow"><input name="attendanceBased" type="checkbox" />|attendance based</label>
        <button disabled={busy || !canAll('payroll.manage')}>Simpan komponen</button>
      </form>

      <form className="formGrid" onSubmit={(event)=>{event.preventDefault();const form = event.currentTarget; const fd = new FormData(form);void action(async()=>{
        const employeeId=String(fd.get('employeeId')||'');
        if(!employeeId) throw new Error('Pilih karyawan.');
        await api('/payroll/employee-components',{method:'POST',body:JSON.stringify({
          employeeId, componentId:String(fd.get('componentId')||''),
          amount:Number(fd.get('amount')||0)||undefined, percentage:Number(fd.get('percentage')||0)||undefined,
          effectiveFrom:String(fd.get('effectiveFrom')||''), effectiveTo:String(fd.get('effectiveTo')||'')||undefined,
        })});
        form.reset(); await refreshCore(); setMessage('Komponen gaji ditugaskan ke karyawan.');
      });}}>
        <h3>Tugaskan ke karyawan</h3>
        <label>Karyawan<select name="employeeId" required defaultValue=""><option value="" disabled>Pilih</option>{employees.filter(e=>e.isActive!==false).map(e=><option key={e.id} value={e.id}>{e.employeeNumber} · {e.fullName}</option>)}</select></label>
        <label>Komponen<select name="componentId" required defaultValue=""><option value="" disabled>Pilih</option>{components.filter(c=>c.isActive!==false).map(c=><option key={c.id} value={c.id}>{c.code} · {c.name}</option>)}</select></label>
        <label>Nominal<input name="amount" type="number" min="0" step="0.01" /></label>
        <label>Persentase (%)<input name="percentage" type="number" min="0" step="0.01" /></label>
        <label>Berlaku dari<input name="effectiveFrom" type="date" required /></label>
        <label>Sampai<input name="effectiveTo" type="date" /></label>
        <button disabled={busy || !canAll('payroll.manage')}>Tugaskan</button>
      </form>

      <Table head={['Kode','Nama','Tipe','Perhitungan','Default','Proratable','Status']} rows={components.map(c=>[
        <strong>{c.code}</strong>, c.name, c.componentType, c.calculationType,
        c.defaultAmount!=null?rupiah(Number(c.defaultAmount)):'-', c.proratable?'Ya':'Tidak',
        <StatusChip status={c.isActive===false?'INACTIVE':'ACTIVE'} />,
      ])} empty="Belum ada komponen gaji. Buat minimal satu untuk menghitung payroll." />
      {componentPageInfo.hasMore && <button type="button" className="secondary" disabled={busy} onClick={() => void loadMoreComponents()}>Muat komponen berikutnya</button>}
      <Table head={['Komponen','Nominal','Persentase','Berlaku','Sampai','Status']} rows={employeeComponents.map(row=>[
        components.find(c=>c.id===row.componentId)?.code ?? row.componentId,
        row.amount!=null?rupiah(Number(row.amount)):'-', row.percentage!=null?`${row.percentage}%`:'-',
        tanggal(row.effectiveFrom), row.effectiveTo?tanggal(row.effectiveTo):'-',
        <StatusChip status={row.isActive?'ACTIVE':'INACTIVE'} />,
      ])} empty="Belum ada penugasan komponen ke karyawan." />
      {employeeComponentPageInfo.hasMore && <button type="button" className="secondary" disabled={busy} onClick={() => void loadMoreEmployeeComponents()}>Muat assignment berikutnya</button>}

      <form className="formGrid" onSubmit={(event)=>{event.preventDefault();const form = event.currentTarget; const fd = new FormData(form);void action(async()=>{
        const kind=String(fd.get('kind')||'tax');
        const endpoint=kind==='tax'?'/payroll/tax-rule-sets':'/payroll/social-security-rule-sets';
        if (!canAll(kind === 'tax' ? 'tax.manage' : 'payroll.manage')) throw new Error('Anda tidak memiliki izin membuat aturan ini.');
        await api(endpoint,{method:'POST',body:JSON.stringify(payrollRulePayload(kind, {
          code:String(fd.get('ruleCode')||'').trim().toUpperCase(), name:String(fd.get('ruleName')||'').trim(),
          effectiveFrom:String(fd.get('ruleFrom')||''), effectiveTo:String(fd.get('ruleTo')||'')||undefined,
          calculationMode:String(fd.get('calculationMode')||''), parameters:String(fd.get('parameters')||''),
          legalReference:String(fd.get('legalReference')||'')||undefined,
        }))});
        form.reset(); await refreshCore(); setMessage('Rule set dibuat berstatus DRAFT. Setujui sebelum dipakai.');
      });}}>
        <h3>Buat tax / social rule set</h3>
        <label>Jenis<select name="kind" value={ruleKind} onChange={event => setRuleKind(event.target.value)}><option value="tax">Pajak penghasilan payroll</option><option value="social">Social Security (BPJS)</option></select></label>
        <label>Kode rule<input name="ruleCode" required placeholder="ID-PPh21-CONFIG" /></label>
        <label>Nama rule<input name="ruleName" required /></label>
        <label>Metode pajak<select name="calculationMode" defaultValue="LOOKUP_TABLE"><option value="LOOKUP_TABLE">Tabel tarif per kategori</option><option value="ANNUAL_PROGRESSIVE">Progresif tahunan</option></select></label>
        <label>Parameter aturan terverifikasi (JSON)<textarea name="parameters" required rows={6} placeholder="Tempel parameter dari konfigurasi tarif yang sudah diverifikasi" /><small>Pajak tabel memakai categories; progresif memakai brackets, allowance dan periodsPerYear. BPJS memakai programs berisi code, employeeRate dan employerRate. Tarif berupa desimal 0–1. Metode pajak tidak dikirim untuk BPJS.</small></label>
        <label>Berlaku dari<input name="ruleFrom" type="date" required /></label>
        <label>Sampai<input name="ruleTo" type="date" /></label>
        <label>Referensi hukum<input name="legalReference" placeholder="UU / Permenkes" /></label>
        <button disabled={busy || !canAll(ruleKind === 'tax' ? 'tax.manage' : 'payroll.manage')}>Simpan rule set (DRAFT)</button>
      </form>

      <Table head={['Kode','Versi','Status','Efektif','Sampai','Referensi','Aksi']} rows={[...taxRules.map(r=>['tax',r] as const),...socialRules.map(r=>['social',r] as const)].map(([kind,rule])=>[
        <><strong>{rule.code}</strong> <small className="mutedText">{kind === 'tax' ? 'Tax' : 'Social'}</small></>,
        `v${rule.version}`,
        <StatusChip status={rule.status} />,
        tanggal(rule.effectiveFrom), rule.effectiveTo?tanggal(rule.effectiveTo):'-', rule.legalReference??'-',
        rule.status==='DRAFT'
          ? (canAll(kind === 'tax' ? 'tax.manage' : 'payroll.approve') ? <button type="button" className="secondary" disabled={busy} onClick={()=>void action(async()=>{
              await api(`${kind==='tax'?'/payroll/tax-rule-sets':'/payroll/social-security-rule-sets'}/${rule.id}/approve`,{method:'POST'});
              await refreshCore(); setMessage(`${rule.code} disetujui.`);
            })}>Setujui</button> : <small className="mutedText">Butuh izin approve</small>)
          : <small>{rule.status}</small>,
      ])} empty="Belum ada rule set pajak/social. Buat dan setujui sebelum menghitung payroll." />
    </Panel>

        <Panel eyebrow="PAYROLL CONTROL" title="Periode & Run" badge={`${runs.length} run`}>
          <div className="formStack">
            <label>Periode
              <select value={selectedPeriodId} onChange={(e) => setSelectedPeriodId(e.target.value)}>
                <option value="">Pilih periode</option>
                {periods.map((p) => <option key={p.id} value={p.id}>{p.code} · {p.status}</option>)}
              </select>
            </label>
            <div className="inlineActions">
              <button type="button" className="secondary" disabled={busy || !canAll('payroll.manage')} onClick={() => void ensureCurrentPeriod()}>Buat periode bulan ini</button>
              <button type="button" disabled={busy || !canAll('payroll.manage') || !selectedPeriodId} onClick={() => void createRun()}>+ Buat Payroll Run</button>
            </div>
            <label>Tax rule APPROVED
              <select value={selectedTaxRuleId} onChange={(e) => setSelectedTaxRuleId(e.target.value)}>
                <option value="">Belum tersedia</option>
                {taxRules.filter((r) => r.status === 'APPROVED').map((r) => <option key={r.id} value={r.id}>{r.name} v{r.version}</option>)}
              </select>
            </label>
            <label>Social/BPJS rule APPROVED
              <select value={selectedSocialRuleId} onChange={(e) => setSelectedSocialRuleId(e.target.value)}>
                <option value="">Tidak digunakan / belum tersedia</option>
                {socialRules.filter((r) => r.status === 'APPROVED').map((r) => <option key={r.id} value={r.id}>{r.name} v{r.version}</option>)}
              </select>
            </label>
            {taxRules.some((r) => r.status === 'DRAFT') && !taxRules.some((r) => r.status === 'APPROVED') && <div className="notice">Tax rule masih DRAFT. Seed sengaja tidak mengaktifkan tarif pajak kosong; impor tarif resmi dan approve rule sebelum payroll production.</div>}
          </div>
        </Panel>
      </section>

      <section className="grid2">
        <Panel eyebrow="CUTI" title="Pengajuan Cuti / Izin / Sakit" badge={`${leaveRequests.filter((row) => row.status === 'SUBMITTED').length} menunggu`}>
          <Table head={['Karyawan', 'Jenis', 'Periode', 'Hari', 'Status', 'Aksi']} rows={leaveRequests.map((row) => {
            const leaveType = leaveTypes.find((item) => item.id === row.leaveTypeId);
            return [employeeById.get(row.employeeId)?.fullName ?? row.employeeId, leaveType?.name ?? row.leaveTypeId, `${tanggal(row.startDate)} – ${tanggal(row.endDate)}`, String(row.totalDays), <StatusChip status={row.status} />, row.status === 'SUBMITTED' ? <span className="inlineActions"><button type="button" disabled={busy || !canAll('leave.approve')} onClick={() => void reviewLeaveRequest(row.id, 'APPROVED')}>Approve</button><button type="button" className="secondary" disabled={busy || !canAll('leave.approve')} onClick={() => void reviewLeaveRequest(row.id, 'REJECTED')}>Reject</button></span> : '-'];
          })} empty="Belum ada pengajuan cuti, izin, atau sakit." />
          <form className="inline" onSubmit={(event) => { event.preventDefault(); const form = event.currentTarget; const fd = new FormData(form); void action(async () => {
            // CreateLeaveTypeDto: code and name required; paid, annualQuota and requiresDocument
            // optional. annualQuota must be a number — a string would fail @IsNumber.
            await api('/hr/leave-types', { method: 'POST', body: JSON.stringify({
              code: fd.get('code'),
              name: fd.get('name'),
              paid: fd.get('paid') === 'on',
              annualQuota: fd.get('annualQuota') ? Number(fd.get('annualQuota')) : undefined,
              requiresDocument: fd.get('requiresDocument') === 'on',
            }) });
            form.reset(); await refreshCore(); setMessage('Jenis cuti berhasil dibuat.');
          }); }}>
            <label>Kode<input name="code" required placeholder="CUTI" /></label><label>Nama<input name="name" required placeholder="Cuti Tahunan" /></label>
            <label>Kuota per tahun (hari)<input name="annualQuota" type="number" min="0" defaultValue="12" /></label>
            <label className="checkboxLabel"><input name="paid" type="checkbox" defaultChecked />Dibayar</label>
            <label className="checkboxLabel"><input name="requiresDocument" type="checkbox" />Perlu dokumen</label>
            <button disabled={!canAll('leave.manage') || busy}>Tambah jenis cuti</button>
          </form>
          <Table head={['Kode', 'Nama', 'Dibayar', 'Kuota', 'Dokumen']} rows={leaveTypes.map((row) => [row.code, row.name, row.paid ? 'ya' : 'tidak', String(row.annualQuota ?? '-'), row.requiresDocument ? 'ya' : 'tidak'])} empty="Belum ada jenis cuti." />
        </Panel>
        <Panel eyebrow="LEMBUR" title="Pengajuan Lembur" badge={`${overtimeRequests.filter((row) => row.status === 'SUBMITTED').length} menunggu`}>
          <Table head={['Karyawan', 'Waktu', 'Durasi', 'Status', 'Aksi']} rows={overtimeRequests.map((row) => {
            const minutes = Math.round((new Date(row.requestedEnd).getTime() - new Date(row.requestedStart).getTime()) / 60000);
            return [employeeById.get(row.employeeId)?.fullName ?? row.employeeId, `${new Date(row.requestedStart).toLocaleString('id-ID')} – ${new Date(row.requestedEnd).toLocaleString('id-ID')}`, `${row.approvedMinutes ?? minutes} menit`, <StatusChip status={row.status} />, row.status === 'SUBMITTED' ? <span className="inlineActions"><button type="button" disabled={busy || !canAll('overtime.approve')} onClick={() => void reviewOvertimeRequest(row, 'APPROVED')}>Approve</button><button type="button" className="secondary" disabled={busy || !canAll('overtime.approve')} onClick={() => void reviewOvertimeRequest(row, 'REJECTED')}>Reject</button></span> : '-'];
          })} empty="Belum ada pengajuan lembur." />
        </Panel>
      </section>

      <Panel eyebrow="PAYROLL LIFECYCLE" title="Run Aktif" badge={selectedRun?.status ?? 'BELUM DIPILIH'}>
        <label>Payroll Run
          <select value={selectedRunId} onChange={(e) => setSelectedRunId(e.target.value)}>
            <option value="">Pilih run</option>
            {runs.map((run) => <option key={run.id} value={run.id}>{run.adjustmentOfRunId ? `ADJ#${run.adjustmentSequence ?? '?'} · ` : ''}{run.number} · {run.status}</option>)}
          </select>
        </label>
        {selectedRun && <>
          <div className="actionRow">
            {!selectedRun.adjustmentOfRunId && canAll('payroll.calculate') && <button type="button" className="secondary" disabled={busy || !['DRAFT', 'REVIEW'].includes(selectedRun.status)} onClick={() => void lockAttendance()}>1. Kunci absensi</button>}
            {canAll('payroll.calculate') && <button type="button" className="secondary" disabled={busy || !['DRAFT', 'REVIEW'].includes(selectedRun.status)} onClick={() => void runStep(`/payroll/runs/${selectedRun.id}/calculate`, selectedRun.adjustmentOfRunId ? 'Adjustment selesai dihitung sebagai selisih; periksa hasil REVIEW.' : 'Payroll selesai dihitung; periksa hasil REVIEW.')}>{selectedRun.adjustmentOfRunId ? '2. Hitung selisih' : '2. Hitung'}</button>}
            {canAll('payroll.approve') && <button type="button" className="secondary" disabled={busy || selectedRun.status !== 'REVIEW'} onClick={() => void runStep(`/payroll/runs/${selectedRun.id}/approve`, selectedRun.adjustmentOfRunId ? 'Adjustment payroll berhasil disetujui.' : 'Payroll berhasil disetujui.')}>3. Approve</button>}
            {canAll('payroll.post') && <button type="button" disabled={busy || selectedRun.status !== 'APPROVED'} onClick={() => void runStep(`/payroll/runs/${selectedRun.id}/post-accounting`, selectedRun.adjustmentOfRunId ? 'Selisih adjustment diposting tanpa mengulang jurnal payroll sumber.' : 'Payroll diposting; Utang Gaji/Pajak/BPJS sudah terbentuk.')}>{selectedRun.adjustmentOfRunId ? '4. Posting selisih' : '4. Posting jurnal'}</button>}
            {canAll('payroll.manage') && !selectedRun.adjustmentOfRunId && ['POSTED', 'PAID'].includes(selectedRun.status) && <button type="button" className="secondary" disabled={busy} onClick={() => { setAdjustmentSource(selectedRun); setAdjustmentReason(''); setAdjustmentPostingDate(new Date().toLocaleDateString('en-CA')); }}>Buat adjustment</button>}
            {canAll('payroll.manage') && ['DRAFT', 'REVIEW', 'APPROVED'].includes(selectedRun.status) && <button type="button" className="secondary" disabled={busy} onClick={() => { setCancelTarget(selectedRun); setCancelReason(''); }}>{selectedRun.adjustmentOfRunId ? 'Batalkan adjustment' : 'Batalkan run'}</button>}
          </div>
          {/* Steps 5 (settle) and 6 (publish) live in the payment panel below: settlement is
              per-employee, and publish-payslips only unlocks once every payment is PAID. */}
          {canAll('payroll.publish') && selectedRun.status !== 'PAID' && <div className="notice sectionBlockBottomSm">Penggajian belum selesai. Langkah 5 (selesai pembayaran gaji di panel Pembayaran Gaji di bawah) harus berstatus lunas sebelum langkah 6 (terbitkan payslip) bisa dijalankan.</div>}
          {selectedRun.adjustmentOfRunId && <div className="notice sectionBlockBottomSm">Adjustment #{selectedRun.adjustmentSequence ?? '-'} · sumber {runs.find((item) => item.id === selectedRun.adjustmentOfRunId)?.number ?? selectedRun.adjustmentOfRunId}. Nilai di bawah adalah <strong>selisih</strong>, bukan total payroll ulang. {selectedRun.adjustmentReason ? `Alasan: ${selectedRun.adjustmentReason}` : ''}</div>}
          <Table
            head={['Karyawan', 'Gross', 'Taxable', 'PPh', 'Iuran', 'Net', 'Status']}
            rows={results.map((r) => [
              employeeById.get(r.employeeId)?.fullName ?? r.employeeId,
              rupiah(Number(r.grossPay)), rupiah(Number(r.taxableIncome)), rupiah(Number(r.incomeTax)), rupiah(Number(r.employeeContribution)), <strong>{rupiah(Number(r.netPay))}</strong>, <StatusChip status={r.status} />,
            ])}
            empty="Belum ada hasil kalkulasi."
          />
        </>}
      </Panel>

      <section className="grid2">
        <Panel eyebrow="LANGKAH 5 · PEMBAYARAN GAJI" title="Payroll Payments" badge={`${payments.filter((p) => p.status !== 'PAID').length} belum selesai`}>
          <Table
            head={['Karyawan', 'Arah', 'Nominal', 'Status', 'Aksi']}
            rows={payments.map((p) => [
              employeeById.get(p.employeeId)?.fullName ?? p.employeeId,
              p.direction === 'RECOVERY' ? 'Recovery ke perusahaan' : 'Bayar ke karyawan',
              rupiah(Number(p.amount)),
              <StatusChip status={p.status} />,
              p.status === 'PAID' ? tanggal(p.paidAt ?? '') : p.status === 'CANCELLED' ? 'Dikoreksi adjustment' : canAll('payroll.post')
                ? <button type="button" className="secondary" disabled={busy} onClick={() => { setSettleTarget(p); setSettlementReference(''); }}>{p.direction === 'RECOVERY' ? 'Konfirmasi penerimaan' : 'Konfirmasi transfer bank'}</button>
                : <small className="mutedText">Butuh izin posting</small>,
            ])}
            empty="Payment/recovery akan dibuat setelah payroll diposting."
          />
          {canAll('payroll.publish') && selectedRun && (
            <button type="button" className="actionRow" disabled={busy || selectedRun.status !== 'PAID'} onClick={() => void runStep(`/payroll/runs/${selectedRun.id}/publish-payslips`, selectedRun.adjustmentOfRunId ? 'Payslip adjustment diterbitkan melalui secure link.' : 'Payslip diterbitkan melalui secure link.')}>6. Terbitkan payslip</button>
          )}
          {selectedLiability?.recovery && Number(selectedLiability.recovery.recognized) > 0 && <div className="notice sectionBlockSm">Piutang recovery karyawan: {rupiah(Number(selectedLiability.recovery.outstanding))} belum diterima dari {rupiah(Number(selectedLiability.recovery.recognized))} yang diakui.</div>}
        </Panel>
        <Panel eyebrow="5B. KEWAJIBAN PAYROLL" title="PPh / BPJS / Potongan" badge={selectedLiability ? 'Run terpilih' : 'Belum tersedia'}>
          {selectedLiability ? <Table
            head={['Kewajiban', 'Diakui', 'Dibayar', 'Pending', 'Sisa', 'Aksi']}
            rows={([
              ['PPh payroll', selectedLiability.tax, 'payrollTaxLiabilityAccount'],
              ['BPJS/potongan', selectedLiability.socialAndOther, 'socialLiabilityAccount'],
            ] satisfies Array<[string, LiabilityBucket, 'payrollTaxLiabilityAccount' | 'socialLiabilityAccount']>).map(([label, data, accountField]) => {
              const available = Number(data.availableToPay ?? 0);
              // Chart of accounts, bukan kode template. Dua dropdown di bawah tabel memilihnya.
              const liabilityAccount = payrollLiabilityChoice[accountField];
              const settlementAccount = payrollSettlementChoice;
              return [label, rupiah(Number(data.recognized)), rupiah(Number(data.paid)), rupiah(Number(data.pending)), <strong>{rupiah(Number(data.outstanding))}</strong>, available > 0 ? <button type="button" className="secondary" disabled={busy || !canAll('finance.create') || !identity?.roles.some(role => ['SUPER_ADMIN', 'OWNER', 'FINANCE', 'ADMIN'].includes(role)) || !liabilityAccount || !settlementAccount} onClick={() => void createLiabilityDraft(liabilityAccount, settlementAccount, available)} >Buat draft bayar</button> : '-'];
            })}
          />
          : <div className="notice">Posting payroll terlebih dahulu untuk membentuk kewajiban.</div>}
          {/* Rekening tujuan pelunasan. `accounts` sudah di-fetch modul ini, jadi tidak ada alasan
              untuk memakai kode akun yang tertanam di source — kode template hanya berlaku di
              template. */}
          <div className="responsiveFormGrid">
            <label>Akun kas/bank tujuan<select required value={payrollSettlementChoice} onChange={event => setPayrollSettlementChoice(event.target.value)}>
              <option value="">Pilih rekening</option>
              {payrollAccounts.filter(a => a.isActive !== false && /bank|kas|cash/i.test(`${a.code} ${a.name}`)).map(a => <option key={a.id} value={a.code}>{a.code} · {a.name}</option>)}
            </select></label>
            <label>Akun kewajiban PPh<select required value={payrollLiabilityChoice.payrollTaxLiabilityAccount ?? ''} onChange={event => setPayrollLiabilityChoice(c => ({ ...c, payrollTaxLiabilityAccount: event.target.value }))}>
              <option value="">Pilih akun</option>
              {payrollAccounts.filter(a => a.isActive !== false).map(a => <option key={a.id} value={a.code}>{a.code} · {a.name}</option>)}
            </select></label>
            <label>Akun kewajiban BPJS<select required value={payrollLiabilityChoice.socialLiabilityAccount ?? ''} onChange={event => setPayrollLiabilityChoice(c => ({ ...c, socialLiabilityAccount: event.target.value }))}>
              <option value="">Pilih akun</option>
              {payrollAccounts.filter(a => a.isActive !== false).map(a => <option key={a.id} value={a.code}>{a.code} · {a.name}</option>)}
            </select></label>
          </div>
        </Panel>
      </section>

      <Panel eyebrow="AUDIT" title="Riwayat Payroll Runs" badge={`${runs.length} run`}>
        <Table
          head={['Nomor', 'Jenis', 'Status', 'Karyawan', 'Gross', 'PPh', 'Net', 'Dibuat']}
          rows={runs.map((r) => [<strong>{r.number}</strong>, r.adjustmentOfRunId ? `Adjustment #${r.adjustmentSequence ?? '-'}` : 'Regular', <StatusChip status={r.status} />, r.employeeCount, rupiah(Number(r.grossTotal)), rupiah(Number(r.taxTotal)), <strong>{rupiah(Number(r.netTotal))}</strong>, tanggal(r.createdAt)])}
          empty="Belum ada payroll run."
        />
        {message && <div className="notice sectionBlock">{message}</div>}
      </Panel>

      {cancelTarget && <div className="modalOverlay" role="dialog" aria-modal="true" aria-labelledby="payroll-cancel-title">
        <div className="modalCard">
          <span className="eyebrow">CANCEL PRE-POSTING</span>
          <h2 id="payroll-cancel-title">Batalkan {cancelTarget.number}</h2>
          <p className="sectionHelp">Hanya run DRAFT/REVIEW/APPROVED yang belum diposting yang dapat dibatalkan. Run POSTED/PAID tidak pernah diedit atau dibatalkan dari workflow ini.</p>
          <label>Alasan pembatalan<textarea autoFocus rows={3} value={cancelReason} onChange={(e) => setCancelReason(e.target.value)} placeholder="Contoh: rule payroll perlu diperbaiki sebelum adjustment dihitung ulang" /></label>
          <div className="modalActions">
            <button type="button" className="secondary" disabled={busy} onClick={() => { setCancelTarget(null); setCancelReason(''); }}>Kembali</button>
            <button type="button" disabled={busy || cancelReason.trim().length < 5} onClick={() => void cancelPayrollRun()}>{busy ? 'Memproses…' : 'Batalkan run'}</button>
          </div>
        </div>
      </div>}

      {adjustmentSource && <div className="modalOverlay" role="dialog" aria-modal="true" aria-labelledby="payroll-adjustment-title">
        <div className="modalCard">
          <span className="eyebrow">PAYROLL ADJUSTMENT</span>
          <h2 id="payroll-adjustment-title">Koreksi {adjustmentSource.number}</h2>
          <p className="sectionHelp">Run sumber tidak diubah. Sistem membuat run baru dan menghitung selisih terhadap payroll sumber + adjustment sebelumnya yang sudah diposting.</p>
          <label>Alasan koreksi<textarea autoFocus rows={3} value={adjustmentReason} onChange={(e) => setAdjustmentReason(e.target.value)} placeholder="Contoh: koreksi lembur yang baru disetujui setelah payroll diposting" /></label>
          <label>Tanggal posting jurnal adjustment<input type="date" value={adjustmentPostingDate} onChange={(e) => setAdjustmentPostingDate(e.target.value)} /></label>
          <div className="notice">Tarif PPh/BPJS tidak dibuat otomatis. Adjustment mewarisi rule APPROVED dari payroll sumber kecuali backend diberi rule pengganti yang valid.</div>
          <div className="modalActions">
            <button type="button" className="secondary" disabled={busy} onClick={() => { setAdjustmentSource(null); setAdjustmentReason(''); }}>Batal</button>
            <button type="button" disabled={busy || adjustmentReason.trim().length < 5 || !adjustmentPostingDate} onClick={() => void createAdjustmentRun()}>{busy ? 'Memproses…' : 'Buat adjustment'}</button>
          </div>
        </div>
      </div>}

      {settleTarget && <div className="modalOverlay" role="dialog" aria-modal="true" aria-labelledby="payroll-settlement-title">
        <div className="modalCard">
          <span className="eyebrow">PAYROLL SETTLEMENT</span>
          <h2 id="payroll-settlement-title">{settleTarget.direction === 'RECOVERY' ? 'Konfirmasi penerimaan recovery' : 'Konfirmasi transfer gaji'}</h2>
          <p className="sectionHelp">Masukkan referensi bank hanya setelah transaksi eksternal benar-benar berhasil. {settleTarget.direction === 'RECOVERY' ? 'Nilai yang diterima kembali' : 'Nilai pembayaran'}: {rupiah(Number(settleTarget.amount))}.</p>
          <label>Referensi transfer bank<input autoFocus value={settlementReference} onChange={(e) => setSettlementReference(e.target.value)} placeholder="Nomor referensi / transaction ID" /></label>
          <div className="modalActions">
            <button type="button" className="secondary" disabled={busy} onClick={() => { setSettleTarget(null); setSettlementReference(''); }}>Kembali</button>
            <button type="button" disabled={busy || !settlementReference.trim()} onClick={() => void settleSalary(settleTarget, settlementReference)}>{busy ? 'Memproses…' : settleTarget.direction === 'RECOVERY' ? 'Konfirmasi penerimaan' : 'Konfirmasi transfer'}</button>
          </div>
        </div>
      </div>}
    </>
  );
}
