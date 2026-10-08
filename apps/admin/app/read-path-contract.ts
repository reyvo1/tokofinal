import type { AdminIdentity } from './navigation';

/**
 * A workspace is reachable by a menu gate, but its module bootstraps with a single
 * `Promise.all`. One endpoint that needs a permission the operator does not hold rejects the
 * whole batch, and the module renders `ErrorState` in place of the entire page — the operator
 * sees "Terjadi kendala" instead of a single missing panel.
 *
 * That is a real failure for legitimately-scoped roles. A CASHIER entering `commerce` passes the
 * `order|sale|shipment|payment` gate, but `operations.tsx` also calls `GET /returns/purchases`
 * (`purchase.return`) and `GET /master-data/warehouses` (`master_data.view`). Neither is in the
 * cashier's role, so the commerce workspace is blank for the person who uses it most.
 *
 * Fix: resolve each dependency independently and degrade to an empty slice when the operator
 * legitimately cannot read it. The controller keeps enforcing permissions; the UI simply stops
 * treating a forbidden optional panel as a fatal error for the whole page.
 */
const ROUTE_PERMISSION: ReadonlyArray<readonly [RegExp, string]> = [
  [/^\/hr\/leave-/, 'leave.view'],
  [/^\/hr\/overtime-/, 'overtime.view'],
  [/^\/hr\//, 'employee.view'],
  [/^\/attendance\//, 'attendance.view'],
  [/^\/payroll\/tax-rule-sets/, 'tax.view'],
  [/^\/payroll\//, 'payroll.view'],
  [/^\/platform\/business-rules/, 'automation.manage'],
  [/^\/platform\/automation-jobs/, 'automation.manage'],
  [/^\/reports\//, 'report.view'],
  [/^\/forecasts/, 'forecast.view'],
  [/^\/operator-insights/, 'assistant.use'],
  [/^\/operator-assistant\//, 'assistant.use'],
  [/^\/accounting-core\/tax-/, 'tax.view'],
  [/^\/accounting-core\//, 'finance.view'],
  [/^\/finance-operations\//, 'finance.view'],
  [/^\/returns\/sales/, 'sale.return'],
  [/^\/returns\/purchases/, 'purchase.return'],
  [/^\/returns\//, 'return.view'],
  [/^\/master-data\//, 'master_data.view'],
  [/^\/advanced-inventory\//, 'inventory.view'],
  [/^\/operations-control\/policies/, 'operations.policy.view'],
  [/^\/operations-control\//, 'inspection.view'],
  [/^\/fleet\//, 'fleet.view'],
  [/^\/assets\//, 'asset.view'],
  [/^\/delivery\//, 'delivery.trip.manage'],
  [/^\/inventory\//, 'inventory.view'],
  [/^\/purchase\//, 'purchase.view'],
  [/^\/supplier\//, 'supplier.view'],
  [/^\/product\//, 'product.view'],
  [/^\/sale\//, 'sale.view'],
  [/^\/order\//, 'order.view'],
  [/^\/payment\//, 'payment.view'],
];

/** Permission the backend requires to read `path`, mirroring the controller @Permissions. */
export function readPermissionFor(path: string): string {
  const route = path.split('?')[0];
  for (const [pattern, permission] of ROUTE_PERMISSION) {
    if (pattern.test(route)) return permission;
  }
  return 'system.manage';
}

/**
 * A subset of routes are additionally restricted by @Roles, and RolesGuard throws independently
 * of PermissionsGuard — so holding the permission is not enough. GET /returns/sales is
 * sale.return behind @Roles(CASHIER|WAREHOUSE|FINANCE), which is why a MANAGER, who passes the
 * commerce gate on sale.view and holds no sale.return, still cannot read it.
 *
 * Only the role-restricted reads that workspace bootstraps depend on are listed. Anything absent
 * is treated as role-open, so a route added to a controller without an entry here degrades to the
 * normal permission check rather than silently unlocking.
 */
const ROUTE_ROLES: ReadonlyArray<readonly [RegExp, readonly string[]]> = [
  [/^\/returns\/sales/, ['CASHIER', 'WAREHOUSE', 'FINANCE']],
  [/^\/returns\/orders/, ['WAREHOUSE', 'FINANCE']],
  [/^\/returns\/purchases/, ['PURCHASING', 'WAREHOUSE', 'FINANCE']],
  [/^\/advanced-inventory\/stock-opnames/, ['WAREHOUSE', 'AUDITOR']],
  [/^\/operations-control\/policies/, ['SUPER_ADMIN', 'OWNER', 'ADMIN', 'MANAGER']],
  [/^\/fleet\//, ['WAREHOUSE', 'AUDITOR']],
  [/^\/accounting-core\//, ['SUPER_ADMIN', 'OWNER', 'FINANCE', 'AUDITOR']],
  [/^\/reports\/schedules/, ['FINANCE', 'MANAGER', 'AUDITOR', 'HR', 'PAYROLL']],
];

export function canReadPath(identity: AdminIdentity | null, path: string): boolean {
  if (!identity) return false;
  if (identity.roles.includes('SUPER_ADMIN')) return true;
  const route = path.split('?')[0];
  for (const [pattern, allowed] of ROUTE_ROLES) {
    if (!pattern.test(route)) continue;
    if (!allowed.some(role => identity.roles.includes(role))) return false;
  }
  return identity.permissions.includes(readPermissionFor(path));
}

/**
 * Read a dependency that the current operator may not be allowed to read, returning `fallback`
 * instead of throwing. Pass this only for panels that are genuinely optional to the page — never
 * to hide a real failure, and never to widen what the controller accepts.
 *
 * `path` is the route the permission is derived from; `fetcher` receives it so the module's own
 * request helper stays the single place that knows about auth headers and transport. Modules that
 * already close over their helper can ignore the argument.
 */
export async function readOptional<T>(identity: AdminIdentity | null, path: string, fallback: T, fetcher: (path: string) => Promise<T>): Promise<T> {
  if (!canReadPath(identity, path)) return fallback;
  try {
    return await fetcher(path);
  } catch (err) {
    // A 403 here means the gate and the controller disagree, or the token expired mid-load.
    // Swallowing it would hide a real outage, so only an authorization failure degrades.
    if (err instanceof Error && /\b(403|401)\b|Forbidden|Unauthorized/.test(err.message)) return fallback;
    throw err;
  }
}
