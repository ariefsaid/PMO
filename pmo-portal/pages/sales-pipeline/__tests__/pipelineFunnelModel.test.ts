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
    expect(leadsProj?.barPct).toBe(20);
  });

  it('scales stage bars to open value and omits a bar for a stage with no deals', () => {
    const stages = mockStages.map((stage) =>
      stage.status === 'Quotation Submitted' ? { ...stage, count: 0, total_value: 0, weighted_value: 0 } : stage,
    );
    const model = projectFunnelModel(stages, [makeDeal('Leads', 'USD'), makeDeal('Negotiation', 'USD')], 'USD');

    expect(model.stageProjections.find((stage) => stage.status === 'Leads')?.barPct).toBe(20);
    expect(model.stageProjections.find((stage) => stage.status === 'Negotiation')?.barPct).toBe(100);
    expect(model.stageProjections.find((stage) => stage.status === 'Quotation Submitted')?.barPct).toBeUndefined();
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

  describe('#2199: an unknown stage figure is unavailable, never 0', () => {
    it('a stage missing from the aggregate while deals sit in it is unavailable, and so is the forecast', () => {
      const stages = mockStages.filter((stage) => stage.status !== 'Tender Submitted');
      const model = projectFunnelModel(stages, [makeDeal('Tender Submitted', 'USD')], 'USD');
      const tender = model.stageProjections.find((p) => p.status === 'Tender Submitted');
      expect(tender?.totalValue).toBeNull();
      expect(tender?.weightedValue).toBeNull();
      expect(tender?.barPct).toBeUndefined();
      expect(model.totalWeighted).toBeNull();
      expect(model.totalOpen).toBeNull();
    });

    it('a stage missing because it has no deals is a real zero', () => {
      const stages = mockStages.filter((stage) => stage.status !== 'Tender Submitted');
      const model = projectFunnelModel(stages, [makeDeal('Leads', 'USD')], 'USD');
      const tender = model.stageProjections.find((p) => p.status === 'Tender Submitted');
      expect(tender?.totalValue).toBe(0);
      expect(tender?.weightedValue).toBe(0);
      expect(model.totalWeighted).toBe(10000 + 40000 + 150000 + 450000);
      expect(model.totalOpen).toBe(100000 + 200000 + 300000 + 500000);
    });

    it('a null weighted value with deals is unavailable; the open value still adds up', () => {
      const stages = mockStages.map((stage) =>
        stage.status === 'Leads' ? { ...stage, weighted_value: null as unknown as number } : stage,
      );
      const model = projectFunnelModel(stages, [], 'USD');
      const leads = model.stageProjections.find((p) => p.status === 'Leads');
      expect(leads?.weightedValue).toBeNull();
      expect(leads?.totalValue).toBe(100000);
      expect(model.totalWeighted).toBeNull();
      expect(model.totalOpen).toBe(1500000);
    });
  });

  describe('#2199 item 1: a mixed pipeline splits its figures per currency when the deals reconcile', () => {
    const mixedStages: PipelineStage[] = [
      { status: 'Leads', count: 2, total_value: 1100, weighted_value: 550, win_probability: 0.5 },
      { status: 'Tender Submitted', count: 1, total_value: 300, weighted_value: 150, win_probability: 0.5 },
    ];
    const deals = [makeDeal('Leads', 'USD', 100), makeDeal('Leads', 'IDR', 1000), makeDeal('Tender Submitted', 'USD', 300)];

    it('each stage and the pipeline carry per-currency totals and weighted values, org currency first', () => {
      const model = projectFunnelModel(mixedStages, deals, 'IDR');
      expect(model.mixedPipeline).toBe(true);
      const leads = model.stageProjections.find((p) => p.status === 'Leads');
      expect(leads?.split.totals).toEqual([{ currency: 'IDR', amount: '1000' }, { currency: 'USD', amount: '100' }]);
      expect(model.openByCurrency).toEqual([{ currency: 'IDR', amount: '1000' }, { currency: 'USD', amount: '400' }]);
      expect(model.weightedByCurrency).toEqual([{ currency: 'IDR', amount: '500' }, { currency: 'USD', amount: '200' }]);
    });

    it('a stage whose deals do not reconcile leaves the pipeline split unavailable', () => {
      const model = projectFunnelModel(mixedStages, [...deals, makeDeal('Tender Submitted', 'IDR', 5)], 'IDR');
      expect(model.stageProjections.find((p) => p.status === 'Tender Submitted')?.split.totals).toBeNull();
      expect(model.openByCurrency).toBeNull();
      expect(model.weightedByCurrency).toBeNull();
    });
  });
});
