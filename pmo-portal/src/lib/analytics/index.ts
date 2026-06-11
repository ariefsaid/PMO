/**
 * Public analytics facade.
 *
 * Components and pages import from here — never from `posthog-js` or `client.ts` directly.
 * Raw analyticsClient is intentionally NOT exported; use the typed helpers below.
 */

export { AnalyticsProvider } from './AnalyticsProvider';
export {
  buildEventProperties,
  trackFormValidationFailed,
  trackSaveFailed,
  trackPermissionDeniedSeen,
  trackEmptyStateSeen,
  FORBIDDEN_PROPERTY_KEYS,
} from './events';
export type { AnalyticsEventName, SafeProperties, SafeValue, TrackedEvent, AuthMethod, AuthFailureReason, DemoPersonaLabel } from './events';
export { getAnalyticsConfig, parseDemoContext, persistDemoContext } from './config';
export type { AnalyticsConfig, DemoAudience, DemoContext } from './config';
export { routeAnalyticsForPath } from './route';
export type { RouteAnalytics } from './route';

// ── Event-specific action helpers ────────────────────────────────────────
// These are the ONLY way components should track events. They encapsulate
// the call to analyticsClient.capture with the correct event name + props.

import { analyticsClient } from './client';
import type { AuthMethod, AuthFailureReason, DemoPersonaLabel } from './events';

/** Track when a demo persona button is selected on the login page. */
export function trackDemoPersonaSelected(role: DemoPersonaLabel): void {
  analyticsClient.capture('demo_persona_selected', { persona_role: role });
}

/** Track a successful authentication. */
export function trackAuthLoginSucceeded(method: AuthMethod): void {
  analyticsClient.capture('auth_login_succeeded', { method });
}

/** Track a failed authentication. */
export function trackAuthLoginFailed(method: AuthMethod, reason_code: AuthFailureReason): void {
  analyticsClient.capture('auth_login_failed', { method, reason_code });
}
