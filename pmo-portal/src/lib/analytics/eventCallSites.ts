import type { AnalyticsEventName } from './events';

/**
 * Which producer emits each analytics event, and where a CI check should expect to find that
 * producer being called (FR-PHG-013, AC-PHG-013, ADR-0067).
 *
 *   'facade'   — a track* helper in index.ts; must be referenced from OUTSIDE src/lib/analytics/**.
 *   'provider' — captured directly by AnalyticsProvider/client internals; no external caller expected.
 *
 * A naive "does analyticsClient.capture('save_failed') appear anywhere" grep would have passed for
 * two years while the event never fired once: the wrapper existed, the caller did not. This registry
 * is what makes scripts/check-dashboard-tiles.mjs able to tell the difference.
 *
 * `save_failed`'s producer is deliberately `trackSaveFailed` (the facade call), NOT
 * `classifyMutationError` (the outer function it now lives inside). `classifyMutationError` is
 * called at ~40+ sites regardless of whether its internal analytics wiring exists — pointing the
 * check at that name would be tautologically true even if the `trackSaveFailed(...)` call were
 * later deleted from inside it, which is exactly the "gate that can never go red" failure class
 * this registry exists to close.
 */
export const EVENT_PRODUCERS: Record<AnalyticsEventName, { producer: string; kind: 'facade' | 'provider' }> = {
  demo_persona_selected:     { producer: 'trackDemoPersonaSelected',    kind: 'facade' },
  app_route_viewed:          { producer: 'AnalyticsProvider',           kind: 'provider' },
  auth_login_succeeded:      { producer: 'trackAuthLoginSucceeded',     kind: 'facade' },
  auth_login_failed:         { producer: 'trackAuthLoginFailed',        kind: 'facade' },
  auth_logout_succeeded:     { producer: 'trackAuthLogoutSucceeded',    kind: 'facade' },
  project_detail_opened:     { producer: 'trackProjectDetailOpened',    kind: 'facade' },
  project_tab_viewed:        { producer: 'trackProjectTabViewed',       kind: 'facade' },
  procurement_detail_opened: { producer: 'trackProcurementDetailOpened',kind: 'facade' },
  filter_applied:            { producer: 'trackFilterApplied',          kind: 'facade' },
  search_used:               { producer: 'trackSearchUsed',             kind: 'facade' },
  coming_soon_clicked:       { producer: 'trackComingSoonClicked',      kind: 'facade' },
  form_validation_failed:    { producer: 'trackFormValidationFailed',   kind: 'facade' },
  save_failed:               { producer: 'trackSaveFailed',            kind: 'facade' },
  empty_state_seen:          { producer: 'trackEmptyStateSeen',         kind: 'facade' },
  agent_panel_opened:        { producer: 'trackAgentPanelOpened',       kind: 'facade' },
  agent_run_started:         { producer: 'trackAgentRunStarted',        kind: 'facade' },
  agent_run_completed:       { producer: 'trackAgentRunCompleted',      kind: 'facade' },
  agent_run_errored:         { producer: 'trackAgentRunErrored',        kind: 'facade' },
  agent_approval_shown:      { producer: 'trackAgentApprovalShown',     kind: 'facade' },
  agent_approval_decided:    { producer: 'trackAgentApprovalDecided',   kind: 'facade' },
  agent_thread_resumed:      { producer: 'trackAgentThreadResumed',     kind: 'facade' },
  agent_feedback_rated:      { producer: 'trackAgentFeedbackRated',     kind: 'facade' },
  agent_compose_view_saved:  { producer: 'trackAgentComposeViewSaved',  kind: 'facade' },
};
