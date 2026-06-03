import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockOrder, mockEq, mockSelect, mockFrom } = vi.hoisted(() => {
  const mockOrder = vi.fn();
  const mockEq = vi.fn(() => ({ order: mockOrder }));
  const mockSelect = vi.fn(() => ({ eq: mockEq }));
  const mockFrom = vi.fn(() => ({ select: mockSelect }));
  return { mockOrder, mockEq, mockSelect, mockFrom };
});

vi.mock('@/src/lib/supabase/client', () => ({ supabase: { from: mockFrom } }));

import { listTimesheets } from './timesheets';

beforeEach(() => {
  mockFrom.mockClear();
  mockSelect.mockClear();
  mockEq.mockClear();
  mockOrder.mockReset();
  // Re-wire the chain after each reset
  mockOrder.mockResolvedValue({ data: [], error: null });
  mockEq.mockReturnValue({ order: mockOrder });
  mockSelect.mockReturnValue({ eq: mockEq });
  mockFrom.mockReturnValue({ select: mockSelect });
});

describe('listTimesheets', () => {
  it('selects timesheets with nested entries+project, filtered by user_id, ordered by week desc (AC-608, FR-DAL-TS-001)', async () => {
    const rows = [{
      id: '70000000-0000-0000-0000-000000000002',
      user_id: '00000000-0000-0000-0000-0000000000a2',
      week_start_date: '2026-06-01', status: 'Draft',
      submitted_at: null, approved_by: null, approved_at: null,
      org_id: '00000000-0000-0000-0000-000000000001',
      entries: [
        { id: 'e1', timesheet_id: '70000000-0000-0000-0000-000000000002',
          project_id: '40000000-0000-0000-0000-000000000001', entry_date: '2026-06-01',
          hours: 6, notes: 'Client workshop',
          project: { name: 'Innovate Corp HQ Fit-Out', code: 'P001' } },
      ],
    }];
    mockOrder.mockResolvedValue({ data: rows, error: null });
    const result = await listTimesheets('00000000-0000-0000-0000-0000000000a2');
    expect(mockFrom).toHaveBeenCalledWith('timesheets');
    expect(mockSelect).toHaveBeenCalledWith('*, entries:timesheet_entries(*, project:projects(name,code))');
    expect(mockEq).toHaveBeenCalledWith('user_id', '00000000-0000-0000-0000-0000000000a2');
    expect(mockOrder).toHaveBeenCalledWith('week_start_date', { ascending: false });
    expect(result[0].entries[0].project?.name).toBe('Innovate Corp HQ Fit-Out');
    expect(result[0].entries[0].entry_date).toBe('2026-06-01');
  });

  it('sends no org_id (RLS scopes it) (FR-DAL-TS-001)', async () => {
    mockOrder.mockResolvedValue({ data: [], error: null });
    await listTimesheets('u1');
    expect(JSON.stringify(mockSelect.mock.calls)).not.toContain('org_id');
    expect(JSON.stringify(mockEq.mock.calls)).not.toContain('org_id');
  });

  it('throws on PostgREST error (AC-608)', async () => {
    mockOrder.mockResolvedValue({ data: null, error: { message: 'boom' } });
    await expect(listTimesheets('u1')).rejects.toThrow('boom');
  });
});
