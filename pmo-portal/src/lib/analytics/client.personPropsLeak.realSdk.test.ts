// @vitest-environment jsdom
//
// SECURITY: the URL/token sanitiser used to run on event `properties` only. posthog-js also puts the
// landing URL/referrer into TOP-LEVEL `$set` / `$set_once` (`$initial_current_url`, `$initial_referrer`
// ...) and into the `/flags` request's `person_properties` -- neither passes through `property_denylist`.
// This inits the REAL SDK on a URL whose query + hash carry token-like values, intercepts every transport
// (fetch / XHR / sendBeacon), decodes gzip / base64 bodies, and asserts the markers appear in NO body.
import { describe, expect, it, vi } from 'vitest';
import posthog from 'posthog-js';
import { analyticsClient } from './client';
import type { AnalyticsConfig } from './config';

const config: AnalyticsConfig = {
  enabled: true,
  demoMode: false,
  replayAndAutocapture: false,
  posthogKey: 'phc_' + 'a'.repeat(24),
  posthogHost: 'https://ph-e2e.invalid',
  appEnv: 'test',
  isProd: false,
  demoAudience: 'internal',
  demoAccount: 'local',
};

const HASH_TOKEN = 'HASHSECRET9f8e7d6c5b4a';
const QUERY_TOKEN = 'QUERYSECRET1a2b3c4d5e6f';
const REF_TOKEN = 'REFSECRET0p9o8i7u6y5t';
const MARKERS = [HASH_TOKEN, QUERY_TOKEN, REF_TOKEN];

type Sent = { url: string; variants: string[] };

// posthog-js captures `fetch` / `XMLHttpRequest` / `sendBeacon` when its module loads, so the fake
// transport must exist BEFORE the import above is evaluated -- hence vi.hoisted.
const { sent } = vi.hoisted(() => {
  const sent: Sent[] = [];
  /** Every textual reading of a request body: raw, gunzipped, base64-decoded (and gunzipped). */
  async function variantsOf(body: unknown): Promise<string[]> {
    const { gunzipSync } = await import('node:zlib');
    let bytes: Buffer | null = null;
    if (typeof body === 'string') bytes = Buffer.from(body);
    else if (body instanceof Blob) bytes = Buffer.from(await body.arrayBuffer());
    else if (body instanceof ArrayBuffer) bytes = Buffer.from(body);
    else if (ArrayBuffer.isView(body)) bytes = Buffer.from(body.buffer, body.byteOffset, body.byteLength);
    else if (body) bytes = Buffer.from(String(body));
    if (!bytes) return [];
    const out = [bytes.toString('latin1'), bytes.toString('utf8')];
    const tryGunzip = (b: Buffer) => {
      try {
        out.push(gunzipSync(b).toString('utf8'));
      } catch {
        /* not gzip */
      }
    };
    tryGunzip(bytes);
    const text = bytes.toString('utf8');
    const m = /(?:^|&)data=([^&]*)/.exec(text);
    for (const cand of [m ? decodeURIComponent(m[1]) : '', text]) {
      if (!/^[A-Za-z0-9+/=_-]{16,}$/.test(cand)) continue;
      const b = Buffer.from(cand, 'base64');
      out.push(b.toString('utf8'));
      tryGunzip(b);
    }
    return out;
  }
  const record = (url: string, body: unknown) => {
    const entry: Sent = { url, variants: [url] };
    sent.push(entry);
    pending.push(variantsOf(body).then((v) => entry.variants.push(...v)));
  };
  const pending: Promise<unknown>[] = [];
  (globalThis as { __pending?: Promise<unknown>[] }).__pending = pending;
  globalThis.fetch = (async (input: unknown, init?: { body?: unknown }) => {
    record(String((input as { url?: string })?.url ?? input), init?.body);
    return { ok: true, status: 200, json: async () => ({}), text: async () => '{}' };
  }) as unknown as typeof fetch;
  const open = XMLHttpRequest.prototype.open;
  XMLHttpRequest.prototype.open = function (this: XMLHttpRequest & { __u?: string }, m: string, u: string | URL) {
    this.__u = String(u);
    return open.apply(this, [m, u] as never);
  } as never;
  XMLHttpRequest.prototype.send = function (this: XMLHttpRequest & { __u?: string }, body?: unknown) {
    record(this.__u ?? '', body);
  } as never;
  navigator.sendBeacon = ((url: string, data?: unknown) => {
    record(String(url), data);
    return true;
  }) as typeof navigator.sendBeacon;
  return { sent };
});

describe('person properties never carry the landing URL tokens -- the REAL SDK, every transport', () => {
  it('no request body (events, $set/$set_once, /flags, decide) contains URL query/hash values', async () => {
    window.history.pushState({}, '', `/login?token=${QUERY_TOKEN}#access_token=${HASH_TOKEN}`);
    Object.defineProperty(document, 'referrer', {
      value: `https://idp.example/cb?code=${REF_TOKEN}#frag=${REF_TOKEN}`,
      configurable: true,
    });
    analyticsClient.init(config);
    posthog.capture('app_route_viewed', { route: '/login' });
    posthog.identify('user-1', { role: 'admin' });
    posthog.capture('after_identify');
    posthog.setPersonPropertiesForFlags({ plan: 'x' });
    posthog.reloadFeatureFlags();
    posthog.reset();
    posthog.capture('after_reset');
    posthog.identify('user-2');
    window.dispatchEvent(new Event('pagehide'));
    await new Promise((r) => setTimeout(r, 4500));
    await Promise.all((globalThis as { __pending?: Promise<unknown>[] }).__pending ?? []);

    // positive controls: the transport really saw events and a /flags call (else this is vacuous)
    expect(sent.some((s) => /\/(e|batch|i\/v0\/e)\/?(\?|$)/.test(s.url))).toBe(true);
    expect(sent.some((s) => /\/flags\//.test(s.url))).toBe(true);
    const leaks: string[] = [];
    for (const s of sent) {
      for (const v of s.variants) {
        for (const marker of MARKERS) if (v.includes(marker)) leaks.push(`${s.url} leaks ${marker}`);
      }
    }
    expect(leaks).toEqual([]);
  }, 15000);
});
