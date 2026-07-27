/**
 * §4.4 / FR-HRD-020 — agent-dispatch's owner notification is doubly silent today:
 *   dispatcher.ts:288-306 uses a bare `catch {}` with no binding, AND casts `insert` to
 *   `Promise<{ error: unknown }>` without ever destructuring `error` — so the ORDINARY
 *   supabase-js failure mode (resolve with error populated) is dropped BEFORE the catch applies.
 * Both call sites (:435 condition-unevaluable, :447 over-credit) are fail-quiet-but-visible paths,
 * so a swallowed failure means the owner is never told — defeating the entire purpose of the path.
 * Contrast the same file's :515-525, which does it correctly.
 */
import { describe, it, expect, vi } from 'vitest';
import { notifyOwner } from '../../../../supabase/functions/agent-dispatch/dispatcher';

describe('notifyOwner', () => {
  it('AC-HRD-020: an insert that RESOLVES with a Postgres error is logged as NOTIFY_INSERT_FAILED', async () => {
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const client = { from: () => ({ insert: async () => ({ error: { code: '42501' } }) }) };

    const ok = await notifyOwner(client, 'warning', 'title', 'body', { automation_id: 'a1' });

    expect(ok).toBe(false);
    expect(errSpy).toHaveBeenCalledWith(
      '[agent-dispatch] NOTIFY_INSERT_FAILED',
      expect.objectContaining({ errorCode: 'NOTIFY_INSERT_FAILED' }),
    );
    errSpy.mockRestore();
  });

  it('AC-HRD-020: a THROWN insert is logged too, and still never rethrown', async () => {
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const client = { from: () => ({ insert: async () => { throw new Error('connection refused'); } }) };

    await expect(notifyOwner(client, 'warning', 't', null, null)).resolves.toBe(false);
    expect(errSpy).toHaveBeenCalledWith(
      '[agent-dispatch] NOTIFY_INSERT_FAILED',
      expect.objectContaining({ errorCode: 'NOTIFY_INSERT_FAILED' }),
    );
    errSpy.mockRestore();
  });

  it('AC-HRD-020: the happy path reports success', async () => {
    const client = { from: () => ({ insert: async () => ({ error: null }) }) };
    await expect(notifyOwner(client, 'info', 't', null, null)).resolves.toBe(true);
  });
});
