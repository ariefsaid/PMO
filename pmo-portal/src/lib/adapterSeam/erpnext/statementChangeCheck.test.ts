import { describe, expect, it, vi } from 'vitest';
import { checkStatementChanges, type StatementCheckInput } from './statementChangeCheck.ts';
import type { ErpClientDeps } from './client.ts';

const context = { bindingId: 'binding', activatedAt: '2026-01-01', company: 'Example Co', profile: '16.33.0/16.31.0', fingerprint: 'validated-context' };
const previous = { context, tops: [null, null, null] } as const;
function fixture(responses: unknown[] = [[], [], []]) {
  const fetchImpl = vi.fn(async (_url: string | URL | Request, _init?: RequestInit) => new Response(JSON.stringify({ message: responses.shift() }), { status: 200 }));
  const client: ErpClientDeps = { fetchImpl: fetchImpl as typeof fetch, baseUrl: 'https://example.invalid', apiKey: 'secret-key', apiSecret: 'secret-value' };
  const input: StatementCheckInput = { context, previous };
  return { client, input, fetchImpl };
}

describe('statement source change hint', () => {
  it('requests each company source using the bounded permission-aware method and keeps equal empty hints pending', async () => {
    const { client, input, fetchImpl } = fixture();
    expect(await checkStatementChanges(client, input)).toEqual({ status: 'unknown', reason: 'unverified_dependencies', hint: 'no_observed_change' });
    expect(fetchImpl).toHaveBeenCalledTimes(3);
    const urls = fetchImpl.mock.calls.map(call => new URL(String(call[0])));
    expect(urls.map(url => url.searchParams.get('doctype'))).toEqual(['GL Entry', 'Account', 'Period Closing Voucher']);
    for (const url of urls) {
      expect(url.pathname).toBe('/api/method/frappe.client.get_list');
      expect(JSON.parse(url.searchParams.get('filters')!)).toEqual([['company', '=', 'Example Co']]);
      expect(JSON.parse(url.searchParams.get('fields')!)).toEqual(['name', 'modified']);
      expect(url.searchParams.get('order_by')).toBe('modified desc, name desc');
      expect(url.searchParams.get('limit_page_length')).toBe('1');
    }
  });
  it('reports a changed top row but never emits its identity', async () => {
    const f = fixture([[{ name: 'private-row', modified: '2026-01-02 12:00:00.000000' }], [], []]);
    const result = await checkStatementChanges(f.client, f.input);
    expect(result).toEqual({ status: 'changed', reason: 'source_hint_changed' });
    expect(JSON.stringify(result)).not.toContain('private-row');
  });
  it('keeps first observation and context drift pending', async () => {
    const f = fixture();
    expect(await checkStatementChanges(f.client, { context, previous: null })).toEqual({ status: 'unknown', reason: 'first_observation' });
    expect(await checkStatementChanges(f.client, { context: { ...context, fingerprint: 'different' }, previous })).toEqual({ status: 'unknown', reason: 'context_mismatch' });
  });
  it('treats equal timestamp ties and regressions as ambiguous', async () => {
    for (const modified of ['2026-01-02 12:00:00.000000', '2026-01-01 12:00:00.000000']) {
      const f = fixture([[{ name: 'other', modified }], [], []]);
      const prior = { context, tops: [{ name: 'old', modified: '2026-01-02 12:00:00.000000' }, null, null] } as const;
      expect(await checkStatementChanges(f.client, { context, previous: prior })).toEqual({ status: 'unknown', reason: 'ambiguous_hint' });
    }
  });
  it.each([null, {}, [{ name: 'x' }], [{ name: 'x', modified: 'bad' }], [{ name: 'x', modified: '2026-01-02 12:00:00' }, {}]])('rejects malformed or partial data %#', async value => {
    const f = fixture([value]);
    expect(await checkStatementChanges(f.client, f.input)).toEqual({ status: 'unknown', reason: 'invalid_response' });
  });
  it('treats denial and exceptions as unknown without echoing secrets', async () => {
    const f = fixture();
    f.client.fetchImpl = vi.fn(async () => { throw new Error('secret-value https://private.invalid'); }) as typeof fetch;
    const result = await checkStatementChanges(f.client, f.input);
    expect(result).toEqual({ status: 'unknown', reason: 'request_failed' });
    expect(JSON.stringify(result)).not.toMatch(/secret|private/);
  });
  it('treats a denied response as unknown', async () => {
    const f = fixture();
    f.client.fetchImpl = vi.fn(async () => new Response('{}', { status: 403 })) as typeof fetch;
    expect(await checkStatementChanges(f.client, f.input)).toEqual({ status: 'unknown', reason: 'request_failed' });
  });
  it('bounds a stalled request', async () => {
    const f = fixture();
    f.client.fetchImpl = vi.fn(() => new Promise<Response>(() => {})) as typeof fetch;
    expect(await checkStatementChanges(f.client, { ...f.input, deadlineAtMs: Date.now() + 20 })).toEqual({ status: 'unknown', reason: 'cancelled' });
  });
  it('treats cancellation and deadline as unknown', async () => {
    const f = fixture();
    const controller = new AbortController(); controller.abort();
    expect(await checkStatementChanges(f.client, { ...f.input, signal: controller.signal })).toEqual({ status: 'unknown', reason: 'cancelled' });
    expect(await checkStatementChanges(f.client, { ...f.input, deadlineAtMs: 0 })).toEqual({ status: 'unknown', reason: 'cancelled' });
  });
});
