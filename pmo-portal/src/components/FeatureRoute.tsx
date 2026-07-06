import React from 'react';
import { Navigate } from 'react-router-dom';
import { useFeature } from '@/src/auth/useFeature';
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
 */
export const FeatureRoute: React.FC<{
  feature: EntitleableKey;
  element: React.ReactNode;
  redirectTo?: string;
}> = ({ feature, element, redirectTo = '/' }) =>
  useFeature(feature) ? <>{element}</> : <Navigate to={redirectTo} replace />;
