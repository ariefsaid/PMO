/**
 * AC-ENA-052/053 [Vitest unit] — erpnext/applyFeed.ts: the lineage-aware inbound apply path that
 * BOTH the webhook (8.2) and the modified-poll sweep (8.6) route every ERP change through. Proves:
 *   • a `docstatus:2` event → applyCancel (soft-tombstone + cancelled lineage row; external_refs retained);
 *   • an `amended_from` event → applyAmend (repoint external_refs to the new name, stamp erp_amended_from,
 *     amended lineage row — NO duplicate mirror; a native amend of an unmapped doc falls back to adopt);
 *   • a stale old-name event (superseded) → isSupersededName no-op (never clobbers the live amended row);
 *   • a normal event → applyInboundChange (the shared source-mod-guarded upsert/adopt).
 *
 * The apply path is the lineage module (slice 2.11) WIRED into the feed: it reuses applyCancel/
 * applyAmend/isSupersededName (pure) + applyEngine.applyInboundChange (the shared upsert/adopt). Pure
 * + mocked deps; Frappe vocabulary confined to erpnext/**.
 */
import { describe, it, expect, vi } from 'vitest';
import { applyErpFeedEvent } from './applyFeed.ts';

const CTX = { tier: 'erpnext', domain: 'procurement' };

function makeDeps(overrides: {
  mappedPmoId?: string | null;
  newMappedPmoId?: string | null; // the resolvePmoRecordId result for the NEW (amended) name
  superseded?: boolean;
  storedSourceModMs?: number | null;
} = {}) {
  return {
    // ApplyChangeDeps
    resolvePmoRecordId: vi.fn(async (externalRecordId: string) => {
      if (overrides.newMappedPmoId !== undefined && externalRecordId === 'ACC-PINV-2026-00003') return overrides.newMappedPmoId;
      return overrides.mappedPmoId ?? null;
    }),
    readMirrorSourceMod: vi.fn(async () => overrides.storedSourceModMs ?? null),
    updateMirror: vi.fn(async () => {}),
    mintMirror: vi.fn(async () => 'pmo-minted'),
    recordExternalRef: vi.fn(async () => {}),
    // LineageDeps
    tombstoneMirror: vi.fn(async () => {}),
    repointExternalRef: vi.fn(async () => {}),
    stampAmended: vi.fn(async () => {}),
    recordLineage: vi.fn(async () => {}),
    // SupersededNameLookupDeps
    findLineageBySupersededName: vi.fn(async (_domain: string, name: string) => overrides.superseded === true && name === 'ACC-PINV-2026-00002'),
  };
}

describe('erpnext/applyFeed — docstatus:2 → applyCancel (AC-ENA-052/053)', () => {
  it('soft-tombstones the mirror + writes a cancelled lineage row; external_refs retained', async () => {
    const d = makeDeps({ mappedPmoId: 'pmo-1' });
    const outcome = await applyErpFeedEvent(
      CTX,
      'ACC-PINV-2026-00002',
      { id: 'ACC-PINV-2026-00002', erp_docstatus: 2, erp_amended_from: null },
      Date.parse('2026-07-12 12:00:00.000000'),
      d,
    );
    expect(outcome.kind).toBe('tombstoned');
    expect(d.tombstoneMirror).toHaveBeenCalledWith('pmo-1', new Date(Date.parse('2026-07-12 12:00:00.000000')).toISOString());
    expect(d.repointExternalRef).not.toHaveBeenCalled();
    expect(d.recordLineage).toHaveBeenCalledWith(expect.objectContaining({ reason: 'cancelled', erpDocstatus: 2 }));
  });

  it('a cancel of an unmapped external id is a faithful no-op (nothing to cancel)', async () => {
    const d = makeDeps({ mappedPmoId: null });
    const outcome = await applyErpFeedEvent(
      CTX,
      'UNMAPPED-NAME',
      { id: 'UNMAPPED-NAME', erp_docstatus: 2, erp_amended_from: null },
      Date.parse('2026-07-12 12:00:00.000000'),
      d,
    );
    expect(outcome).toEqual({ kind: 'no-op' });
    expect(d.tombstoneMirror).not.toHaveBeenCalled();
  });
});

