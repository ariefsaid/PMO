import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/src/lib/supabase/client', () => ({
  supabase: { rpc: vi.fn() },
}));

import { getProjectsMilestoneDates } from './milestones';
import { supabase } from '@/src/lib/supabase/client';

const rpcSpy = supabase.rpc as ReturnType<typeof vi.fn>;

beforeEach(() => rpcSpy.mockReset());

describe('getProjectsMilestoneDates', () => {
  it('AC-CAL-009: getProjectsMilestoneDates([]) returns [] without calling the RPC', async () => {
    const out = await getProjectsMilestoneDates([]);
    expect(out).toEqual([]);
    expect(rpcSpy).not.toHaveBeenCalled();
  });

  it('maps RPC rows to MilestoneDate[] and passes p_ids', async () => {
    rpcSpy.mockResolvedValue({
      data: [{ id: 'm1', project_id: 'p1', name: 'Kickoff', target_date: '2026-06-12' }],
      error: null,
    });
    const out = await getProjectsMilestoneDates(['p1']);
    expect(out).toEqual([{ id: 'm1', projectId: 'p1', name: 'Kickoff', targetDate: '2026-06-12' }]);
    expect(rpcSpy).toHaveBeenCalledWith('get_projects_milestone_dates', { p_ids: ['p1'] });
  });

  it('returns [] when the RPC yields null data', async () => {
    rpcSpy.mockResolvedValue({ data: null, error: null });
    const out = await getProjectsMilestoneDates(['p1']);
    expect(out).toEqual([]);
  });

  it('throws an AppError (code preserved) on RPC error', async () => {
    rpcSpy.mockResolvedValue({ data: null, error: { message: 'boom', code: '42501' } });
    await expect(getProjectsMilestoneDates(['p1'])).rejects.toMatchObject({ code: '42501' });
  });
});
