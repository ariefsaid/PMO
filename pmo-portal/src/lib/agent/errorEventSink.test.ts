/**
 * Tests for `_shared/errorEventSink.ts` — a fetch-based service-role writer for
 * public.error_events, reachable from every edge function including ones that do not
 * otherwise import supabase-js (e.g. `health`). ADR-0066 §4.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { createServiceRoleErrorEventSink } from '../../../../supabase/functions/_shared/errorEventSink';

afterEach(() => vi.unstubAllGlobals());

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
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
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
});
