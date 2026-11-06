// @vitest-environment jsdom
//
// Inits the real SDK on a URL with query + hash values, intercepts every transport, decodes bodies,
// and asserts person properties, flags requests and the SDK's browser storage carry only sanitised URLs.
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

const HASH_MARK = 'HASHMARK9f8e7d6c5b4a';
const QUERY_MARK = 'QUERYMARK1a2b3c4d5e6f';
const REF_MARK = 'REFMARK0p9o8i7u6y5t';
const MARKS = [HASH_MARK, QUERY_MARK, REF_MARK];

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

describe('person properties are sanitised (real SDK, every transport)', () => {
  it('every request body and the browser storage carry only sanitised URLs', async () => {
    window.history.pushState({}, '', `/login?token=${QUERY_MARK}#access_token=${HASH_MARK}`);
    Object.defineProperty(document, 'referrer', {
      value: `https://idp.example/cb?code=${REF_MARK}#frag=${REF_MARK}`,
      configurable: true,
    });
    analyticsClient.init(config);
    await analyticsClient.ready();
    posthog.capture('app_route_viewed', { route: '/login' });
    posthog.identify('user-1', { role: 'admin', seen_at: `https://app.example/x?q=${QUERY_MARK}#h=${HASH_MARK}` });
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
    const found: string[] = [];
    // The SDK's persisted copies (cookie, localStorage, sessionStorage) are readable by the page and sent
    // back with requests, so they are checked the same way.
    const stored = [document.cookie, ...[localStorage, sessionStorage].map((st) => JSON.stringify({ ...st }))];
    for (const v of stored) for (const mark of MARKS) if (v.includes(mark)) found.push(`browser storage carries ${mark}`);
    expect(stored.join('').includes('phc_')).toBe(true); // control: the SDK did persist state
    for (const s of sent) {
      for (const v of s.variants) {
        for (const mark of MARKS) if (v.includes(mark)) found.push(`${s.url} carries ${mark}`);
      }
    }
    expect(found).toEqual([]);
  }, 15000);
});
