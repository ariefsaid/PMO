/**
 * Analytics event contract and sanitizer.
 *
 * Only `src/lib/analytics/client.ts` should call these; components use the
 * client facade or the helper builders exported here.
 */
import type { DownvoteReason } from '../db/agentEvents';

// ---------------------------------------------------------------------------
// Event name union — extend this when adding new events (AC-PH-015)
// ---------------------------------------------------------------------------
export type AnalyticsEventName =
  | 'demo_persona_selected'
  | 'app_route_viewed'
  | 'auth_login_succeeded'
  | 'auth_login_failed'
  | 'auth_logout_succeeded'
  | 'project_detail_opened'
  | 'project_tab_viewed'
  | 'procurement_detail_opened'
  | 'filter_applied'
  | 'search_used'
  | 'coming_soon_clicked'
  | 'form_validation_failed'
  | 'save_failed'
  | 'bulk_import_failed'
  | 'empty_state_seen'
  | 'agent_panel_opened'
  | 'agent_run_started'
  | 'agent_run_completed'
  | 'agent_run_errored'
  | 'agent_approval_shown'
  | 'agent_approval_decided'
  | 'agent_thread_resumed'
  | 'agent_feedback_rated'
  | 'agent_compose_view_saved';

// ---------------------------------------------------------------------------
// Constrained argument types for facade helpers
// ---------------------------------------------------------------------------

/** Known authentication methods. */
export type AuthMethod = 'password' | 'magic_link' | 'password_reset' | 'invite_accept' | 'microsoft';

/** Known authentication failure reason codes. */
export type AuthFailureReason =
  | 'invalid_credentials'
  | 'auth_error'
  | 'email_not_confirmed'
  | 'weak_password'
  | 'expired_token';

/** Known demo persona labels (matches DEMO_PERSONAS in LoginPage). */
export type DemoPersonaLabel = 'Executive' | 'Project Manager' | 'Finance' | 'Engineer' | 'Admin';

// ---------------------------------------------------------------------------
// Safe property types
// ---------------------------------------------------------------------------
export type SafeValue = string | number | boolean | null | undefined;
export type SafeProperties = Record<string, SafeValue>;

// ---------------------------------------------------------------------------
// Forbidden property keys — never send as analytics properties
// ---------------------------------------------------------------------------
export const FORBIDDEN_PROPERTY_KEYS = new Set([
  'email', 'name', 'full_name', 'person_name', 'company_name', 'project_name',
  'procurement_title', 'contract_value', 'budget', 'budget_amount', 'token',
  'access_token', 'refresh_token', 'notes', 'note', 'comment', 'comments',
  'file_name', 'file', 'password', 'query', 'search_params',
  // SECURITY (2026-07-27 review round 2 #6): posthog-js attaches these to EVERY captured event
  // automatically, straight from `window.location` — independent of whatever properties we pass.
  // `routeAnalyticsForPath` carefully parameterises our OWN `route` property (`/projects/:id`),
  // but the SDK's own `$current_url`/`$pathname`/`$initial_current_url` carry the RAW path,
  // including any record UUID in it (spec §6 forbids raw UUID paths). `$session_entry_url` /
  // `$session_entry_pathname` are the SAME leak under a DIFFERENT name — posthog-js's
  // `SessionPropsManager` renames `$current_url`→`$session_entry_url`/`$pathname`→
  // `$session_entry_pathname` and stamps them once per session onto every event in that
  // session; an exact-name denylist of only the first 3 keys does not catch these renamed
  // derivatives (found empirically by this fix's OWN belt-and-suspenders test asserting no raw
  // UUID anywhere in the captured payload, not just under the 3 originally-named keys). All 5
  // feed `POSTHOG_PROPERTY_DENYLIST` below, which posthog-js applies to the FULL calculated
  // property set (its own auto-added properties included) before every send — verified against
  // the real, unmocked SDK in client.currentUrlLeak.realSdk.test.ts, not just this config.
  '$current_url', '$pathname', '$initial_current_url',
  '$session_entry_url', '$session_entry_pathname',
]);

// ---------------------------------------------------------------------------
// Sanitizer — rejects forbidden keys / unsafe shapes
// ---------------------------------------------------------------------------
export function buildEventProperties(
  event: AnalyticsEventName,
  properties: SafeProperties,
  production = import.meta.env.PROD,
): SafeProperties {
  const safe: SafeProperties = {};
  for (const [key, value] of Object.entries(properties)) {
    if (FORBIDDEN_PROPERTY_KEYS.has(key)) {
      if (!production) throw new Error(`Forbidden analytics property for ${event}: ${key}`);
      continue;
    }
    if (typeof value === 'object' && value !== null) {
      if (!production) throw new Error(`Unsafe analytics value for ${event}: ${key}`);
      continue;
    }
    safe[key] = value;
  }
  return safe;
}

