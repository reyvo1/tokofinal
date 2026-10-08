'use client';

import { FormEvent, useEffect, useMemo, useState } from 'react';
import { authFetch } from '../auth-fetch';
import { usePermissions } from '../permissions';
import { readOptional } from '../read-path-contract';
import { Panel, StatusChip, Table, tanggal } from '../ui';

const API = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000/api/v1';

const EMPLOYMENT_STATUSES = [
  'PROBATION',
  'PERMANENT',
  'CONTRACT',
  'DAILY',
  'PART_TIME',
  'INTERN',
  'INACTIVE',
  'TERMINATED',
] as const;

type EmploymentStatus = (typeof EMPLOYMENT_STATUSES)[number];

type Employee = {
  id: string;
  employeeNumber: string;
  fullName: string;
  email?: string | null;
  phone?: string | null;
  departmentId?: string | null;
  positionId?: string | null;
  employmentStatus: EmploymentStatus;
  hireDate: string;
  contractEnd?: string | null;
  isActive: boolean;
};

type Department = { id: string; code: string; name: string; parentId?: string | null; isActive?: boolean };
type EmployeeAssignment = { id:string; employeeId:string; departmentId?:string|null; positionId?:string|null; managerEmployeeId?:string|null; effectiveFrom:string; effectiveTo?:string|null; isPrimary:boolean };
type Position = { id: string; departmentId?: string | null; code: string; name: string; grade?: string | null; isActive?: boolean };
type CursorResponse<T> = { items?: T[]; nextCursor?: string | null };

type EmployeeForm = {
  employeeNumber: string;
  fullName: string;
  email: string;
  phone: string;
  departmentId: string;
  positionId: string;
  employmentStatus: EmploymentStatus;
  hireDate: string;
  contractEnd: string;
};

function initialForm(): EmployeeForm {
  return {
    employeeNumber: '',
    fullName: '',
    email: '',
    phone: '',
    departmentId: '',
    positionId: '',
    employmentStatus: 'PERMANENT',
    hireDate: new Date().toLocaleDateString('en-CA'),
    contractEnd: '',
  };
}

function rowsOf<T>(data: T[] | CursorResponse<T>): T[] {
  return Array.isArray(data) ? data : data.items ?? [];
}

function dateOnly(value?: string | null): string {
  if (!value) return '';
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? value.slice(0, 10) : parsed.toLocaleDateString('en-CA');
}

