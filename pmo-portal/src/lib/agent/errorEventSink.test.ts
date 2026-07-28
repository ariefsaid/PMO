/**
 * Tests for `_shared/errorEventSink.ts` — a fetch-based service-role writer for
 * public.error_events, reachable from every edge function including ones that do not
 * otherwise import supabase-js (e.g. `health`). ADR-0066 §4.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { createServiceRoleErrorEventSink } from '../../../../supabase/functions/_shared/errorEventSink';

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

/** A fetch that never settles until its AbortSignal fires — models a hung PostgREST (correlated
 *  failure: the DB is slowest exactly when errors spike). Mirrors fetchWithDeadline.test.ts's
 *  hangingFetch fixture. */
function hangingFetch() {
  return vi.fn((_input: RequestInfo | URL, init?: RequestInit) =>
    new Promise<Response>((_resolve, reject) => {
      const signal = init?.signal;
      if (!signal) return; // no deadline wired -> would hang forever (the RED state)
      if (signal.aborted) reject(signal.reason ?? new Error('aborted'));
      signal.addEventListener('abort', () => reject(signal.reason ?? new Error('aborted')));
    }),
  );
}

describe('createServiceRoleErrorEventSink', () => {
  it('AC-OBS-001: returns null when the service-role env is absent (caller must report, not skip)', () => {
    expect(createServiceRoleErrorEventSink({})).toBeNull();
  });

  it('AC-OBS-001: POSTs the row to PostGREST with the service-role headers', async () => {
    const fetchMock = vi.fn(async () => new Response(null, { status: 201 }));
    vi.stubGlobal('fetch', fetchMock);

    const sink = createServiceRoleErrorEventSink({ url: 'https://db.example/', serviceRoleKey: 'srk' })!;
    const res = await sink.from('error_events').insert({ fn: 'erpnext-sweep', error_code: 'X' });

    expect(res.error).toBeNull();
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://db.example/rest/v1/error_events');
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer srk');
    expect(init.body).toBe(JSON.stringify({ fn: 'erpnext-sweep', error_code: 'X' }));
  });

  it('AC-OBS-001: a non-2xx PostGREST response is surfaced as an error, never swallowed', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('nope', { status: 403 })));
    const sink = createServiceRoleErrorEventSink({ url: 'https://db.example', serviceRoleKey: 'srk' })!;
    expect(await sink.from('error_events').insert({ fn: 'health', error_code: 'X' }))
      .toEqual({ error: { code: '403' } });
  });

  it('a hung PostgREST call is bounded by a deadline — resolves FetchDeadlineError, never hangs the caller (correlated-failure hazard: the DB is slowest exactly when errors spike)', async () => {
    vi.useFakeTimers();
    vi.stubGlobal('fetch', hangingFetch());

    const sink = createServiceRoleErrorEventSink({ url: 'https://db.example', serviceRoleKey: 'srk' })!;
    const resultPromise = sink.from('error_events').insert({ fn: 'erpnext-sweep', error_code: 'X' });

    await vi.advanceTimersByTimeAsync(10_000);
    const result = await resultPromise;

    expect(result).toEqual({ error: { code: 'FetchDeadlineError' } });
  });
});
