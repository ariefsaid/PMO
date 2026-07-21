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
    expect(result).toEqual({ applied: 2, nextCursor: '200', skipped: [] });
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
    expect(result).toEqual({ applied: 0, nextCursor: null, skipped: [] });
    expect(deps.advanced).toHaveLength(0);
  });

  // ── HIGH-A (Luna re-audit round 2, 2026-07-21): ONE document whose apply throws a TERMINAL,
  //    expected outcome (an ERP doc PMO must never adopt — FR-BUD-140/FR-TSP-082) wedged the whole
  //    poll: the throw escaped the loop before `advanceWatermarkMonotonic`, so the watermark never
  //    moved and EVERY later change queued behind it — including a Desk CANCEL of a genuinely
  //    PMO-pushed Budget — was never applied, on this tick or any future one.
  it('HIGH-A a terminal per-change apply failure is ACKED and SKIPPED — later changes still apply and the watermark advances', async () => {
    const applied: string[] = [];
    const deps = makeSweepDeps(
      [
        { record: { id: 'BUDGET-DESK-001' }, sourceModMs: 100 },
        { record: { id: 'BUDGET-PMO-002' }, sourceModMs: 200 },
      ],
      '200',
    );
    deps.applyChange = async (_c, externalRecordId) => {
      if (externalRecordId === 'BUDGET-DESK-001') {
        throw Object.assign(new Error('native-budget-not-adopted'), { code: 'commit-rejected' });
      }
      applied.push(externalRecordId);
      return { kind: 'upserted', pmoRecordId: 'pmo-1', adopted: false };
    };
    deps.applyErrorPolicy = () => 'skip';

    const result = await runSweep(ctx, deps);

    expect(applied).toEqual(['BUDGET-PMO-002']); // ⚑ the change BEHIND the never-adopt doc still applies
    expect(result.applied).toBe(1);
    expect(result.skipped).toEqual([
      { externalRecordId: 'BUDGET-DESK-001', error: 'native-budget-not-adopted' },
    ]);
    expect(deps.advanced).toEqual(['200']); // ⚑ the poll is NOT wedged — the watermark moves past it
  });

  // ⚑ FOUND WHILE FIXING HIGH-A (not in the audit): the sweep coerced `nextCursor` with `Number()`
  //   before advancing. ClickUp's cursor IS epoch-ms, but ERPNext's is the ERP `modified` DATETIME
  //   string ('2026-07-20 10:00:00' — `sweepCursor.ts` returns the max observed `modified`, and the
  //   next tick sends it straight back as `["modified",">=",cursor]`). `Number()` of that is NaN, so
  //   every ERPNext doctype persisted the literal string 'NaN' as its watermark and the next tick's
  //   filter was `modified >= 'NaN'` — the per-doctype cursor never worked at all.
  it('the watermark advances with the cursor AS GIVEN when it is not epoch-ms (an ERP `modified` datetime), never NaN', async () => {
    const deps = makeSweepDeps([{ record: { id: 'BUDGET-001' }, sourceModMs: 1 }], '2026-07-20 10:00:00');
    await runSweep(ctx, deps);
    expect(deps.advanced).toEqual(['2026-07-20 10:00:00']);
  });

  it('a non-numeric cursor still never REWINDS (a lower datetime string leaves the stored one alone)', async () => {
    const deps = makeSweepDeps([{ record: { id: 'BUDGET-001' }, sourceModMs: 1 }], '2026-07-19 08:00:00');
    deps.readWatermark = async () => '2026-07-20 10:00:00';
    await runSweep(ctx, deps);
    expect(deps.advanced).toEqual(['2026-07-20 10:00:00']);
  });

  it('HIGH-A an UNCLASSIFIED per-change failure still halts the run without advancing (a transient DB error must retry, never be skipped past)', async () => {
    const deps = makeSweepDeps([{ record: { id: 'MAT-REQ-001' }, sourceModMs: 100 }], '100');
    deps.applyChange = async () => {
      throw new Error('connection terminated unexpectedly');
    };
    await expect(runSweep(ctx, deps)).rejects.toThrow('connection terminated unexpectedly');
    expect(deps.advanced).toHaveLength(0);
  });
});

