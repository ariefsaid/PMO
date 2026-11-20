import { describe, expect, it } from 'vitest';
import type { PipelineProject, PipelineStage } from '@/src/lib/db/dashboard';
import { projectFunnelModel } from '../sales-pipeline/pipelineFunnelModel';
import { pipelineFigures } from './salesLogic';
import type { SalesModel } from './useSalesModel';

const norm = (lines: string[]) => lines.map((l) => l.replace(/[  ]/g, ' '));
const stage = (status: string, count: number, total_value: number, weighted_value: number | null) =>
  ({ status, count, total_value, weighted_value, win_probability: 0.5 }) as unknown as PipelineStage;
const deal = (status: string, currency: string, contract_value: number, go = 0.5) =>
  ({ id: `${currency}${contract_value}`, status, currency, contract_value, go_probability: go, get_probability: 1, win_probability: go }) as unknown as PipelineProject;
const model = (stages: PipelineStage[], projects: PipelineProject[]) =>
  ({ funnel: projectFunnelModel(stages, projects, 'USD') }) as unknown as SalesModel;

describe('pipelineFigures (#2199)', () => {
  it('a weighted forecast under one unit reads exactly, on the tile and in its exact twin', () => {
    const f = pipelineFigures(model([stage('Leads', 1, 1, 0.25)], [deal('Leads', 'USD', 1)]));
    expect(norm(f.weighted!.lines)).toEqual(['$0.25']);
    expect(norm(f.weighted!.exact)).toEqual(['$0.25']);
  });

  it('a weighted forecast with more than two decimals keeps a whole-unit exact twin', () => {
    const f = pipelineFigures(model([stage('Leads', 1, 1_000_000, 160000.123456)], [deal('Leads', 'USD', 1_000_000)]));
    expect(norm(f.weighted!.lines)).toEqual(['$160K']);
    expect(norm(f.weighted!.exact)).toEqual(['$160,000']);
  });

  it('mixed currencies: the org currency is the figure, each other currency a second line, nothing summed', () => {
    const f = pipelineFigures(model(
      [stage('Leads', 3, 0, 0)],
      [deal('Leads', 'USD', 5300), deal('Leads', 'IDR', 2_000_000_000, 0.25)],
    ));
    expect(norm(f.open.lines)).toEqual(['$5.3K', '+ IDR 2B']);
    expect(norm(f.open.exact)).toEqual(['$5,300', '+ IDR 2,000,000,000']);
    expect(norm(f.weighted!.lines)).toEqual(['$2.65K', '+ IDR 500M']);
  });

  it('an unreported stage forecast makes the weighted figure unknown, not zero', () => {
    const f = pipelineFigures(model([stage('Leads', 1, 100, null)], [deal('Leads', 'USD', 100)]));
    expect(f.weighted).toBeNull();
    expect(norm(f.open.lines)).toEqual(['$100']);
  });
});
