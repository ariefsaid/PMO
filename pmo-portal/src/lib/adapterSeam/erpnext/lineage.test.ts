/**
 * AC-ENA-020/021/022 — erpnext/lineage.ts: cancel is a soft-tombstone (external_refs retained), amend
 * repoints external_refs to the new ERP `name` with NO duplicate mirror row, and a stale old-name
 * event arriving after an amend is a guarded no-op that never clobbers the live amended row.
 */
import { describe, expect, it, vi } from 'vitest';
import { applyAmend, applyCancel, guardStaleModified, isSupersededName } from './lineage.ts';

const CTX = { domain: 'procurement' };

function deps(overrides: Partial<Parameters<typeof applyCancel>[3]> = {}) {
  return {
    resolvePmoRecordId: vi.fn(async () => 'pmo-1'),
    tombstoneMirror: vi.fn(async () => {}),
    repointExternalRef: vi.fn(async () => {}),
    stampAmended: vi.fn(async () => {}),
    recordLineage: vi.fn(async () => {}),
    ...overrides,
  };
}

describe('erpnext/lineage — applyCancel (AC-ENA-020)', () => {
  it('soft-tombstones the mirror (erp_cancelled_at/erp_docstatus=2), retains external_refs, writes a cancelled lineage row', async () => {
    const d = deps();
    await applyCancel(CTX, 'ACC-PINV-2026-00002', '2026-07-11 12:00:00.000000', d);
    expect(d.tombstoneMirror).toHaveBeenCalledWith('pmo-1', '2026-07-11 12:00:00.000000');
    expect(d.repointExternalRef).not.toHaveBeenCalled(); // external_refs retained — never repointed on a plain cancel
    expect(d.recordLineage).toHaveBeenCalledWith({
      domain: 'procurement',
      pmoRecordId: 'pmo-1',
      supersededExternalRecordId: 'ACC-PINV-2026-00002',
      successorExternalRecordId: null,
      reason: 'cancelled',
      erpDocstatus: 2,
    });
  });

  it('is a no-op for an external id with no PMO mapping (never mapped, nothing to cancel)', async () => {
    const d = deps({ resolvePmoRecordId: vi.fn(async () => null) });
    await applyCancel(CTX, 'UNMAPPED-NAME', '2026-07-11 12:00:00.000000', d);
    expect(d.tombstoneMirror).not.toHaveBeenCalled();
    expect(d.recordLineage).not.toHaveBeenCalled();
  });
});

describe('erpnext/lineage — applyAmend (AC-ENA-021)', () => {
  it('repoints external_refs to the new name, stamps erp_amended_from, writes an amended lineage row — no duplicate mirror', async () => {
    const d = deps();
    await applyAmend(CTX, 'ACC-PINV-2026-00002', 'ACC-PINV-2026-00003', '2026-07-11 12:05:00.000000', d);
    expect(d.repointExternalRef).toHaveBeenCalledWith('procurement', 'pmo-1', 'ACC-PINV-2026-00003');
    expect(d.stampAmended).toHaveBeenCalledWith('pmo-1', 'ACC-PINV-2026-00002', '2026-07-11 12:05:00.000000');
    expect(d.recordLineage).toHaveBeenCalledWith({
      domain: 'procurement',
      pmoRecordId: 'pmo-1',
      supersededExternalRecordId: 'ACC-PINV-2026-00002',
      successorExternalRecordId: 'ACC-PINV-2026-00003',
      reason: 'amended',
      erpDocstatus: null,
    });
    // exactly one mint path (repoint + stamp on the SAME pmo_record_id) — never a second mirror row.
    expect(d.repointExternalRef).toHaveBeenCalledTimes(1);
  });

  it('throws when the superseded (old) name has no existing PMO mapping — amend implies a prior mapping', async () => {
    const d = deps({ resolvePmoRecordId: vi.fn(async () => null) });
    await expect(applyAmend(CTX, 'UNMAPPED-NAME', 'ACC-PINV-2026-00003', '2026-07-11 12:05:00.000000', d)).rejects.toThrow(/no PMO mapping/);
  });
});

describe('erpnext/lineage — the erp_modified >= guard + superseded-name lookup (AC-ENA-022)', () => {
  it('guardStaleModified: a strictly-older candidate is stale (never applied)', () => {
    expect(guardStaleModified('2026-07-11 12:05:00.000000', '2026-07-11 12:00:00.000000')).toBe(true);
  });

  it('guardStaleModified: an equal-or-newer candidate is NOT stale (re-delivery/inclusive boundary re-applies)', () => {
    expect(guardStaleModified('2026-07-11 12:05:00.000000', '2026-07-11 12:05:00.000000')).toBe(false);
    expect(guardStaleModified('2026-07-11 12:05:00.000000', '2026-07-11 12:06:00.000000')).toBe(false);
  });

  it('guardStaleModified: no stored value (unmapped/fresh) is never stale', () => {
    expect(guardStaleModified(null, '2026-07-11 12:00:00.000000')).toBe(false);
  });

  it('isSupersededName: true for a name recorded as a lineage supersession, false otherwise', async () => {
    const findLineageBySupersededName = vi.fn(async (domain: string, name: string) => domain === 'procurement' && name === 'ACC-PINV-2026-00002');
    await expect(isSupersededName('procurement', 'ACC-PINV-2026-00002', { findLineageBySupersededName })).resolves.toBe(true);
    await expect(isSupersededName('procurement', 'ACC-PINV-2026-00003', { findLineageBySupersededName })).resolves.toBe(false);
  });
});
