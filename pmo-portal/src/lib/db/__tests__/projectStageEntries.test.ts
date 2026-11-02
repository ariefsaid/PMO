import { describe, it, expect, vi, beforeEach } from 'vitest';
const rpc = vi.fn();
const order = vi.fn();
vi.mock('@/src/lib/supabase/client', () => ({
  supabase: {
    rpc: (...a: unknown[]) => rpc(...a),
    from: () => ({ select: () => ({ eq: () => ({ order: (...a: unknown[]) => order(...a) }) }) }),
  },
}));
import { listStageEntries, redateStageEntry, addSkippedStageEntry, importProjectStageHistory } from '../projectStageEntries';

beforeEach(() => { rpc.mockReset(); order.mockReset(); });

describe('projectStageEntries DAL (#1638)', () => {
  it('lists a project journey newest-first by position', async () => {
    order.mockResolvedValue({ data: [{ id: 'e2' }, { id: 'e1' }], error: null });
    await expect(listStageEntries('p1')).resolves.toEqual([{ id: 'e2' }, { id: 'e1' }]);
    expect(order).toHaveBeenCalledWith('position', { ascending: false });
  });
  it('never sends org_id to the stage RPCs', async () => {
    rpc.mockResolvedValue({ data: null, error: null });
    await redateStageEntry('e1', '2026-10-12');
    await addSkippedStageEntry('e2', 'Quotation Submitted', '2026-10-01');
    await importProjectStageHistory('p1', [{ stage: 'PQ Submitted', entered_on: '2026-07-01' }]);
    expect(rpc.mock.calls).toEqual([
      ['redate_stage_entry', { p_entry_id: 'e1', p_entered_on: '2026-10-12' }],
      ['add_skipped_stage_entry', { p_before_entry_id: 'e2', p_stage: 'Quotation Submitted', p_entered_on: '2026-10-01' }],
      ['import_project_stage_history', { p_project_id: 'p1', p_entries: [{ stage: 'PQ Submitted', entered_on: '2026-07-01' }] }],
    ]);
  });
  it('surfaces an RPC refusal as an AppError with its code', async () => {
    rpc.mockResolvedValue({ data: null, error: { code: '23514', message: 'a stage date cannot be earlier…' } });
    await expect(redateStageEntry('e1', '2026-01-01')).rejects.toMatchObject({ code: '23514' });
  });
});
