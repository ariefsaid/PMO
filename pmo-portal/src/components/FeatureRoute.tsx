import React from 'react';
import { Navigate } from 'react-router-dom';
import { useFeature } from '@/src/auth/useFeature';
import { useOrgFeatures } from '@/src/hooks/useOrgFeatures';
import { isCoreFeature } from '@/src/lib/features';
import type { EntitleableKey } from '@/src/lib/features';

/**
 * Route-element gate for the per-org entitlement system (ops-admin-surface S6, FR-ENT-005/006,
 * AC-ENT-003). Renders `element` when the feature is enabled; otherwise redirects (default `/`)
 * so bookmarks/deep-links to a hidden module degrade gracefully to the dashboard instead of
 * 404-ing or rendering the hidden page (disable = hide, never destroy).
 *
 * Resolves the entitlement via `useFeature()` (core keys always true; a stored `org_features`
 * row overrides the env default; absence = the env default). The route analog of <FeatureGate>.
 *
 * UX-only: this hides a route, it does NOT protect the module's data (its tables/RPCs remain
 * reachable by direct API until server-enforced — ADR-0049).
 *
 * FIX (AC-ENT-005): while the org-features query is loading for a non-core feature,
 * render null (stay put, no redirect, no element) to avoid the flash-redirect race.
 * Core features (projects/dashboard/approvals/administration) render immediately.
 */
export const FeatureRoute: React.FC<{
  feature: EntitleableKey;
  element: React.ReactNode;
  redirectTo?: string;
}> = ({ feature, element, redirectTo = '/' }) => {
  const { isLoading } = useOrgFeatures();
  const enabled = useFeature(feature);

  // Core features are always enabled and render immediately (AC-ENT-002).
  // For non-core features, wait for the org-features query to resolve before deciding.
  if (!isCoreFeature(feature) && isLoading) {
    return null;
  }

  return enabled ? <>{element}</> : <Navigate to={redirectTo} replace />;
};