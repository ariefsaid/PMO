/**
 * PostHog SDK boundary — the ONLY file allowed to import `posthog-js`.
 *
 * All analytics calls flow through `analyticsClient`. Components and pages
 * import the typed facade from `src/lib/analytics/index.ts` instead.
 */

import type posthog from 'posthog-js';
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

// `initialized` = init was requested with consent (enabled, no DNT, not opted out). The SDK itself is a
// dynamic import (#1885): until it resolves, calls queue as closures over ALREADY-sanitised payloads;
// opt-out clears the queue, so nothing buffered before a revoke is ever sent.
type Posthog = typeof posthog;
let initialized = false;
let activeConfig: AnalyticsConfig | null = null;
let sdk: Posthog | null = null;
let loading: Promise<void> | null = null;
let queue: Array<(ph: Posthog) => void> = [];
const MAX_QUEUE = 200;

/** Run now if the SDK is loaded, else buffer until it is (bounded; oldest dropped). */
function withSdk(fn: (ph: Posthog) => void): void {
  if (sdk) return fn(sdk);
  if (!loading) return;
  if (queue.length >= MAX_QUEUE) queue.shift();
  queue.push(fn);
}

/** Current SDK, only while analytics is live (init'd, enabled, not opted out). */
const live = (): Posthog | null => (initialized && activeConfig?.enabled && !readOptOut() ? sdk : null);
const isLive = (): boolean => initialized && !!activeConfig?.enabled && !readOptOut();

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
  // #1532 S9: a survey answer is free text the SDK sends itself (it bypasses buildEventProperties), so
  // it gets the same scrubber. Numbers (rating, NPS) pass through; choice answers are string arrays.
  if (captureResult.event === 'survey sent') {
    for (const key of Object.keys(properties)) {
      if (key !== '$survey_response' && !key.startsWith('$survey_response_')) continue;
      const v = properties[key];
      if (typeof v === 'string') properties[key] = redactExceptionText(v);
      else if (Array.isArray(v)) properties[key] = v.map((x) => (typeof x === 'string' ? redactExceptionText(x) : x));
    }
  }
  sanitizeNestedEventValue(properties);
  // Same pass for person properties (`$set`, `$set_once`).
  sanitizeNestedEventValue(captureResult.$set);
  sanitizeNestedEventValue(captureResult.$set_once);
  return captureResult;
}

type PersistenceLike = {
  props?: Record<string, unknown>;
  save?: () => void;
  get_initial_props?: () => unknown;
};

// Stored URL-bearing values (cookie / localStorage / sessionStorage copies).
const PERSISTED_URL_KEYS = ['$initial_person_info', '$referrer', '$client_session_props'];

function sanitizePersisted(persistence: PersistenceLike): void {
  const props = persistence.props;
  if (!props) return;
  for (const key of PERSISTED_URL_KEYS) {
    if (props[key] !== undefined) props[key] = sanitizeNestedEventValue(props[key]);
  }
}

/**
 * Sanitises initial person properties at their reader and at every write to the stored copies
 * (wrapping `save`, the single sink all SDK writers go through); holds across `reset()` and for
 * values written after init (session props, referrer).
 */
function sanitizeInitialPersonProps(ph: unknown): void {
  const { persistence, sessionPersistence } = ph as {
    persistence?: PersistenceLike;
    sessionPersistence?: PersistenceLike;
  };
  const read = persistence?.get_initial_props;
  if (!persistence || typeof read !== 'function') {
    if (import.meta.env.DEV) console.warn('[analytics] posthog persistence hook missing; person properties unsanitised');
    return;
  }
  persistence.get_initial_props = () => sanitizeNestedEventValue(read.call(persistence));
  for (const store of [persistence, sessionPersistence]) {
    if (!store) continue;
    const save = store.save;
    if (typeof save === 'function') {
      store.save = () => {
        sanitizePersisted(store);
        save.call(store);
      };
    }
    store.save?.();
  }
}

