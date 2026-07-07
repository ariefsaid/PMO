/**
 * Tests for the error_events companion writer (`_shared/errorEvent.ts`), the
 * fire-and-forget insert that runs alongside every logStructuredError call site
 * (observability floor, DC-OF-001 step 2, FR-OF-001/002/003).
 *
 * Test-location convention (standing rule — see openRouterModelClient.test.ts header,
 * errorLog.test.ts): edge-fn logic tests live under pmo-portal/ (Vitest's root); the
 * implementation stays in supabase/functions/, imported here via a relative path.
 */
import { describe, it, expect, vi } from 'vitest';
import { recordErrorEvent } from '../../../../supabase/functions/_shared/errorEvent';

describe('recordErrorEvent', () => {
  it('AC-OF-003: swallows an insert rejection, logs ERROR_EVENT_INSERT_FAILED, never throws', async () => {
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const rejectingSupabase = {
      from: () => ({
        insert: () => Promise.reject(new Error('connection refused')),
      }),
    };

    await expect(
      recordErrorEvent(rejectingSupabase as never, {
        fn: 'agent-chat',
        errorCode: 'MISSING_OPENROUTER_API_KEY',
      }),
    ).resolves.toBeUndefined();

    expect(errSpy).toHaveBeenCalledWith(
      '[errorEvent] ERROR_EVENT_INSERT_FAILED',
      expect.objectContaining({ errorCode: 'ERROR_EVENT_INSERT_FAILED' }),
    );
    errSpy.mockRestore();
  });

  it('AC-OF-003: inserts {fn, error_code, context_id, org_id} on the happy path', async () => {
    const insertSpy = vi.fn(() => Promise.resolve({ error: null }));
    const supabase = { from: () => ({ insert: insertSpy }) };

    await recordErrorEvent(supabase as never, {
      fn: 'agent-dispatch',
      errorCode: 'DISPATCH_TICK_FAILED',
      contextId: 'run_abc',
      orgId: 'org_1',
    });

    expect(insertSpy).toHaveBeenCalledWith({
      fn: 'agent-dispatch',
      error_code: 'DISPATCH_TICK_FAILED',
      context_id: 'run_abc',
      org_id: 'org_1',
    });
  });

  it('AC-OF-003: an insert that RESOLVES with a Postgres error object also swallows (does not throw)', async () => {
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const supabase = { from: () => ({ insert: () => Promise.resolve({ error: { code: '42501' } }) }) };

    await expect(
      recordErrorEvent(supabase as never, { fn: 'compose-view', errorCode: 'MISSING_OPENROUTER_API_KEY' }),
    ).resolves.toBeUndefined();
    expect(errSpy).toHaveBeenCalledWith(
      '[errorEvent] ERROR_EVENT_INSERT_FAILED',
      expect.objectContaining({ errorCode: 'ERROR_EVENT_INSERT_FAILED', code: '42501' }),
    );
    errSpy.mockRestore();
  });
});
