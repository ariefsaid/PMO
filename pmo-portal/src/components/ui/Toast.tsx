import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Toaster, toast as sonnerToast, type ToastClassnames } from 'sonner';
import { Icon, type IconName } from './icons';

export type ToastKind = 'info' | 'success' | 'warning' | 'error';

const KIND_ICON: Record<ToastKind, IconName> = {
  info: 'inbox',
  success: 'check',
  warning: 'alert',
  error: 'alert',
};

const KIND_ICON_TONE: Record<ToastKind, string> = {
  info: 'text-muted-foreground',
  success: 'text-success',
  warning: 'text-warning-foreground',
  error: 'text-destructive',
};

const isUrgentKind = (kind: ToastKind) => kind === 'warning' || kind === 'error';

/** Emit + style come from the library surface; every class is a DESIGN.md token. */
const TOAST_CLASSNAMES: ToastClassnames = {
  toast: 'pointer-events-auto flex w-[min(360px,calc(100vw-2.5rem))] items-start gap-2 rounded-overlay border border-border bg-card px-3 py-3 text-control text-foreground shadow-[var(--shadow-lg)] [&_svg]:size-4 [&_svg]:shrink-0',
  content: 'min-w-0 flex-1',
  title: 'font-semibold',
  description: 'text-muted-foreground',
  closeButton:
    'absolute left-0 top-0 z-10 flex size-[var(--control-height-sm)] -translate-x-1/3 -translate-y-1/3 items-center justify-center rounded-full border border-border bg-card text-muted-foreground hover:bg-surface-hover hover:text-foreground active:bg-surface-pressed focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
  success: 'save-pulse',
};

const TOAST_ICONS: React.ComponentProps<typeof Toaster>['icons'] = {
  info: <Icon name={KIND_ICON.info} className={KIND_ICON_TONE.info} />,
  success: <Icon name={KIND_ICON.success} className={KIND_ICON_TONE.success} />,
  warning: <Icon name={KIND_ICON.warning} className={KIND_ICON_TONE.warning} />,
  error: <Icon name={KIND_ICON.error} className={KIND_ICON_TONE.error} />,
  close: <Icon name="x" />,
};

interface ToastApi {
  toast: {
    (title: string, kind?: ToastKind): number;
    (title: string, sub?: string, kind?: ToastKind): number;
  };
  dismiss: (id: number) => void;
  clear: () => void;
}
const ToastCtx = createContext<ToastApi | undefined>(undefined);

interface ActiveNotice {
  kind: ToastKind;
  message: string;
  order: number;
}

/**
 * Toasts on Sonner (stacking, swipe-away, pause on hover/focus, alt+T hotkey,
 * reduced-motion off) styled purely with DESIGN.md tokens. This module keeps the
 * app's call API (`toast(title, sub?, kind?)`, `dismiss`, `clear`) and owns the two
 * persistent announcement regions: the polite `role="status"` region mirrors the
 * newest routine toast, the assertive `role="alert"` region mirrors the newest
 * warning/error — remedies stay announced until they leave.
 *
 * The `[data-toast-container]` seam is placement state only: an open `aria-modal`
 * overlay moves the stack to the safe top edge; a side drawer additionally tucks it
 * below its measured header band (`--toast-top-inset`, re-measured on resize —
 * issue 1816) so a remedy never covers the drawer's title or footer actions.
 */
