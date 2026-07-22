import { describe, it, expect, vi } from 'vitest';
import { activateAndPush } from './budgetPushConsequence';

// ⚑ THE BINDING MONEY INVARIANT (slice 4, ADR-0059 §3.1/§3.2): activating a budget version MUST NEVER fail
// because ERPNext failed. PMO is the source of truth; the push is a CONSEQUENCE of activation — after the
// transition commits, outside its transaction — never its precondition.

describe('activateAndPush', () => {
  it('AC-BUD-032 ⚑ the ACTIVATION succeeds even when ERP is unreachable; the failure is durable + visible', async () => {
    const rpc = vi.fn().mockResolvedValue({ error: null });
    const dispatch = vi.fn().mockRejectedValue(new Error('external-unreachable'));

    const result = await activateAndPush({ versionId: 'ver-1', rpc, dispatch });

    expect(result.activated).toBe(true); // the user's action ALWAYS succeeds
    expect(result.error).toBeUndefined(); // the push failure is NOT surfaced as an activation failure
    expect(rpc).toHaveBeenCalledOnce();
    expect(rpc).toHaveBeenCalledWith('activate_budget_version', { version_id: 'ver-1' });
    expect(result.pushState).toBe('failed'); // durable state, not a lost error
  });

  it('AC-BUD-032 a push rejection never rolls back or retry-loops the activation', async () => {
    const rpc = vi.fn().mockResolvedValue({ error: null });
    const dispatch = vi.fn().mockRejectedValue(new Error('budget-category-unmapped'));

    const result = await activateAndPush({ versionId: 'ver-1', rpc, dispatch });

    expect(result.activated).toBe(true);
    expect(rpc).toHaveBeenCalledOnce(); // never re-called — no retry loop on the PMO transition
    expect(dispatch).toHaveBeenCalledOnce(); // and no client-side retry storm
  });

  it('AC-BUD-032 a REAL activation failure (the RPC itself) is surfaced and the push is never attempted', async () => {
    const rpc = vi.fn().mockResolvedValue({ error: { message: 'not authorized', code: '42501' } });
    const dispatch = vi.fn();

    const result = await activateAndPush({ versionId: 'ver-1', rpc, dispatch });

    expect(result.activated).toBe(false);
    expect(result.error).toEqual({ message: 'not authorized', code: '42501' });
    expect(dispatch).not.toHaveBeenCalled();
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

    expect(order).toEqual(['rpc', 'dispatch']);
  });

  it('AC-BUD-032 a successful push is reported as pushed', async () => {
    const rpc = vi.fn().mockResolvedValue({ error: null });
    const dispatch = vi.fn().mockResolvedValue(undefined);

    const result = await activateAndPush({ versionId: 'ver-1', rpc, dispatch });

    expect(result.activated).toBe(true);
    expect(result.pushState).toBe('pushed');
  });
});
