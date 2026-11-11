import { describe, it, expect } from 'vitest';
import type { PipelineProject, PipelineStage } from '@/src/lib/db/dashboard';
import { projectFunnelModel } from '../pipelineFunnelModel';

const mockStages: PipelineStage[] = [
  { status: 'Leads', count: 1, total_value: 100000, weighted_value: 10000, win_probability: 0.1 },
  { status: 'PQ Submitted', count: 1, total_value: 200000, weighted_value: 40000, win_probability: 0.2 },
  { status: 'Quotation Submitted', count: 1, total_value: 300000, weighted_value: 150000, win_probability: 0.5 },
  { status: 'Tender Submitted', count: 1, total_value: 400000, weighted_value: 280000, win_probability: 0.7 },
  { status: 'Negotiation', count: 1, total_value: 500000, weighted_value: 450000, win_probability: 0.9 },
];

const makeDeal = (status: PipelineProject['status'], currency: string, contract_value = 100000): PipelineProject => ({
  id: `d-${Math.random()}`,
  name: 'Deal',
  short_name: null,
  status,
  contract_value,
  currency,
  win_probability: 0.5,
  service_line: null,
  sector: null,
  location: null,
  award_type: null,
  bidding_entity: null,
  pmo_project_number: null,
  code: null,
  client_name: null,
  client_legal_name: null,
  end_client_name: null,
  end_client_legal_name: null,
  last_update: undefined,
  pm_name: null,
  tax_treatment: null,
});

describe('pipelineFunnelModel — currency-safe stage projections and totals (THEME-CROSS-76)', () => {
  it('computes correct totals and projections for single-currency pipeline', () => {
    const deals = [
      makeDeal('Leads', 'USD', 100000),
      makeDeal('Negotiation', 'USD', 500000),
    ];
    const model = projectFunnelModel(mockStages, deals, 'USD');

    expect(model.mixedPipeline).toBe(false);
    expect(model.totalWeighted).toBe(10000 + 40000 + 150000 + 280000 + 450000);
    expect(model.effectiveCurrency).toBe('USD');
    expect(model.stageProjections).toHaveLength(5);

    const leadsProj = model.stageProjections.find((p) => p.status === 'Leads');
    expect(leadsProj?.mixedStage).toBe(false);
    expect(leadsProj?.stageCurrency).toBe('USD');
    expect(leadsProj?.weightedValue).toBe(10000);
  });

  it('suppresses overall forecast when pipeline has mixed currencies', () => {
    const deals = [
      makeDeal('Leads', 'USD', 100000),
      makeDeal('Negotiation', 'IDR', 500000000),
    ];
    const model = projectFunnelModel(mockStages, deals, 'USD');

    expect(model.mixedPipeline).toBe(true);
    // When mixed, barPct is undefined to prevent comparing apples to oranges
    expect(model.stageProjections.every((p) => p.barPct === undefined)).toBe(true);
  });

  it('suppresses stage total when deals within that stage have mixed currencies', () => {
    const deals = [
      makeDeal('Leads', 'USD', 100000),
      makeDeal('Leads', 'EUR', 90000),
    ];
    const model = projectFunnelModel(mockStages, deals, 'USD');

    const leadsProj = model.stageProjections.find((p) => p.status === 'Leads');
    expect(leadsProj?.mixedStage).toBe(true);
  });

  it('falls back to orgCurrency and 0 total when there are no deals', () => {
    const model = projectFunnelModel([], [], 'SGD');
    expect(model.mixedPipeline).toBe(false);
    expect(model.totalWeighted).toBe(0);
    expect(model.effectiveCurrency).toBe('SGD');
  });
});
