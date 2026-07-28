/**
 * Tests for `_shared/reportEdgeError.ts` — the ONE call every edge function makes when
 * something fails (ADR-0066). Fans one failure into a structured console line and an
 * error_events row.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import {
  reportEdgeError,
  __resetSinkForTests,
} from '../../../../supabase/functions/_shared/reportEdgeError';

afterEach(() => {
  __resetSinkForTests();
  vi.restoreAllMocks();
});

describe('reportEdgeError', () => {
  it('logs a structured console line carrying the caller-supplied fn + errorCode', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const sink = { from: () => ({ insert: async () => ({ error: null }) }) };

    await reportEdgeError({ fn: 'erpnext-sweep', errorCode: 'ERP_PUSH_FAILED' }, sink);

    expect(spy).toHaveBeenCalledWith(
      '[erpnext-sweep] ERP_PUSH_FAILED',
      expect.objectContaining({ fn: 'erpnext-sweep', errorCode: 'ERP_PUSH_FAILED' }),
    );
  });

  it('writes an error_events row through the injected sink', async () => {
    const insertSpy = vi.fn(async () => ({ error: null }));
    const sink = { from: () => ({ insert: insertSpy }) };
    vi.spyOn(console, 'error').mockImplementation(() => {});

    await reportEdgeError(
      { fn: 'erpnext-sweep', errorCode: 'ERP_PUSH_FAILED', contextId: 'ctx1', orgId: 'org1' },
      sink,
    );

    expect(insertSpy).toHaveBeenCalledWith({
      fn: 'erpnext-sweep',
      error_code: 'ERP_PUSH_FAILED',
      context_id: 'ctx1',
      org_id: 'org1',
    });
  });

  it('AC-OBS-001: with no injected sink and no Deno env, reports ERROR_EVENT_SINK_UNAVAILABLE instead of skipping silently', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});

    await reportEdgeError({ fn: 'health', errorCode: 'X' }); // no injected client; Deno is undefined in Vitest

    expect(spy).toHaveBeenCalledWith(
      '[health] X',
      expect.objectContaining({ errorCode: 'X' }),
    );
    expect(spy).toHaveBeenCalledWith(
      '[health] ERROR_EVENT_SINK_UNAVAILABLE',
      expect.objectContaining({ errorCode: 'ERROR_EVENT_SINK_UNAVAILABLE' }),
    );
  });
});
