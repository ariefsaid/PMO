/**
 * Public analytics facade.
 *
 * Components and pages import from here — never from `posthog-js` or `client.ts` directly.
 * Raw analyticsClient is intentionally NOT exported; use the typed helpers below.
 */

export { AnalyticsProvider } from './AnalyticsProvider';
export {
  buildEventProperties,
  FORBIDDEN_PROPERTY_KEYS,
} from './events';
export type { AnalyticsEventName, SafeProperties, SafeValue, TrackedEvent, AuthMethod, AuthFailureReason, DemoPersonaLabel } from './events';
export { getAnalyticsConfig, parseDemoContext, persistDemoContext } from './config';
export type { AnalyticsConfig, DemoAudience, DemoContext } from './config';
export { routeAnalyticsForPath, SAFE_TAB_ID } from './route';
export type { RouteAnalytics } from './route';
export { safeTrack } from './safeTrack';
export * from './business';
export * from './surveys';
export * from './surveyPolicy';

// ── Event-specific action helpers ────────────────────────────────────────
// These are the ONLY way components should track events. They encapsulate
// the call to analyticsClient.capture with the correct event name + props.

import { analyticsClient } from './client';
import { isFeatureEnabled } from '@/src/lib/features';
import type { AuthMethod, AuthFailureReason, DemoPersonaLabel } from './events';
import type { DownvoteReason } from '@/src/lib/db/agentEvents';
import { SAFE_TAB_ID } from './route';

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
// Each event's name + property shape lives directly in its capture call below —
// the one place it is assembled. Property sets stay exhaustive per spec
// (NFR-APH-PRIV-001 precedent): never add a key without a spec amendment.

export function trackFormValidationFailed(
  formId: string,
  fieldCount: number,
  reasonCode: string,
  module: string,
): void {
  analyticsClient.capture('form_validation_failed', {
    form_id: formId,
    field_count: fieldCount,
    reason_code: reasonCode,
    module,
  });
}

export function trackSaveFailed(
  /** The friction classification slug (`permission_denied`, `in_use`, …) — renamed from
   *  `entity_type` (2026-07-27 code-quality review #4): the property never carried an
   *  entity type, and the series had zero history (the event was inert until this same slice), so the
   *  rename was free today and unpayable once real data exists under the old name. */
  failureClass: string,
  operation: string,
  reasonCode: string,
  module: string,
): void {
  analyticsClient.capture('save_failed', {
    failure_class: failureClass,
    operation,
    reason_code: reasonCode,
    module,
  });
}

/**
 * A bulk-import commit run's failures, aggregated PER CLASSIFICATION (2026-07-27 code-quality
 * review #2 fix). A DISTINCT event from `save_failed` — not the same event with a `failed_count`
 * bolted on — because `save_failed` counts EVENTS, so a lump aggregate under one event would make
 * a 5,000-row import failure contribute exactly 1 to whichever `reason_code`/`failure_class`
 * bucket it landed in, indistinguishable from a single real failure, and would discard the
 * per-row reason distribution entirely (RLS vs duplicates becomes unanswerable). One
 * `bulk_import_failed` event per non-zero classification bucket per run (at most 7 —
 * FrictionClass has 7 members) keeps both quota-safety and the reason distribution.
 */
export function trackBulkImportFailed(module: string, failureClass: string, failedCount: number): void {
  analyticsClient.capture('bulk_import_failed', {
    module,
    failure_class: failureClass,
    failed_count: failedCount,
  });
}

export function trackEmptyStateSeen(stateId: string, role: string, module: string): void {
  analyticsClient.capture('empty_state_seen', { state_id: stateId, role, module });
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
// (FR-APH-014, NFR-APH-REL-001). Each capture call below owns its event's
// exhaustive property shape (see the AC-APH-016 tests in index.agent.test.ts).

export function trackAgentPanelOpened(hasScope: boolean): void {
  if (!isFeatureEnabled('agentAssistant')) return;
  analyticsClient.capture('agent_panel_opened', { has_scope: hasScope });
}

export function trackAgentRunStarted(runId: string, isRetry: boolean): void {
  if (!isFeatureEnabled('agentAssistant')) return;
  analyticsClient.capture('agent_run_started', { run_id: runId, is_retry: isRetry });
}

export function trackAgentRunCompleted(
  runId: string,
  durationMs: number | undefined,
  toolRoundCount: number,
): void {
  if (!isFeatureEnabled('agentAssistant')) return;
  analyticsClient.capture('agent_run_completed', {
    run_id: runId,
    duration_ms: durationMs,
    tool_round_count: toolRoundCount,
  });
}

export function trackAgentRunErrored(
  runId: string,
  durationMs: number | undefined,
  toolRoundCount: number,
  errorCode: string,
): void {
  if (!isFeatureEnabled('agentAssistant')) return;
  analyticsClient.capture('agent_run_errored', {
    run_id: runId,
    duration_ms: durationMs,
    tool_round_count: toolRoundCount,
    error_code: errorCode,
  });
}

export function trackAgentApprovalShown(runId: string): void {
  if (!isFeatureEnabled('agentAssistant')) return;
  analyticsClient.capture('agent_approval_shown', { run_id: runId });
}

export function trackAgentApprovalDecided(runId: string, decision: 'approved' | 'denied'): void {
  if (!isFeatureEnabled('agentAssistant')) return;
  analyticsClient.capture('agent_approval_decided', { run_id: runId, decision });
}

export function trackAgentThreadResumed(
  threadId: string | null,
  runId: string | null,
  eventCount: number,
): void {
  if (!isFeatureEnabled('agentAssistant')) return;
  analyticsClient.capture('agent_thread_resumed', {
    thread_id: threadId,
    run_id: runId,
    event_count: eventCount,
  });
}

export function trackAgentFeedbackRated(rating: 'up' | 'down', downvoteReason: DownvoteReason | undefined, runId: string): void {
  if (!isFeatureEnabled('agentAssistant')) return;
  // run_id (FR-PHO-005) joins the rating to its AI trace; `$ai_trace_id` is the same uuid under
  // PostHog's own LLM-analytics key so insights can filter ratings and generations on one property.
  analyticsClient.capture('agent_feedback_rated', {
    rating,
    downvote_reason: downvoteReason,
    run_id: runId,
    $ai_trace_id: runId,
  });
}

export function trackAgentComposeViewSaved(runId: string): void {
  if (!isFeatureEnabled('agentAssistant')) return;
  analyticsClient.capture('agent_compose_view_saved', { run_id: runId });
}

// ── Consent (FR-CON-002/003, ADR-0067) ───────────────────────────────────
/** FR-CON-002/003 — the in-app analytics opt-out (see /privacy). */
export function analyticsOptOut(): void { analyticsClient.optOut(); }
export function analyticsOptIn(): void { analyticsClient.optIn(); }
export function hasAnalyticsOptedOut(): boolean { return analyticsClient.hasOptedOut(); }
/** AC-CON-011 — the three-state (+active) consent surface; see `client.ts`'s `getConsentState` doc. */
export { getConsentState } from './client';
export type { ConsentState } from './client';
