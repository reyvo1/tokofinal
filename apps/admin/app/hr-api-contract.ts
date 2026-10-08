import type { AdminIdentity } from './navigation';

/** Mirrors HR, attendance, payroll and the two finance dependencies used by HR pages. */
export function hrReadPermission(path: string): string {
  const route = path.split('?')[0];
  if (route === '/accounting-core/accounts') return 'finance.view';
  if (route === '/payroll/tax-rule-sets') return 'tax.view';
  if (route.startsWith('/payroll/')) return 'payroll.view';
  if (route.startsWith('/attendance/')) return 'attendance.view';
  if (route.startsWith('/hr/leave-')) return 'leave.view';
  if (route.startsWith('/hr/overtime-')) return 'overtime.view';
  return 'employee.view';
}

export function canReadHrPath(identity: AdminIdentity | null, path: string): boolean {
  if (!identity) return false;
  if (path.split('?')[0] === '/accounting-core/accounts' && !identity.roles.some(role => ['SUPER_ADMIN', 'OWNER', 'FINANCE', 'AUDITOR'].includes(role))) return false;
  return identity.roles.includes('SUPER_ADMIN') || identity.permissions.includes(hrReadPermission(path));
}

export function shiftStatusPayload(shift: {
  code: string; name: string; startMinute: number; endMinute: number; isActive: boolean;
  crossesMidnight?: boolean; breakMinutes?: number; lateToleranceMinutes?: number;
  earlyLeaveToleranceMinutes?: number; minimumWorkMinutes?: number | null; overtimeAfterMinutes?: number | null;
}) {
  return {
    code: shift.code, name: shift.name, startMinute: shift.startMinute, endMinute: shift.endMinute,
    crossesMidnight: shift.crossesMidnight, breakMinutes: shift.breakMinutes,
    lateToleranceMinutes: shift.lateToleranceMinutes, earlyLeaveToleranceMinutes: shift.earlyLeaveToleranceMinutes,
    minimumWorkMinutes: shift.minimumWorkMinutes ?? undefined, overtimeAfterMinutes: shift.overtimeAfterMinutes ?? undefined,
    isActive: !shift.isActive,
  };
}

export function payrollRulePayload(kind: string, fields: { code: string; name: string; effectiveFrom: string; effectiveTo?: string; legalReference?: string; calculationMode: string; parameters: string }) {
  const parameters: unknown = JSON.parse(fields.parameters);
  if (!parameters || typeof parameters !== 'object' || Array.isArray(parameters)) throw new Error('Parameter aturan harus berupa objek JSON.');
  const { calculationMode, ...common } = fields;
  return { ...common, ...(kind === 'tax' ? { calculationMode } : {}), parameters };
}
