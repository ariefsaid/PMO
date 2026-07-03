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
import { isFeatureEnabled } from '@/src/lib/features';
import type { AuthMethod, AuthFailureReason, DemoPersonaLabel } from './events';
import type { DownvoteReason } from '@/src/lib/db/agentEvents';
import {
  buildAgentPanelOpenedEvent,
  buildAgentRunStartedEvent,
  buildAgentRunCompletedEvent,
  buildAgentRunErroredEvent,
  buildAgentApprovalShownEvent,
  buildAgentApprovalDecidedEvent,
  buildAgentThreadResumedEvent,
  buildAgentFeedbackRatedEvent,
  buildAgentComposeViewSavedEvent,
} from './events';

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

// ── Agent-surface events (FR-APH-004..012) ───────────────────────────────
// Gated on BOTH isFeatureEnabled('agentAssistant') AND the existing analytics
// gate (analyticsClient.capture already no-ops when !initialized || !enabled,
// FR-APH-013) — the isFeatureEnabled check here is a defensive early-return,
// never a second suppression mechanism the facade has to grow. Fire-and-forget:
// every function below is synchronous and void; call sites never await them
// (FR-APH-014, NFR-APH-REL-001).

export function trackAgentPanelOpened(hasScope: boolean): void {
  if (!isFeatureEnabled('agentAssistant')) return;
  const built = buildAgentPanelOpenedEvent(hasScope);
  analyticsClient.capture(built.event, built.properties);
}

export function trackAgentRunStarted(runId: string, isRetry: boolean): void {
  if (!isFeatureEnabled('agentAssistant')) return;
  const built = buildAgentRunStartedEvent(runId, isRetry);
  analyticsClient.capture(built.event, built.properties);
}

export function trackAgentRunCompleted(
  runId: string,
  durationMs: number | undefined,
  toolRoundCount: number,
): void {
  if (!isFeatureEnabled('agentAssistant')) return;
  const built = buildAgentRunCompletedEvent(runId, durationMs, toolRoundCount);
  analyticsClient.capture(built.event, built.properties);
}

export function trackAgentRunErrored(
  runId: string,
  durationMs: number | undefined,
  toolRoundCount: number,
  errorCode: string,
): void {
  if (!isFeatureEnabled('agentAssistant')) return;
  const built = buildAgentRunErroredEvent(runId, durationMs, toolRoundCount, errorCode);
  analyticsClient.capture(built.event, built.properties);
}

export function trackAgentApprovalShown(runId: string): void {
  if (!isFeatureEnabled('agentAssistant')) return;
  const built = buildAgentApprovalShownEvent(runId);
  analyticsClient.capture(built.event, built.properties);
}

export function trackAgentApprovalDecided(runId: string, decision: 'approved' | 'denied'): void {
  if (!isFeatureEnabled('agentAssistant')) return;
  const built = buildAgentApprovalDecidedEvent(runId, decision);
  analyticsClient.capture(built.event, built.properties);
}

export function trackAgentThreadResumed(
  threadId: string,
  runId: string | null,
  eventCount: number,
): void {
  if (!isFeatureEnabled('agentAssistant')) return;
  const built = buildAgentThreadResumedEvent(threadId, runId, eventCount);
  analyticsClient.capture(built.event, built.properties);
}

export function trackAgentFeedbackRated(rating: 'up' | 'down', downvoteReason: DownvoteReason | undefined): void {
  if (!isFeatureEnabled('agentAssistant')) return;
  const built = buildAgentFeedbackRatedEvent(rating, downvoteReason);
  analyticsClient.capture(built.event, built.properties);
}

export function trackAgentComposeViewSaved(runId: string): void {
  if (!isFeatureEnabled('agentAssistant')) return;
  const built = buildAgentComposeViewSavedEvent(runId);
  analyticsClient.capture(built.event, built.properties);
}
