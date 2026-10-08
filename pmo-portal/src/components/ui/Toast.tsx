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
}> = ({ kind, title, sub, announce = true }) => (
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
    </div>
  </div>
);

interface ToastApi {
  toast: {
    (title: string, kind?: ToastKind): void;
    (title: string, sub?: string, kind?: ToastKind): void;
  };
}
const ToastCtx = createContext<ToastApi | undefined>(undefined);

export const ToastProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [item, setItem] = useState<ToastData | null>(null);
  const [statusAnnouncement, setStatusAnnouncement] = useState('');
  const [alertAnnouncement, setAlertAnnouncement] = useState('');
  const seq = useRef(0);
  const lastAnnouncement = useRef<{ urgent: boolean; message: string } | null>(null);

  const toast = useCallback((title: string, subOrKind?: string, kind?: ToastKind) => {
    const isKind = (value: string | undefined): value is ToastKind =>
      value === 'info' || value === 'success' || value === 'warning' || value === 'error';
    const resolvedKind = kind ?? (isKind(subOrKind) ? subOrKind : 'info');
    const sub = kind || !isKind(subOrKind) ? subOrKind : undefined;
    setItem({ id: ++seq.current, kind: resolvedKind, title, sub });
  }, []);

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

  const dismiss = useCallback(() => setItem(null), []);

  return (
    <ToastCtx.Provider value={{ toast }}>
      {children}
      <div className="sr-only" role="status" aria-live="polite" aria-atomic="true">{statusAnnouncement}</div>
      <div className="sr-only" role="alert" aria-live="assertive" aria-atomic="true">{alertAnnouncement}</div>
      <div className="pointer-events-none fixed bottom-5 right-5 z-[1000] flex flex-col gap-2.5">
        {item && (
          <AutoDismiss key={item.id} kind={item.kind} textLength={item.title.length + (item.sub?.length ?? 0)} onDone={dismiss}>
            <div className="pointer-events-auto flex max-w-[min(360px,calc(100vw-40px))] items-start gap-1">
              <div aria-hidden="true" className="min-w-0 flex-1">
                <ToastView kind={item.kind} title={item.title} sub={item.sub} announce={false} />
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