describe('erpnext/applyFeed — amended_from → applyAmend (AC-ENA-052/053)', () => {
  it('repoints external_refs to the new name, stamps erp_amended_from, amended lineage — no duplicate mirror', async () => {
    const d = makeDeps({ mappedPmoId: 'pmo-1', newMappedPmoId: null }); // old mapped, new unmapped
    const outcome = await applyErpFeedEvent(
      CTX,
      'ACC-PINV-2026-00003',
      { id: 'ACC-PINV-2026-00003', erp_docstatus: 0, erp_amended_from: 'ACC-PINV-2026-00002' },
      Date.parse('2026-07-12 12:05:00.000000'),
      d,
    );
    expect(outcome).toEqual({ kind: 'upserted', pmoRecordId: 'pmo-1', adopted: false });
    expect(d.repointExternalRef).toHaveBeenCalledWith('procurement', 'pmo-1', 'ACC-PINV-2026-00003');
    expect(d.stampAmended).toHaveBeenCalledWith('pmo-1', 'ACC-PINV-2026-00002', new Date(Date.parse('2026-07-12 12:05:00.000000')).toISOString());
    expect(d.recordLineage).toHaveBeenCalledWith(expect.objectContaining({ reason: 'amended', successorExternalRecordId: 'ACC-PINV-2026-00003' }));
    expect(d.mintMirror).not.toHaveBeenCalled(); // never a second mirror row
  });

  it('an amend whose NEW name is already mapped never repoints or re-records lineage (no double-processing)', async () => {
    const d = makeDeps({ mappedPmoId: 'pmo-1', newMappedPmoId: 'pmo-1' }); // new name already mapped to the same row
    await applyErpFeedEvent(
      CTX,
      'ACC-PINV-2026-00003',
      { id: 'ACC-PINV-2026-00003', erp_docstatus: 0, erp_amended_from: 'ACC-PINV-2026-00002' },
      Date.parse('2026-07-12 12:05:00.000000'),
      d,
    );
    expect(d.repointExternalRef).not.toHaveBeenCalled();
    expect(d.recordLineage).not.toHaveBeenCalled();
    expect(d.mintMirror).not.toHaveBeenCalled();
  });

  it('a native amend of an UNMAPPED old doc falls back to adopt (mint the new name fresh)', async () => {
    const d = makeDeps({ mappedPmoId: null, newMappedPmoId: null });
    const outcome = await applyErpFeedEvent(
      CTX,
      'ACC-PINV-2026-00003',
      { id: 'ACC-PINV-2026-00003', erp_docstatus: 0, erp_amended_from: 'ACC-PINV-2026-00002' },
      Date.parse('2026-07-12 12:05:00.000000'),
      d,
    );
    expect(outcome).toEqual({ kind: 'upserted', pmoRecordId: 'pmo-minted', adopted: true });
    expect(d.mintMirror).toHaveBeenCalledTimes(1);
    expect(d.repointExternalRef).not.toHaveBeenCalled();
  });
});

/**
 * Round-5 cross-family finding 6 (money) — a NATIVE desk amend (ERPNext cancels the predecessor and
 * mints a successor carrying `amended_from`) must leave the PMO money mirror on the SUCCESSOR's
 * figures. Repointing `external_refs` + stamping lineage alone left the row carrying the PREDECESSOR's
 * `amount` / `erp_outstanding_amount` / `status` forever, so a cancelled invoice kept counting toward
 * project revenue and open AR, and the successor's real amount never landed.
 */