export default function EmployeeMasterView({ token }: { token: string }) {
  // POST/PATCH /hr/employees dan POST /hr/assignments semuanya dijaga employee.manage, jadi
  // form tambah/ubah karyawan dan panel assignment disembunyikan utuh bila token tidak
  // memegang permission itu. Tabel dan pencarian tetap read-only dan tidak terpengaruh.
  const { canAll, identity } = usePermissions(token);
  const canManageEmployees = canAll('employee.manage');
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [departments, setDepartments] = useState<Department[]>([]);
  const [positions, setPositions] = useState<Position[]>([]);
  // Department and position are created from this page because the employee and assignment forms
  // both read them from GET /hr/departments and GET /hr/positions. Both creates are gated
  // employee.manage, exactly like the employee form, and both were previously reachable only by
  // inserting a row by hand.
  const [departmentForm, setDepartmentForm] = useState({ code: '', name: '', parentId: '' });
  const [positionForm, setPositionForm] = useState({ code: '', name: '', grade: '', departmentId: '' });
  const [masterMessage, setMasterMessage] = useState('');
  const [assignmentEmployeeId, setAssignmentEmployeeId] = useState('');
  const [assignments, setAssignments] = useState<EmployeeAssignment[]>([]);
  const [assignmentForm, setAssignmentForm] = useState({ departmentId: '', positionId: '', managerEmployeeId: '', effectiveFrom: new Date().toLocaleDateString('en-CA'), effectiveTo: '', isPrimary: true });
  const [assignmentMessage, setAssignmentMessage] = useState('');
  const [form, setForm] = useState<EmployeeForm>(() => initialForm());
  const [editingId, setEditingId] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');

  async function api<T>(path: string, init?: RequestInit): Promise<T> {
    const response = await authFetch(`${API}${path}`, token, {
      ...init,
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
        ...(init?.headers ?? {}),
      },
    });
    const data = await response.json();
    if (!response.ok) {
      throw new Error(Array.isArray(data.message) ? data.message.join(', ') : data.message ?? 'Permintaan gagal.');
    }
    return data as T;
  }

  async function refresh(searchTerm = search) {
    const query = new URLSearchParams({ limit: '100' });
    if (searchTerm.trim()) query.set('search', searchTerm.trim());
    const [employeeData, departmentData, positionData] = await Promise.all([
      // The people workspace gate is employee|attendance|payroll|leave|overtime, so an EMPLOYEE,
      // WAREHOUSE, FINANCE or AUDITOR passes it without holding employee.view — EMPLOYEE has only
      // employee.self. The 403 from the roster read rejected all three and left the workspace
      // blank for exactly the roles that reach it through a sibling permission. The search term
      // is applied inside the fetcher, after the permission decision.
      readOptional(identity, '/hr/employees', [] as Employee[] | CursorResponse<Employee>, () => api<Employee[] | CursorResponse<Employee>>(`/hr/employees?${query.toString()}`)),
      readOptional(identity, '/hr/departments', [] as Department[], () => api<Department[]>('/hr/departments')),
      readOptional(identity, '/hr/positions', [] as Position[], () => api<Position[]>('/hr/positions')),
    ]);
    setEmployees(rowsOf(employeeData));
    setDepartments(departmentData.filter((row) => row.isActive !== false));
    setPositions(positionData.filter((row) => row.isActive !== false));
  }

  useEffect(() => {
    void refresh().catch((error) => setMessage(error instanceof Error ? error.message : 'Gagal memuat employee master.'));
  }, [token]);

  const availablePositions = useMemo(
    () => positions.filter((row) => !form.departmentId || !row.departmentId || row.departmentId === form.departmentId),
    [positions, form.departmentId],
  );

  async function loadAssignments(employeeId: string) {
    setAssignmentEmployeeId(employeeId);
    if (!employeeId) { setAssignments([]); return; }
    try {
      setAssignments(await api<EmployeeAssignment[]>(`/hr/employees/${employeeId}/assignments`));
    } catch (error) { setAssignmentMessage(error instanceof Error ? error.message : 'Gagal memuat riwayat assignment.'); }
  }

  async function createDepartment(event: FormEvent) {
    event.preventDefault();
    if (busy) return;
    setBusy(true); setMasterMessage('');
    try {
      // CreateDepartmentDto: code and name required, parentId optional UUID. companyId is
      // deliberately NOT sent — it comes from the token, and the DTO only keeps it for legacy.
      await api('/hr/departments', { method: 'POST', body: JSON.stringify({
        code: departmentForm.code.trim(),
        name: departmentForm.name.trim(),
        parentId: departmentForm.parentId || undefined,
      }) });
      setDepartmentForm({ code: '', name: '', parentId: '' });
      await refresh();
      setMasterMessage('Departemen berhasil dibuat.');
    } catch (error) { setMasterMessage(error instanceof Error ? error.message : 'Departemen gagal dibuat.'); }
    finally { setBusy(false); }
  }

  async function createPosition(event: FormEvent) {
    event.preventDefault();
    if (busy) return;
    setBusy(true); setMasterMessage('');
    try {
      // CreatePositionDto: code and name required; departmentId and grade optional.
      await api('/hr/positions', { method: 'POST', body: JSON.stringify({
        code: positionForm.code.trim(),
        name: positionForm.name.trim(),
        grade: positionForm.grade.trim() || undefined,
        departmentId: positionForm.departmentId || undefined,
      }) });
      setPositionForm({ code: '', name: '', grade: '', departmentId: '' });
      await refresh();
      setMasterMessage('Jabatan berhasil dibuat.');
    } catch (error) { setMasterMessage(error instanceof Error ? error.message : 'Jabatan gagal dibuat.'); }
    finally { setBusy(false); }
  }

  async function saveAssignment() {
    setBusy(true); setAssignmentMessage('');
    try {
      if (!assignmentEmployeeId) throw new Error('Pilih karyawan terlebih dahulu.');
      if (!assignmentForm.effectiveFrom) throw new Error('Tanggal mulai wajib diisi.');
      if (assignmentForm.effectiveTo && assignmentForm.effectiveTo < assignmentForm.effectiveFrom) throw new Error('Tanggal akhir tidak boleh sebelum tanggal mulai.');
      await api('/hr/assignments', { method: 'POST', body: JSON.stringify({
        employeeId: assignmentEmployeeId,
        departmentId: assignmentForm.departmentId || undefined,
        positionId: assignmentForm.positionId || undefined,
        managerEmployeeId: assignmentForm.managerEmployeeId || undefined,
        effectiveFrom: assignmentForm.effectiveFrom,
        effectiveTo: assignmentForm.effectiveTo || undefined,
        isPrimary: assignmentForm.isPrimary,
      }) });
      setAssignmentForm((current) => ({ ...current, effectiveTo: '' }));
      await loadAssignments(assignmentEmployeeId);
      await refresh();
      setAssignmentMessage('Assignment baru tercatat. Riwayat memakai rentang tanggal, jadi perubahan jabatan tidak menghapus data lama.');
    } catch (error) { setAssignmentMessage(error instanceof Error ? error.message : 'Gagal menyimpan assignment.'); }
    finally { setBusy(false); }
  }

  function resetForm() {
    setEditingId(null);
    setForm(initialForm());
  }

  function startEdit(employee: Employee) {
    setEditingId(employee.id);
    setForm({
      employeeNumber: employee.employeeNumber,
      fullName: employee.fullName,
      email: employee.email ?? '',
      phone: employee.phone ?? '',
      departmentId: employee.departmentId ?? '',
      positionId: employee.positionId ?? '',
      employmentStatus: employee.employmentStatus,
      hireDate: dateOnly(employee.hireDate),
      contractEnd: dateOnly(employee.contractEnd),
    });
    setMessage('');
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setMessage('');
    try {
      if (editingId) {
        await api<Employee>(`/hr/employees/${editingId}`, {
          method: 'PATCH',
          body: JSON.stringify({
            fullName: form.fullName.trim(),
            email: form.email.trim() || undefined,
            phone: form.phone.trim() || undefined,
            departmentId: form.departmentId || null,
            positionId: form.positionId || null,
            employmentStatus: form.employmentStatus,
          }),
        });
        setMessage('Data karyawan berhasil diperbarui.');
      } else {
        await api<Employee>('/hr/employees', {
          method: 'POST',
          body: JSON.stringify({
            employeeNumber: form.employeeNumber.trim(),
            fullName: form.fullName.trim(),
            email: form.email.trim() || undefined,
            phone: form.phone.trim() || undefined,
            departmentId: form.departmentId || undefined,
            positionId: form.positionId || undefined,
            employmentStatus: form.employmentStatus,
            hireDate: form.hireDate,
            contractEnd: form.contractEnd || undefined,
          }),
        });
        setMessage('Karyawan berhasil dibuat.');
      }
      resetForm();
      await refresh();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Gagal menyimpan karyawan.');
    } finally {
      setBusy(false);
    }
  }

  async function toggleActive(employee: Employee) {
    setBusy(true);
    setMessage('');
    try {
      await api<Employee>(`/hr/employees/${employee.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ isActive: !employee.isActive }),
      });
      if (editingId === employee.id) resetForm();
      setMessage(employee.isActive ? 'Karyawan dinonaktifkan.' : 'Karyawan diaktifkan kembali.');
      await refresh();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Gagal mengubah status karyawan.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <section className="grid2">
        <form className="panel" onSubmit={submit}>
          <div className="panelTitle">
            <div>
              <span className="eyebrow">EMPLOYEE MASTER</span>
              <h2>{editingId ? 'Edit karyawan' : 'Tambah karyawan'}</h2>
            </div>
            {editingId && <button type="button" className="secondary" disabled={busy} onClick={resetForm}>Batal edit</button>}
          </div>

          <label>NIP / Employee Number
            <input required disabled={Boolean(editingId)} value={form.employeeNumber} onChange={(event) => setForm({ ...form, employeeNumber: event.target.value })} />
          </label>
          <label>Nama lengkap
            <input required value={form.fullName} onChange={(event) => setForm({ ...form, fullName: event.target.value })} />
          </label>
          <div className="inline">
            <label>Email
              <input type="email" value={form.email} onChange={(event) => setForm({ ...form, email: event.target.value })} />
            </label>
            <label>Telepon
              <input value={form.phone} onChange={(event) => setForm({ ...form, phone: event.target.value })} />
            </label>
          </div>
          <div className="inline">
            <label>Department
              <select value={form.departmentId} onChange={(event) => setForm({ ...form, departmentId: event.target.value, positionId: '' })}>
                <option value="">Tanpa department</option>
                {departments.map((row) => <option key={row.id} value={row.id}>{row.code} · {row.name}</option>)}
              </select>
            </label>
            <label>Position
              <select value={form.positionId} onChange={(event) => setForm({ ...form, positionId: event.target.value })}>
                <option value="">Tanpa position</option>
                {availablePositions.map((row) => <option key={row.id} value={row.id}>{row.code} · {row.name}</option>)}
              </select>
            </label>
          </div>
          <label>Status kepegawaian
            <select value={form.employmentStatus} onChange={(event) => setForm({ ...form, employmentStatus: event.target.value as EmploymentStatus })}>
              {EMPLOYMENT_STATUSES.map((status) => <option key={status} value={status}>{status.replaceAll('_', ' ')}</option>)}
            </select>
          </label>
          {!editingId && <div className="inline">
            <label>Tanggal masuk
              <input type="date" required value={form.hireDate} onChange={(event) => setForm({ ...form, hireDate: event.target.value })} />
            </label>
            <label>Kontrak berakhir
              <input type="date" value={form.contractEnd} onChange={(event) => setForm({ ...form, contractEnd: event.target.value })} />
            </label>
          </div>}
          {canManageEmployees && <button disabled={busy}>{busy ? 'Menyimpan…' : editingId ? 'Simpan perubahan' : 'Tambah karyawan'}</button>}
        </form>

        <Panel eyebrow="TENANT-SAFE HRIS" title="Kontrol operator" badge={`${employees.filter((row) => row.isActive).length} aktif`}>
          <p className="sectionHelp">Company dan branch tidak dipilih dari form. Scope selalu berasal dari identitas login dan diverifikasi ulang oleh API.</p>
          <form onSubmit={(event) => { event.preventDefault(); void refresh().catch((error) => setMessage(error instanceof Error ? error.message : 'Pencarian gagal.')); }}>
            <label>Cari karyawan
              <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="NIP, nama, atau email" />
            </label>
            <div className="inlineActions">
              <button type="submit" className="secondary" disabled={busy}>Cari</button>
              <button type="button" className="secondary" disabled={busy || !search} onClick={() => { setSearch(''); void refresh(''); }}>Reset</button>
            </div>
          </form>
          {message && <div className="notice sectionBlock">{message}</div>}
        </Panel>
      </section>

      <Panel eyebrow="HRIS" title="Daftar Karyawan" badge={`${employees.length} orang`}>
        <Table
          head={['NIP', 'Nama', 'Department', 'Position', 'Status', 'Aksi']}
          rows={employees.map((employee) => {
            const department = departments.find((row) => row.id === employee.departmentId);
            const position = positions.find((row) => row.id === employee.positionId);
            return [
              <strong>{employee.employeeNumber}</strong>,
              employee.fullName,
              department?.name ?? '-',
              position?.name ?? '-',
              <StatusChip status={employee.isActive === false ? 'NONAKTIF' : employee.employmentStatus} />,
              <span className="inlineActions">
                <button type="button" className="secondary" disabled={busy} onClick={() => void loadAssignments(employee.id)}>Assignment</button>
                {canManageEmployees && <><button type="button" className="secondary" disabled={busy} onClick={() => startEdit(employee)}>Edit</button>
                <button type="button" className="secondary" disabled={busy} onClick={() => void toggleActive(employee)}>{employee.isActive === false ? 'Aktifkan' : 'Nonaktifkan'}</button></>}
              </span>,
            ];
          })}
          empty="Belum ada karyawan pada branch ini."
        />
      </Panel>

      <Panel eyebrow="POSISI & RIWAYAT JABATAN" title="Employee Assignment" badge={assignmentEmployeeId ? employees.find((row) => row.id === assignmentEmployeeId)?.fullName ?? '' : 'belum dipilih'}>
        <p className="sectionHelp">Assignment bersifat effective-dated: satu karyawan dapat memiliki beberapa riwayat jabatan, jabatan, dan atasan. Endpoint ini ada di backend tetapi sebelumnya tidak dapat alcanzado dari UI sama sekali.</p>
        <form className="formStack" onSubmit={(event) => { event.preventDefault(); void saveAssignment(); }}>
          <label>Karyawan<select value={assignmentEmployeeId} onChange={(event) => void loadAssignments(event.target.value)} required>
            <option value="">Pilih karyawan</option>
            {employees.map((employee) => <option key={employee.id} value={employee.id}>{employee.employeeNumber} · {employee.fullName}</option>)}
          </select></label>
          <div className="grid2">
            <label>Department<select value={assignmentForm.departmentId} onChange={(event) => setAssignmentForm({ ...assignmentForm, departmentId: event.target.value, positionId: '' })}>
              <option value="">-</option>
              {departments.map((row) => <option key={row.id} value={row.id}>{row.name}</option>)}
            </select></label>
            <label>Position<select value={assignmentForm.positionId} onChange={(event) => setAssignmentForm({ ...assignmentForm, positionId: event.target.value })}>
              <option value="">-</option>
              {positions.filter((row) => !assignmentForm.departmentId || !row.departmentId || row.departmentId === assignmentForm.departmentId).map((row) => <option key={row.id} value={row.id}>{row.name}{row.grade ? ` · ${row.grade}` : ''}</option>)}
            </select></label>
          </div>
          <label>Atasan langsung<select value={assignmentForm.managerEmployeeId} onChange={(event) => setAssignmentForm({ ...assignmentForm, managerEmployeeId: event.target.value })}>
            <option value="">-</option>
            {employees.filter((row) => row.id !== assignmentEmployeeId).map((row) => <option key={row.id} value={row.id}>{row.employeeNumber} · {row.fullName}</option>)}
          </select></label>
          <div className="grid2">
            <label>Berlaku dari<input type="date" value={assignmentForm.effectiveFrom} onChange={(event) => setAssignmentForm({ ...assignmentForm, effectiveFrom: event.target.value })} required /></label>
            <label>Sampai (opsional)<input type="date" value={assignmentForm.effectiveTo} onChange={(event) => setAssignmentForm({ ...assignmentForm, effectiveTo: event.target.value })} /></label>
          </div>
          <label className="checkRow"><input type="checkbox" checked={assignmentForm.isPrimary} onChange={(event) => setAssignmentForm({ ...assignmentForm, isPrimary: event.target.checked })} /> Assignment utama</label>
          {canManageEmployees && <button disabled={busy || !assignmentEmployeeId}>Simpan assignment</button>}
        </form>
        {assignmentMessage && <div className="notice sectionBlock">{assignmentMessage}</div>}
        <Table
          head={['Department', 'Position', 'Atasan', 'Berlaku', 'Sampai', 'Utama']}
          rows={assignments.map((row) => [
            departments.find((item) => item.id === row.departmentId)?.name ?? '-',
            positions.find((item) => item.id === row.positionId)?.name ?? '-',
            row.managerEmployeeId ? (employees.find((item) => item.id === row.managerEmployeeId)?.fullName ?? row.managerEmployeeId) : '-',
            tanggal(row.effectiveFrom),
            row.effectiveTo ? tanggal(row.effectiveTo) : 'berlaku',
            <StatusChip status={row.isPrimary ? 'PRIMARY' : 'SIDE'} />,
          ])}
          empty={assignmentEmployeeId ? 'Belum ada riwayat assignment untuk karyawan ini.' : 'Pilih karyawan untuk melihat riwayat assignment.'}
        />
      </Panel>

      <Panel title="Departemen & Jabatan" eyebrow="R · MASTER">
        <p className="sectionBlock">Form ini ada karena select di form karyawan dan assignment membaca dari endpoint yang sama, jadi menambah departemen atau jabatan sebelumnya hanya bisa lewat insert manual ke database.</p>
        {/* POST /hr/departments dan POST /hr/positions keduanya di gate employee.manage, sama
            seperti form karyawan, jadi form disembunyikan utuh bila token tidak memegangnya. */}
        {canManageEmployees && <div className="grid2">
          <form onSubmit={createDepartment}><h4>Tambah departemen</h4><label>Kode<input required value={departmentForm.code} onChange={(event) => setDepartmentForm({ ...departmentForm, code: event.target.value })} /></label><label>Nama<input required value={departmentForm.name} onChange={(event) => setDepartmentForm({ ...departmentForm, name: event.target.value })} /></label><label>Induk (opsional)<select value={departmentForm.parentId} onChange={(event) => setDepartmentForm({ ...departmentForm, parentId: event.target.value })}><option value="">-</option>{departments.map((row) => <option key={row.id} value={row.id}>{row.name}</option>)}</select></label><button disabled={busy}>Simpan departemen</button></form>
          <form onSubmit={createPosition}><h4>Tambah jabatan</h4><label>Kode<input required value={positionForm.code} onChange={(event) => setPositionForm({ ...positionForm, code: event.target.value })} /></label><label>Nama<input required value={positionForm.name} onChange={(event) => setPositionForm({ ...positionForm, name: event.target.value })} /></label><label>Grade (opsional)<input value={positionForm.grade} onChange={(event) => setPositionForm({ ...positionForm, grade: event.target.value })} /></label><label>Departemen (opsional)<select value={positionForm.departmentId} onChange={(event) => setPositionForm({ ...positionForm, departmentId: event.target.value })}><option value="">-</option>{departments.map((row) => <option key={row.id} value={row.id}>{row.name}</option>)}</select></label><button disabled={busy}>Simpan jabatan</button></form>
        </div>}
        {masterMessage && <div className="notice sectionBlock">{masterMessage}</div>}
        <div className="grid2">
          <Table head={['Kode', 'Departemen', 'Induk']} rows={departments.map((row) => [row.code, row.name, row.parentId ? (departments.find((item) => item.id === row.parentId)?.name ?? row.parentId) : '-'])} empty="Belum ada departemen." />
          <Table head={['Kode', 'Jabatan', 'Grade', 'Departemen']} rows={positions.map((row) => [row.code, row.name, row.grade ?? '-', row.departmentId ? (departments.find((item) => item.id === row.departmentId)?.name ?? row.departmentId) : '-'])} empty="Belum ada jabatan." />
        </div>
      </Panel>
    </>
  );
}
