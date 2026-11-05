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
  await res.body?.cancel(); // the deadline timer lives until the body is consumed or cancelled
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

Deno.test('fetchWithDeadline keeps the deadline through the body: headers prompt, body stalled → FetchDeadlineError', async () => {
  const stalledBodyFetch = ((_input: string | URL | Request, init?: RequestInit) => {
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        init?.signal?.addEventListener('abort', () => controller.error(init.signal?.reason ?? new Error('aborted')));
      },
    });
    return Promise.resolve(new Response(body, { status: 200 }));
  }) as typeof fetch;
  const res = await fetchWithDeadline(stalledBodyFetch, 'https://erp.example/x', {}, 25);
  assertEquals(res.status, 200);
  let guard: number | undefined;
  const outcome = await Promise.race([
    res.text().then(() => 'read', (e) => e),
    new Promise((r) => { guard = setTimeout(() => r('hung'), 1_000); }),
  ]);
  clearTimeout(guard);
  assert(outcome instanceof FetchDeadlineError, `expected FetchDeadlineError, got ${String(outcome)}`);
});

Deno.test('fetchWithDeadline passes a fully read body through intact and leaves no timer behind', async () => {
  const fast = (() => Promise.resolve(new Response('{"a":1}', { status: 201, headers: { 'x-k': 'v' } }))) as typeof fetch;
  const res = await fetchWithDeadline(fast, 'https://erp.example/x', {}, 20_000);
  assertEquals(res.status, 201);
  assertEquals(res.headers.get('x-k'), 'v');
  assertEquals(await res.json(), { a: 1 }); // Deno's leak sanitizer fails the test if the timer is left running
});
