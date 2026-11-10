import { describe, it, expect, vi } from 'vitest';
import { activateAndPush } from './budgetPushConsequence';

// ⚑ THE BINDING MONEY INVARIANT (slice 4, ADR-0059 §3.1/§3.2): activating a budget version MUST NEVER fail
// because ERPNext failed. PMO is the source of truth; the push is a CONSEQUENCE of activation — after the
// transition commits, outside its transaction — never its precondition.
// ADR-0062 / AC-APU-001..004: and it is never AWAITED either — the PMO write is the act.

const flush = () => new Promise((r) => setTimeout(r, 0));

describe('activateAndPush', () => {
  it('AC-APU-002 resolves on the PMO write while the push never settles', async () => {
    const rpc = vi.fn().mockResolvedValue({ error: null });
    const dispatch = vi.fn(() => new Promise<unknown>(() => {})); // ERPNext hung: never resolves

    const result = await activateAndPush({ versionId: 'ver-1', rpc, dispatch });

    expect(result).toEqual({ activated: true, pushState: 'queued' });
    await flush();
    expect(dispatch).toHaveBeenCalledWith('ver-1'); // the push WAS started, just not awaited
  });

  it('AC-APU-001 AC-BUD-032 ⚑ a push rejection never fails the activation; it reaches onPushSettled as failed', async () => {
    const rpc = vi.fn().mockResolvedValue({ error: null });
    const dispatch = vi.fn().mockRejectedValue(new Error('external-unreachable'));
    const onPushSettled = vi.fn();

    const result = await activateAndPush({ versionId: 'ver-1', rpc, dispatch, onPushSettled });

    expect(result.activated).toBe(true); // the user's action ALWAYS succeeds
    expect(result.error).toBeUndefined(); // the push failure is NOT surfaced as an activation failure
    expect(rpc).toHaveBeenCalledWith('activate_budget_version', { version_id: 'ver-1' });
    await flush();
    expect(onPushSettled).toHaveBeenCalledWith('failed', undefined);
  });

  it('AC-BUD-032 a push rejection never rolls back or retry-loops the activation', async () => {
    const rpc = vi.fn().mockResolvedValue({ error: null });
    const dispatch = vi.fn().mockRejectedValue(new Error('budget-category-unmapped'));

    const result = await activateAndPush({ versionId: 'ver-1', rpc, dispatch });
    await flush();

    expect(result.activated).toBe(true);
    expect(rpc).toHaveBeenCalledOnce(); // never re-called — no retry loop on the PMO transition
    expect(dispatch).toHaveBeenCalledOnce(); // and no client-side retry storm
  });

  it('AC-APU-004 a REAL activation failure (the RPC itself) is surfaced and the push is never attempted', async () => {
    const rpc = vi.fn().mockResolvedValue({ error: { message: 'not authorized', code: '42501' } });
    const dispatch = vi.fn();
    const onPushSettled = vi.fn();

    const result = await activateAndPush({ versionId: 'ver-1', rpc, dispatch, onPushSettled });
    await flush();

    expect(result.activated).toBe(false);
    expect(result.error).toEqual({ message: 'not authorized', code: '42501' });
    expect(dispatch).not.toHaveBeenCalled();
    expect(onPushSettled).not.toHaveBeenCalled();
  });

  it('AC-BUD-032 the push is a CONSEQUENCE, strictly AFTER the activation commits — never called before it', async () => {
    const order: string[] = [];
    const rpc = vi.fn(async () => {
      order.push('rpc');
      return { error: null };
    });
    const dispatch = vi.fn(async () => {
      order.push('dispatch');
    });

    await activateAndPush({ versionId: 'ver-1', rpc, dispatch });
    await flush();

    expect(order).toEqual(['rpc', 'dispatch']);
  });

  it('AC-APU-001 a landed push reaches onPushSettled as pushed with the dispatch response', async () => {
    const rpc = vi.fn().mockResolvedValue({ error: null });
    const dispatch = vi.fn().mockResolvedValue({ years: [] });
    const onPushSettled = vi.fn();

    await activateAndPush({ versionId: 'ver-1', rpc, dispatch, onPushSettled });
    await flush();

    expect(onPushSettled).toHaveBeenCalledWith('pushed', { years: [] });
  });

  it('a synchronous dispatch throw or a throwing onPushSettled never escapes', async () => {
    const rpc = vi.fn().mockResolvedValue({ error: null });
    const onPushSettled = vi.fn(() => {
      throw new Error('refresh blew up');
    });
    const dispatch = vi.fn(() => {
      throw new Error('sync boom');
    });

    await expect(activateAndPush({ versionId: 'ver-1', rpc, dispatch, onPushSettled })).resolves.toMatchObject({
      activated: true,
    });
    await flush();
    expect(onPushSettled).toHaveBeenCalledWith('failed', undefined);
  });
});
