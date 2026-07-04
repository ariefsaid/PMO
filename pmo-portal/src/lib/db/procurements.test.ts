import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockSelect, mockFrom, mockRange } = vi.hoisted(() => {
  const mockSelect = vi.fn();
  const mockFrom = vi.fn();
  const mockRange = vi.fn();
  return { mockSelect, mockFrom, mockRange };
});

vi.mock('@/src/lib/supabase/client', () => ({ supabase: { from: mockFrom } }));

import {
  listProcurements,
  getProjectCommittedSpend,
  getProjectReservedSpend,
  COMMITTED_STATUSES,
  RESERVED_STATUSES,
} from './procurements';

function makeBuilder(resolved: { data: unknown; error: unknown }) {
  const builder = {
    select: mockSelect,
    range: mockRange,
    then: (resolve: (v: typeof resolved) => void, reject?: (e: unknown) => void) =>
      Promise.resolve(resolved).then(resolve, reject),
  };
  mockSelect.mockReturnValue(builder);
  mockRange.mockReturnValue(builder);
  mockFrom.mockReturnValue(builder);
  return builder;
}

beforeEach(() => { mockFrom.mockReset(); mockSelect.mockReset(); mockRange.mockReset(); });

describe('listProcurements', () => {
  it('selects procurements joining project/vendor/requester; returns rows (AC-509, FR-DAL-PROC-001)', async () => {
    const rows = [{
      id: '60000000-0000-0000-0000-000000000001', code: 'PROC-2026-004',
      title: 'Workstations & AV', status: 'Vendor Quoted', total_value: 150000,
      project_id: '40000000-0000-0000-0000-000000000001',
      requested_by_id: '00000000-0000-0000-0000-0000000000a2', vendor_id: null,
      created_at: '2026-02-05T00:00:00Z',
      project: { name: 'Innovate Corp HQ Fit-Out', code: 'PRJ-001' },
      vendor: null, requested_by: { full_name: 'Alice Manager' },
    }];
    makeBuilder({ data: rows, error: null });
    const result = await listProcurements();
    expect(mockFrom).toHaveBeenCalledWith('procurements');
    expect(mockSelect).toHaveBeenCalledWith(
      '*, project:projects(name,code), vendor:companies(name), requested_by:profiles!procurements_requested_by_id_fkey(full_name)',
    );
    expect(result[0].project?.name).toBe('Innovate Corp HQ Fit-Out');
    expect(result[0].requested_by?.full_name).toBe('Alice Manager');
    expect(result[0].vendor).toBeNull();
  });

  it('sends no org_id (RLS scopes it) (FR-DAL-PROC-001)', async () => {
    makeBuilder({ data: [], error: null });
    await listProcurements();
    expect(JSON.stringify(mockSelect.mock.calls)).not.toContain('org_id');
  });

  it('throws on PostgREST error (AC-509)', async () => {
    makeBuilder({ data: null, error: { message: 'boom' } });
    await expect(listProcurements()).rejects.toThrow('boom');
  });

  it('data-layer perf hardening #4: does NOT range-bound the query when called with no params (opt-in pagination)', async () => {
    makeBuilder({ data: [], error: null });
    await listProcurements();
    expect(mockRange).not.toHaveBeenCalled();
  });

  it('data-layer perf hardening #4: applies an explicit page/pageSize range', async () => {
    makeBuilder({ data: [], error: null });
    await listProcurements({ page: 2, pageSize: 10 });
    expect(mockRange).toHaveBeenCalledWith(20, 29);
  });
});

// ---------------------------------------------------------------------------
// AC-IXD-PROC-W5-2 — getProjectCommittedSpend (committed basis, OD-W5-4)
// ---------------------------------------------------------------------------
function makeChainedBuilder(resolved: { data: unknown; error: unknown }) {
  const mockEq = vi.fn();
  const mockIn = vi.fn();
  const builder = { select: mockSelect, eq: mockEq, in: mockIn };
  mockFrom.mockReturnValue(builder);
  mockSelect.mockReturnValue(builder);
  mockEq.mockReturnValue(builder);
  mockIn.mockResolvedValue(resolved);
  return { mockEq, mockIn };
}

