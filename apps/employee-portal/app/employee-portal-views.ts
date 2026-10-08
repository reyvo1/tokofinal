// Route/view contract for the employee portal.
//
// This lives in its own module on purpose: the route handlers under app/[view]/ are Server
// Components, and they used to import isEmployeePortalView() from employee-portal-shell.tsx,
// which is a 'use client' module. That made every /attendance, /leave, /overtime, /payslips,
// /history and /profile route crash with:
//
//   Attempted to call isEmployeePortalView() from the server but isEmployeePortalView is on
//   the client. It's not possible to invoke a client function from the server.
//
// The whole portal was unreachable from any sub-page. Server Components may import plain
// modules, so keeping the contract here fixes it without weakening the client boundary.

export const EMPLOYEE_PORTAL_VIEWS = [
  'home',
  'attendance',
  'leave',
  'overtime',
  'payslips',
  'history',
  'profile',
] as const;

export type EmployeePortalView = (typeof EMPLOYEE_PORTAL_VIEWS)[number];

export function isEmployeePortalView(value: string): value is EmployeePortalView {
  return (EMPLOYEE_PORTAL_VIEWS as readonly string[]).includes(value);
}
