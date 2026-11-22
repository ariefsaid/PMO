import { beforeEach, describe, expect, it, vi } from 'vitest';

/** The DAL sends no org_id, reads progress from the one database function, and keeps the Postgres code of a refusal. */
const h = vi.hoisted(() => ({ insert: vi.fn(), rpc: vi.fn(), update: vi.fn(), del: vi.fn() }));
vi.mock('@/src/lib/supabase/client', () => ({
  supabase: {
    rpc: h.rpc,
    from: (table: string) => ({
      insert: (row: unknown) => h.insert(table, row),
      update: (row: unknown) => ({ eq: () => ({ select: () => h.update(table, row) }) }),
      delete: () => ({ eq: (c: string, id: string) => h.del(table, c, id) }),
    }),
  },
}));
import { canManageManpower, createManpowerNeed, linkManpowerPerson, listManpowerProgress, unlinkManpowerPerson, updateManpowerNeed } from './manpowerNeeds';

describe('manpower needs DAL', () => {
  beforeEach(() => { h.insert.mockReset(); h.rpc.mockReset(); h.update.mockReset(); h.del.mockReset(); });

  it('creates a need without org_id and trims the note', async () => {
    h.insert.mockResolvedValue({ error: null });
    await createManpowerNeed({ project_id: 'p', discipline_id: 'd', headcount: 2, needed_by: '2999-01-01', note: '  hi ' });
    expect(h.insert).toHaveBeenCalledWith('manpower_needs', {
      project_id: 'p', discipline_id: 'd', headcount: 2, needed_by: '2999-01-01', work_order_id: null, crew_id: null, note: 'hi',
    });
  });

  it('keeps the Postgres code of a refused link', async () => {
    h.insert.mockResolvedValue({ error: { message: 'MPN_FULL: full', code: '23514' } });
    await expect(linkManpowerPerson('n', 'p')).rejects.toMatchObject({ code: '23514', message: 'MPN_FULL: full' });
  });

  it('reads progress from the database function, not by recomputing', async () => {
    h.rpc.mockResolvedValue({ data: [{ need_id: 'n', asked: 3, linked: 2, filled: 1, in_progress: 1, open_count: 1 }], error: null });
    expect(await listManpowerProgress()).toHaveLength(1);
    expect(h.rpc).toHaveBeenCalledWith('manpower_need_progress');
  });

  it('says so when an update changed nothing', async () => {
    h.update.mockResolvedValue({ data: [], error: null });
    await expect(updateManpowerNeed('n', { status: 'met' })).rejects.toMatchObject({ code: 'not-found' });
  });

  it('unlinks by link id and asks the database who may write', async () => {
    h.del.mockResolvedValue({ error: null });
    await unlinkManpowerPerson('l1');
    expect(h.del).toHaveBeenCalledWith('manpower_need_people', 'id', 'l1');
    h.rpc.mockResolvedValue({ data: true, error: null });
    expect(await canManageManpower()).toBe(true);
    h.rpc.mockResolvedValue({ data: null, error: null });
    expect(await canManageManpower()).toBe(false);
  });
});