// ---------------------------------------------------------------------------
// Helper builders — return { event, properties } for explicit event types
// ---------------------------------------------------------------------------

export interface TrackedEvent {
  event: AnalyticsEventName;
  properties: SafeProperties;
}

export function trackFormValidationFailed(
  formId: string,
  fieldCount: number,
  reasonCode: string,
  module: string,
): TrackedEvent {
  return {
    event: 'form_validation_failed',
    properties: { form_id: formId, field_count: fieldCount, reason_code: reasonCode, module },
  };
}

export function trackSaveFailed(
  /** The friction classification slug (`permission_denied`, `in_use`, …) — renamed from
   *  `entity_type` (2026-07-27 code-quality review #4): the property never carried an entity
   *  type, and the series had zero history (the event was inert until this same slice), so the
   *  rename was free today and unpayable once real data exists under the old name. */
  failureClass: string,
  operation: string,
  reasonCode: string,
  module: string,
): TrackedEvent {
  return {
    event: 'save_failed',
    properties: { failure_class: failureClass, operation, reason_code: reasonCode, module },
  };
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
export function trackBulkImportFailed(
  module: string,
  failureClass: string,
  failedCount: number,
): TrackedEvent {
  return {
    event: 'bulk_import_failed',
    properties: { module, failure_class: failureClass, failed_count: failedCount },
  };
}

export function trackEmptyStateSeen(
  stateId: string,
  role: string,
  module: string,
): TrackedEvent {
  return {
    event: 'empty_state_seen',
    properties: { state_id: stateId, role, module },
  };
}

// ---------------------------------------------------------------------------
// Agent-surface event builders (FR-APH-001..012) — pure, TrackedEvent-returning.
// Property sets are EXHAUSTIVE per FR-APH-004..012 (NFR-APH-PRIV-001): never add
// a key here without a spec amendment. index.ts's gated trackAgent* wrappers call
// these builders internally so there is exactly one place each event's property
// shape is assembled.
// ---------------------------------------------------------------------------

export function buildAgentPanelOpenedEvent(hasScope: boolean): TrackedEvent {
  return { event: 'agent_panel_opened', properties: { has_scope: hasScope } };
}

export function buildAgentRunStartedEvent(runId: string, isRetry: boolean): TrackedEvent {
  return { event: 'agent_run_started', properties: { run_id: runId, is_retry: isRetry } };
}

export function buildAgentRunCompletedEvent(
  runId: string,
  durationMs: number | undefined,
  toolRoundCount: number,
): TrackedEvent {
  return {
    event: 'agent_run_completed',
    properties: { run_id: runId, duration_ms: durationMs, tool_round_count: toolRoundCount },
  };
}

export function buildAgentRunErroredEvent(
  runId: string,
  durationMs: number | undefined,
  toolRoundCount: number,
  errorCode: string,
): TrackedEvent {
  return {
    event: 'agent_run_errored',
    properties: { run_id: runId, duration_ms: durationMs, tool_round_count: toolRoundCount, error_code: errorCode },
  };
}

export function buildAgentApprovalShownEvent(runId: string): TrackedEvent {
  return { event: 'agent_approval_shown', properties: { run_id: runId } };
}

export function buildAgentApprovalDecidedEvent(
  runId: string,
  decision: 'approved' | 'denied',
): TrackedEvent {
  return { event: 'agent_approval_decided', properties: { run_id: runId, decision } };
}

export function buildAgentThreadResumedEvent(
  threadId: string | null,
  runId: string | null,
  eventCount: number,
): TrackedEvent {
  return {
    event: 'agent_thread_resumed',
    properties: { thread_id: threadId, run_id: runId, event_count: eventCount },
  };
}

export function buildAgentFeedbackRatedEvent(
  rating: 'up' | 'down',
  downvoteReason: DownvoteReason | undefined,
): TrackedEvent {
  return { event: 'agent_feedback_rated', properties: { rating, downvote_reason: downvoteReason } };
}

export function buildAgentComposeViewSavedEvent(runId: string): TrackedEvent {
  return { event: 'agent_compose_view_saved', properties: { run_id: runId } };
}
