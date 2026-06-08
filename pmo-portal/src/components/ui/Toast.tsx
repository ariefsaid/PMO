import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { cn } from './cn';
import { Icon, type IconName } from './icons';

export type ToastKind = 'info' | 'success' | 'warning';

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
};

const KIND_ICON: Record<ToastKind, IconName> = {
  info: 'inbox',
  success: 'check',
  warning: 'alert',
};

/** Presentational toast (also the unit-test surface). aria-live polite — it
 *  announces without stealing focus (toast-accessibility). */
export const ToastView: React.FC<{ kind: ToastKind; title: string; sub?: string }> = ({
  kind,
  title,
  sub,
}) => (
  <div
    role="status"
    aria-live="polite"
    className={cn(
      'toast-anim flex min-w-[230px] max-w-[360px] items-center gap-2.5 rounded-lg border border-l-[3px] border-border bg-popover px-3.5 py-[11px] text-[13.5px] shadow-[0_10px_30px_hsl(240_10%_8%/0.16)] [&_svg]:size-[17px] [&_svg]:shrink-0',
      KIND_STRIPE[kind]
    )}
  >
    <Icon name={KIND_ICON[kind]} />
    <div>
      <span className="font-semibold">{title}</span>
      {sub && <span className="ml-1 text-muted-foreground">{sub}</span>}
    </div>
  </div>
);

interface ToastApi {
  toast: (title: string, sub?: string, kind?: ToastKind) => void;
}
const ToastCtx = createContext<ToastApi | undefined>(undefined);

export const ToastProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [items, setItems] = useState<ToastData[]>([]);
  const seq = useRef(0);

  // Cap to ONE visible toast (OD-UX-1 / write-policy: routine forward writes each fire a
  // quiet toast; without a cap they would pile up into a column). A new toast REPLACES the
  // current one, so the user always sees the latest feedback and never a stack. Each toast
  // still auto-dismisses on its own 3–5s timer (AutoDismiss below).
  const toast = useCallback((title: string, sub?: string, kind: ToastKind = 'info') => {
    const id = ++seq.current;
    setItems([{ id, kind, title, sub }]);
  }, []);

  return (
    <ToastCtx.Provider value={{ toast }}>
      {children}
      <div className="pointer-events-none fixed bottom-5 right-5 z-[1000] flex flex-col gap-2.5">
        {items.map((t) => (
          <AutoDismiss key={t.id} onDone={() => setItems((p) => p.filter((x) => x.id !== t.id))}>
            <ToastView kind={t.kind} title={t.title} sub={t.sub} />
          </AutoDismiss>
        ))}
      </div>
    </ToastCtx.Provider>
  );
};

const AutoDismiss: React.FC<{ onDone: () => void; children: React.ReactNode }> = ({
  onDone,
  children,
}) => {
  useEffect(() => {
    const t = setTimeout(onDone, 4000);
    return () => clearTimeout(t);
  }, [onDone]);
  return <>{children}</>;
};

// eslint-disable-next-line react-refresh/only-export-components -- hook co-located with its provider
export const useToast = (): ToastApi => {
  const ctx = useContext(ToastCtx);
  if (!ctx) throw new Error('useToast must be used within a ToastProvider');
  return ctx;
};
