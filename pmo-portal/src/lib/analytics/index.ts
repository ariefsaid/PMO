/**
 * Public analytics facade.
 *
 * Components and pages import from here — never from `posthog-js` or `client.ts` directly.
 * Raw analyticsClient is intentionally NOT exported; use the typed helpers below.
 */

export { AnalyticsProvider } from './AnalyticsProvider';
export {
  buildEventProperties,
  trackPermissionDeniedSeen,
  FORBIDDEN_PROPERTY_KEYS,
} from './events';
export type { AnalyticsEventName, SafeProperties, SafeValue, TrackedEvent, AuthMethod, AuthFailureReason, DemoPersonaLabel } from './events';
export { getAnalyticsConfig, parseDemoContext, persistDemoContext } from './config';
export type { AnalyticsConfig, DemoAudience, DemoContext } from './config';
export { routeAnalyticsForPath, SAFE_TAB_ID } from './route';
export type { RouteAnalytics } from './route';
export { safeTrack } from './safeTrack';

// ── Event-specific action helpers ────────────────────────────────────────
// These are the ONLY way components should track events. They encapsulate
// the call to analyticsClient.capture with the correct event name + props.

import { analyticsClient } from './client';
import { isFeatureEnabled } from '@/src/lib/features';
import type { AuthMethod, AuthFailureReason, DemoPersonaLabel } from './events';
import type { DownvoteReason } from '@/src/lib/db/agentEvents';
import { SAFE_TAB_ID } from './route';
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
  // The 3 builders below already existed (pure, TrackedEvent-returning) but had no
  // capturing wrapper — renamed on import so this file can define the ACTUAL
  // `trackFormValidationFailed`/`trackSaveFailed`/`trackEmptyStateSeen` facade
  // helpers below (mirroring the trackAgent* / buildAgent* pattern) without a name
  // collision. Components must import the wrapper (this file), never the builder.
  trackFormValidationFailed as buildFormValidationFailedEvent,
  trackSaveFailed as buildSaveFailedEvent,
  trackEmptyStateSeen as buildEmptyStateSeenEvent,
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

/**
 * Track a completed logout. `role` is already carried on every event as a
 * registered super-property (`analyticsClient.identify`, matching the existing
 * `trackAuthLoginSucceeded`/`trackAuthLoginFailed` precedent — see
 * `docs/analytics-events.md` "Common Context (Super Properties)") — call sites
 * never need to pass it again explicitly.
 */
export function trackAuthLogoutSucceeded(): void {
  analyticsClient.capture('auth_logout_succeeded', {});
}

// ── Wave-1/2 engagement + friction events (2026-07-13 wiring plan) ───────
// `form_validation_failed` / `save_failed` / `empty_state_seen` reuse the pure
// builders already defined + tested in events.ts (imported above under a
// `build*Event` alias) — this is the one place each is turned into an actual
// `analyticsClient.capture` call, mirroring `trackAgentPanelOpened` et al.

export function trackFormValidationFailed(
  formId: string,
  fieldCount: number,
  reasonCode: string,
  module: string,
): void {
  const built = buildFormValidationFailedEvent(formId, fieldCount, reasonCode, module);
  analyticsClient.capture(built.event, built.properties);
}

export function trackSaveFailed(
  entityType: string,
  operation: string,
  reasonCode: string,
  module: string,
): void {
  const built = buildSaveFailedEvent(entityType, operation, reasonCode, module);
  analyticsClient.capture(built.event, built.properties);
}

export function trackEmptyStateSeen(stateId: string, role: string, module: string): void {
  const built = buildEmptyStateSeenEvent(stateId, role, module);
  analyticsClient.capture(built.event, built.properties);
}

/** `search_used` (AC-PH-DISC-005-ish): fired once per search intent by `SearchMini`
 * (debounced/on-Enter there — never per keystroke, never the query text itself). */
export function trackSearchUsed(searchSurface: string, resultCount: number, module: string): void {
  analyticsClient.capture('search_used', { search_surface: searchSurface, result_count: resultCount, module });
}

/** A project's detail route was opened from a list/board/card/calendar surface. */
export function trackProjectDetailOpened(route: string, source: 'list' | 'card'): void {
  analyticsClient.capture('project_detail_opened', { route, source });
}

/** A procurement request's detail route was opened from a list/board surface. */
export function trackProcurementDetailOpened(route: string, source: 'list' | 'card'): void {
  analyticsClient.capture('procurement_detail_opened', { route, source });
}

/**
 * A project-detail tab was switched to. `tabId` is normalized against the same
 * `SAFE_TAB_ID` pattern `routeAnalyticsForPath` already applies to route-derived
 * tab ids — an unexpected shape never reaches PostHog as free text.
 */
export function trackProjectTabViewed(tabId: string): void {
  const safeTabId = SAFE_TAB_ID.test(tabId) ? tabId : 'unknown_tab';
  analyticsClient.capture('project_tab_viewed', { tab_id: safeTabId });
}

/** A disabled/deferred "coming soon" affordance was clicked — a demand signal. */
export function trackComingSoonClicked(featureId: string, module: string): void {
  analyticsClient.capture('coming_soon_clicked', { feature_id: featureId, module });
}

/** A filter control changed value. `optionCount` is the filter's option-set size —
 * never the value the user actually picked (that can be a customer/PM name). */
export function trackFilterApplied(filterId: string, optionCount: number, module: string): void {
  analyticsClient.capture('filter_applied', { filter_id: filterId, option_count: optionCount, module });
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
  threadId: string | null,
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
