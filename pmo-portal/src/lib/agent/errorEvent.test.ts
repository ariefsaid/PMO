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
  it('AC-OBS-011: an insert rejection resolves to a FAILURE indicator (not void), never throws', async () => {
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const rejectingSupabase = {
      from: () => ({ insert: () => Promise.reject(new Error('connection refused')) }),
    };

    await expect(
      recordErrorEvent(rejectingSupabase as never, { fn: 'agent-chat', errorCode: 'MISSING_OPENROUTER_API_KEY' }),
    ).resolves.toEqual({ ok: false, code: 'Error' });

    expect(errSpy).toHaveBeenCalledWith(
      '[errorEvent] ERROR_EVENT_INSERT_FAILED',
      expect.objectContaining({ errorCode: 'ERROR_EVENT_INSERT_FAILED' }),
    );
    errSpy.mockRestore();
  });

  it('AC-OBS-011: the happy path resolves to a SUCCESS indicator and inserts the row', async () => {
    const insertSpy = vi.fn(() => Promise.resolve({ error: null }));
    const supabase = { from: () => ({ insert: insertSpy }) };

    await expect(
      recordErrorEvent(supabase as never, {
        fn: 'agent-dispatch', errorCode: 'DISPATCH_TICK_FAILED', contextId: 'run_abc', orgId: 'org_1',
      }),
    ).resolves.toEqual({ ok: true });

    expect(insertSpy).toHaveBeenCalledWith({
      fn: 'agent-dispatch',
      error_code: 'DISPATCH_TICK_FAILED',
      context_id: 'run_abc',
      org_id: 'org_1',
    });
  });

  it('review round (2026-07-28): a contextId longer than 64 chars is TRUNCATED before it reaches error_events — structurally safe, not conventionally safe (every err.name today is a literal, but one `err.name = erpResponseText` away from the leak class closed twice this week)', async () => {
    const insertSpy = vi.fn(() => Promise.resolve({ error: null }));
    const supabase = { from: () => ({ insert: insertSpy }) };
    const longContextId = 'x'.repeat(200);

    await recordErrorEvent(supabase as never, {
      fn: 'erpnext-sweep',
      errorCode: 'ERP_PUSH_FAILED',
      contextId: longContextId,
    });

    const call = (insertSpy.mock.calls[0] as unknown as [{ context_id?: string }])[0];
    expect(call.context_id).toBe('x'.repeat(64));
    expect(call.context_id?.length).toBe(64);
  });

  it('AC-OBS-011: a resolve-with-Postgres-error ALSO reports failure (the swallow cannot return)', async () => {
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const supabase = { from: () => ({ insert: () => Promise.resolve({ error: { code: '42501' } }) }) };

    await expect(
      recordErrorEvent(supabase as never, { fn: 'compose-view', errorCode: 'MISSING_OPENROUTER_API_KEY' }),
    ).resolves.toEqual({ ok: false, code: '42501' });
    expect(errSpy).toHaveBeenCalledWith(
      '[errorEvent] ERROR_EVENT_INSERT_FAILED',
      expect.objectContaining({ errorCode: 'ERROR_EVENT_INSERT_FAILED', code: '42501' }),
    );
    errSpy.mockRestore();
  });
});
