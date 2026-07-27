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
    out = out.replace(new RegExp(`"${key}"\\s*:\\s*(?:"[^"]*"|[^\\s,}]+)`, 'gi'), '[redacted]');
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
    properties.$exception_stack_trace_raw = redactExceptionText(
      properties.$exception_stack_trace_raw,
    );
  }
  if (Array.isArray(properties.$exception_list)) {
    properties.$exception_list = (properties.$exception_list as Array<Record<string, unknown>>).map(
      (entry) =>
        typeof entry?.value === 'string'
          ? { ...entry, value: redactExceptionText(entry.value) }
          : entry,
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
  return request as Parameters<
    NonNullable<
      NonNullable<import('@posthog/types').SessionRecordingOptions['maskCapturedNetworkRequestFn']>
    >
  >[0];
};

/**
 * FR-CON-002/003 (OD-OBS-2, ADR-0067). The preference is OURS, in localStorage — not the SDK's
 * internal opt-out cookie. That matters: posthog-js's own opt-out still permits its remote-config
 * fetch, so "no network request to the PostHog host" (AC-CON-003) is only true if we never call
 * `posthog.init` at all. `posthog.opt_out_capturing()` is still called so the CURRENT session stops
 * immediately, before any reload.
 */
const OPT_OUT_STORAGE_KEY = 'pmo.analyticsOptOut';

function readOptOut(): boolean {
  try {
    return globalThis.localStorage?.getItem(OPT_OUT_STORAGE_KEY) === 'true';
  } catch {
    return false; // storage blocked (private mode / embedded) — default is opt-IN per OD-OBS-2
  }
}

/**
 * FR-CON-001 (OD-OBS-2): a browser's Do Not Track signal is honoured the same way an explicit
 * opt-out is — `init()` never runs at all, so the remote-config request (which carries the
 * project token, IP and referer) never fires either. `respect_dnt: true` passed to `posthog.init`
 * only suppresses CAPTURE after init — the config fetch still happens — so it is not sufficient on
 * its own for a user who has already signalled DNT before we ever call init. Checks all 3 legacy
 * spellings (`navigator.doNotTrack`, the old `window.doNotTrack`, and IE's `navigator.msDoNotTrack`).
 */
function isDoNotTrack(): boolean {
  if (typeof navigator === 'undefined') return false;
  const nav = navigator as Navigator & { msDoNotTrack?: string };
  const win = typeof window === 'undefined' ? undefined : (window as Window & { doNotTrack?: string });
  return nav.doNotTrack === '1' || nav.msDoNotTrack === '1' || win?.doNotTrack === '1';
}

/**
 * The `posthog.init` options object, pulled into its own pure function so a test can assert against
 * the EXACT object we ship instead of a hand-copied duplicate that could silently drift from
 * production. @internal exported ONLY so client.deadClickGate.test.ts can init the REAL SDK with it.
 */
export function buildPosthogInitOptions(config: AnalyticsConfig): Parameters<typeof posthog.init>[1] {
  return {
    api_host: config.posthogHost,
    defaults: '2026-01-30',
    capture_pageview: false,
    // FR-PHG-004: EXPLICIT. Its default is 'if_capture_pageview', so capture_pageview:false had
    // silently disabled $pageleave too. We keep it off deliberately: "last module before exit"
    // (FR-PHG-020) is answered by the final app_route_viewed of a session, which we already send,
    // and $pageleave is a billed event that would add nothing.
    capture_pageleave: false,
    person_profiles: 'identified_only',
    // FR-CON-001 (OD-OBS-2): honour Do Not Track. Disclosure + opt-out + DNT, no banner. (The DNT
    // check that actually skips `init()` entirely lives in `doInit`'s guard — this SDK-level flag
    // is defence in depth for the case init already ran before a user's browser reports DNT.)
    respect_dnt: true,
    disable_session_recording: !config.replayAndAutocapture,
    // FR-PHG-001/002. `capture_heatmaps`, not the deprecated `enable_heatmaps` (which was also set
    // to the WRONG value). Heatmaps carry rage- and dead-click COORDINATES ({x,y,target_fixed,type}
    // only, folded into the aggregated $$heatmap event) and are NOT billed against the event
    // allowance -- under OD-OBS-1 (no autocapture for real users) this is the only rage-click
    // signal available at all, since $rageclick is emitted from inside the autocapture code path
    // and is unreachable with autocapture:false.
    capture_heatmaps: true,
    // SECURITY (2026-07-27, must stay false): `capture_dead_clicks:true` enables a SEPARATE,
    // autocapture-gated dead-click producer (posthog-js's own `isDeadClicksEnabledForAutocapture`)
    // that emits a `$dead_click` event carrying `$el_text` / `$elements_chain` / `attr__title` —
    // i.e. the RAW RENDERED PAGE TEXT of the clicked element. A live capture during review returned
    // "MYR 4,250,000.00" and "Approve contract for Petronas Carigali". None of our controls apply:
    // `before_send` only touches `$exception_*` fields, `property_denylist` is exact-key matching
    // (`$el_text`/`$elements_chain`/`attr__title` are not denylisted keys), and `buildEventProperties`
    // never runs — the SDK emits this event directly, bypassing our facade entirely. Setting this
    // false does NOT lose the heatmap dead-click signal spec §5.1 actually wanted: heatmaps run
    // their own, ALWAYS-ON dead-click detector (`isDeadClicksEnabledForHeatmaps` — unconditional)
    // whose properties are only `{x, y, target_fixed, type}`, folded into `$$heatmap` — no element
    // text, ever. See client.deadClickGate.test.ts, which inits the REAL (unmocked) SDK and asserts
    // this against posthog-js's own gating function, not a mock that could never have caught this.
    capture_dead_clicks: false,
    // FR-PHG-001: web vitals yes, network timing no (URLs/payload shapes are a leak surface).
    capture_performance: { web_vitals: true, network_timing: false },
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
  };
}

function doInit(config: AnalyticsConfig): void {
  activeConfig = config;
  if (!config.enabled || initialized || !config.posthogKey || readOptOut() || isDoNotTrack()) return;
  posthog.init(config.posthogKey, buildPosthogInitOptions(config));
  initialized = true;
}

export const analyticsClient = {
  init(config: AnalyticsConfig) {
    doInit(config);
  },

  /** FR-CON-002: has this browser opted out of analytics? Survives reloads. */
  hasOptedOut(): boolean {
    return readOptOut();
  },

  /** FR-CON-003: stop capture now AND on every future session. */
  optOut() {
    try {
      globalThis.localStorage?.setItem(OPT_OUT_STORAGE_KEY, 'true');
    } catch {
      /* storage blocked — the in-session opt-out below still applies */
    }
    if (initialized) posthog.opt_out_capturing();
  },

  /** FR-CON-002: opt back in; initialise if the opt-out had suppressed init. */
  optIn() {
    try {
      globalThis.localStorage?.removeItem(OPT_OUT_STORAGE_KEY);
    } catch {
      /* storage blocked */
    }
    if (initialized) {
      // captureEventName:false — a billed $opt_in event tells us nothing we need.
      posthog.opt_in_capturing({ captureEventName: false });
      return;
    }
    if (activeConfig) {
      doInit(activeConfig);
      // The SDK's OWN persisted opt-out is a SEPARATE key from ours and survives a fresh `init()`
      // call — without this, traffic to PostHog resumes (consent reads PENDING, not opted-out) but
      // EVENTS never do, because the SDK still privately believes this browser opted out. Analytics
      // would go permanently dark while looking opted back in.
      if (initialized) posthog.opt_in_capturing({ captureEventName: false });
    }
  },

  capture(event: AnalyticsEventName, properties: SafeProperties = {}) {
    if (!initialized || !activeConfig?.enabled || readOptOut()) return;
    posthog.capture(event, buildEventProperties(event, properties, activeConfig.isProd));
  },

  captureException(input: CaptureExceptionInput) {
    if (!initialized || !activeConfig?.enabled || readOptOut()) return;
    const err = new Error(input.message) as Error & { componentStack?: string };
    err.name = input.name;
    if (input.componentStack !== undefined) {
      err.componentStack = input.componentStack;
    }
    posthog.captureException(err);
  },

  identify(input: { userId: string; role: string; orgId: string }) {
    if (!initialized || !activeConfig?.enabled || readOptOut()) return;
    posthog.identify(input.userId, { role: input.role });
    posthog.register({ role: input.role, org_id: input.orgId });
  },

  register(properties: SafeProperties) {
    if (!initialized || !activeConfig?.enabled || readOptOut()) return;
    posthog.register(buildEventProperties('app_route_viewed', properties, activeConfig.isProd));
  },

  reset() {
    if (!initialized) return;
    posthog.reset();
    // `posthog.reset()` DELETES the SDK's own consent key, so its internal state reads PENDING
    // (i.e. "allowed") again and `is_capturing()`/captures resume for the rest of the session even
    // though this browser is still opted out in OUR storage. Log out → capture silently resumes —
    // a privacy promise must not depend on SDK-internal state surviving a call we don't control.
    if (readOptOut()) posthog.opt_out_capturing();
  },

  /** @internal Reset singleton state between tests */
  __resetForTests() {
    initialized = false;
    activeConfig = null;
  },
};