describe('erpnext/applyFeed — a native amend converges the mirror on the SUCCESSOR money (round-5 finding 6)', () => {
  const REVENUE = { tier: 'erpnext', domain: 'revenue' };
  const OLD = 'ACC-SINV-2026-00007';
  const NEW = 'ACC-SINV-2026-00007-1';

  /** Deps with an explicit name→pmo-id map so both lineage names can be resolved independently. */
  function makeRevenueDeps(mapping: Record<string, string>, storedSourceModMs: number | null = null) {
    return {
      resolvePmoRecordId: vi.fn(async (name: string) => mapping[name] ?? null),
      readMirrorSourceMod: vi.fn(async () => storedSourceModMs),
      updateMirror: vi.fn(async () => {}),
      mintMirror: vi.fn(async () => 'pmo-minted'),
      recordExternalRef: vi.fn(async () => {}),
      tombstoneMirror: vi.fn(async () => {}),
      repointExternalRef: vi.fn(async () => {}),
      stampAmended: vi.fn(async () => {}),
      recordLineage: vi.fn(async () => {}),
      findLineageBySupersededName: vi.fn(async () => false),
    };
  }

  const successor = {
    id: NEW,
    erp_docstatus: 1,
    erp_amended_from: OLD,
    amount: '90000.00',
    erp_outstanding_amount: '90000.00',
  };
  const amendMs = Date.parse('2026-07-19 09:00:00.000000');

  it('refreshes the mirror money+status from the successor document on the repoint tick', async () => {
    const d = makeRevenueDeps({ [OLD]: 'pmo-si-1' });

    const outcome = await applyErpFeedEvent(REVENUE, NEW, successor, amendMs, d);

    expect(outcome).toEqual({ kind: 'upserted', pmoRecordId: 'pmo-si-1', adopted: false });
    expect(d.repointExternalRef).toHaveBeenCalledWith('revenue', 'pmo-si-1', NEW);
    // The money convergence: the SAME mirror row is refreshed from the successor's canonical, through
    // the shared `updateMirror` (which owns the canonical deriveSiStatus/putIfPresent discipline).
    expect(d.updateMirror).toHaveBeenCalledWith(
      'pmo-si-1',
      expect.objectContaining({ id: 'pmo-si-1', amount: '90000.00', erp_outstanding_amount: '90000.00', erp_docstatus: 1 }),
      amendMs,
    );
    expect(d.mintMirror).not.toHaveBeenCalled();
  });

  it('keeps applying later money changes to an already-repointed successor (amended_from is permanent on the doc)', async () => {
    // The successor carries `amended_from` for the rest of its life, so EVERY later sweep tick for it
    // re-enters the amend branch with the new name already mapped. That must not be a permanent no-op:
    // a part-payment (outstanding 90000 → 40000) has to land.
    const d = makeRevenueDeps({ [OLD]: 'pmo-si-1', [NEW]: 'pmo-si-1' }, amendMs);
    const laterMs = Date.parse('2026-07-19 11:00:00.000000');

    const outcome = await applyErpFeedEvent(
      REVENUE,
      NEW,
      { ...successor, erp_outstanding_amount: '40000.00' },
      laterMs,
      d,
    );

    expect(outcome).toEqual({ kind: 'upserted', pmoRecordId: 'pmo-si-1', adopted: false });
    expect(d.updateMirror).toHaveBeenCalledWith(
      'pmo-si-1',
      expect.objectContaining({ erp_outstanding_amount: '40000.00' }),
      laterMs,
    );
    // …and the lineage work is NOT repeated (the no-op guard's real purpose is preserved).
    expect(d.repointExternalRef).not.toHaveBeenCalled();
    expect(d.recordLineage).not.toHaveBeenCalled();
  });

  it('a STALE re-delivery for an already-repointed successor is still a no-op (no rewind of live money)', async () => {
    const d = makeRevenueDeps({ [OLD]: 'pmo-si-1', [NEW]: 'pmo-si-1' }, Date.parse('2026-07-19 11:00:00.000000'));

    const outcome = await applyErpFeedEvent(REVENUE, NEW, successor, amendMs, d);

    expect(outcome).toEqual({ kind: 'no-op' });
    expect(d.updateMirror).not.toHaveBeenCalled();
    expect(d.repointExternalRef).not.toHaveBeenCalled();
  });
});

describe('erpnext/applyFeed — superseded stale old-name → no-op (AC-ENA-053)', () => {
  it('a stale event for a name recorded as a lineage supersession is a no-op (never clobbers the live amended row)', async () => {
    const d = makeDeps({ mappedPmoId: 'pmo-1', superseded: true });
    const outcome = await applyErpFeedEvent(
      CTX,
      'ACC-PINV-2026-00002',
      { id: 'ACC-PINV-2026-00002', erp_docstatus: 1, erp_amended_from: null },
      Date.parse('2026-07-12 13:00:00.000000'),
      d,
    );
    expect(outcome).toEqual({ kind: 'no-op' });
    expect(d.tombstoneMirror).not.toHaveBeenCalled();
    expect(d.updateMirror).not.toHaveBeenCalled();
    expect(d.mintMirror).not.toHaveBeenCalled();
  });
});

describe('erpnext/applyFeed — normal event → applyInboundChange (the shared upsert/adopt)', () => {
  it('an unmapped normal event adopts (mint mirror + record external_refs)', async () => {
    const d = makeDeps({ mappedPmoId: null });
    const outcome = await applyErpFeedEvent(
      CTX,
      'MAT-REQ-0001',
      { id: 'MAT-REQ-0001', erp_docstatus: 1, erp_amended_from: null },
      Date.parse('2026-07-12 12:00:00.000000'),
      d,
    );
    expect(outcome).toEqual({ kind: 'upserted', pmoRecordId: 'pmo-minted', adopted: true });
    expect(d.mintMirror).toHaveBeenCalledTimes(1);
    expect(d.recordExternalRef).toHaveBeenCalledWith(expect.objectContaining({ externalRecordId: 'MAT-REQ-0001', domain: 'procurement' }));
  });

  it('a mapped normal event upserts the mirror', async () => {
    const d = makeDeps({ mappedPmoId: 'pmo-1', storedSourceModMs: null });
    const outcome = await applyErpFeedEvent(
      CTX,
      'MAT-REQ-0001',
      { id: 'MAT-REQ-0001', erp_docstatus: 1, erp_amended_from: null },
      Date.parse('2026-07-12 12:00:00.000000'),
      d,
    );
    expect(outcome).toEqual({ kind: 'upserted', pmoRecordId: 'pmo-1', adopted: false });
    expect(d.updateMirror).toHaveBeenCalledTimes(1);
  });
});
