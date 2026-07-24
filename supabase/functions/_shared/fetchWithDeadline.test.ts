import { assert, assertEquals, assertRejects } from 'https://deno.land/std@0.224.0/assert/mod.ts';
import { fetchWithDeadline, FetchDeadlineError } from './fetchWithDeadline.ts';

/** A fetch that never settles until its AbortSignal fires — models a hung-but-alive ERPNext host. */
function hangingFetch(): typeof fetch {
  return ((_input: string | URL | Request, init?: RequestInit) =>
    new Promise<Response>((_resolve, reject) => {
      const signal = init?.signal;
      if (!signal) return; // no deadline wired → would hang forever (the RED state)
      if (signal.aborted) reject(signal.reason ?? new Error('aborted'));
      signal.addEventListener('abort', () => reject(signal.reason ?? new Error('aborted')));
    })) as typeof fetch;
}

Deno.test('fetchWithDeadline aborts a never-responding host at the deadline → FetchDeadlineError (not a hang)', async () => {
  const start = Date.now();
  await assertRejects(
    () => fetchWithDeadline(hangingFetch(), 'https://erp.invalid/api/resource/Fiscal Year', {}, 25),
    FetchDeadlineError,
  );
  // Bounded: it returned promptly instead of hanging the worker.
  assert(Date.now() - start < 5_000, 'should abort near the deadline, not hang');
});

Deno.test('fetchWithDeadline passes a fast successful response straight through (happy path unchanged)', async () => {
  const ok = new Response('{"data":[]}', { status: 200 });
  const fastFetch = (() => Promise.resolve(ok)) as typeof fetch;
  const res = await fetchWithDeadline(fastFetch, 'https://erp.example/x', { method: 'GET' }, 20_000);
  assertEquals(res.status, 200);
});

Deno.test('fetchWithDeadline propagates a non-timeout network rejection unchanged (DNS/refused)', async () => {
  const boom = new Error('connection refused');
  const failingFetch = (() => Promise.reject(boom)) as typeof fetch;
  const err = await fetchWithDeadline(failingFetch, 'https://erp.example/x', {}, 20_000).catch((e) => e);
  // A real network failure is NOT masqueraded as a deadline — the caller still fails closed either way.
  assert(!(err instanceof FetchDeadlineError));
  assertEquals((err as Error).message, 'connection refused');
});

Deno.test('fetchWithDeadline threads the AbortSignal into the underlying fetch init', async () => {
  let sawSignal = false;
  const spyFetch = ((_input: string | URL | Request, init?: RequestInit) => {
    sawSignal = init?.signal instanceof AbortSignal;
    return Promise.resolve(new Response(null, { status: 204 }));
  }) as typeof fetch;
  await fetchWithDeadline(spyFetch, 'https://erp.example/x', { method: 'GET' }, 20_000);
  assert(sawSignal, 'the bounded fetch must pass an AbortSignal to the transport');
});
