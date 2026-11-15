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
const deal = (status: string): PipelineProject => ({ id: status, status, currency: 'USD', contract_value: 1 } as PipelineProject);

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
});
