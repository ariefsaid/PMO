import { describe, expect, it, vi, beforeEach } from 'vitest';

/** AC-PIU-002/004 — the import's update writes only the fields it is given, never code, profile link or manager. */
const h = vi.hoisted(() => ({ payload: undefined as unknown, eq: [] as unknown[], data: [{ id: 'p1' }] as unknown[] | null }));
const chain: Record<string, unknown> = {};
chain.update = (p: unknown) => { h.payload = p; return chain; };
chain.eq = (...a: unknown[]) => { h.eq = a; return chain; };
chain.select = () => chain;
chain.then = (res: (v: unknown) => unknown) => Promise.resolve({ data: h.data, error: null }).then(res);
vi.mock('@/src/lib/supabase/client', () => ({ supabase: { from: () => chain } }));

import { updatePersonFields } from '../people';

describe('updatePersonFields (people import)', () => {
  beforeEach(() => { h.payload = undefined; h.data = [{ id: 'p1' }]; });

  it('AC-PIU-002 sends the trimmed name for the person, and nothing else', async () => {
    await updatePersonFields('p1', { name: ' Ana Putri ' });
    expect(h.payload).toEqual({ name: 'Ana Putri' });
    expect(h.eq).toEqual(['id', 'p1']);
  });

  it('AC-PIU-004 a blank or missing value is omitted, never written as null', async () => {
    await updatePersonFields('p1', { name: 'Ana', job_title: '  ' });
    expect(h.payload).toEqual({ name: 'Ana' });
    await updatePersonFields('p1', { job_title: ' Foreman ' });
    expect(h.payload).toEqual({ job_title: 'Foreman' });
    expect(Object.keys(h.payload as object)).not.toContain('code');
    expect(Object.keys(h.payload as object)).not.toContain('profile_id');
  });

  it('AC-PIU-009 a write the database does not let through is refused (42501), not silent', async () => {
    h.data = [];
    await expect(updatePersonFields('p1', { name: 'Ana' })).rejects.toMatchObject({ code: '42501' });
  });

  it('AC-PIU-013 sends manager_id when given and omits it when blank; never code or profile_id', async () => {
    await updatePersonFields('p1', { manager_id: 'u-9' });
    expect(h.payload).toEqual({ manager_id: 'u-9' });
    await updatePersonFields('p1', { name: 'Ana', manager_id: '' });
    expect(h.payload).toEqual({ name: 'Ana' });
  });
});