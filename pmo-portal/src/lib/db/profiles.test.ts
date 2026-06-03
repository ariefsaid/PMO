import { describe, it, expect, vi, beforeEach } from 'vitest';

const { eq, select, from } = vi.hoisted(() => {
  const eq = vi.fn();
  const select = vi.fn(() => ({ eq }));
  const from = vi.fn(() => ({ select }));
  return { eq, select, from };
});

vi.mock('@/src/lib/supabase/client', () => ({ supabase: { from } }));

import { listProjectManagers } from './profiles';

beforeEach(() => { from.mockClear(); select.mockClear(); eq.mockReset(); });

describe('listProjectManagers', () => {
  it("selects profiles where role = 'Project Manager' (FR-DAL-005, OD-2)", async () => {
    eq.mockResolvedValue({ data: [{ id: 'a2', full_name: 'Alice Manager', role: 'Project Manager' }], error: null });
    const result = await listProjectManagers();
    expect(from).toHaveBeenCalledWith('profiles');
    expect(eq).toHaveBeenCalledWith('role', 'Project Manager');
    expect(result[0].full_name).toBe('Alice Manager');
  });
  it('throws on error', async () => {
    eq.mockResolvedValue({ data: null, error: { message: 'boom' } });
    await expect(listProjectManagers()).rejects.toThrow('boom');
  });
});