function sanitizeNestedEventValue(value: unknown): unknown {
  if (typeof value === 'string') {
    try {
      const parsed = new URL(value);
      if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return value;
      const queryStart = value.indexOf('?');
      const hashStart = value.indexOf('#');
      const suffixStart = [queryStart, hashStart].filter((index) => index >= 0).sort((a, b) => a - b)[0];
      return suffixStart === undefined ? value : value.slice(0, suffixStart);
    } catch {
      return value;
    }
  }
  if (Array.isArray(value)) {
    for (let index = 0; index < value.length; index += 1) {
      value[index] = sanitizeNestedEventValue(value[index]);
    }
    return value;
  }
  if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    for (const key of Object.keys(record)) {
      if (POSTHOG_PROPERTY_DENYLIST.includes(key) || key === 'navigationURL') {
        delete record[key];
      } else {
        record[key] = sanitizeNestedEventValue(record[key]);
      }
    }
  }
  return value;
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
 * FR-CON-002/003/AC-CON-011 (ADR-0067 addendum, 2026-07-28): the consent surface on `/privacy` is
 * THREE-STATE, not boolean — `analyticsClient.hasOptedOut()` alone answers only "did the user explicitly
 * check the box", which is a different question from "is this browser's usage actually being sent".
 * `getConsentState` answers the second question, in the SAME priority order `doInit`'s own guard
 * checks (config.enabled, then DNT, then the stored opt-out) — so the UI can never show a state the
 * SDK-init guard disagrees with:
 *   - 'disabled'   — this deployment has no valid PostHog key / analytics turned off entirely.
 *                    Nothing would send regardless of DNT or the stored preference.
 *   - 'dnt'        — the browser's Do Not Track signal is on. `doInit` never calls `posthog.init` in
 *                    this case (FR-CON-001) — this OVERRIDES a not-yet-opted-out preference; nothing
 *                    the user does in this browser can turn analytics back on while DNT is set.
 *   - 'opted-out'  — the user explicitly opted out (and neither of the above already suppressed it).
 *   - 'active'     — analytics is genuinely running: enabled, no DNT, not opted out.
 * Pure function of its inputs (config + the two ambient reads) — no dependency on `activeConfig`/
 * `initialized`, so it works correctly even before `AnalyticsProvider`'s own `init()` effect has run.
 */
export type ConsentState = 'disabled' | 'dnt' | 'opted-out' | 'active';

export function getConsentState(config: AnalyticsConfig): ConsentState {
  if (!config.enabled) return 'disabled';
  if (isDoNotTrack()) return 'dnt';
  if (readOptOut()) return 'opted-out';
  return 'active';
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
    // #1532 S9: the SDK never pops a survey by itself (that would ignore "not during a write or a form",
    // first week and the org switch). SurveyHost / the Feedback button render them through
    // `analyticsClient.surveys`; PostHog still decides eligibility (wait period, targeting, already seen).
    disable_surveys_automatic_display: true,
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
    disable_capture_url_hashes: true,
    loaded: (ph) => sanitizeInitialPersonProps(ph),
  };
}

