import React from 'react';
import { describe, expect, it } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { ActiveProjectsTable } from './ActiveProjectsTable';
import type { ProjectWithRefs } from '@/src/lib/db/projects';
import type { BudgetReviewRow } from '@/src/lib/db/dashboard';

const project = (id: string, over: Partial<ProjectWithRefs> = {}) => ({ id, name: `Project ${id}`, short_name: null, status: 'Ongoing Project', currency: 'USD', contract_value: 1000, client: { name: 'Client' }, pm: { full_name: 'Dana Smith' }, ...over }) as ProjectWithRefs;
const budget = (id: string, spent: number) => ({ id, name: id, status: 'Ongoing Project', currency: 'USD', budget_currency: 'USD', actual_currency: 'USD', actual_complete: true, budget: 100, spent, variance: spent - 100 }) as BudgetReviewRow;

describe('ActiveProjectsTable', () => {
  const all = Array.from({ length: 7 }, (_, i) => project(String(i + 1), { contract_value: 100 * (i + 1) }));
  const renderTable = () => render(<MemoryRouter><ActiveProjectsTable projects={[...all, project('x', { status: 'Leads' })]} budgets={[budget('3', 104)]} attentionIds={['3']} statusVariant={() => 'neutral'} /></MemoryRouter>);

  it('lists the at-risk project first, five of the active ones, and the budget used', () => {
    renderTable();
    expect(screen.getByText('Showing 5 of 7')).toBeInTheDocument();
    expect(screen.getAllByRole('row')[1]).toHaveTextContent('Project 3');
    expect(screen.getAllByRole('row')[1]).toHaveTextContent('104%');
    expect(screen.queryByText('Project x')).toBeNull();
  });

  it('All lists every active project', () => {
    renderTable();
    fireEvent.click(screen.getByRole('button', { name: 'All' }));
    expect(screen.getByText('Showing 7 of 7')).toBeInTheDocument();
  });
});
