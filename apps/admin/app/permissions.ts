'use client';

import { useMemo } from 'react';

import { identityFromAccessToken } from './navigation';

/**
 * Operators need to know which lifecycle actions they can actually perform.
 *
 * The API gates each step of a lifecycle behind a *distinct* permission — payroll, for
 * example, separates payroll.calculate, payroll.approve, payroll.post and payroll.publish
 * — but until now every button in a workspace was rendered unconditionally. A user with
 * payroll.calculate therefore saw "Approve payroll" and only discovered the 403 after
 * clicking it. Hiding the control that cannot succeed is part of an honest UI, and it must
 * be derived from the same token the API will use, not from a second source of truth.
 */

/** SUPER_ADMIN bypasses permission checks server-side, so it must bypass here too. */
const UNRESTRICTED_ROLES = new Set(['SUPER_ADMIN']);

export function can(identity: ReturnType<typeof identityFromAccessToken>, permission: string): boolean {
  if (!identity) return false;
  if (identity.roles.some((role) => UNRESTRICTED_ROLES.has(role))) return true;
  return identity.permissions.includes(permission);
}

export function usePermissions(token: string | null | undefined) {
  const identity = useMemo(() => identityFromAccessToken(token), [token]);
  return useMemo(
    () => ({
      identity,
      /** True when the token grants every listed permission. */
      canAll: (...permissions: string[]) => permissions.every((permission) => can(identity, permission)),
      /** True when the token grants at least one listed permission. */
      canAny: (...permissions: string[]) => permissions.some((permission) => can(identity, permission)),
    }),
    [identity],
  );
}
