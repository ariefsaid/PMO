import { describe, expect, it, vi, beforeEach } from 'vitest';

const h = vi.hoisted(() => ({ calls: [] as Array<{ op: string; arg?: unknown }>, result: { data: [{ id: 'p1' }] as unknown, error: null as unknown } }));
const chain: Record<string, unknown> = {};
for (const op of ['insert', 'update', 'select', 'eq', 'is', 'order']) {
  chain[op] = (arg?: unknown) => { h.calls.push({ op, arg }); return chain; };
}
chain.single = () => Promise.resolve({ data: { id: 'new' }, error: null });
chain.then = (res: (v: unknown) => unknown) => Promise.resolve(h.result).then(res);
vi.mock('@/src/lib/supabase/client', () => ({ supabase: { from: () => chain } }));
import { archivePerson, createPerson, updatePerson } from '../people';

describe('people register writes (#2542 follow-up)', () => {
  beforeEach(() => { h.calls = []; h.result = { data: [{ id: 'p1' }], error: null }; });

  it('AC-PPL-005 create with only a name sends no org_id and no code', async () => {
    await createPerson({ name: ' Ayu ', code: '  ', job_title: null, profile_id: null });
    const row = h.calls.find((c) => c.op === 'insert')?.arg as Record<string, unknown>;
    expect(row).toEqual({ name: 'Ayu', job_title: null, profile_id: null });
  });

  it('AC-PPL-005 create keeps a typed code', async () => {
    await createPerson({ name: 'Ayu', code: ' EMP-9 ', job_title: 'Welder', profile_id: 'u1' });
    expect(h.calls.find((c) => c.op === 'insert')?.arg).toEqual({ name: 'Ayu', code: 'EMP-9', job_title: 'Welder', profile_id: 'u1' });
  });

  it('AC-PPL-006 update carries only name, code, job title and profile', async () => {
    await updatePerson('p1', { name: 'Ayu', code: 'P-0001', job_title: null, profile_id: null });
    expect(Object.keys(h.calls.find((c) => c.op === 'update')?.arg as object).sort()).toEqual(['code', 'job_title', 'name', 'profile_id']);
  });

  it('AC-PPL-007 archive sets archived_at only', async () => {
    await archivePerson('p1');
    expect(Object.keys(h.calls.find((c) => c.op === 'update')?.arg as object)).toEqual(['archived_at']);
  });

  it('reports a write RLS turned into zero rows', async () => {
    h.result = { data: [], error: null };
    await expect(archivePerson('p1')).rejects.toMatchObject({ code: '42501' });
  });

  it('AC-PPL-009 preserves the Postgres code and message so the form can name the field', async () => {
    h.result = { data: null, error: { message: 'duplicate key value violates unique constraint "people_code_live"', code: '23505' } };
    await expect(updatePerson('p1', { name: 'A', code: 'P-0001', job_title: null, profile_id: null }))
      .rejects.toMatchObject({ code: '23505', message: expect.stringContaining('people_code_live') });
  });
});
