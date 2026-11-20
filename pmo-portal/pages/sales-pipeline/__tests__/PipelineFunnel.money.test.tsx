import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import type { PipelineProject, PipelineStage } from '@/src/lib/db/dashboard';
import { PipelineFunnel } from '../PipelineFunnel';
import { projectFunnelModel } from '../pipelineFunnelModel';

const stage = (status: string, count: number, total_value: number, weighted_value: number | null): PipelineStage =>
  ({ status, count, total_value, weighted_value, win_probability: 0.5 }) as unknown as PipelineStage;
const deal = (status: string, currency: string, contract_value: number): PipelineProject =>
  ({ id: `${status}-${currency}-${contract_value}`, name: 'Deal', status, currency, contract_value, win_probability: 0.5 }) as unknown as PipelineProject;

const norm = (s: string | null | undefined) => (s ?? '').replace(/[\u00a0\u202f]/g, ' ');

function renderFunnel(stages: PipelineStage[], projects: PipelineProject[]) {
  const projection = projectFunnelModel(stages, projects, 'USD');
  return render(<PipelineFunnel projection={projection} onSelectStage={vi.fn()} stageLabel={(c) => c.statuses[0]} />);
}
const cell = (name: string) => screen.getByText(name).closest('[data-funnel-stage]') as HTMLElement;
const amount = (name: string) => cell(name).querySelector('[data-funnel-stage-amount]') as HTMLElement;

describe('PipelineFunnel money (#2199)', () => {
  it('a weighted value under one unit reads its exact value, not $0', () => {
    renderFunnel([stage('Leads', 1, 1, 0.25)], [deal('Leads', 'USD', 1)]);
    expect(norm(cell('Leads').querySelector('[data-funnel-stage-weighted]')?.textContent)).toContain('$0.25');
    expect(norm(cell('Leads').querySelector('[data-funnel-stage-weighted]')?.textContent)).not.toContain('$0 ');
  });

  it('a weighted value with many decimals still shows its whole-unit figure', () => {
    renderFunnel([stage('Leads', 1, 1234.5678, 160000.123456)], [deal('Leads', 'USD', 1235)]);
    expect(norm(cell('Leads').querySelector('[data-funnel-stage-weighted]')?.textContent)).toContain('$160,000');
  });

  it('a stage the aggregate omits while a deal sits in it reads unavailable, never zero', () => {
    renderFunnel([stage('PQ Submitted', 1, 500, 250)], [deal('PQ Submitted', 'USD', 500), deal('Leads', 'USD', 100)]);
    const leads = amount('Leads');
    expect(leads.textContent).toContain('Not available');
    expect(leads.textContent).not.toMatch(/\$0/);
    expect(cell('Leads').querySelector('[data-funnel-stage-weighted]')).toBeNull();
    expect(cell('Leads').querySelector('[data-funnel-stage-bar]')).toBeNull();
  });

  it('a null weighted figure reads unavailable, never zero', () => {
    renderFunnel([stage('Leads', 1, 100, null)], [deal('Leads', 'USD', 100)]);
    expect(amount('Leads').textContent).toContain('Not available');
    expect(cell('Leads').querySelector('[data-funnel-stage-weighted]')).toBeNull();
  });

  it('a stage that holds no deals reads a true zero', () => {
    renderFunnel([stage('PQ Submitted', 1, 500, 250)], [deal('PQ Submitted', 'USD', 500)]);
    expect(norm(amount('Leads').textContent)).toBe('$0');
  });

  it('a stage holding two currencies reads the org currency first and one line per other currency', () => {
    renderFunnel(
      [stage('Leads', 3, 5300, 0)],
      [deal('Leads', 'USD', 1000), deal('Leads', 'USD', 1000), deal('Leads', 'IDR', 5_000_000)],
    );
    const lines = Array.from(amount('Leads').children).map((n) => norm(n.textContent));
    expect(lines).toEqual(['$2,000', '+ IDR 5,000,000']);
  });
});
