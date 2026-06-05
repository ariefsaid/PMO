import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/src/lib/supabase/client', () => ({
  supabase: { rpc: vi.fn() },
}));

import { getExecutiveDashboard, getWinRate, getSalesPipeline } from './dashboard';
import { supabase } from '@/src/lib/supabase/client';

const rpc = supabase.rpc as ReturnType<typeof vi.fn>;

beforeEach(() => { rpc.mockReset(); });

// ---- Extended dashboard payload ----
const extendedPayload = {
  active_projects: 2,
  total_contract_value: 8000000,
  on_hand_margin: 0.949375,
  on_hand_value: 8000000,
  pipeline_weighted_value: 800000,
  pipeline_projected_margin: 0.200,
  pipeline_total_value: 2000000,
  projects_at_risk: 1,
  projects_by_status: [{ status: 'Ongoing Project', count: 2 }],
  procurements_by_status: [{ status: 'Paid', count: 1 }],
  top_projects: [{ id: 'p1', name: 'Innovate Corp HQ Fit-Out', client_name: 'Innovate Corp',
    contract_value: 5000000, budget: 4700000, spent: 2100000, status: 'Ongoing Project' }],
};

describe('getExecutiveDashboard', () => {
  it('calls rpc("get_executive_dashboard") with no org_id arg, returns the payload (AC-710, FR-DAL-DASH-001)', async () => {
    rpc.mockResolvedValue({ data: extendedPayload, error: null });
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

  it('AC-1111: getExecutiveDashboard returns the extended dual-lens payload; throws on error (FR-SPD-009)', async () => {
    rpc.mockResolvedValue({ data: extendedPayload, error: null });
    const result = await getExecutiveDashboard();
    expect(result.on_hand_margin).toBe(0.949375);
    expect(result.on_hand_value).toBe(8000000);
    expect(result.pipeline_weighted_value).toBe(800000);
    expect(result.pipeline_projected_margin).toBe(0.200);
    expect(result.pipeline_total_value).toBe(2000000);
    // no avg_gross_margin
    expect((result as unknown as Record<string, unknown>)['avg_gross_margin']).toBeUndefined();

    // error branch
    rpc.mockResolvedValue({ data: null, error: { message: 'dal-error' } });
    await expect(getExecutiveDashboard()).rejects.toThrow('dal-error');
  });
});

// ---- Win-rate marshaling ----
describe('getWinRate', () => {
  it('AC-1112: getWinRate marshals a Date range to p_from/p_to and null when omitted (FR-SPD-009)', async () => {
    const winPayload = {
      wins_count: 1, losses_count: 1, wins_value: 3000000, losses_value: 650000,
      win_rate_count: 0.5, win_rate_value: 0.821918,
    };
    rpc.mockResolvedValue({ data: winPayload, error: null });

    // with date range
    const from = new Date('2026-02-01');
    const to = new Date('2026-02-28');
    const result = await getWinRate(from, to);
    expect(rpc).toHaveBeenCalledWith('get_win_rate', { p_from: '2026-02-01', p_to: '2026-02-28' });
    expect(result.win_rate_count).toBe(0.5);

    rpc.mockReset();
    rpc.mockResolvedValue({ data: { wins_count: 2, losses_count: 1, wins_value: 8000000, losses_value: 650000, win_rate_count: 0.666667, win_rate_value: 0.924855 }, error: null });

    // no-arg call — sends null/null
    await getWinRate();
    expect(rpc).toHaveBeenCalledWith('get_win_rate', { p_from: null, p_to: null });

    // error branch
    rpc.mockResolvedValue({ data: null, error: { message: 'wr-error' } });
    await expect(getWinRate()).rejects.toThrow('wr-error');
  });
});

// ---- Sales pipeline ----
describe('getSalesPipeline', () => {
  it('AC-1113: getSalesPipeline returns typed stages + projects; throws on error (FR-SPD-009)', async () => {
    const pipelinePayload = {
      stages: [
        { status: 'Tender Submitted', count: 1, total_value: 1200000, win_probability: 0.5, weighted_value: 600000 },
        { status: 'PQ Submitted', count: 1, total_value: 800000, win_probability: 0.25, weighted_value: 200000 },
      ],
      projects: [
        { id: 'p2', name: 'Northwind ERP Rollout', client_name: 'Northwind', status: 'Tender Submitted', contract_value: 1200000, win_probability: 0.5 },
      ],
    };
    rpc.mockResolvedValue({ data: pipelinePayload, error: null });
    const result = await getSalesPipeline();
    expect(rpc).toHaveBeenCalledWith('get_sales_pipeline');
    expect(result.stages).toHaveLength(2);
    expect(result.stages[0].status).toBe('Tender Submitted');
    expect(result.projects[0].client_name).toBe('Northwind');

    // error branch
    rpc.mockResolvedValue({ data: null, error: { message: 'sp-error' } });
    await expect(getSalesPipeline()).rejects.toThrow('sp-error');
  });
});