function doInit(config: AnalyticsConfig): void {
  activeConfig = config;
  if (!config.enabled || initialized || loading || !config.posthogKey || readOptOut() || isDoNotTrack()) return;
  initialized = true;
  const key = config.posthogKey;
  loading = import('posthog-js')
    .then(({ default: ph }) => {
      // Consent revoked (or DNT set) while the chunk loaded: never init, drop the buffer.
      if (readOptOut() || isDoNotTrack()) {
        queue = [];
        initialized = false;
        loading = null;
        return;
      }
      ph.init(key, buildPosthogInitOptions(config));
      // AC-PHO-012: same id the source-map upload uses, so PostHog filters issues by release.
      ph.register({ release: __GIT_SHA__ });
      sdk = ph;
      const pending = queue;
      queue = [];
      for (const fn of pending) {
        try {
          fn(ph);
        } catch {
          /* one bad buffered call must not lose the rest */
        }
      }
    })
    .catch(() => {
      // SDK failed to load (offline, blocked): analytics goes dark, the app is unaffected.
      queue = [];
      initialized = false;
      loading = null;
    });
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
    // Revoke: drop everything buffered, never flush it later.
    queue = [];
    if (initialized) withSdk((ph) => ph.opt_out_capturing());
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
      withSdk((ph) => ph.opt_in_capturing({ captureEventName: false }));
      return;
    }
    if (activeConfig) {
      doInit(activeConfig);
      // The SDK's OWN persisted opt-out is a SEPARATE key from ours and survives a fresh `init()`
      // call — without this, traffic to PostHog resumes (consent reads PENDING, not opted-out) but
      // EVENTS never do, because the SDK still privately believes this browser opted out. Analytics
      // would go permanently dark while looking opted back in.
      if (initialized) withSdk((ph) => ph.opt_in_capturing({ captureEventName: false }));
    }
  },

  capture(event: AnalyticsEventName, properties: SafeProperties = {}) {
    if (!isLive()) return;
    // Sanitise BEFORE buffering: a queued event is already clean (#1840, FR-OF-011).
    const safe = buildEventProperties(event, properties, activeConfig!.isProd);
    withSdk((ph) => {
      if (!readOptOut()) ph.capture(event, safe);
    });
  },

  captureException(input: CaptureExceptionInput) {
    if (!isLive()) return;
    const err = new Error(input.message) as Error & { componentStack?: string };
    err.name = input.name;
    if (input.componentStack !== undefined) {
      err.componentStack = input.componentStack;
    }
    withSdk((ph) => {
      if (!readOptOut()) ph.captureException(err);
    });
  },

  /** #1532 S9. Every method is inert unless analytics is live (init'd, enabled, not opted out). */
  surveys: {
    /** The id of the published survey with exactly this name, or null (not published / analytics off). */
    find(name: string, done: (id: string | null) => void) {
      if (!isLive()) return done(null);
      withSdk((ph) => ph.getSurveys((all) => done((all.find((x) => x?.name === name)?.id as string | undefined) ?? null)));
    },
    /** PostHog's own verdict: running, targeting flag, wait period passed, not already seen. Async: waits for the SDK. */
    async canRender(id: string): Promise<boolean> {
      if (!isLive()) return false;
      await loading;
      const ph = live();
      return ph ? ph.canRenderSurvey(id)?.visible === true : false;
    },
    /**
     * Show survey `id` as PostHog's own popover (its chrome records shown / sent / dismissed and the
     * 30-day wait). `properties` ride on the answer event; `nextTo` anchors it beside an element.
     * Eligibility (wait period, targeting) is checked by the caller via `canRender` for prompted surveys.
     */
    show(id: string, properties: SafeProperties, nextTo?: string) {
      if (!isLive()) return;
      // The shipped SDK has `displaySurvey`; the published typings omit it.
      withSdk((ph) =>
        (ph as unknown as { displaySurvey: (id: string, o: object) => void }).displaySurvey(id, {
          displayType: 'popover',
          ignoreConditions: true,
          ignoreDelay: true,
          properties,
          ...(nextTo ? { position: 'next_to_trigger', selector: nextTo } : {}),
        }),
      );
    },
    /** Calls `cb(event, properties)` for every event the SDK captures; returns the unsubscribe. No-op when analytics is off. */
    onCaptured(cb: (event: string, properties: Record<string, unknown>) => void): () => void {
      if (!isLive()) return () => {};
      let off = () => {};
      let cancelled = false;
      withSdk((ph) => {
        if (cancelled) return;
        off = ph.on('eventCaptured', (e: { event?: string; properties?: Record<string, unknown> }) => {
          if (typeof e?.event === 'string') cb(e.event, e.properties ?? {});
        });
      });
      return () => {
        cancelled = true;
        off();
      };
    },
  },

  identify(input: { userId: string; role: string; orgId: string }) {
    if (!isLive()) return;
    withSdk((ph) => {
      if (readOptOut()) return;
      ph.identify(input.userId, { role: input.role });
      ph.register({ role: input.role, org_id: input.orgId });
    });
  },

  /**
   * Plans S4 (FR-PLN-016): register a PostHog GROUP and its properties (today: the caller's
   * `organisation` group with its `plan`), so every later event can be sliced by plan without carrying
   * a property of its own. Group properties describe the group, not the person: callers pass plan
   * identifiers only — never a name, an id the group does not already carry, or any row data.
   *
   * Same consent gate as every other call (initialized + enabled + not opted out; a DNT browser never
   * inits at all), so a group is never created for a user who has not consented.
   */
  group(type: string, key: string, properties: Record<string, string> = {}) {
    if (!isLive()) return;
    withSdk((ph) => {
      if (!readOptOut()) ph.group(type, key, properties);
    });
  },

  register(properties: SafeProperties) {
    if (!isLive()) return;
    const safe = buildEventProperties('app_route_viewed', properties, activeConfig!.isProd);
    withSdk((ph) => {
      if (!readOptOut()) ph.register(safe);
    });
  },

  reset() {
    if (!initialized) return;
    withSdk((ph) => {
      ph.reset();
      // `posthog.reset()` DELETES the SDK's own consent key, so its internal state reads PENDING
      // (i.e. "allowed") again and `is_capturing()`/captures resume for the rest of the session even
      // though this browser is still opted out in OUR storage. Log out → capture silently resumes —
      // a privacy promise must not depend on SDK-internal state surviving a call we don't control.
      if (readOptOut()) ph.opt_out_capturing();
    });
  },

  /** Agent-chat consent flag source: the live SDK's session id, or undefined (not loaded / opted out). */
  agentSession(): { sessionId?: string } | undefined {
    try {
      const ph = live();
      if (!ph?.__loaded || ph.has_opted_out_capturing()) return undefined;
      const sessionId = ph.get_session_id();
      return sessionId ? { sessionId } : {};
    } catch {
      return undefined;
    }
  },

  /** Resolves once the deferred SDK load settles (success or failure). Tests + canRender. */
  ready(): Promise<void> {
    return loading ?? Promise.resolve();
  },

  /** @internal Reset singleton state between tests */
  __resetForTests() {
    initialized = false;
    activeConfig = null;
    sdk = null;
    loading = null;
    queue = [];
  },
};
