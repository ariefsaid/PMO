import { describe, it, expect, vi, beforeEach } from 'vitest';

const { select, from } = vi.hoisted(() => {
  const select = vi.fn();
  const from = vi.fn(() => ({ select }));
  return { select, from };
});

vi.mock('@/src/lib/supabase/client', () => ({ supabase: { from } }));

import { listProjects } from './projects';

beforeEach(() => { from.mockClear(); select.mockReset(); });

describe('listProjects', () => {
  it('selects projects joining client name + PM name; returns rows (AC-409, FR-DAL-001)', async () => {
    const rows = [{
      id: '40000000-0000-0000-0000-000000000001', name: 'Innovate Corp HQ Fit-Out',
      status: 'Ongoing Project', client_id: 'c2', project_manager_id: 'a2',
      contract_value: 5000000, budget: 4700000, spent: 2100000,
      start_date: '2026-01-06', end_date: '2026-12-18',
      client: { name: 'Innovate Corp' }, pm: { full_name: 'Alice Manager' },
    }];
    select.mockResolvedValue({ data: rows, error: null });
    const result = await listProjects();
    expect(from).toHaveBeenCalledWith('projects');
    expect(select).toHaveBeenCalledWith('*, client:companies(name), pm:profiles(full_name)');
    expect(result[0].client?.name).toBe('Innovate Corp');
    expect(result[0].pm?.full_name).toBe('Alice Manager');
  });

  it('sends no org_id (RLS scopes it) (FR-DAL-004)', async () => {
    select.mockResolvedValue({ data: [], error: null });
    await listProjects();
    expect(JSON.stringify(select.mock.calls)).not.toContain('org_id');
  });

  it('throws on PostgREST error (AC-409, FR-DAL-003)', async () => {
    select.mockResolvedValue({ data: null, error: { message: 'boom' } });
    await expect(listProjects()).rejects.toThrow('boom');
  });
});
