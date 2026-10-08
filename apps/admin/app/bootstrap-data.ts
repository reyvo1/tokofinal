import type { AdminIdentity } from './navigation';

// Mirrors the read guards on the existing controllers. The server remains authoritative.
const READ_ROLES: Record<string, string[]> = {
  reports: ['SUPER_ADMIN', 'OWNER', 'ADMIN', 'FINANCE', 'MANAGER', 'AUDITOR', 'HR', 'PAYROLL'],
  suppliers: ['SUPER_ADMIN', 'OWNER', 'ADMIN', 'PURCHASING', 'WAREHOUSE'],
  warehouses: ['SUPER_ADMIN', 'OWNER', 'ADMIN', 'WAREHOUSE', 'PURCHASING', 'CASHIER'],
  purchasing: ['SUPER_ADMIN', 'OWNER', 'ADMIN', 'PURCHASING', 'WAREHOUSE', 'FINANCE'],
  inventory: ['SUPER_ADMIN', 'OWNER', 'ADMIN', 'WAREHOUSE', 'PURCHASING', 'CASHIER', 'FINANCE'],
  movements: ['SUPER_ADMIN', 'OWNER', 'ADMIN', 'WAREHOUSE', 'PURCHASING', 'FINANCE'],
};

export function canReadAdminFeed(identity: AdminIdentity | null, feed: string): boolean {
  if (!identity) return false;
  const roles = READ_ROLES[feed];
  if (!roles || !identity.roles.some((role) => roles.includes(role))) return false;
  return true;
}

export async function settleAdminFeed<T>(load: () => Promise<T>, fallback: T, enabled = true): Promise<{ value: T; failed: boolean }> {
  if (!enabled) return { value: fallback, failed: false };
  try { return { value: await load(), failed: false }; }
  catch { return { value: fallback, failed: true }; }
}
