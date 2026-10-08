/**
 * Supervisor approval dialog for the POS.
 *
 * The backend already splits privileged actions across roles (a CASHIER files a return, a FINANCE
 * user confirms the refund), but the till had no way to BE that approver: there was no dialog, no
 * PIN, and no grant. A control the operator cannot satisfy is a control that gets disabled.
 *
 * Design constraints that came out of looking at the real till:
 *
 *   - **It must not block the normal path.** A cashier selling normal items never sees this. It
 *     appears only when an action actually needs approval, and it can be dismissed.
 *   - **It must never cache a PIN or a grant beyond its own scope.** The PIN goes to the API, the
 *     API returns a single-use grant id, and that id is held in component state for the lifetime of
 *     one checkout attempt. It is not written to localStorage and not kept in a module variable,
 *     because a grant that survives a page reload is a standing permission.
 *   - **Failure must be legible.** A wrong PIN says so; an unconfigured branch says THAT, because
 *     "PIN salah" when no PIN exists sends the cashier hunting for a supervisor who cannot help.
 */
import { useCallback, useState } from 'react';

/** Mirrors the API's `PrivilegedAction` union. The POS never opens the dialog for SALE_REFUND. */
export type PrivilegedAction =
  | 'SALE_PRICE_OVERRIDE'
  | 'SALE_LINE_DISCOUNT'
  | 'SALE_CASH_MOVEMENT'
  | 'SHIFT_CLOSE';

export type ApprovalResult = {
  grantId: string;
  approvedByName: string;
  approvedAt: string;
};

export type ApprovalApi = {
  status: (token: string) => Promise<{ configured: boolean; approverName: string | null }>;
  approve: (token: string, pin: string, action: PrivilegedAction, reason: string) => Promise<ApprovalResult>;
};

export type SupervisorGate = {
  /** Is the dialog open, and for which action? */
  pending: { action: PrivilegedAction; reason: string } | null;
  /** True when no approver exists — the UI should disable the action instead of prompting. */
  unavailable: boolean;
  error: string;
  busy: boolean;
  /** Re-read whether the branch has an approver. Call after a PIN is set, or on reconnect. */
  refresh: () => Promise<void>;
  open: (action: PrivilegedAction, reason: string) => void;
  cancel: () => void;
  /** Returns the grant on success, or null when the operator cancels or the PIN is wrong. */
  submit: (pin: string) => Promise<ApprovalResult | null>;
  /** Consume the held grant for the next API call, then forget it. */
  takeGrant: () => string | null;
};

/**
 * @param api      the two endpoints, injected so this hook is testable without a server
 * @param token    the operator's session token
 * @param loadStatus called once on mount to learn whether an approver is configured
 */
export function useSupervisorApproval(
  api: ApprovalApi,
  token: string | null,
  loadStatus: () => Promise<{ configured: boolean; approverName: string | null }>,
): SupervisorGate {
  const [pending, setPending] = useState<{ action: PrivilegedAction; reason: string } | null>(null);
  const [grant, setGrant] = useState<ApprovalResult | null>(null);
  const [configured, setConfigured] = useState<boolean | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(async () => {
    if (!token) { setConfigured(false); return; }
    try {
      const status = await loadStatus();
      setConfigured(status.configured);
    } catch {
      // Unknown is treated as "assume unavailable" rather than "assume available". Failing closed
      // means a network blip cannot unlock a privileged action; it only blocks one.
      setConfigured(false);
    }
  }, [token, loadStatus]);

  const open = useCallback((action: PrivilegedAction, reason: string) => {
    setError('');
    setPending({ action, reason });
  }, []);

  const cancel = useCallback(() => {
    setPending(null);
    setError('');
    setBusy(false);
  }, []);

  const submit = useCallback(async (pin: string): Promise<ApprovalResult | null> => {
    // No session, no approval: the PIN is checked against the operator's company by the API.
    if (!pending || !token) { setError('Sesi kasir tidak aktif. Masuk ulang sebelum meminta persetujuan.'); return null; }
    if (!/^\d{4,8}$/.test(pin.trim())) {
      setError('Masukkan PIN 4-8 digit.');
      return null;
    }
    setBusy(true);
    setError('');
    try {
      const result = await api.approve(token, pin.trim(), pending.action, pending.reason);
      setGrant(result);
      setPending(null);
      return result;
    } catch (caught) {
      const message = caught instanceof Error ? caught.message : 'Persetujuan supervisor gagal.';
      setError(message);
      return null;
    } finally {
      setBusy(false);
    }
  }, [api, pending, token]);

  const takeGrant = useCallback(() => {
    const id = grant?.grantId ?? null;
    setGrant(null);
    return id;
  }, [grant]);

  return { pending, unavailable: configured === false, error, busy, open, cancel, submit, takeGrant, refresh };
}