describe('getProjectCommittedSpend', () => {
  it('sums total_value over Ordered..Paid PRs for the project (OD-W5-4 committed basis)', async () => {
    const { mockEq, mockIn } = makeChainedBuilder({
      data: [{ total_value: 120000 }, { total_value: 30000 }, { total_value: 50000 }],
      error: null,
    });
    const total = await getProjectCommittedSpend('proj-1');
    expect(mockFrom).toHaveBeenCalledWith('procurements');
    expect(mockSelect).toHaveBeenCalledWith('total_value');
    expect(mockEq).toHaveBeenCalledWith('project_id', 'proj-1');
    // The exact dashboard basis (0009): Ordered / Received / Vendor Invoiced / Paid.
    expect(mockIn).toHaveBeenCalledWith('status', ['Ordered', 'Received', 'Vendor Invoiced', 'Paid']);
    expect(total).toBe(200000);
  });

  it('returns 0 when there are no committed POs', async () => {
    makeChainedBuilder({ data: [], error: null });
    await expect(getProjectCommittedSpend('proj-1')).resolves.toBe(0);
  });

  it('sends no org_id (RLS scopes it)', async () => {
    makeChainedBuilder({ data: [], error: null });
    await getProjectCommittedSpend('proj-1');
    expect(JSON.stringify(mockSelect.mock.calls)).not.toContain('org_id');
  });

  it('throws on PostgREST error', async () => {
    makeChainedBuilder({ data: null, error: { message: 'kaboom' } });
    await expect(getProjectCommittedSpend('proj-1')).rejects.toThrow('kaboom');
  });
});

// ---------------------------------------------------------------------------
// AC-RB-001 — getProjectReservedSpend (reserved basis, ADR-0034)
// ---------------------------------------------------------------------------
describe('getProjectReservedSpend', () => {
  it('AC-RB-001: sums total_value over Approved/Vendor Quoted/Quote Selected for the project', async () => {
    const { mockEq, mockIn } = makeChainedBuilder({
      data: [{ total_value: 80000 }, { total_value: 40000 }, { total_value: 30000 }],
      error: null,
    });
    const total = await getProjectReservedSpend('proj-1');
    expect(mockFrom).toHaveBeenCalledWith('procurements');
    expect(mockSelect).toHaveBeenCalledWith('total_value');
    expect(mockEq).toHaveBeenCalledWith('project_id', 'proj-1');
    expect(mockIn).toHaveBeenCalledWith('status', ['Approved', 'Vendor Quoted', 'Quote Selected']);
    expect(total).toBe(150000);
  });

  it('AC-RB-001: returns 0 when there are no reserved procurements', async () => {
    makeChainedBuilder({ data: [], error: null });
    await expect(getProjectReservedSpend('proj-1')).resolves.toBe(0);
  });

  it('AC-RB-001: sends no org_id (RLS scopes it)', async () => {
    makeChainedBuilder({ data: [], error: null });
    await getProjectReservedSpend('proj-1');
    expect(JSON.stringify(mockSelect.mock.calls)).not.toContain('org_id');
  });

  it('AC-RB-001: throws on PostgREST error', async () => {
    makeChainedBuilder({ data: null, error: { message: 'kaboom' } });
    await expect(getProjectReservedSpend('proj-1')).rejects.toThrow('kaboom');
  });
});

// ---------------------------------------------------------------------------
// AC-RB-003 — Committed and Reserved status sets are disjoint (FR-RB-004)
// ---------------------------------------------------------------------------
describe('AC-RB-003: Committed and Reserved sets are disjoint', () => {
  it('AC-RB-003: shares no status between COMMITTED_STATUSES and RESERVED_STATUSES', () => {
    const overlap = COMMITTED_STATUSES.filter((s) => RESERVED_STATUSES.includes(s));
    expect(overlap).toEqual([]);
  });
  it('AC-RB-003: COMMITTED_STATUSES is exactly Ordered/Received/Vendor Invoiced/Paid (unchanged)', () => {
    expect(COMMITTED_STATUSES).toEqual(['Ordered', 'Received', 'Vendor Invoiced', 'Paid']);
  });
});
