import React, { useContext, useEffect, useState } from 'react';
import { QueryClientContext } from '@tanstack/react-query';
import { AuthContext } from '@/src/auth/AuthContext';
import { usePermission } from '@/src/auth/usePermission';
import { usePerformanceSettings } from '@/src/hooks/useWorkOrderPerformance';

/**
 * The one gate in front of every cost and schedule performance surface (#2597, AC-CSP-018). It renders its children
 * only when the organisation has turned the indices on and the caller's role may view them; otherwise it renders
 * nothing at all, so an organisation that has not opted in sees exactly the screens it saw before, and no performance
 * request is made. Outside a signed-in, query-backed tree (a bare render) it also renders nothing.
 */
export const PerformanceGate: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const queryClient = useContext(QueryClientContext);
  const auth = useContext(AuthContext);
  const idle = useWhenIdle();
  if (!queryClient || !auth || !idle) return null;
  return <GateInner>{children}</GateInner>;
};

/**
 * True once the browser is idle (or after a second where it has no idle callback). The panels are secondary and
 * below the fold, so reading the organisation setting waits until the page's own reads are done; the screen's
 * mount requests are unchanged for an organisation that has not turned the indices on.
 */
function useWhenIdle(): boolean {
  const [idle, setIdle] = useState(false);
  useEffect(() => {
    const w = window as Window & { requestIdleCallback?: (cb: () => void, o?: { timeout: number }) => number; cancelIdleCallback?: (h: number) => void };
    if (w.requestIdleCallback) {
      const handle = w.requestIdleCallback(() => setIdle(true), { timeout: 2000 });
      return () => w.cancelIdleCallback?.(handle);
    }
    const timer = window.setTimeout(() => setIdle(true), 1000);
    return () => window.clearTimeout(timer);
  }, []);
  return idle;
}

const GateInner: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const may = usePermission();
  const settings = usePerformanceSettings();
  if (!may('view', 'workOrderPerformance') || settings.data?.enabled !== true) return null;
  return <>{children}</>;
};
