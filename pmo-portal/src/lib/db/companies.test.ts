import { describe, it, expect, vi, beforeEach } from 'vitest';

const { eq, select, from } = vi.hoisted(() => {
  const eq = vi.fn();
  const select = vi.fn(() => ({ eq }));
  const from = vi.fn(() => ({ select }));
  return { eq, select, from };
});

vi.mock('@/src/lib/supabase/client', () => ({ supabase: { from } }));

import { listClientCompanies } from './companies';

beforeEach(() => { from.mockClear(); select.mockClear(); eq.mockReset(); });

describe('listClientCompanies', () => {
  it("selects companies where type = 'Client' (FR-DAL-005)", async () => {
    eq.mockResolvedValue({ data: [{ id: 'c2', name: 'Innovate Corp', type: 'Client' }], error: null });
    const result = await listClientCompanies();
    expect(from).toHaveBeenCalledWith('companies');
    expect(eq).toHaveBeenCalledWith('type', 'Client');
    expect(result[0].name).toBe('Innovate Corp');
  });
  it('throws on error', async () => {
    eq.mockResolvedValue({ data: null, error: { message: 'boom' } });
    await expect(listClientCompanies()).rejects.toThrow('boom');
  });
});
