/**
 * Task 1.12 — hoist `applyInboundChange` / `advanceWatermarkMonotonic` / `runSweep` out of
 * `clickup/{webhookApply,sweep}.ts` into a tier/domain-parameterized shared engine, so slice 8's
 * ERPNext modified-poll sweep reuses the SAME source-mod-guarded apply path (FR-CUA-049 "any apply")
 * instead of re-implementing it. This file exercises the generic engine directly (tier-neutral test
 * data, not ClickUp-shaped) — the P1 byte-for-byte proof stays in `clickup/{webhookApply,sweep}.test.ts`
 * (unchanged; those files still pass after 1.12 re-points their modules to thin wrappers over this one).
 */
import { describe, it, expect, vi } from 'vitest';
import {
  applyInboundChange,
  advanceWatermarkMonotonic,
  runSweep,
  type ApplyChangeDeps,
  type WatermarkDeps,
  type SweepDeps,
} from './applyEngine.ts';
import type { PmoRecord } from './contract.ts';

const ctx = { tier: 'erpnext', domain: 'procurement' };

function makeApplyDeps(config: { mappedPmoId?: string | null; storedSourceModMs?: number | null } = {}): ApplyChangeDeps & {
  updates: { pmoRecordId: string; canonical: PmoRecord; sourceUpdatedAtMs: number }[];
  mints: { canonical: PmoRecord; sourceUpdatedAtMs: number }[];
  refs: { pmoRecordId: string; externalTier: string; externalRecordId: string; domain: string }[];
} {
  const updates: { pmoRecordId: string; canonical: PmoRecord; sourceUpdatedAtMs: number }[] = [];
  const mints: { canonical: PmoRecord; sourceUpdatedAtMs: number }[] = [];
  const refs: { pmoRecordId: string; externalTier: string; externalRecordId: string; domain: string }[] = [];
  return {
    updates,
    mints,
    refs,
    resolvePmoRecordId: async () => config.mappedPmoId ?? null,
    readMirrorSourceMod: async () => config.storedSourceModMs ?? null,
    updateMirror: async (pmoRecordId, canonical, sourceUpdatedAtMs) => {
      updates.push({ pmoRecordId, canonical, sourceUpdatedAtMs });
    },
    mintMirror: async (canonical, sourceUpdatedAtMs) => {
      mints.push({ canonical, sourceUpdatedAtMs });
      return 'pmo-minted-1';
    },
    recordExternalRef: async (mapping) => {
      refs.push(mapping);
    },
  };
}

describe('applyEngine.applyInboundChange — the tier/domain-parameterized apply path', () => {
  it('an unmapped external record adopts: mints a mirror + records external_refs with the CALLER\'s (tier,domain)', async () => {
    const deps = makeApplyDeps({ mappedPmoId: null });
    const outcome = await applyInboundChange(ctx, 'MAT-REQ-001', { id: 'ignored', name: 'x' }, 1000, deps);
    expect(outcome).toEqual({ kind: 'upserted', pmoRecordId: 'pmo-minted-1', adopted: true });
    expect(deps.mints).toHaveLength(1);
    expect(deps.refs).toEqual([
      { pmoRecordId: 'pmo-minted-1', externalTier: 'erpnext', externalRecordId: 'MAT-REQ-001', domain: 'procurement' },
    ]);
  });

  it('a mapped external record with no stored source-mod updates the mirror (upsert, not adopted)', async () => {
    const deps = makeApplyDeps({ mappedPmoId: 'pmo-1', storedSourceModMs: null });
    const outcome = await applyInboundChange(ctx, 'MAT-REQ-001', { id: 'ignored', name: 'renamed' }, 1000, deps);
    expect(outcome).toEqual({ kind: 'upserted', pmoRecordId: 'pmo-1', adopted: false });
    expect(deps.updates).toEqual([{ pmoRecordId: 'pmo-1', canonical: { id: 'pmo-1', name: 'renamed' }, sourceUpdatedAtMs: 1000 }]);
  });

  it('a strictly-older change (sourceUpdatedAtMs < stored) is a per-row no-op, independent of tier/domain', async () => {
    const deps = makeApplyDeps({ mappedPmoId: 'pmo-1', storedSourceModMs: 5000 });
    const outcome = await applyInboundChange(ctx, 'MAT-REQ-001', { id: 'ignored' }, 1000, deps);
    expect(outcome).toEqual({ kind: 'no-op' });
    expect(deps.updates).toHaveLength(0);
  });

  it('an equal (>=) source-mod applies (idempotent re-delivery)', async () => {
    const deps = makeApplyDeps({ mappedPmoId: 'pmo-1', storedSourceModMs: 1000 });
    const outcome = await applyInboundChange(ctx, 'MAT-REQ-001', { id: 'ignored' }, 1000, deps);
    expect(outcome.kind).toBe('upserted');
  });
});

