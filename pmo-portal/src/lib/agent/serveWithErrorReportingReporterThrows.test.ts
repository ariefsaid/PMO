/**
 * The reporter's own throw must not escape `wrapWithErrorReporting`'s net (review round,
 * 2026-07-28): `recordErrorEvent`, `errorEventSink.insert`, and `capturePosthogException` all
 * self-swallow — but `reportEdgeError`'s OWN machinery does not (e.g. `createServiceRoleErrorEventSink`'s
 * `Deno.env.get`, or `console.error` itself, throwing). If `reportEdgeError` rejects,
 * `wrapWithErrorReporting` must still return its stable 500 — not a rejected promise that costs the
 * caller its own response, the exact thing this wrapper exists to prevent.
 *
 * A separate file (not serveWithErrorReporting.test.ts) because it needs `reportEdgeError` MOCKED
 * to throw for every case, which would corrupt that file's happy-path / UNHANDLED_EDGE_ERROR /
 * leak-path assertions against the REAL reportEdgeError -> logStructuredError -> console.error chain.
 */
import { describe, it, expect, vi } from 'vitest';

const reportEdgeErrorMock = vi.hoisted(() => ({
  reportEdgeError: vi.fn(async () => {
    throw new Error('the reporter itself is down');
  }),
}));
vi.mock('../../../../supabase/functions/_shared/reportEdgeError', () => reportEdgeErrorMock);

import { wrapWithErrorReporting } from '../../../../supabase/functions/_shared/serveWithErrorReporting';

describe('wrapWithErrorReporting — the reporter itself throwing must not cost the caller its response', () => {
  it('still returns the stable 500 when reportEdgeError REJECTS', async () => {
    const handler = vi.fn(async () => {
      throw new Error('boom');
    });
    const wrapped = wrapWithErrorReporting('erpnext-sweep', handler);

    const res = await wrapped(new Request('https://example.test'));

    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ error: 'INTERNAL_ERROR' });
  });
});
