import { describe, it, expect } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import React from 'react';
import type { PipelineProject, PipelineStage } from '@/src/lib/db/dashboard';
import { PipelineFunnel } from '../PipelineFunnel';
import { projectFunnelModel } from '../pipelineFunnelModel';

/** #2199: the funnel band's money follows screen rules, Numbers (no non-zero as 0, unknown is not 0). */
const stage = (status: string, total_value: number, weighted_value: number | null, count = 1): PipelineStage => ({
  status: status as PipelineStage['status'], count, total_value, weighted_value: weighted_value as number, win_probability: 0.1,
});
const deal = (status: string, currency = 'USD', contract_value = 1, win_probability = 0.1): PipelineProject =>
  ({ id: `${status}-${currency}-${contract_value}`, status, currency, contract_value, win_probability } as PipelineProject);

const renderBand = (stages: PipelineStage[], deals: PipelineProject[] = []) =>
  render(
    <PipelineFunnel
      projection={projectFunnelModel(stages, deals, 'USD')}
      onSelectStage={() => {}}
      stageLabel={(col) => col.title}
    />,
  );

const stageCell = (index: number) => screen.getAllByRole('button')[index];

describe('PipelineFunnel money (#2199)', () => {
  it('a weighted value under one unit shows its exact value, not $0', () => {
    renderBand([stage('Leads', 1, 0.25)]);
    expect(within(stageCell(0)).getByText('$0.25 weighted')).toBeInTheDocument();
  });

  it('a stage missing from the aggregate while it holds deals reads unavailable, not $0', () => {
    renderBand([stage('Leads', 100, 10)], [deal('Leads'), deal('Negotiation')]);
    const negotiation = stageCell(4);
    expect(within(negotiation).queryByText('$0')).toBeNull();
    expect(within(negotiation).getByText('Stage figure missing')).toHaveClass('sr-only');
  });

  it('a null weighted value reads unavailable, while the stage total still shows', () => {
    renderBand([stage('Leads', 100, null)]);
    const leads = stageCell(0);
    expect(within(leads).getByText('$100')).toBeInTheDocument();
    expect(within(leads).queryByText(/\$0 weighted/)).toBeNull();
    expect(within(leads).getByText('Stage figure missing')).toHaveClass('sr-only');
  });

  it('a stage with no deals still reads a real zero', () => {
    renderBand([stage('Leads', 100, 10)]);
    expect(within(stageCell(1)).getByText('$0')).toBeInTheDocument();
  });

  it('#2199 item 1: a two-currency stage that reconciles shows each currency on its own line, not a dash', () => {
    renderBand([stage('Leads', 1100, 110, 2)], [deal('Leads', 'USD', 100), deal('Leads', 'IDR', 1000)]);
    const leads = stageCell(0);
    const amount = leads.querySelector('[data-funnel-stage-amount]') as HTMLElement;
    const lines = [...amount.querySelectorAll('[data-currency-line]')].map((line) => line.textContent?.replace(/\u00a0/g, ' '));
    expect(lines).toEqual(['$100', '+ IDR 1,000']);
    expect(within(leads).queryByText('Mixed currencies')).toBeNull();
    const weighted = leads.querySelector('[data-funnel-stage-weighted]') as HTMLElement;
    expect([...weighted.querySelectorAll('[data-currency-line]')].map((line) => line.textContent?.replace(/\u00a0/g, ' ')))
      .toEqual(['$10 weighted', '+ IDR 100 weighted']);
  });

  it('#2199 item 1: a two-currency stage that does not reconcile keeps the dash and its reason', () => {
    renderBand([stage('Leads', 1100, 110, 3)], [deal('Leads', 'USD', 100), deal('Leads', 'IDR', 1000)]);
    const amount = stageCell(0).querySelector('[data-funnel-stage-amount]') as HTMLElement;
    expect(amount).toHaveTextContent('—');
    expect(within(amount).getByText('Mixed currencies')).toHaveClass('sr-only');
  });

  it('an amount the formatter cannot read is not reported as a missing stage figure', () => {
    renderBand([stage('Leads', 1, 0.5)], [{ ...deal('Leads'), currency: 'usd' } as PipelineProject]);
    const leads = stageCell(0);
    expect(within(leads).queryByText('Stage figure missing')).toBeNull();
    expect(within(leads).getAllByText('Amount cannot be shown')[0]).toHaveClass('sr-only');
  });
});
