import React from 'react';
import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router';
import type { PipelineStage } from '@/src/lib/db/dashboard';
import { SalesFunnel } from './SalesFunnel';

const stage = (status: string, count: number, weighted: number): PipelineStage =>
  ({ status, count, total_value: weighted * 2, win_probability: 0.5, weighted_value: weighted } as PipelineStage);
const Where = () => <p data-testid="loc">{useLocation().pathname + useLocation().search}</p>;

describe('SalesFunnel', () => {
  const stages = [stage('Leads', 8, 1000), stage('Negotiation', 2, 4000), stage('Ongoing Project', 5, 9), stage('Loss Tender', 3, 0)];

  it('shows the count on every open stage, drops won and lost, and has no repeating stage table', () => {
    render(<MemoryRouter><SalesFunnel stages={stages} currency="USD" /></MemoryRouter>);
    expect(screen.getByRole('button', { name: /Leads/ })).toHaveTextContent('8');
    expect(screen.getByRole('button', { name: /Negotiation/ })).toHaveTextContent('2');
    expect(screen.queryByText(/Ongoing Project|Lost/)).toBeNull();
    expect(screen.queryByRole('table')).toBeNull();
  });

  it('opens the stage on the sales board', async () => {
    render(<MemoryRouter><Routes><Route path="*" element={<><SalesFunnel stages={stages} currency="USD" /><Where /></>} /></Routes></MemoryRouter>);
    await userEvent.click(screen.getByRole('button', { name: /Negotiation/ }));
    expect(screen.getByTestId('loc')).toHaveTextContent('/sales?status=Negotiation');
  });

  it('says there is no open pipeline when no stage is open', () => {
    render(<MemoryRouter><SalesFunnel stages={[]} currency="USD" /></MemoryRouter>);
    expect(screen.getByText(/no open pipeline/i)).toBeInTheDocument();
  });
});