// ────────────────────────────────────────────────────────────────────────────────────────────────
// Luna BLOCK 7 — concurrent webhook/sweep adoption must NOT leave an orphan mirror row.
// The pre-fix engine minted the mirror FIRST and recorded `external_refs` second; the unique
// (org_id, domain, external_record_id) constraint (0093) makes ONE writer lose the ref race — but the
// loser had ALREADY inserted its randomly-keyed mirror row, so a duplicate, permanently-unmapped
// revenue row stayed visible forever. The fix: an OPTIONAL `adoptAtomically` strategy that CLAIMS the
// ref for a caller-generated PMO id BEFORE the mirror is minted, so a losing racer writes no mirror at
// all — plus a repair path for the (crash-between) ref-claimed-but-mirror-missing window.
// ────────────────────────────────────────────────────────────────────────────────────────────────
describe('applyEngine.applyInboundChange — atomic adopt (Luna BLOCK 7)', () => {
  function makeAtomicDeps(config: {
    mappedPmoId?: string | null;
    storedSourceModMs?: number | null;
    mirrorExists?: boolean;
    refClaimError?: Error;
  }) {
    const minted: { canonical: PmoRecord; sourceUpdatedAtMs: number; pmoRecordId: string }[] = [];
    const refs: { pmoRecordId: string; externalRecordId: string }[] = [];
    const legacyMints: PmoRecord[] = [];
    const deps: ApplyChangeDeps & { minted: typeof minted; refs: typeof refs; legacyMints: typeof legacyMints } = {
      minted,
      refs,
      legacyMints,
      resolvePmoRecordId: async () => config.mappedPmoId ?? null,
      readMirrorSourceMod: async () => config.storedSourceModMs ?? null,
      updateMirror: async () => {},
      mintMirror: async (canonical) => {
        legacyMints.push(canonical);
        return 'pmo-legacy-mint';
      },
      recordExternalRef: async () => {},
      adoptAtomically: {
        newPmoRecordId: () => 'pmo-new-1',
        mintWithId: async (canonical, sourceUpdatedAtMs, pmoRecordId) => {
          minted.push({ canonical, sourceUpdatedAtMs, pmoRecordId });
        },
        claimExternalRef: async (mapping) => {
          if (config.refClaimError) throw config.refClaimError;
          refs.push({ pmoRecordId: mapping.pmoRecordId, externalRecordId: mapping.externalRecordId });
        },
        mirrorExists: async () => config.mirrorExists ?? true,
      },
    };
    return deps;
  }

  it('claims external_refs BEFORE minting the mirror (the ref is the adoption lock, not an afterthought)', async () => {
    const order: string[] = [];
    const deps = makeAtomicDeps({ mappedPmoId: null });
    const claim = deps.adoptAtomically!.claimExternalRef;
    const mint = deps.adoptAtomically!.mintWithId;
    deps.adoptAtomically!.claimExternalRef = async (m) => { order.push('ref'); await claim(m); };
    deps.adoptAtomically!.mintWithId = async (c, ms, id) => { order.push('mint'); await mint(c, ms, id); };

    const outcome = await applyInboundChange(ctx, 'SINV-001', { id: 'ignored', amount: '125000.00' }, 1000, deps);

    expect(order).toEqual(['ref', 'mint']);
    expect(outcome).toEqual({ kind: 'upserted', pmoRecordId: 'pmo-new-1', adopted: true });
    expect(deps.minted).toEqual([{ canonical: { id: 'pmo-new-1', amount: '125000.00' }, sourceUpdatedAtMs: 1000, pmoRecordId: 'pmo-new-1' }]);
    expect(deps.legacyMints).toHaveLength(0);
  });

  it('a LOSING concurrent adopt (23505 on the ref claim) mints NO mirror row — no orphan duplicate revenue row', async () => {
    const conflict = Object.assign(new Error('duplicate key value violates unique constraint'), { code: '23505' });
    const deps = makeAtomicDeps({ mappedPmoId: null, refClaimError: conflict });

    await expect(applyInboundChange(ctx, 'SINV-001', { id: 'ignored', amount: '125000.00' }, 1000, deps))
      .rejects.toMatchObject({ code: '23505' });

    expect(deps.minted).toHaveLength(0);
    expect(deps.legacyMints).toHaveLength(0);
  });

  it('a ref claimed whose mirror is MISSING (crash between claim and mint) is repaired on the next tick with the SAME pmo id', async () => {
    const deps = makeAtomicDeps({ mappedPmoId: 'pmo-claimed-1', mirrorExists: false });

    const outcome = await applyInboundChange(ctx, 'SINV-001', { id: 'ignored', amount: '125000.00' }, 1000, deps);

    expect(outcome).toEqual({ kind: 'upserted', pmoRecordId: 'pmo-claimed-1', adopted: true });
    expect(deps.minted).toEqual([
      { canonical: { id: 'pmo-claimed-1', amount: '125000.00' }, sourceUpdatedAtMs: 1000, pmoRecordId: 'pmo-claimed-1' },
    ]);
    expect(deps.refs).toHaveLength(0); // the ref is already claimed — never re-claimed
  });

  it('without the strategy (ClickUp/P0/P1) the legacy mint-then-ref path is byte-for-byte unchanged', async () => {
    const deps = makeApplyDeps({ mappedPmoId: null });
    const outcome = await applyInboundChange(ctx, 'MAT-REQ-009', { id: 'ignored' }, 1000, deps);
    expect(outcome).toEqual({ kind: 'upserted', pmoRecordId: 'pmo-minted-1', adopted: true });
    expect(deps.mints).toHaveLength(1);
    expect(deps.refs).toHaveLength(1);
  });
});
