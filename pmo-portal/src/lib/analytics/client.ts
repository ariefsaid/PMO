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

/**
 * The denylist handed to posthog-js MUST NOT include `token`: PostHog carries its own
 * project API key as `properties.token` in the capture payload, so denylisting it makes
 * the SDK send a TOKENLESS event → ingest returns 401 "event submitted without an api_key"
 * (PostHog/posthog-js#3438 — the exact 401 that silenced capture on the demo, 2026-06-16:
 * /flags + /array config 200, only the compressed /e/ capture 401'd because the token was
 * stripped). We still scrub `token` from OUR OWN events in buildEventProperties (defence in
 * depth); we just stop telling the SDK to delete the field that authenticates the request.
 */
export const POSTHOG_PROPERTY_DENYLIST = Array.from(FORBIDDEN_PROPERTY_KEYS).filter(
  (key) => key !== 'token',
);

let initialized = false;
let activeConfig: AnalyticsConfig | null = null;

const MAX_EXCEPTION_TEXT_LENGTH = 2000;

/**
 * Redact one exception-shaped string (FR-OF-011, NFR-OF-PRIV-002). Hardened (fix
 * round) against 4 leak vectors the original query-string/`key=value` scrub missed:
 *   1. A JWT (or other high-entropy token) in a URL PATH, not just a query string.
 *   2. A `Bearer <token>` / `sk-...`-shaped secret with no `key=`/`key:` prefix.
 *   3. A JSON-shaped forbidden key (`"key":value`, no `=`) — redacts the key name too.
 *   4. A bare email address with no key prefix at all.
 * Order matters: JWTs/URLs/bearer-tokens are stripped FIRST so a later generic
 * high-entropy scrub doesn't need to re-discover them inside an already-redacted
 * substring, then the JSON/key=value/email scrubs run, then a final generic
 * high-entropy catch-all, then the length bound.
 */
function redactExceptionText(text: string): string {
  let out = text;

  // 1. JWTs anywhere (path, query, bare) — header.payload.signature, base64url triplet.
  out = out.replace(/eyJ[\w-]+\.[\w-]+\.[\w-]+/g, '[redacted]');

  // Query strings (existing behavior — kept for anything the JWT pass didn't own).
  out = out.replace(/\?[^\s'")]*/g, '');

  // 2. `Bearer <token>` / `sk-...`-shaped API keys, no `key=` shape required.
  out = out.replace(/Bearer\s+\S+/gi, 'Bearer [redacted]');
  out = out.replace(/\bsk-[a-z0-9-]+/gi, '[redacted]');

  // 3. JSON-shaped forbidden key: "key": value (redact the key name AND the value).
  for (const key of FORBIDDEN_PROPERTY_KEYS) {
    out = out.replace(
      new RegExp(`"${key}"\\s*:\\s*(?:"[^"]*"|[^\\s,}]+)`, 'gi'),
      '[redacted]',
    );
  }

  // Existing key=value / key:value shape (no quotes).
  for (const key of FORBIDDEN_PROPERTY_KEYS) {
    out = out.replace(new RegExp(`${key}[=:][^\\s'")&]*`, 'gi'), '[redacted]');
  }

  // 4. Bare email address, no key prefix required.
  out = out.replace(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g, '[redacted]');

  // Generic high-entropy secret catch-all: 32+ run of letters/digits with no
  // separators — covers stray API keys/tokens the named patterns above didn't match.
  out = out.replace(/\b[A-Za-z0-9]{32,}\b/g, '[redacted]');

  return out.slice(0, MAX_EXCEPTION_TEXT_LENGTH);
}

/**
 * The `before_send` hook registered at `posthog.init()` (DC-OF-002, FR-OF-011): applied to EVERY
 * outbound event, not just ones built by `captureException`. Only touches the `$exception_*`
 * properties PostHog's exception schema populates (`$exception_message`, `$exception_list`,
 * `$exception_values`, `$exception_stack_trace_raw`) — every other event/property passes through
 * unchanged, so this hook is additive to (never a replacement for) `buildEventProperties`'s
 * existing scrub on ordinary `capture()` calls.
 */
function redactExceptionProperties(
  captureResult: import('@posthog/types').CaptureResult | null,
): import('@posthog/types').CaptureResult | null {
  if (!captureResult) return captureResult;
  const properties = captureResult.properties as Record<string, unknown>;
  if (typeof properties.$exception_message === 'string') {
    properties.$exception_message = redactExceptionText(properties.$exception_message);
  }
  if (typeof properties.$exception_stack_trace_raw === 'string') {
    properties.$exception_stack_trace_raw = redactExceptionText(properties.$exception_stack_trace_raw);
  }
  if (Array.isArray(properties.$exception_list)) {
    properties.$exception_list = (properties.$exception_list as Array<Record<string, unknown>>).map(
      (entry) => (typeof entry?.value === 'string' ? { ...entry, value: redactExceptionText(entry.value) } : entry),
    );
  }
  if (Array.isArray(properties.$exception_values)) {
    properties.$exception_values = (properties.$exception_values as unknown[]).map((v) =>
      typeof v === 'string' ? redactExceptionText(v) : v,
    );
  }
  return captureResult;
}

export interface CaptureExceptionInput {
  name: string;
  message: string;
  componentStack?: string;
}

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
      property_denylist: POSTHOG_PROPERTY_DENYLIST,
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
      before_send: redactExceptionProperties,
    });
    initialized = true;
  },

  capture(event: AnalyticsEventName, properties: SafeProperties = {}) {
    if (!initialized || !activeConfig?.enabled) return;
    posthog.capture(event, buildEventProperties(event, properties, activeConfig.isProd));
  },

  captureException(input: CaptureExceptionInput) {
    if (!initialized || !activeConfig?.enabled) return;
    const err = new Error(input.message) as Error & { componentStack?: string };
    err.name = input.name;
    if (input.componentStack !== undefined) {
      err.componentStack = input.componentStack;
    }
    posthog.captureException(err);
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
