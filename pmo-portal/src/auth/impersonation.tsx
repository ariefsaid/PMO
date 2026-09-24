import React, { createContext, useContext, useEffect, useMemo, useState } from 'react';
import type { Role } from './AuthContext';

/**
 * Demo-org eligibility for the Admin "view as role" control (FR-AUTH-036/037):
 *  - `'eligible'`   — the signed-in org's `lifecycle_state` resolved to exactly `'demo'`
 *  - `'ineligible'` — resolved, but the org is live / test / NULL / an unknown state value
 *  - `'pending'`    — the org state is NOT resolved (loading, errored, or signed out): FAIL CLOSED
 *
 * Derived by `useDemoEligibility` (org-scoped RLS read — never a hardcoded org id) and
 * threaded through `Shell` in `App.tsx`.
 */
export type DemoEligibility = 'eligible' | 'ineligible' | 'pending';

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
  /**
   * Own-org demo eligibility. OPTIONAL and DEFAULTS TO `'pending'` — fail closed — so an
   * unthreaded mount point simply hides the control instead of exposing it. The only
   * production mount (`Shell`) passes the live `useDemoEligibility()` value.
   */
  demoEligibility?: DemoEligibility;
  children: React.ReactNode;
}> = ({ realRole, demoEligibility = 'pending', children }) => {
  const [viewAsRole, setViewAsRole] = useState<Role | null>(null);
  // Admin AND a demo org. Anything unresolved or non-demo denies — including a live-org
  // Admin (the restricted case): the control must never appear for them, on any surface.
  const canImpersonate = realRole === 'Admin' && demoEligibility === 'eligible';

  // AC-AUTH-015: clear a stale view-as selection the moment eligibility disappears (org
  // flips out of demo, the read errors, or the prop goes missing). effectiveRole is ALREADY
  // fail-closed per render below, so this only cleans stored state — but it is what prevents
  // a cleared selection from resurrecting if eligibility later returns.
  useEffect(() => {
    if (!canImpersonate) setViewAsRole(null);
  }, [canImpersonate]);

  const value = useMemo<EffectiveRole>(
    () => ({
      realRole,
      // Derived, never stored: outside demo eligibility this is ALWAYS realRole, even in the
      // render before the cleanup effect above runs.
      effectiveRole: canImpersonate ? (viewAsRole ?? realRole) : realRole,
      canImpersonate,
      // Inert outside an eligible demo org: viewAs can never move effectiveRole off realRole.
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

/**
 * Non-throwing real-role reader for code that may render outside the provider (e.g. a hook
 * exercised in isolation by unit tests, or a defensive call site). Returns `null` when no
 * ImpersonationProvider is mounted, so callers deny-by-default rather than crash.
 */
// eslint-disable-next-line react-refresh/only-export-components -- hook co-located with its provider; HMR-only lint concern
export const useOptionalRealRole = (): Role | null => {
  const ctx = useContext(Ctx);
  return ctx?.realRole ?? null;
};
