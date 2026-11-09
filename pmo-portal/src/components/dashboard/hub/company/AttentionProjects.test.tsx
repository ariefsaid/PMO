import React from 'react';
import { describe, expect, it } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import type { AttentionProject } from '@/src/lib/db/dashboard';
import { AttentionProjects } from './AttentionProjects';

const row = (over: Partial<AttentionProject>): AttentionProject => ({
  id: 'x', name: 'X', client_name: null, contract_value: 1000, currency: 'USD', budget: null, spent: null, status: 'Ongoing',
  attention_signals: 1, overdue_items: 0, overdue_tasks: 0, overdue_milestones: 0, overdue_invoices: 0, waiting_approvals: 0,
  over_budget: false, budget_used_ratio: null, ...over,
} as AttentionProject);

describe('AttentionProjects ranking rule', () => {
  it('lists projects in the order the server ranked them (most distinct signals first) and never re-sorts', () => {
    render(<MemoryRouter><AttentionProjects projects={[
      row({ id: 'a', name: 'Alpha', attention_signals: 3, overdue_items: 2, over_budget: true, budget_used_ratio: 1.2, waiting_approvals: 1 }),
      row({ id: 'b', name: 'Bravo', attention_signals: 1, waiting_approvals: 2, contract_value: 9e9 }),
      row({ id: 'c', name: 'Charlie', attention_signals: 1, overdue_items: 1, contract_value: 1 }),
    ]} /></MemoryRouter>);
    const items = within(screen.getByRole('list', { name: /need attention/i })).getAllByRole('listitem');
    expect(items.map((li) => li.textContent)).toEqual([
      expect.stringMatching(/Alpha.*2 overdue.*1 awaiting approval.*20% over budget/),
      expect.stringMatching(/Bravo.*2 awaiting approval/),
      expect.stringMatching(/Charlie.*1 overdue/),
    ]);
    expect(screen.getByRole('link', { name: /Alpha/ })).toHaveAttribute('href', '/projects/a');
  });

  it('shows an all-clear line when nothing needs attention', () => {
    render(<MemoryRouter><AttentionProjects projects={[]} /></MemoryRouter>);
    expect(screen.getByText(/nothing needs attention/i)).toBeInTheDocument();
  });
});
