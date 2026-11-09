import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { ActiveProjectsTable } from './ActiveProjectsTable';
import type { ProjectWithRefs } from '@/src/lib/db/projects';
import type { AttentionProject, BudgetReviewRow } from '@/src/lib/db/dashboard';

vi.mock('@/src/hooks/useProjectsDelivery', () => ({
  useProjectsDeliverySummary: () => ({ isPending: false, isError: false, data: { '3': { deliveryPct: 40 } } }),
}));

const project = (id: string, over: Partial<ProjectWithRefs> = {}) => ({ id, name: `Project ${id}`, short_name: null, status: 'Ongoing Project', currency: 'USD', contract_value: 1000, client: { name: 'Client' }, pm: { full_name: 'Dana Smith' }, ...over }) as ProjectWithRefs;
const attn = (id: string, over: Partial<AttentionProject>) => ({ id, overdue_items: 0, waiting_approvals: 0, over_budget: false, budget_used_ratio: null, ...over }) as AttentionProject;
const budget = (id: string, spent: number) => ({ id, name: id, status: 'Ongoing Project', currency: 'USD', budget_currency: 'USD', actual_currency: 'USD', actual_complete: true, budget: 100, spent, variance: spent - 100 }) as BudgetReviewRow;

describe('ActiveProjectsTable', () => {
  const all = Array.from({ length: 7 }, (_, i) => project(String(i + 1), { contract_value: i === 2 ? 1_500_000 : 100 * (i + 1) }));
  const renderTable = () => render(<MemoryRouter><ActiveProjectsTable projects={[...all, project('x', { status: 'Leads' })]} budgets={[budget('3', 104)]} attention={[attn('3', { over_budget: true, budget_used_ratio: 1.04 })]} /></MemoryRouter>);

  it('lists the at-risk project first, five of the active ones, and the budget used', () => {
    renderTable();
    expect(screen.getByText('Showing 5 of 7')).toBeInTheDocument();
    expect(screen.getAllByRole('row')[1]).toHaveTextContent('Project 3');
    expect(screen.getAllByRole('row')[1]).toHaveTextContent('104%');
    expect(screen.queryByText('Project x')).toBeNull();
  });

  it('Status shows the attention signal for a flagged project and the lifecycle status otherwise; budget bar is named for the Active budget', () => {
    renderTable();
    const rows = screen.getAllByRole('row');
    expect(rows[1]).toHaveTextContent('4% over budget');
    expect(rows[2]).toHaveTextContent('Ongoing Project');
    expect(screen.getByRole('progressbar', { name: '104% of Active budget' })).toBeInTheDocument();
  });

  it('Progress comes from the delivery summary, and "No phases yet" stands in when there is none', () => {
    renderTable();
    expect(screen.getByRole('progressbar', { name: 'Delivery 40%' })).toBeInTheDocument();
    expect(screen.getAllByRole('img', { name: 'No phases yet' }).length).toBeGreaterThan(0);
  });

  it('shows the contract compactly with the exact amount on hover', () => {
    renderTable();
    expect(screen.getByText('$1.5M')).toHaveAttribute('title', expect.stringMatching(/1,500,000/));
  });

  it('All lists every active project', () => {
    renderTable();
    fireEvent.click(screen.getByRole('button', { name: 'All' }));
    expect(screen.getByText('Showing 7 of 7')).toBeInTheDocument();
  });
});
