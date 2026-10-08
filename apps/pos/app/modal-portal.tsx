'use client';

import { ReactNode, useEffect, useState } from 'react';
import { createPortal } from 'react-dom';

/**
 * Renders a modal into `document.body` instead of in place.
 *
 * Why this exists, because it is not a stylistic choice:
 *
 *   .posWorkspaceSurface has `backdrop-blur-xl`.
 *   `backdrop-filter` (like `filter`, `transform`, `perspective` and `contain: paint`) makes the
 *   element a CONTAINING BLOCK for `position: fixed` descendants. Every POS modal used to be
 *   rendered inside that section, so `position: fixed; inset: 0` resolved against the section's box
 *   rather than the viewport. Measured in the browser: the overlay reported top=174 and height=1190
 *   inside a 900px viewport — anchored to a scrolling panel instead of the screen.
 *
 *   The visible result was that the dialog drifted with the panel and its footer fell below the fold.
 *   Fixing it with `max-h` on the card does not help, because the cap is a percentage of the wrong
 *   box. The only correct fix is to move the dialog out of that subtree, which is what this does.
 *
 * Escape key and backdrop click are handled here too, so the three call sites do not each reimplement
 * them. A modal that cannot be dismissed with Escape on a busy till is a cashier losing a sale.
 */
export function ModalPortal({
  children,
  onClose,
  labelledBy,
}: {
  children: ReactNode;
  onClose: () => void;
  labelledBy: string;
}) {
  // Portals need a real document. During SSR/hydration there is not one, so render nothing rather
  // than crashing: a cashier-facing screen must not throw because the first paint is server-side.
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  if (!mounted) return null;

  return createPortal(
    <div
      className="modalOverlay"
      role="dialog"
      aria-modal="true"
      aria-labelledby={labelledBy}
      onClick={(event) => {
        // Only a click on the backdrop itself dismisses. A click that started inside the card and
        // ended outside it must not, or a drag-select would close the dialog under the user.
        if (event.target === event.currentTarget) onClose();
      }}
    >
      {children}
    </div>,
    document.body,
  );
}

/**
 * Closes a modal on Escape.
 *
 * Deliberately a `document` listener, not `onKeyDown` on the overlay. The overlay is not focusable,
 * so a keydown only reaches it if focus happens to be on it — measured: pressing Escape with the
 * card open left the dialog on screen. On a busy till, Escape is the reflex for "get this off my
 * screen", and it has to work no matter where focus currently sits.
 *
 * Registered in the capture phase and only acts on Escape, so it never swallows typing in the
 * supervisor PIN field.
 */
export function useEscapeToClose(onClose: () => void, active = true) {
  useEffect(() => {
    if (!active) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.stopPropagation();
        onClose();
      }
    };
    document.addEventListener('keydown', onKeyDown, true);
    return () => document.removeEventListener('keydown', onKeyDown, true);
  }, [onClose, active]);
}

/**
 * Traps focus inside the open modal and restores it on close.
 *
 * Without this, Tab walks out of the dialog into the POS behind it, so a cashier who tabs to "Buat
 * voucher" lands on an invisible control. Cheap to get wrong, impossible to notice without trying.
 */
export function useModalFocus(active: boolean) {
  useEffect(() => {
    if (!active) return;
    const previous = document.activeElement as HTMLElement | null;
    const dialog = document.querySelector<HTMLElement>('[role="dialog"]');
    if (!dialog) return;

    const selector =
      'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';
    dialog.querySelector<HTMLElement>(selector)?.focus();

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Tab') return;
      const focusable = [...dialog.querySelectorAll<HTMLElement>(selector)];
      if (focusable.length === 0) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    dialog.addEventListener('keydown', onKeyDown);
    return () => {
      dialog.removeEventListener('keydown', onKeyDown);
      previous?.focus?.();
    };
  }, [active]);
}
