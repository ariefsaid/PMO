/**
 * PostHog SDK boundary — the ONLY file allowed to import `posthog-js`.
 *
 * All analytics calls flow through `analyticsClient`. Components and pages
 * import the typed facade from `src/lib/analytics/index.ts` instead.
 */

import posthog from 'posthog-js';
import type { AnalyticsConfig } from './config';
import type { AnalyticsEventName, SafeProperties } from './events';
import { buildEventProperties, FORBIDDEN_PROPERTY_KEYS } from './events';

let initialized = false;
let activeConfig: AnalyticsConfig | null = null;

/**
 * Redact query strings from captured network request URLs in session replay.
 * Accepts the full CapturedNetworkRequest shape from @posthog/types but only
 * touches `name` (the URL field) to strip query strings.
 */
const redactUrl = (request: Record<string, unknown>) => {
  if (typeof request.name === 'string') {
    request.name = request.name.split('?')[0];
  }
  delete request.requestHeaders;
  delete request.responseHeaders;
  delete request.requestBody;
  delete request.responseBody;
  return request as Parameters<NonNullable<NonNullable<import('@posthog/types').SessionRecordingOptions['maskCapturedNetworkRequestFn']>>>[0];
};

export const analyticsClient = {
  init(config: AnalyticsConfig) {
    activeConfig = config;
    if (!config.enabled || initialized || !config.posthogKey) return;
    posthog.init(config.posthogKey, {
      api_host: config.posthogHost,
      defaults: '2026-01-30',
      capture_pageview: false,
      person_profiles: 'identified_only',
      disable_session_recording: !config.replayAndAutocapture,
      enable_heatmaps: false,
      enable_recording_console_log: false,
      property_denylist: Array.from(FORBIDDEN_PROPERTY_KEYS),
      autocapture: config.replayAndAutocapture
        ? {
            dom_event_allowlist: ['click'],
            element_allowlist: ['a', 'button'],
            capture_copied_text: false,
            element_attribute_ignorelist: ['aria-label', 'data-sensitive'],
          }
        : false,
      session_recording: {
        maskAllInputs: true,
        maskTextSelector: '.ph-mask,[data-ph-mask="true"]',
        blockSelector: '.ph-no-capture,[data-ph-no-capture="true"]',
        recordHeaders: false,
        recordBody: false,
        maskCapturedNetworkRequestFn: redactUrl,
      },
    });
    initialized = true;
  },

  capture(event: AnalyticsEventName, properties: SafeProperties = {}) {
    if (!initialized || !activeConfig?.enabled) return;
    posthog.capture(event, buildEventProperties(event, properties, activeConfig.isProd));
  },

  identify(input: { userId: string; role: string; orgId: string }) {
    if (!initialized || !activeConfig?.enabled) return;
    posthog.identify(input.userId, { role: input.role });
    posthog.register({ role: input.role, org_id: input.orgId });
  },

  register(properties: SafeProperties) {
    if (!initialized || !activeConfig?.enabled) return;
    posthog.register(buildEventProperties('app_route_viewed', properties, activeConfig.isProd));
  },

  reset() {
    if (!initialized) return;
    posthog.reset();
  },

  /** @internal Reset singleton state between tests */
  __resetForTests() {
    initialized = false;
    activeConfig = null;
  },
};
