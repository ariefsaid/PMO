import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { cn } from './cn';
import { Icon, type IconName } from './icons';

export type ToastKind = 'info' | 'success' | 'warning' | 'error';

interface ToastData {
  id: number;
  kind: ToastKind;
  title: string;
  sub?: string;
}

const KIND_STRIPE: Record<ToastKind, string> = {
  info: 'border-l-primary [&_svg]:text-primary',
  success: 'border-l-success [&_svg]:text-success',
  warning: 'border-l-warning [&_svg]:text-warning-foreground',
  error: 'border-l-destructive [&_svg]:text-destructive',
};

const KIND_ICON: Record<ToastKind, IconName> = {
  info: 'inbox',
  success: 'check',
  warning: 'alert',
  error: 'alert',
};

/** Presentational toast (also the unit-test surface). */
export const ToastView: React.FC<{
  kind: ToastKind;
  title: string;
  sub?: string;
  announce?: boolean;
  moreCount?: number;
}> = ({ kind, title, sub, announce = true, moreCount = 0 }) => {
  const { t } = useTranslation('common');
  return (
    <div
      {...(announce ? { role: kind === 'warning' || kind === 'error' ? 'alert' : 'status', 'aria-live': kind === 'warning' || kind === 'error' ? 'assertive' : 'polite' } : {})}
      className={cn(
        'toast-anim flex min-w-[230px] max-w-[360px] items-center gap-2.5 rounded-lg border border-l-[3px] border-border bg-popover px-3.5 py-[11px] text-[13.5px] shadow-[0_10px_30px_hsl(240_10%_8%/0.16)] [&_svg]:size-[17px] [&_svg]:shrink-0',
        KIND_STRIPE[kind]
      )}
    >
      <Icon name={KIND_ICON[kind]} />
      <div className="min-w-0 flex-1">
        <span className="font-semibold">{title}</span>
        {sub && <span className="ml-1 text-muted-foreground">{sub}</span>}
        {moreCount > 0 && <span className="ml-1 whitespace-nowrap text-muted-foreground">{t('toast.more', '+{{count}} more', { count: moreCount })}</span>}
      </div>
    </div>
  );
};

interface ToastApi {
  toast: {
    (title: string, kind?: ToastKind): void;
    (title: string, sub?: string, kind?: ToastKind): void;
  };
}
const ToastCtx = createContext<ToastApi | undefined>(undefined);

