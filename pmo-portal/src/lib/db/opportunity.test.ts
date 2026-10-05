import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockFrom, mockSelect, mockEq, mockMaybeSingle } = vi.hoisted(() => {
  const mockFrom = vi.fn();
  const mockSelect = vi.fn();
  const mockEq = vi.fn();
  const mockMaybeSingle = vi.fn();
  return { mockFrom, mockSelect, mockEq, mockMaybeSingle };
});

vi.mock('@/src/lib/supabase/client', () => ({ supabase: { from: mockFrom } }));

import { getOpportunity } from './opportunity';

function makeBuilder(resolved: { data: unknown; error: unknown }) {
  const builder = {
    select: mockSelect,
    eq: mockEq,
    maybeSingle: mockMaybeSingle,
    then: (resolve: (v: typeof resolved) => void, reject?: (e: unknown) => void) =>
      Promise.resolve(resolved).then(resolve, reject),
  };
  mockSelect.mockReturnValue(builder);
  mockEq.mockReturnValue(builder);
  mockMaybeSingle.mockReturnValue(builder);
  mockFrom.mockReturnValue(builder);
  return builder;
}

beforeEach(() => {
  mockFrom.mockReset();
  mockSelect.mockReset();
  mockEq.mockReset();
  mockMaybeSingle.mockReset();
});

describe('getOpportunity', () => {
  // AC-EC-002/#758: both companies embeds must be FK-qualified (two FKs to companies since 0223)
  // and carry end_client_id so the pre-win detail fallback keeps end-customer parity.
  it('AC-EC-002: selects the explicit column list with FK-qualified client/end-client embeds', async () => {
    const row = {
      id: 'o1', name: 'A Deal', status: 'Leads', client_id: 'c1', end_client_id: 'c9',
      project_manager_id: null, contract_value: 100, currency: 'USD',
      client: { name: 'Main Contractor' }, end_client: { name: 'Asset Owner' },
      pm: { full_name: null },
    };
    makeBuilder({ data: row, error: null });
    const result = await getOpportunity('o1');
    expect(mockFrom).toHaveBeenCalledWith('projects');
    expect(mockEq).toHaveBeenCalledWith('id', 'o1');
    // The FK-qualified SELECT string (pins the embed strings so a revert is caught here).
    expect(mockSelect).toHaveBeenCalledWith(
      expect.stringContaining('client:companies!projects_client_id_fkey(name, short_name)'),
    );
    expect(mockSelect).toHaveBeenCalledWith(
      expect.stringContaining('end_client:companies!projects_end_client_id_fkey(name, short_name)'),
    );
    expect(mockSelect).toHaveBeenCalledWith(
      expect.stringContaining('end_client_id'),
    );
    expect(result?.end_client?.name).toBe('Asset Owner');
  });

  it('AC-EC-002: returns null when the record is absent / not visible', async () => {
    makeBuilder({ data: null, error: null });
    const result = await getOpportunity('missing');
    expect(result).toBeNull();
  });
});