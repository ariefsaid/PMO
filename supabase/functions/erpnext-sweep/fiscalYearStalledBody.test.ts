/**
 * AC-OUT-841 — the sweep's live `Fiscal Year` read: a body that stalls after headers fails CLOSED as the
 * same `external-unreachable` the connect phase raises, never a raw FetchDeadlineError.
 */
import { assertEquals, assertRejects } from '@std/assert';
import { AppError } from '../../../pmo-portal/src/lib/appError.ts';
import { erp, withFetchMock } from '../_shared/testing/edgeTestKit.ts';
import { withShortOutboundDeadline } from '../_shared/testing/hungFetch.ts';

Deno.serve = (() => ({ finished: Promise.resolve() })) as unknown as typeof Deno.serve;
const { readErpFiscalYearsLive } = await import('./index.ts');

Deno.test('AC-OUT-841: a stalled Fiscal Year body is external-unreachable', async () => {
  Deno.env.set('STALL_BENCH_KEY', 'k');
  Deno.env.set('STALL_BENCH_SECRET', 's');
  const from = () => ({ select: () => ({ eq: () => ({ eq: () => ({ maybeSingle: () => Promise.resolve({ data: null, error: null }) }) }) }) });
  const serviceClient = { from, rpc: () => Promise.resolve({ data: null, error: null }) } as never;
  const org = { orgId: 'org-1', siteUrl: 'https://erp.stall.test', secretRef: 'stall-bench', company: 'ACME', config: {}, ownedDomains: [] } as never;
  const stalled = erp('erp.stall.test', '/api/resource/Fiscal%20Year', () =>
    new Response(new ReadableStream<Uint8Array>({ pull: () => new Promise(() => {}) }), { status: 200 }));
  await withFetchMock([stalled], () =>
    withShortOutboundDeadline(async () => {
      const err = await assertRejects(() => readErpFiscalYearsLive(serviceClient, org), AppError);
      assertEquals((err as AppError).code, 'external-unreachable');
    }));
});
