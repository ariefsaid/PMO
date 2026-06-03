import React, { createContext, useContext, useMemo, useState } from 'react';
import type { Role } from './AuthContext';

interface EffectiveRole {
  realRole: Role | null;
  effectiveRole: Role | null;
  canImpersonate: boolean;
  // Client-side, view-only (ADR-0008): changes the displayed role/nav gating ONLY.
  // It does NOT alter the Supabase session, JWT, auth.uid(), or RLS evaluation.
  viewAs: (role: Role | null) => void;
}

const Ctx = createContext<EffectiveRole | undefined>(undefined);

export const ImpersonationProvider: React.FC<{
  realRole: Role | null;
  children: React.ReactNode;
}> = ({ realRole, children }) => {
  const [viewAsRole, setViewAsRole] = useState<Role | null>(null);
  const canImpersonate = realRole === 'Admin';
  const value = useMemo<EffectiveRole>(
    () => ({
      realRole,
      effectiveRole: canImpersonate ? (viewAsRole ?? realRole) : realRole,
      canImpersonate,
      viewAs: (r) => {
        if (canImpersonate) setViewAsRole(r);
      },
    }),
    [realRole, viewAsRole, canImpersonate]
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
};

// eslint-disable-next-line react-refresh/only-export-components -- hook co-located with its provider; HMR-only lint concern
export const useEffectiveRole = (): EffectiveRole => {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error('useEffectiveRole must be used within an ImpersonationProvider');
  return ctx;
};
