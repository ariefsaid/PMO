import { describe, it, expect } from 'vitest';
import type { PipelineProject, PipelineStage } from '@/src/lib/db/dashboard';
import { splitStageByCurrency, sumByCurrency } from '../pipelineCurrencySplit';

/**
 * #2199 item 1: a stage's per-currency totals come from the open deals (the full open population),
 * in exact decimals, and are used only when they reconcile with the stage aggregate.
 */
const stage = (status: string, count: number, total_value: number, weighted_value: number | null): PipelineStage => ({
  status: status as PipelineStage['status'], count, total_value, weighted_value: weighted_value as number, win_probability: 0.5,
});
const deal = (status: string, currency: string, contract_value: number, go: number | undefined, get: number | undefined, win = 0): PipelineProject => ({
  id: `${status}-${currency}-${contract_value}`, status, currency, contract_value,
  go_probability: go, get_probability: get, win_probability: win,
} as PipelineProject);

describe('splitStageByCurrency (#2199)', () => {
  it('splits a two-currency stage into exact per-currency totals and weighted values, org currency first', () => {
    const deals = [
      deal('Tender Submitted', 'USD', 9000, 0.5, 0.5),
      deal('Tender Submitted', 'IDR', 1_250_000_000, 0.75, 0.6),
      deal('Tender Submitted', 'USD', 1000.1, 0.5, 0.5),
    ];
    const split = splitStageByCurrency(stage('Tender Submitted', 3, 1_250_010_000.1, 2250 + 562_500_000 + 250.025), deals, 'IDR');
    expect(split.totals).toEqual([
      { currency: 'IDR', amount: '1250000000' },
      { currency: 'USD', amount: '10000.1' },
    ]);
    expect(split.weighted).toEqual([
      { currency: 'IDR', amount: '562500000' },
      { currency: 'USD', amount: '2500.025' },
    ]);
  });

  it('sums without float drift (0.1 + 0.2 is exactly 0.3)', () => {
    const deals = [deal('Leads', 'USD', 0.1, 1, 1), deal('Leads', 'USD', 0.2, 1, 1), deal('Leads', 'IDR', 5, 1, 1)];
    const split = splitStageByCurrency(stage('Leads', 3, 5.3, 5.3), deals, 'USD');
    expect(split.totals).toEqual([{ currency: 'USD', amount: '0.3' }, { currency: 'IDR', amount: '5' }]);
  });

  it('falls back to the deal win probability when go and get are not on the row', () => {
    const deals = [deal('Leads', 'USD', 100, undefined, undefined, 0.25), deal('Leads', 'IDR', 200, undefined, undefined, 0.5)];
    const split = splitStageByCurrency(stage('Leads', 2, 300, 125), deals, 'USD');
    expect(split.weighted).toEqual([{ currency: 'USD', amount: '25' }, { currency: 'IDR', amount: '100' }]);
  });

  it('is unavailable when the deal count does not match the stage aggregate', () => {
    const deals = [deal('Leads', 'USD', 100, 1, 1), deal('Leads', 'IDR', 200, 1, 1)];
    const split = splitStageByCurrency(stage('Leads', 3, 300, 300), deals, 'USD');
    expect(split).toEqual({ totals: null, weighted: null });
  });

  it('is unavailable when the deal values do not add up to the stage total (to the cent)', () => {
    const deals = [deal('Leads', 'USD', 100, 1, 1), deal('Leads', 'IDR', 200, 1, 1)];
    expect(splitStageByCurrency(stage('Leads', 2, 300.01, 300), deals, 'USD').totals).toBeNull();
  });

  it('keeps the totals but drops the weighted split when the weighted values do not reconcile', () => {
    const deals = [deal('Leads', 'USD', 100, 0.5, 1), deal('Leads', 'IDR', 200, 0.5, 1)];
    const split = splitStageByCurrency(stage('Leads', 2, 300, 151), deals, 'USD');
    expect(split.totals).not.toBeNull();
    expect(split.weighted).toBeNull();
  });

  it('accepts a weighted aggregate that differs by under a cent (the JSON number cannot carry every digit)', () => {
    const deals = [deal('Leads', 'USD', 100.01, 0.333, 0.777), deal('Leads', 'IDR', 1, 1, 1)];
    // 100.01 x 0.333 x 0.777 = 25.87668741 (exact); the aggregate here is off by a fraction of a cent.
    const split = splitStageByCurrency(stage('Leads', 2, 101.01, 26.879), deals, 'USD');
    expect(split.weighted?.[0]).toEqual({ currency: 'USD', amount: '25.87668741' });
  });

  it('is unavailable for the weighted split when the aggregate weighted value is null', () => {
    const deals = [deal('Leads', 'USD', 100, 1, 1), deal('Leads', 'IDR', 200, 1, 1)];
    expect(splitStageByCurrency(stage('Leads', 2, 300, null), deals, 'USD').weighted).toBeNull();
  });

  it('is unavailable when a deal value cannot be read as an exact decimal', () => {
    const deals = [deal('Leads', 'USD', 1e21, 1, 1), deal('Leads', 'IDR', 1, 1, 1)];
    expect(splitStageByCurrency(stage('Leads', 2, 1e21 + 1, 1e21 + 1), deals, 'USD')).toEqual({ totals: null, weighted: null });
  });

  it('a stage the aggregate omits with no deals is an empty, complete split', () => {
    expect(splitStageByCurrency(undefined, [], 'USD')).toEqual({ totals: [], weighted: [] });
  });

  it('a stage the aggregate omits while deals sit in it is unavailable', () => {
    expect(splitStageByCurrency(undefined, [deal('Leads', 'USD', 1, 1, 1)], 'USD')).toEqual({ totals: null, weighted: null });
  });
});

describe('sumByCurrency (#2199)', () => {
  it('adds per-currency amounts across stages exactly, org currency first', () => {
    expect(sumByCurrency([
      [{ currency: 'USD', amount: '0.1' }, { currency: 'IDR', amount: '5' }],
      [{ currency: 'USD', amount: '0.2' }],
      [],
    ], 'IDR')).toEqual([{ currency: 'IDR', amount: '5' }, { currency: 'USD', amount: '0.3' }]);
  });

  it('is unavailable when any stage split is unavailable', () => {
    expect(sumByCurrency([[{ currency: 'USD', amount: '1' }], null], 'USD')).toBeNull();
  });
});
