import React from 'react';
import { Navigate } from 'react-router';
import { useFeature } from '@/src/auth/useFeature';
import { useOrgFeatures } from '@/src/hooks/useOrgFeatures';
import { FeatureUnavailable } from '@/src/components/FeatureUnavailable';
import { isCoreFeature } from '@/src/lib/features';
import type { EntitleableKey } from '@/src/lib/features';

/**
 * Route-element gate for the per-org entitlement system (AC-PLN-008, FR-PLN-005).
 *
 * Resolves the entitlement via `useFeature()` — the database projection, never a copy of the order —
 * and renders one of four states:
 *
 *   core            → the element immediately (core keys are never gated);
 *   loading         → null: HOLD. No redirect and no element, so a deep-link never flash-denies a
 *                     module the org actually has (AC-ENT-005, kept);
 *   read failed     → the unavailable state WITH a retry, and never the words "not on your plan"
 *                     (an unknown answer must not be reported as a plan decision);
 *   resolved OFF    → the not-available state (AC-PLN-008). This replaces the old redirect to `/`:
 *                     the spec asks the route to say why, and data is kept either way (FR-PLN-007);
 *   resolved ON     → the element.
 *
 * UX gate only: since S2 the server refuses writes for a disabled module (FR-PLN-006). This keeps
 * the surface from being offered at all.
 */
export const FeatureRoute: React.FC<{
  feature: EntitleableKey;
  element: React.ReactNode;
  disabledRedirectTo?: string;
}> = ({ feature, element, disabledRedirectTo }) => {
  const { data, isLoading, isError, refetch } = useOrgFeatures();
  const enabled = useFeature(feature);

  if (isCoreFeature(feature)) return <>{element}</>;

  // Hold while the resolved set is in flight, and while it is absent without an error (a disabled
  // query, e.g. before the session is known) — never decide from a missing answer.
  if (isLoading || (!data && !isError)) return null;

  if (isError) return <FeatureUnavailable variant="error" onRetry={refetch} />;

  if (!enabled && disabledRedirectTo) return <Navigate to={disabledRedirectTo} replace />;

  return enabled ? <>{element}</> : <FeatureUnavailable variant="off" feature={feature} />;
};