export const ToastProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { t } = useTranslation('common');
  const [statusAnnouncement, setStatusAnnouncement] = useState('');
  const [alertAnnouncement, setAlertAnnouncement] = useState('');
  const statusRef = useRef('');
  const alertRef = useRef('');
  const lastAnnouncement = useRef<{ urgent: boolean; message: string } | null>(null);
  const active = useRef(new Map<number, ActiveNotice>());
  const seq = useRef(0);

  const putSlot = useCallback((urgent: boolean, message: string) => {
    if (urgent) {
      alertRef.current = message;
      setAlertAnnouncement(message);
    } else {
      statusRef.current = message;
      setStatusAnnouncement(message);
    }
  }, []);

  const announce = useCallback(
    (kind: ToastKind, message: string) => {
      const urgent = isUrgentKind(kind);
      const previous = lastAnnouncement.current;
      lastAnnouncement.current = { urgent, message };
      if (previous && previous.urgent === urgent && previous.message === message) {
        // Re-announce an identical message by clearing and restoring the region.
        putSlot(urgent, '');
        setTimeout(() => putSlot(urgent, message), 0);
        return;
      }
      putSlot(urgent, message);
    },
    [putSlot],
  );

  const forget = useCallback(
    (id: number) => {
      const removed = active.current.get(id);
      if (!removed || !active.current.delete(id)) return;
      const urgent = isUrgentKind(removed.kind);
      const slotMessage = urgent ? alertRef.current : statusRef.current;
      if (slotMessage !== removed.message) return; // A newer same-kind notice owns the region.
      const remaining = [...active.current.values()]
        .filter((notice) => isUrgentKind(notice.kind) === urgent)
        .sort((a, b) => b.order - a.order);
      const nextMessage = remaining[0]?.message ?? '';
      if (nextMessage !== slotMessage) putSlot(urgent, nextMessage);
    },
    [putSlot],
  );

  const toast = useCallback(
    (title: string, subOrKind?: string, kind?: ToastKind): number => {
      const isKind = (value: string | undefined): value is ToastKind =>
        value === 'info' || value === 'success' || value === 'warning' || value === 'error';
      const resolvedKind = kind ?? (isKind(subOrKind) ? subOrKind : 'info');
      const sub = kind || !isKind(subOrKind) ? subOrKind : undefined;
      const message = [title, sub].filter(Boolean).join(' ');
      // Warnings and errors carry remedies, so they persist until dismissed; routine notices
      // stay max(4s, 60ms per character), capped at 10s (DD-TOAST-1).
      const id = sonnerToast[resolvedKind](title, {
        description: sub,
        duration: isUrgentKind(resolvedKind) ? Infinity : Math.min(10_000, Math.max(4_000, 60 * message.length)),
        onDismiss: () => forget(id),
        onAutoClose: () => forget(id),
      }) as number;
      active.current.set(id, { kind: resolvedKind, message, order: ++seq.current });
      announce(resolvedKind, message);
      return id;
    },
    [announce, forget],
  );

  const dismiss = useCallback(
    (id: number) => {
      forget(id); // Announcement upkeep is synchronous; the library removes the element.
      sonnerToast.dismiss(id);
    },
    [forget],
  );

  const clear = useCallback(() => {
    active.current.clear();
    lastAnnouncement.current = null;
    putSlot(false, '');
    putSlot(true, '');
    sonnerToast.dismiss();
  }, [putSlot]);

  const api = useMemo<ToastApi>(() => ({ toast, dismiss, clear }), [toast, dismiss, clear]);

  // Placement seam: measure open aria-modal overlays on every mutation/resize. An open
  // dialog moves the stack to the top edge; a side drawer is edge-anchored, so the
  // generic remedy would land its header — measure the live header band instead (1816).
  const [overlay, setOverlay] = useState<{ dialog: boolean; drawerInset: number | null }>({
    dialog: false,
    drawerInset: null,
  });
  useEffect(() => {
    const sync = () => {
      const overlays = document.querySelectorAll<HTMLElement>('[aria-modal="true"]');
      const drawer = Array.from(overlays).find((candidate) => candidate.hasAttribute('data-drawer-panel'));
      let drawerInset: number | null = null;
      if (drawer) {
        const header = drawer.querySelector<HTMLElement>(':scope > [data-drawer-header]');
        drawerInset = Math.ceil((header?.getBoundingClientRect().bottom ?? 0) + 12);
      }
      setOverlay((previous) => {
        const next = { dialog: overlays.length > 0, drawerInset };
        return previous.dialog === next.dialog && previous.drawerInset === next.drawerInset ? previous : next;
      });
    };
    sync();
    const observer = new MutationObserver(sync);
    observer.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['aria-modal'] });
    window.addEventListener('resize', sync);
    return () => {
      observer.disconnect();
      window.removeEventListener('resize', sync);
    };
  }, []);

  const atTop = overlay.dialog || overlay.drawerInset !== null;
  const topOffset = overlay.drawerInset !== null ? `${overlay.drawerInset}px` : 'max(12px, env(safe-area-inset-top))';
  const bottomOffset = 'calc(1.25rem + var(--mobile-action-bar-height, 0px) + var(--phone-nav-height, 0px))';

  return (
    <ToastCtx.Provider value={api}>
      {children}
      {/* Persistent for the provider's lifetime: content is added only after a toast fires,
          because inserting a live region and its message together is unreliable. */}
      <div className="sr-only" role="status" aria-live="polite" aria-atomic="true">
        {statusAnnouncement}
      </div>
      <div className="sr-only" role="alert" aria-live="assertive" aria-atomic="true">
        {alertAnnouncement}
      </div>
      <div
        data-toast-container
        aria-hidden="true"
        className="hidden"
        data-dialog-open={overlay.dialog ? 'true' : 'false'}
        {...(overlay.drawerInset !== null ? { 'data-overlay-drawer': 'true' } : {})}
        {...(overlay.drawerInset !== null ? { style: { '--toast-top-inset': `${overlay.drawerInset}px` } as React.CSSProperties } : {})}
      />
      <div aria-live="off">
      <Toaster
        // The two regions above own announcements; the library's own polite region would
        // read every toast a second time.
        ref={(section) => section?.removeAttribute('aria-live')}
        position={atTop ? 'top-right' : 'bottom-right'}
        offset={{ top: topOffset, right: '1.25rem', bottom: bottomOffset }}
        mobileOffset={{ top: topOffset, right: '1.25rem', bottom: bottomOffset }}
        gap={10}
        visibleToasts={4}
        theme="light"
        // Sonner defaults to a 999999999 stack; menus/popovers sit at 1010 and must stay above it.
        style={{ zIndex: 1000 } as React.CSSProperties}
        closeButton
        toastOptions={{ unstyled: true, classNames: TOAST_CLASSNAMES, closeButtonAriaLabel: t('toast.dismiss', 'Dismiss notification') }}
        icons={TOAST_ICONS}
      />
      </div>
    </ToastCtx.Provider>
  );
};

// eslint-disable-next-line react-refresh/only-export-components -- hook co-located with its provider
export const useToast = (): ToastApi => {
  const ctx = useContext(ToastCtx);
  if (!ctx) throw new Error('useToast must be used within a ToastProvider');
  return ctx;
};

/** Non-throwing `useToast` for hooks that may run outside a provider (a notice is then simply skipped). */
// eslint-disable-next-line react-refresh/only-export-components -- hook co-located with its provider
export const useOptionalToast = (): ToastApi | null => useContext(ToastCtx) ?? null;
