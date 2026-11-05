import { describe, expect, it, vi } from 'vitest';
import { checkStatementChanges, type StatementCheckInput } from './statementChangeCheck.ts';
import type { ErpClientDeps } from './client.ts';

const context = { bindingId: 'binding', activatedAt: '2026-01-01', company: 'Example Co', profile: '16.33.0/16.31.0', fingerprint: 'validated-context' };
const row = { name: 'private-row', modified: '2026-01-02 12:00:00.000000' };
function fixture(responses: unknown[] = [[], [], []]) {
  const fetchImpl = vi.fn(async (_url: string | URL | Request, _init?: RequestInit) => new Response(JSON.stringify({ message: responses.shift() })));
  const client: ErpClientDeps = { fetchImpl: fetchImpl as typeof fetch, baseUrl: 'https://example.invalid', apiKey: 'secret-key', apiSecret: 'secret-value', maxRetries: 0 };
  return { client, fetchImpl };
}
async function baseline(responses: unknown[] = [[], [], []]) {
  const f = fixture(responses);
  const result = await checkStatementChanges(f.client, { context, previous: null });
  expect(result.status).toBe('unknown');
  expect(result).toHaveProperty('observation');
  if (!('observation' in result)) throw new Error('missing observation');
  return result.observation;
}

describe('statement source change hint', () => {
  it('round trips actual first observations, keyed independently of order, while coverage remains pending', async () => {
    const observation = await baseline([[row], [], []]);
    const f = fixture([[row], [], []]);
    const result = await checkStatementChanges(f.client, { context, previous: { ...observation, sources: [...observation.sources].reverse() } });
    expect(result).toMatchObject({ status: 'unknown', reason: 'unverified_dependencies', hint: 'no_observed_change', observation: { version: 1 } });
    expect(f.fetchImpl).toHaveBeenCalledTimes(3);
    const urls = f.fetchImpl.mock.calls.map(call => new URL(String(call[0])));
    expect(urls.map(url => url.searchParams.get('doctype'))).toEqual(['GL Entry', 'Account', 'Period Closing Voucher']);
    for (const url of urls) {
      expect(url.pathname).toBe('/api/method/frappe.client.get_list');
      expect(JSON.parse(url.searchParams.get('filters')!)).toEqual([['company', '=', context.company]]);
      expect(JSON.parse(url.searchParams.get('fields')!)).toEqual(['name', 'modified']);
      expect(url.searchParams.get('order_by')).toBe('modified desc, name desc');
      expect(url.searchParams.get('limit_page_length')).toBe('1');
    }
    expect(observation.sources.map(s => s.source)).toEqual(['GL Entry', 'Account', 'Period Closing Voucher']);
  });
  it('handles successful empty observations and changed tops without clearing pending', async () => {
    const previous = await baseline();
    const equal = await checkStatementChanges(fixture().client, { context, previous });
    expect(equal).toMatchObject({ status: 'unknown', reason: 'unverified_dependencies' });
    const changed = await checkStatementChanges(fixture([[row], [], []]).client, { context, previous });
    expect(changed).toMatchObject({ status: 'changed', reason: 'source_hint_changed' });
    expect(changed).toHaveProperty('observation');
  });
  it.each(['2026-01-02 12:00:00.000000', '2026-01-01 12:00:00.000000'])('keeps ties and regressions ambiguous %s', async modified => {
    const previous = await baseline([[row], [], []]);
    const result = await checkStatementChanges(fixture([[{ name: 'other', modified }], [], []]).client, { context, previous });
    expect(result).toEqual({ status: 'unknown', reason: 'ambiguous_hint' });
  });
  it('rejects malformed or incompatible persisted state before requests', async () => {
    const valid = await baseline();
    const sparse = Array(3);
    const invalid: unknown[] = [undefined, 3, {}, { ...valid, version: 0 }, { ...valid, sources: sparse }, { ...valid, sources: [null, ...valid.sources.slice(1)] }, { ...valid, sources: [undefined, ...valid.sources.slice(1)] }, { ...valid, sources: [3, ...valid.sources.slice(1)] }, { ...valid, sources: [valid.sources[0], valid.sources[0], valid.sources[2]] }, { ...valid, sources: valid.sources.slice(1) }, { ...valid, sources: [{ ...valid.sources[0], source: 'replacement' }, ...valid.sources.slice(1)] }, { ...valid, sources: [{ ...valid.sources[0], top: { ...row, modified: 'bad' } }, ...valid.sources.slice(1)] }];
    for (const previous of invalid) {
      const f = fixture();
      const result = await checkStatementChanges(f.client, { context, previous: previous as StatementCheckInput['previous'] });
      expect(result).toEqual({ status: 'unknown', reason: 'ambiguous_hint' });
      expect(f.fetchImpl).not.toHaveBeenCalled();
    }
    expect(await checkStatementChanges(fixture().client, { context: { ...context, fingerprint: 'changed' }, previous: valid })).toEqual({ status: 'unknown', reason: 'context_mismatch' });
  });
  it.each([null, {}, [{ name: 'x' }], [{ name: 'x', modified: 'bad' }], [row, row]])('rejects partial or malformed responses %#', async value => {
    const previous = await baseline();
    const result = await checkStatementChanges(fixture([[], value]).client, { context, previous });
    expect(result).toEqual({ status: 'unknown', reason: 'invalid_response' });
  });
  it('does not let a request failure clear pending or return a complete observation', async () => {
    const previous = await baseline();
    const f = fixture();
    f.client.fetchImpl = vi.fn(async () => { throw new Error('secret-value Example Co'); }) as typeof fetch;
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      const result = await checkStatementChanges(f.client, { context, previous });
      expect(result.status).toBe('unknown');
      expect(result).not.toHaveProperty('observation');
      expect(JSON.stringify([result, log.mock.calls])).not.toMatch(/secret|Example/);
    } finally { log.mockRestore(); }
  });
  it.each(['abort', 'deadline'])('does not fetch after a queued limiter resolves after %s', async mode => {
    const previous = await baseline();
    const f = fixture();
    let release!: () => void;
    f.client.rateLimiter = { acquire: () => new Promise<void>(resolve => { release = resolve; }) };
    const controller = new AbortController();
    const pending = checkStatementChanges(f.client, { context, previous, signal: controller.signal, deadlineAtMs: mode === 'deadline' ? Date.now() + 25 : undefined });
    if (mode === 'abort') controller.abort();
    expect(await pending).toEqual({ status: 'unknown', reason: 'cancelled' });
    release();
    await new Promise(resolve => setTimeout(resolve, 10));
    expect(f.fetchImpl).not.toHaveBeenCalled();
  });
  it('cancels an in-flight fetch without further requests', async () => {
    const previous = await baseline();
    const f = fixture();
    f.client.fetchImpl = vi.fn((_url, init) => new Promise<Response>((_resolve, reject) => init?.signal?.addEventListener('abort', () => reject(new Error('secret')), { once: true }))) as typeof fetch;
    const controller = new AbortController();
    const pending = checkStatementChanges(f.client, { context, previous, signal: controller.signal });
    await Promise.resolve(); controller.abort();
    expect(await pending).toEqual({ status: 'unknown', reason: 'cancelled' });
    expect(f.client.fetchImpl).toHaveBeenCalledTimes(1);
  });
});

it('cleans up caller cancellation listener after successful reads', async () => {
  const controller = new AbortController();
  const add = vi.spyOn(controller.signal, 'addEventListener');
  const remove = vi.spyOn(controller.signal, 'removeEventListener');
  await checkStatementChanges(fixture().client, { context, previous: null, signal: controller.signal });
  expect(add.mock.calls.filter(call => call[0] === 'abort').length).toBe(remove.mock.calls.filter(call => call[0] === 'abort').length);
});

it('bounds an uncooperative in-flight request and does not retry', async () => {
  const previous = await baseline();
  const f = fixture();
  f.client.fetchImpl = vi.fn(() => new Promise<Response>(() => {})) as typeof fetch;
  expect(await checkStatementChanges(f.client, { context, previous, deadlineAtMs: Date.now() + 25 })).toEqual({ status: 'unknown', reason: 'cancelled' });
  expect(f.client.fetchImpl).toHaveBeenCalledTimes(1);
});
