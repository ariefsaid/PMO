import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/src/lib/supabase/client', () => ({
  supabase: { rpc: vi.fn() },
}));

import { getExecutiveDashboard } from './dashboard';
import { supabase } from '@/src/lib/supabase/client';

const rpc = supabase.rpc as ReturnType<typeof vi.fn>;

beforeEach(() => { rpc.mockReset(); });

describe('getExecutiveDashboard', () => {
  it('calls rpc("get_executive_dashboard") with no org_id arg, returns the payload (AC-710, FR-DAL-DASH-001)', async () => {
    const payload = {
      active_projects: 2, total_contract_value: 8000000, avg_gross_margin: 0.30162,
      projects_at_risk: 1,
      projects_by_status: [{ status: 'Ongoing Project', count: 2 }],
      procurements_by_status: [{ status: 'Paid', count: 1 }],
      top_projects: [{ id: 'p1', name: 'Innovate Corp HQ Fit-Out', client_name: 'Innovate Corp',
        contract_value: 5000000, budget: 4700000, spent: 2100000, status: 'Ongoing Project' }],
    };
    rpc.mockResolvedValue({ data: payload, error: null });
    const result = await getExecutiveDashboard();
    expect(rpc).toHaveBeenCalledWith('get_executive_dashboard');
    expect(rpc.mock.calls[0].length).toBe(1); // no args object → no org_id
    expect(result.active_projects).toBe(2);
    expect(result.top_projects[0].client_name).toBe('Innovate Corp');
  });

  it('throws on RPC error (AC-710)', async () => {
    rpc.mockResolvedValue({ data: null, error: { message: 'boom' } });
    await expect(getExecutiveDashboard()).rejects.toThrow('boom');
  });
});
