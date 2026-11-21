import { describe, it, expect, vi, beforeEach } from 'vitest';

/** #2669 (migrations 1265/1266) — the DAL seam: RPCs only, no org id sent, a refusal is "restricted" not empty. */
const h = vi.hoisted(() => ({ rpc: vi.fn() }));
vi.mock('@/src/lib/supabase/client', () => ({ supabase: { rpc: h.rpc } }));

import { getDisciplineProfitEnabled, listDisciplineRevenue, setBoqItemDiscipline, setDisciplineProfitEnabled } from '@/src/lib/db/disciplineProfit';
import { AppError } from '@/src/lib/appError';

beforeEach(() => h.rpc.mockReset());

describe('discipline profit DAL', () => {
  it('AC-DPR-001 reads the setting, and an unreadable one is off', async () => {
    h.rpc.mockResolvedValueOnce({ data: true, error: null });
    await expect(getDisciplineProfitEnabled()).resolves.toBe(true);
    h.rpc.mockResolvedValueOnce({ data: null, error: null });
    await expect(getDisciplineProfitEnabled()).resolves.toBe(false);
  });

  it('AC-DPR-015 the setter sends only the value', async () => {
    h.rpc.mockResolvedValueOnce({ data: true, error: null });
    await setDisciplineProfitEnabled(true);
    expect(h.rpc).toHaveBeenCalledWith('set_org_discipline_profit_enabled', { p_enabled: true });
    h.rpc.mockResolvedValueOnce({ data: null, error: { message: 'no', code: '42501' } });
    await expect(setDisciplineProfitEnabled(false)).rejects.toMatchObject({ code: '42501' });
  });

  it('AC-DPR-012 a refused revenue read is restricted, never an empty list', async () => {
    h.rpc.mockResolvedValueOnce({ data: null, error: { message: 'no', code: '42501' } });
    await expect(listDisciplineRevenue('p1')).resolves.toBe('restricted');
    h.rpc.mockResolvedValueOnce({ data: null, error: { message: 'boom', code: 'XX000' } });
    await expect(listDisciplineRevenue('p1')).rejects.toBeInstanceOf(AppError);
  });

  it('maps the revenue rows and keeps the basis', async () => {
    h.rpc.mockResolvedValueOnce({ data: [{ basis: 'validated_progress', discipline_id: 'd1', currency: 'USD', revenue: 110, validated_lines: 2, unrated_lines: 1 }], error: null });
    await expect(listDisciplineRevenue('p1')).resolves.toEqual([
      { basis: 'validated_progress', disciplineId: 'd1', currency: 'USD', revenue: '110.00', validatedLines: 2, unratedLines: 1 },
    ]);
    expect(h.rpc).toHaveBeenCalledWith('project_discipline_revenue', { p_project: 'p1' });
  });

  it('AC-DPR-003 tags a contract item through the RPC', async () => {
    h.rpc.mockResolvedValueOnce({ data: 'd1', error: null });
    await setBoqItemDiscipline('i1', 'd1');
    expect(h.rpc).toHaveBeenCalledWith('set_boq_item_discipline', { p_item: 'i1', p_discipline: 'd1' });
  });
});
