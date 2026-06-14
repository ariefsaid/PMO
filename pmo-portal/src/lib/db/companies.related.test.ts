import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * DAL: listProjectsByClient + listProcurementsByVendor
 *
 * Mock the Supabase query builder chain:
 *   supabase.from('projects').select(SELECT).eq('client_id', id)  → thenable
 *   supabase.from('procurements').select(SELECT).eq('vendor_id', id) → thenable
 *
 * All mocks hoisted so they are available to vi.mock factories.
 */
const { mockEq, mockSelect, mockFrom } = vi.hoisted(() => {
  const mockEq = vi.fn();
  const mockSelect = vi.fn();
  const mockFrom = vi.fn();
  return { mockEq, mockSelect, mockFrom };
});

vi.mock('@/src/lib/supabase/client', () => ({ supabase: { from: mockFrom } }));

import { listProjectsByClient } from './projects';
import { listProcurementsByVendor } from './procurements';

function makeBuilder(resolved: { data: unknown; error: unknown }) {
  const builder = {
    select: mockSelect,
    eq: mockEq,
    then: (resolve: (v: typeof resolved) => void, reject?: (e: unknown) => void) =>
      Promise.resolve(resolved).then(resolve, reject),
  };
  mockSelect.mockReturnValue(builder);
  mockEq.mockReturnValue(builder);
  mockFrom.mockReturnValue(builder);
  return builder;
}

beforeEach(() => {
  mockFrom.mockReset();
  mockSelect.mockReset();
  mockEq.mockReset();
});

// ---------------------------------------------------------------------------
// AC-IFW-COMPANY-01 — DAL reads for related objects on CompanyDetail
// ---------------------------------------------------------------------------

describe('listProjectsByClient', () => {
  it('AC-IFW-COMPANY-01: queries projects table with client_id filter; returns rows', async () => {
    const rows = [
      {
        id: 'd0000000-0000-0000-0000-000000000001',
        name: 'Meridian Solar Phase 1',
        status: 'Ongoing Project',
        client: { name: 'Meridian Steelworks' },
        pm: { full_name: 'Diego PM' },
      },
    ];
    makeBuilder({ data: rows, error: null });

    const result = await listProjectsByClient('cd000000-0000-0000-0000-000000000001');

    expect(mockFrom).toHaveBeenCalledWith('projects');
    expect(mockEq).toHaveBeenCalledWith('client_id', 'cd000000-0000-0000-0000-000000000001');
    expect(result[0].name).toBe('Meridian Solar Phase 1');
  });

  it('AC-IFW-COMPANY-01: sends no org_id (RLS scopes by org)', async () => {
    makeBuilder({ data: [], error: null });
    await listProjectsByClient('some-id');
    // No org_id in any call arg
    const allArgs = JSON.stringify(mockEq.mock.calls);
    expect(allArgs).not.toContain('org_id');
  });

  it('AC-IFW-COMPANY-01: throws on PostgREST error', async () => {
    makeBuilder({ data: null, error: { message: 'access denied' } });
    await expect(listProjectsByClient('bad-id')).rejects.toThrow('access denied');
  });
});

describe('listProcurementsByVendor', () => {
  it('AC-IFW-COMPANY-01: queries procurements table with vendor_id filter; returns rows', async () => {
    const rows = [
      {
        id: 'd2000000-0000-0000-0000-000000000001',
        title: 'PV Module Supply',
        status: 'Ordered',
        vendor_id: 'cd000000-0000-0000-0000-000000000005',
        project: { name: 'Meridian Solar Phase 1', code: 'SP-2401' },
        vendor: { name: 'SunVolt Modules Co.' },
        requested_by: { full_name: 'Diego PM' },
      },
    ];
    makeBuilder({ data: rows, error: null });

    const result = await listProcurementsByVendor('cd000000-0000-0000-0000-000000000005');

    expect(mockFrom).toHaveBeenCalledWith('procurements');
    expect(mockEq).toHaveBeenCalledWith('vendor_id', 'cd000000-0000-0000-0000-000000000005');
    expect(result[0].title).toBe('PV Module Supply');
  });

  it('AC-IFW-COMPANY-01: sends no org_id (RLS scopes by org)', async () => {
    makeBuilder({ data: [], error: null });
    await listProcurementsByVendor('some-id');
    const allArgs = JSON.stringify(mockEq.mock.calls);
    expect(allArgs).not.toContain('org_id');
  });

  it('AC-IFW-COMPANY-01: throws on PostgREST error', async () => {
    makeBuilder({ data: null, error: { message: 'boom' } });
    await expect(listProcurementsByVendor('bad-id')).rejects.toThrow('boom');
  });
});
