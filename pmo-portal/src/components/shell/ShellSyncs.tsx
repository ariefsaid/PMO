import React from 'react';
import { ImpersonationProvider } from '@/src/auth/impersonation';
import { useDemoEligibility } from '@/src/hooks/useDemoEligibility';
import { useOwnershipCacheSync } from '@/src/hooks/useOwnershipCacheSync';
import type { Role } from '@/src/auth/AuthContext';

/**
 * ADR-0056: mount exactly once in the authenticated shell — seeds/clears the module-level
 * ownership cache so routeTaskWrite() routes task writes correctly (fail-closed 'pmo').
 * A leaf, so its two queries settling re-render only this component, not the provider chain.
 */
export const ShellSyncs: React.FC = () => {
  useOwnershipCacheSync();
  return null;
};

/**
 * FR-AUTH-036 (AC-AUTH-013/014): the Admin "view as role" control exists ONLY for Admins of a demo
 * org. The hook reads the signed-in org's lifecycle_state via RLS and FAILS CLOSED to 'pending'
 * while loading or on error. It is read here, next to the provider that consumes it, so a
 * settle re-renders the provider (whose context value changes) but not the already-built `children`
 * element tree handed down from the shell root.
 */
export const EligibleImpersonationProvider: React.FC<{ realRole: Role | null; children: React.ReactNode }> = ({ realRole, children }) => {
  const demoEligibility = useDemoEligibility();
  return <ImpersonationProvider realRole={realRole} demoEligibility={demoEligibility}>{children}</ImpersonationProvider>;
};
