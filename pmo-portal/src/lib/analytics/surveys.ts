/**
 * Survey facade (#1532 S9). Components use these helpers, never the SDK client directly.
 * PostHog owns the survey definitions, the popover chrome, shown / sent / dismissed events and the
 * 30-day wait period; the app owns WHEN a survey may appear (see surveyPolicy.ts) and what context rides on it.
 */
import { analyticsClient, getConsentState } from './client';
import { getAnalyticsConfig } from './config';
import type { SafeProperties } from './events';
import { routeAnalyticsForPath } from './route';

/** The four surveys the owner publishes in PostHog (click-path in docs/posthog-dashboards.md). All type API. */
export const SURVEY_NAMES = {
  feedback: '[PMO] Feedback',
  assistant: '[PMO] Assistant: what went wrong?',
  firstFlow: '[PMO] First core flow',
  nps: '[PMO] NPS',
} as const;
export type SurveyKey = keyof typeof SURVEY_NAMES;

const CORE_FLOW_EVENTS: ReadonlySet<string> = new Set([
  'budget_activated',
  'invoice_issued',
  'payment_recorded',
  'purchase_approved',
]);

const SAFE_RUN_ID = /^[A-Za-z0-9-]{8,64}$/;

/** module + route template (never the raw path), plus the run id inside the assistant. */
export function buildSurveyContext(pathname: string, runId?: string): SafeProperties {
  const { module, route } = routeAnalyticsForPath(pathname);
  const ctx: SafeProperties = { module, route };
  if (runId && SAFE_RUN_ID.test(runId)) {
    ctx.run_id = runId;
    ctx.$ai_trace_id = runId;
  }
  return ctx;
}

/** Analytics is genuinely running: enabled, no Do Not Track, not opted out. Otherwise no survey ever loads. */
export function surveysLive(): boolean {
  return getConsentState(getAnalyticsConfig()) === 'active';
}

export const findSurvey = (key: SurveyKey, done: (id: string | null) => void): void =>
  analyticsClient.surveys.find(SURVEY_NAMES[key], done);

/** PostHog's verdict on a prompted survey: running, targeted, wait period passed, not already seen. */
export const canShowSurvey = (id: string): boolean => analyticsClient.surveys.canRender(id);

export const showSurvey = (id: string, context: SafeProperties, nextTo?: string): void =>
  analyticsClient.surveys.show(id, context, nextTo);

/** Calls `cb` each time one of the four money-path business events is captured; returns the unsubscribe. */
export function onCoreFlowCompleted(cb: () => void): () => void {
  return analyticsClient.surveys.onCaptured((event) => {
    if (CORE_FLOW_EVENTS.has(event)) cb();
  });
}
