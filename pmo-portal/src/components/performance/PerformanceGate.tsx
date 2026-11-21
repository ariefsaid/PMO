import React, { useContext } from 'react';
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
  if (!queryClient || !auth) return null;
  return <GateInner>{children}</GateInner>;
};

const GateInner: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const may = usePermission();
  const settings = usePerformanceSettings();
  if (!may('view', 'workOrderPerformance') || settings.data?.enabled !== true) return null;
  return <>{children}</>;
};
