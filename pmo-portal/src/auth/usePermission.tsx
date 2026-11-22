import React, { useCallback } from 'react';
import { useEffectiveRole } from './impersonation';
import { can, type Action, type Entity, type PolicyContext } from './policy';

/**
 * React bindings for the FE authorization primitive (ADR-0016). These wrap the pure
 * `can()` policy and bind it to the **real JWT role** from the impersonation context,
 * never the impersonated `effectiveRole`. Co-located with `policy.ts` (the pure matrix).
 */

/** Per-call extra context (everything except the role, which the hook supplies). */
export type PermissionCtx = Omit<PolicyContext, 'realRole'>;

/**
 * Returns a `can`-style predicate bound to the current user's REAL role. Write
 * affordances call this; an impersonating Admin therefore sees exactly the affordances
 * the server will honor under their real role.
 */
// eslint-disable-next-line react-refresh/only-export-components -- hook co-located with its <CanWrite> render-gate; HMR-only lint concern
export function usePermission(): (action: Action, entity: Entity, ctx?: PermissionCtx) => boolean {
  const { realRole } = useEffectiveRole();
  return useCallback(
    (action: Action, entity: Entity, ctx?: PermissionCtx) =>
      can(action, entity, { realRole, ...ctx }),
    [realRole],
  );
}

export interface CanWriteProps {
  action: Action;
  entity: Entity;
  /** Optional record/identity context for record-scoped or status-conditional rules. */
  ctx?: PermissionCtx;
  /** Rendered when permitted. */
  children: React.ReactNode;
  /** Optional read-only / GateNotice variant rendered when denied. */
  fallback?: React.ReactNode;
}

/**
 * Declarative render gate: renders `children` only when the real role may perform the
 * action; otherwise renders `fallback` (or nothing). The single affordance gate for the
 * whole app. RLS/RPC remain the enforcement authority — this hides for clarity only.
 */
export const CanWrite: React.FC<CanWriteProps> = ({ action, entity, ctx, children, fallback }) => {
  const may = usePermission();
  return <>{may(action, entity, ctx) ? children : (fallback ?? null)}</>;
};
