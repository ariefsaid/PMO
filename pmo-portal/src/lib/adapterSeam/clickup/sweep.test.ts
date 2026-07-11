/**
 * AC-CUA-043/044 — the reconciliation sweep (FR-CUA-045/046/047). The safety net that catches webhook
 * gaps: per employing org, read the `(tasks, clickup)` watermark → enumerate changes since it → apply
 * each through the SAME source-mod-guarded path as the webhook (FR-CUA-049 "any apply") → advance the
 * watermark to `nextCursor` (monotonic, never rewinds).
 *
 *   - AC-CUA-043 applies changes since the watermark, advances to nextCursor; overlap with a prior
 *     webhook apply is harmless (the per-row source-mod guard makes the re-apply idempotent).
 *   - AC-CUA-044 ClickUp-unreachable ⇒ the sweep throws WITHOUT advancing the watermark and WITHOUT
 *     touching the read-model; a concurrent PMO-owned write is unaffected.
 */
import { describe, it, expect, vi } from 'vitest';
import { runSweep, type SweepDeps, type SweepChange } from './sweep.ts';
import type { ClickUpStatusMap } from './statusMap.ts';
import type { ClickUpMemberMap } from './memberMap.ts';

const statusMap: ClickUpStatusMap = {
  pmoToClickUp: { 'To Do': 'to do', Done: 'complete' },
  clickUpToPmo: { 'to do': 'To Do', complete: 'Done' },
  defaultPmoStatus: 'To Do',
};
const memberMap: ClickUpMemberMap = { pmoToClickUp: { 'pmo-a': 101 }, clickUpToPmo: { 101: 'pmo-a' } };

/** A raw sweep change: a canonical PMO record + its source-modification timestamp (epoch-ms). */
function change(id: string, sourceModMs: number, name = `Task ${id}`): SweepChange {
  return {
    record: { id, name, status: 'To Do', assignee_id: null, start_date: null, end_date: null },
    sourceModMs,
  };
}

function makeDeps(config: {
  listChanges: SweepDeps['listChanges'];
  mappedPmoId?: string | null;
  storedSourceModMs?: number | null;
  watermark?: string | null;
}) {
  const updates: Array<{ pmoRecordId: string; sourceModMs: number }> = [];
  const mints: Array<{ pmoRecordId: string; sourceModMs: number }> = [];
  const advancedTo: string[] = [];
  const deps: SweepDeps = {
    statusMap,
    memberMap,
    readWatermark: vi.fn(async () => config.watermark ?? null),
    advanceWatermark: vi.fn(async (cursor) => {
      advancedTo.push(cursor);
    }),
    listChanges: config.listChanges,
    resolvePmoRecordId: vi.fn(async () => config.mappedPmoId ?? null),
    readMirrorSourceMod: vi.fn(async () => config.storedSourceModMs ?? null),
    updateMirror: vi.fn(async (pmoRecordId, _canonical, sourceModMs) => {
      updates.push({ pmoRecordId, sourceModMs });
    }),
    mintMirror: vi.fn(async (_canonical, sourceModMs) => {
      const id = `pmo-minted-${mints.length + 1}`;
      mints.push({ pmoRecordId: id, sourceModMs });
      return id;
    }),
    recordExternalRef: vi.fn(async () => {}),
  };
  return { deps, updates, mints, advancedTo };
}

describe('AC-CUA-043 the sweep applies changes since the watermark and advances it monotonically', () => {
  it('applies each change (upsert/adopt) and advances the watermark to nextCursor', async () => {
    const listChanges = vi.fn(async () => ({
      changes: [change('cu-1', 1500), change('cu-2', 1800)],
      nextCursor: '1800',
    }));
    const { deps, updates, advancedTo } = makeDeps({
      listChanges,
      mappedPmoId: 'pmo-1',
      storedSourceModMs: null,
      watermark: '1000',
    });

    const result = await runSweep(deps);

    expect(result.applied).toBe(2);
    expect(updates.map((u) => u.pmoRecordId)).toEqual(['pmo-1', 'pmo-1']);
    expect(updates.map((u) => u.sourceModMs)).toEqual([1500, 1800]);
    // Advanced to nextCursor, monotonically (>= the 1000 watermark).
    expect(advancedTo).toEqual(['1800']);
    expect(listChanges).toHaveBeenCalledWith('1000');
  });

  it('overlap with a prior webhook apply is harmless — a stale change is a per-row no-op (idempotent)', async () => {
    // The webhook already applied cu-1 at source-mod 2000; the sweep's inclusive boundary re-fetches
    // it at 1500 < 2000 — the per-row guard rejects it (no double-apply), but the watermark still
    // advances to nextCursor.
    const listChanges = vi.fn(async () => ({
      changes: [change('cu-1', 1500)], // older than the stored 2000
      nextCursor: '2000',
    }));
    const { deps, updates, advancedTo } = makeDeps({
      listChanges,
      mappedPmoId: 'pmo-1',
      storedSourceModMs: 2000,
      watermark: '2000',
    });

    const result = await runSweep(deps);

    expect(result.applied).toBe(0); // the stale change was a no-op
    expect(updates).toHaveLength(0);
    expect(advancedTo).toEqual(['2000']); // watermark still advances (monotonic, no rewind)
  });

  it('a null nextCursor at exhaustion advances the watermark only if it is ahead (no rewind)', async () => {
    const listChanges = vi.fn(async () => ({ changes: [], nextCursor: null }));
    const { deps, advancedTo } = makeDeps({ listChanges, watermark: '5000' });
    const result = await runSweep(deps);
    expect(result.applied).toBe(0);
    // nextCursor null + no change applied ⇒ do not rewind a lower watermark; leave it as-is.
    expect(advancedTo).toEqual([]);
  });
});

describe('AC-CUA-044 ClickUp-unreachable sweep does NOT advance the watermark and leaves the read-model untouched', () => {
  it('throws without advancing the watermark or applying anything', async () => {
    const listChanges = vi.fn(async () => {
      throw new Error('ClickUp request failed');
    });
    const { deps, updates, advancedTo } = makeDeps({ listChanges, watermark: '1000' });

    await expect(runSweep(deps)).rejects.toThrow('ClickUp request failed');

    expect(updates).toHaveLength(0);
    expect(advancedTo).toEqual([]); // watermark NOT advanced
    expect(deps.advanceWatermark).not.toHaveBeenCalled();
  });
});
