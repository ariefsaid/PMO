import { describe, it, expect, vi } from 'vitest';
import {
  routeRead,
  routeWrite,
  executeWrite,
  executeWriteWithPendingPush,
  EMPTY_OWNERSHIP_MAP,
  type OwnershipMap,
} from './router';
import { IDLE_PENDING_PUSH } from './pendingPush';

describe('AC-EAS-001 empty ownership map ⇒ write takes the direct-DAL path (byte-for-byte)', () => {
  it('AC-EAS-001 routeWrite returns pmo for an empty map (short-circuit FIRST)', () => {
    expect(routeWrite('reference', EMPTY_OWNERSHIP_MAP)).toBe('pmo');
    expect(routeWrite('anything', {} as OwnershipMap)).toBe('pmo');
  });
  it('AC-EAS-001 executeWrite with an empty map calls directWrite and NOT dispatchWrite', async () => {
    const directWrite = vi.fn(async (p: string) => `direct:${p}`);
    const dispatchWrite = vi.fn(async (p: string) => `dispatch:${p}`);
    const res = await executeWrite({
      domain: 'reference', ownershipMap: EMPTY_OWNERSHIP_MAP, payload: 'x',
      directWrite, dispatchWrite,
    });
    expect(res).toBe('direct:x');
    expect(directWrite).toHaveBeenCalledTimes(1);
    expect(dispatchWrite).not.toHaveBeenCalled();
  });
});

describe('AC-EAS-002 empty map ⇒ reads from the DAL and no pending-push state', () => {
  it('AC-EAS-002 routeRead always returns dal', () => {
    expect(routeRead('reference')).toBe('dal');
  });
  it('AC-EAS-002 a PMO-owned write through executeWriteWithPendingPush yields no pushing/pushed/push-failed state', async () => {
    const directWrite = vi.fn(async () => 'ok');
    const composed = await executeWriteWithPendingPush({
      domain: 'reference', ownershipMap: EMPTY_OWNERSHIP_MAP, payload: 'x',
      directWrite, dispatchWrite: vi.fn(),
    });
    expect(composed.result).toBe('ok');
    expect(composed.pendingPush).toEqual(IDLE_PENDING_PUSH);
    expect(directWrite).toHaveBeenCalledTimes(1);
  });
});

describe('AC-EAS-014 the ownership-decision routes by own-org ownership only', () => {
  const orgAMap: OwnershipMap = { reference: 'reference' };
  it('AC-EAS-014 an assigned domain routes to dispatch', () => {
    expect(routeWrite('reference', orgAMap)).toBe('external');
  });
  it('AC-EAS-014 an unassigned domain routes to the direct DAL', () => {
    expect(routeWrite('tasks', orgAMap)).toBe('pmo');
  });
  it('AC-EAS-014 org B rows never affect org A branch (router only sees the passed map)', () => {
    expect(routeWrite('reference', orgAMap)).toBe('external');
    expect(routeWrite('accounting', orgAMap)).toBe('pmo');
  });
});

describe('AC-EAS-030 reads ALWAYS serve from Supabase (the read-model), regardless of ownership', () => {
  it('AC-EAS-030 routeRead is dal even for an externally-owned domain', () => {
    expect(routeRead('reference')).toBe('dal');
  });
});

describe('AC-EAS-031 an externally-owned write routes through the dispatch (not the direct DAL)', () => {
  it('AC-EAS-031 executeWrite calls dispatchWrite and NOT directWrite when externally-owned', async () => {
    const directWrite = vi.fn(async () => 'direct');
    const dispatchWrite = vi.fn(async () => 'dispatch');
    const res = await executeWrite({
      domain: 'reference', ownershipMap: { reference: 'reference' }, payload: 'x',
      directWrite, dispatchWrite,
    });
    expect(res).toBe('dispatch');
    expect(dispatchWrite).toHaveBeenCalledTimes(1);
    expect(directWrite).not.toHaveBeenCalled();
  });
});

describe('AC-EAS-032 a PMO-owned write routes through the direct DAL (not the dispatch)', () => {
  it('AC-EAS-032 a non-empty map without the domain ⇒ directWrite called, dispatchWrite not', async () => {
    const directWrite = vi.fn(async () => 'direct');
    const dispatchWrite = vi.fn(async () => 'dispatch');
    const res = await executeWrite({
      domain: 'tasks', ownershipMap: { reference: 'reference' }, payload: 'x',
      directWrite, dispatchWrite,
    });
    expect(res).toBe('direct');
    expect(directWrite).toHaveBeenCalledTimes(1);
    expect(dispatchWrite).not.toHaveBeenCalled();
  });
});
