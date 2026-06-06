import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockSelect, mockFrom } = vi.hoisted(() => {
  const mockSelect = vi.fn();
  const mockFrom = vi.fn();
  return { mockSelect, mockFrom };
});

vi.mock('@/src/lib/supabase/client', () => ({ supabase: { from: mockFrom } }));

import { listProcurements } from './procurements';

function makeBuilder(resolved: { data: unknown; error: unknown }) {
  const builder = {
    select: mockSelect,
    then: (resolve: (v: typeof resolved) => void, reject?: (e: unknown) => void) =>
      Promise.resolve(resolved).then(resolve, reject),
  };
  mockSelect.mockReturnValue(builder);
  mockFrom.mockReturnValue(builder);
  return builder;
}

beforeEach(() => { mockFrom.mockReset(); mockSelect.mockReset(); });

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
});