export const ToastProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [item, setItem] = useState<ToastData | null>(null);
  const queue = useRef<ToastData[]>([]);
  const [queueCount, setQueueCount] = useState(0);
  const [statusAnnouncement, setStatusAnnouncement] = useState('');
  const [alertAnnouncement, setAlertAnnouncement] = useState('');
  const seq = useRef(0);
  const itemRef = useRef<ToastData | null>(null);
  const lastAnnouncement = useRef<{ urgent: boolean; message: string } | null>(null);
  const announceQueuedUrgent = useCallback((message: string) => {
    if (alertAnnouncement === message) {
      setAlertAnnouncement('');
      setTimeout(() => setAlertAnnouncement(message), 0);
    } else {
      setAlertAnnouncement(message);
    }
  }, [alertAnnouncement]);

  const toast = useCallback((title: string, subOrKind?: string, kind?: ToastKind) => {
    const isKind = (value: string | undefined): value is ToastKind =>
      value === 'info' || value === 'success' || value === 'warning' || value === 'error';
    const resolvedKind = kind ?? (isKind(subOrKind) ? subOrKind : 'info');
    const sub = kind || !isKind(subOrKind) ? subOrKind : undefined;
    const next = { id: ++seq.current, kind: resolvedKind, title, sub };
    const current = itemRef.current;
    const urgent = resolvedKind === 'warning' || resolvedKind === 'error';
    const message = [title, sub].filter(Boolean).join(' ');
    const enqueue = (entry: ToastData, front = false) => {
      const existingIndex = queue.current.findIndex((queued) => queued.kind === entry.kind && queued.title === entry.title);
      if (existingIndex >= 0) {
        if (front && existingIndex > 0) {
          const updated = [...queue.current];
          const [existing] = updated.splice(existingIndex, 1);
          updated.unshift(existing);
          queue.current = updated;
          setQueueCount(updated.length);
        }
        return;
      }
      const updated = front ? [entry, ...queue.current] : [...queue.current, entry];
      if (updated.length > 5) {
        const routineIndex = updated.findIndex((queued) => queued.kind === 'info' || queued.kind === 'success');
        if (routineIndex >= 0) updated.splice(routineIndex, 1);
        else {
          const warningIndex = updated.findIndex((queued) => queued.kind === 'warning');
          if (warningIndex >= 0) updated.splice(warningIndex, 1);
          else if (!front) updated.pop(); // Never evict an already-queued error.
        }
      }
      queue.current = updated;
      setQueueCount(updated.length);
    };

    if (current?.kind === 'warning' && resolvedKind === 'error') {
      enqueue(current, true);
      itemRef.current = next;
      setItem(next);
      return;
    }
    if (current?.kind === 'warning' || current?.kind === 'error') {
      if (current.kind === 'error' && urgent) announceQueuedUrgent(message);
      if (current.kind !== resolvedKind || current.title !== title) enqueue(next);
      return;
    }
    itemRef.current = next;
    setItem(next);
  }, [announceQueuedUrgent]);

  // These regions are persistent for the lifetime of the provider. Content is added only
  // after a toast is fired; inserting a live region and its message together is unreliable.
  useEffect(() => {
    if (!item) {
      setStatusAnnouncement('');
      setAlertAnnouncement('');
      return;
    }
    const message = [item.title, item.sub].filter(Boolean).join(' ');
    const urgent = item.kind === 'warning' || item.kind === 'error';
    const repeated = lastAnnouncement.current?.urgent === urgent && lastAnnouncement.current.message === message;
    lastAnnouncement.current = { urgent, message };

    if (repeated) {
      setStatusAnnouncement('');
      setAlertAnnouncement('');
      const timer = setTimeout(() => {
        setStatusAnnouncement(urgent ? '' : message);
        setAlertAnnouncement(urgent ? message : '');
      }, 0);
      return () => clearTimeout(timer);
    }

    setStatusAnnouncement(urgent ? '' : message);
    setAlertAnnouncement(urgent ? message : '');
  }, [item]);

  const dismiss = useCallback(() => {
    const [next, ...rest] = queue.current;
    queue.current = rest;
    setQueueCount(rest.length);
    itemRef.current = next ?? null;
    setItem(next ?? null);
  }, []);

  return (
    <ToastCtx.Provider value={{ toast }}>
      {children}
      <div className="sr-only" role="status" aria-live="polite" aria-atomic="true">{statusAnnouncement}</div>
      <div className="sr-only" role="alert" aria-live="assertive" aria-atomic="true">{alertAnnouncement}</div>
      <div
        className="pointer-events-none fixed bottom-5 right-5 z-[1000] flex flex-col gap-2.5"
        style={{ transform: 'translateY(calc(0px - var(--mobile-action-bar-height, 0px)))' }}
      >
        {item && (
          <AutoDismiss key={item.id} kind={item.kind} textLength={item.title.length + (item.sub?.length ?? 0)} onDone={dismiss}>
            <div className="pointer-events-auto flex max-w-[min(360px,calc(100vw-40px))] items-start gap-1">
              <div aria-hidden="true" data-toast="visible" className="min-w-0 flex-1">
                <ToastView kind={item.kind} title={item.title} sub={item.sub} announce={false} moreCount={item.kind === 'warning' || item.kind === 'error' ? queueCount : 0} />
              </div>
              <DismissButton onClick={dismiss} />
            </div>
          </AutoDismiss>
        )}
      </div>
    </ToastCtx.Provider>
  );
};

const AutoDismiss: React.FC<{
  kind: ToastKind;
  textLength: number;
  onDone: () => void;
  children: React.ReactNode;
}> = ({ kind, textLength, onDone, children }) => {
  const persistent = kind === 'warning' || kind === 'error';
  const duration = Math.min(10_000, Math.max(4_000, 60 * textLength));
  const remaining = useRef(duration);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const startedAt = useRef(0);
  const paused = useRef(false);

  const start = useCallback(() => {
    if (persistent || paused.current || timer.current !== null) return;
    startedAt.current = Date.now();
    timer.current = setTimeout(() => {
      timer.current = null;
      onDone();
    }, remaining.current);
  }, [onDone, persistent]);

  const pause = useCallback(() => {
    if (persistent || paused.current) return;
    paused.current = true;
    if (timer.current !== null) {
      clearTimeout(timer.current);
      timer.current = null;
      remaining.current = Math.max(0, remaining.current - (Date.now() - startedAt.current));
    }
  }, [persistent]);

  const resume = useCallback(() => {
    if (persistent || !paused.current) return;
    paused.current = false;
    start();
  }, [persistent, start]);

  useEffect(() => {
    start();
    return () => {
      if (timer.current !== null) clearTimeout(timer.current);
    };
  }, [start]);

  return (
    <div onMouseEnter={pause} onMouseLeave={resume} onFocusCapture={pause} onBlurCapture={(event) => {
      if (!event.currentTarget.contains(event.relatedTarget as Node | null)) resume();
    }}>
      {children}
    </div>
  );
};

const DismissButton: React.FC<{ onClick: () => void }> = ({ onClick }) => {
  const { t } = useTranslation('common');
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={t('toast.dismiss', 'Dismiss notification')}
      className="pointer-events-auto inline-flex size-8 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      <Icon name="x" />
    </button>
  );
};

// eslint-disable-next-line react-refresh/only-export-components -- hook co-located with its provider
export const useToast = (): ToastApi => {
  const ctx = useContext(ToastCtx);
  if (!ctx) throw new Error('useToast must be used within a ToastProvider');
  return ctx;
};
