import React from 'react';
import { Navigate } from 'react-router-dom';
import { isFeatureEnabled, type FeatureKey } from '@/src/lib/features';

/**
 * Route-element gate for the interim UI feature flags ("UI-hide-first" — see
 * `src/lib/features.ts` and docs/backlog.md §OPEN feature tracks). Renders `element`
 * when the feature is enabled; otherwise redirects (default `/`) so bookmarks/deep-links
 * to a hidden module degrade gracefully instead of 404-ing or rendering the hidden page.
 *
 * The route analog of the (backlogged) `<FeatureGate>` content gate. When the per-org
 * entitlement system lands, only `isFeatureEnabled` swaps to the entitlement lookup —
 * every `<FeatureRoute>` call site stays unchanged.
 *
 * UX-only: this hides a route, it does NOT protect the module's data (its tables/RPCs
 * remain reachable by direct API until server-enforced).
 */
export const FeatureRoute: React.FC<{
  feature: FeatureKey;
  element: React.ReactNode;
  redirectTo?: string;
}> = ({ feature, element, redirectTo = '/' }) =>
  isFeatureEnabled(feature) ? <>{element}</> : <Navigate to={redirectTo} replace />;
