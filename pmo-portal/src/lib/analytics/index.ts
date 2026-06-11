/**
 * Public analytics facade.
 *
 * Components and pages import from here — never from `posthog-js` or `client.ts` directly.
 */

export { AnalyticsProvider } from './AnalyticsProvider';
export { analyticsClient } from './client';
export {
  buildEventProperties,
  trackFormValidationFailed,
  trackSaveFailed,
  trackPermissionDeniedSeen,
  trackEmptyStateSeen,
  FORBIDDEN_PROPERTY_KEYS,
} from './events';
export type { AnalyticsEventName, SafeProperties, SafeValue, TrackedEvent } from './events';
export { getAnalyticsConfig, parseDemoContext } from './config';
export type { AnalyticsConfig, DemoAudience, DemoContext } from './config';
export { routeAnalyticsForPath } from './route';
export type { RouteAnalytics } from './route';