describe('applyEngine.advanceWatermarkMonotonic — never rewinds, independent of tier/domain', () => {
  function makeWatermarkDeps(current: string | null): WatermarkDeps & { advanced: string[] } {
    const advanced: string[] = [];
    return { advanced, readWatermark: async () => current, advanceWatermark: async (c) => { advanced.push(c); } };
  }

  it('advances to the candidate when it is fresh (no prior cursor)', async () => {
    const deps = makeWatermarkDeps(null);
    await advanceWatermarkMonotonic(deps, 500);
    expect(deps.advanced).toEqual(['500']);
  });

  it('advances forward when the candidate is newer than the current cursor', async () => {
    const deps = makeWatermarkDeps('100');
    await advanceWatermarkMonotonic(deps, 500);
    expect(deps.advanced).toEqual(['500']);
  });

  it('never rewinds when the candidate is older than the current cursor', async () => {
    const deps = makeWatermarkDeps('900');
    await advanceWatermarkMonotonic(deps, 500);
    expect(deps.advanced).toEqual(['900']);
  });
});

describe('applyEngine.runSweep — ctx-parameterized reconciliation sweep (reused by ERPNext, slice 8)', () => {
  function makeSweepDeps(changes: { record: PmoRecord; sourceModMs: number }[], nextCursor: string | null): SweepDeps & { advanced: string[] } {
    const advanced: string[] = [];
    return {
      advanced,
      resolvePmoRecordId: async () => null,
      readMirrorSourceMod: async () => null,
      updateMirror: async () => {},
      mintMirror: async () => 'pmo-x',
      recordExternalRef: async () => {},
      readWatermark: async () => null,
      advanceWatermark: async (c) => { advanced.push(c); },
      listChanges: vi.fn(async () => ({ changes, nextCursor })),
    };
  }

  it('applies each change through the SAME ctx-scoped apply path and advances the watermark to nextCursor', async () => {
    const deps = makeSweepDeps(
      [
        { record: { id: 'MAT-REQ-001' }, sourceModMs: 100 },
        { record: { id: 'MAT-REQ-002' }, sourceModMs: 200 },
      ],
      '200',
    );
    const result = await runSweep(ctx, deps);
    expect(result).toEqual({ applied: 2, nextCursor: '200' });
    expect(deps.advanced).toEqual(['200']);
    expect(deps.listChanges).toHaveBeenCalledWith(null);
  });

  it('an unreachable adapter (listChanges throws) propagates WITHOUT advancing the watermark', async () => {
    const deps = makeSweepDeps([], null);
    deps.listChanges = vi.fn(async () => { throw new Error('erpnext unreachable'); });
    await expect(runSweep(ctx, deps)).rejects.toThrow('erpnext unreachable');
    expect(deps.advanced).toHaveLength(0);
  });

  it('a null nextCursor (exhaustion) leaves the watermark untouched', async () => {
    const deps = makeSweepDeps([], null);
    const result = await runSweep(ctx, deps);
    expect(result).toEqual({ applied: 0, nextCursor: null });
    expect(deps.advanced).toHaveLength(0);
  });
});
