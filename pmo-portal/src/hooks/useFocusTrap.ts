import { useCallback } from 'react';

/**
 * useFocusTrap — reusable focus-trap utility for modal dialogs.
 *
 * Returns an `onKeyDown` handler that traps Tab / Shift+Tab within the
 * provided `rootRef` container.  Used by ConfirmDialog, EntityFormModal,
 * and the mobile rail drawer so the machinery is defined once.
 *
 * Usage:
 *   const onTrapKeyDown = useFocusTrap(dialogRef);
 *   <div ref={dialogRef} onKeyDown={onTrapKeyDown}>…</div>
 */
export function useFocusTrap(
  rootRef: React.RefObject<HTMLElement | null>,
  /** While `suspended` is true the trap yields (e.g. a nested dialog is open). */
  suspended = false,
) {
  return useCallback(
    (e: React.KeyboardEvent | KeyboardEvent) => {
      if (suspended) return;
      if (e.key !== 'Tab') return;
      const root = rootRef.current;
      if (!root) return;
      const focusables = root.querySelectorAll<HTMLElement>(
        'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
      );
      if (focusables.length === 0) return;
      const first = focusables[0];
      const last = focusables[focusables.length - 1];
      if ((e as KeyboardEvent).shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!(e as KeyboardEvent).shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    },
    [rootRef, suspended],
  );
}
