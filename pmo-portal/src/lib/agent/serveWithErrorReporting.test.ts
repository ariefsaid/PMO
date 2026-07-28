/**
 * Tests for `_shared/serveWithErrorReporting.ts` — the outermost net every edge function serves
 * through instead of a bare `Deno.serve` (ADR-0066 §2). The actual `Deno.serve(...)` call cannot
 * run in Vitest (no `Deno` global), so the catching/reporting logic is factored into
 * `wrapWithErrorReporting`, a pure `(req) => Promise<Response>` that IS unit-testable — this
 * mirrors the codebase's existing pattern of a testable core + a thin Deno.serve wiring line
 * (e.g. external-companies' handleCompaniesRequest).
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import {
  wrapWithErrorReporting,
  serveWithErrorReporting,
} from '../../../../supabase/functions/_shared/serveWithErrorReporting';
import { __resetSinkForTests } from '../../../../supabase/functions/_shared/reportEdgeError';

afterEach(() => {
  __resetSinkForTests();
  vi.restoreAllMocks();
});

describe('wrapWithErrorReporting', () => {
  it('returns the handler response unchanged on success', async () => {
    const handler = vi.fn(async () => new Response('ok', { status: 200 }));
    const wrapped = wrapWithErrorReporting('health', handler);

    const res = await wrapped(new Request('https://example.test'));

    expect(res.status).toBe(200);
    expect(await res.text()).toBe('ok');
  });

  it('catches a thrown error, reports UNHANDLED_EDGE_ERROR, and returns a stable 500', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const handler = vi.fn(async () => {
      throw new Error('boom');
    });
    const wrapped = wrapWithErrorReporting('erpnext-sweep', handler);

    const res = await wrapped(new Request('https://example.test'));

    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ error: 'INTERNAL_ERROR' });
    expect(spy).toHaveBeenCalledWith(
      '[erpnext-sweep] UNHANDLED_EDGE_ERROR',
      expect.objectContaining({ fn: 'erpnext-sweep', errorCode: 'UNHANDLED_EDGE_ERROR' }),
    );
  });

  it('never interpolates the raw error message/object into the reported log line (leak path)', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const handler = vi.fn(async () => {
      throw new Error('super secret token abc123');
    });
    const wrapped = wrapWithErrorReporting('erpnext-sweep', handler);

    await wrapped(new Request('https://example.test'));

    const serialized = spy.mock.calls.map((c) => JSON.stringify(c)).join('\n');
    expect(serialized).not.toContain('super secret token abc123');
  });
});

describe('serveWithErrorReporting — the missing-Deno case (review round: no `Deno` -> no server, no error, no log is the exact green-by-absence class this PR exists to kill)', () => {
  it('throws LOUDLY when Deno is absent, instead of a silent `deno?.serve(...)` no-op — safe here: no shipped edge fn or Vitest suite calls serveWithErrorReporting outside a real Deno runtime', () => {
    // `Deno` is genuinely undefined under Vitest/Node — this exercises the real absent-global path,
    // not a stub.
    expect(() => serveWithErrorReporting('health', () => new Response('ok'))).toThrow(/Deno/);
  });
});
