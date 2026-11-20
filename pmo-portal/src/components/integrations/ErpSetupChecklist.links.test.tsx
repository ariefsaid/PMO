import { describe, expect, it, vi } from 'vitest';
import { createEvent, fireEvent, render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, useLocation } from 'react-router';

const setup = vi.hoisted(() => ({
  getErpSetup: vi.fn(async () => ({
    defaults: { company: 'Example Company', default_receivable_account: null, default_activity_type: null },
    domains: [],
    unmappedProjects: [],
    budgetMappedCategories: [],
    unlinkedEmployeeCount: 2,
  })),
}));
vi.mock('@/src/lib/repositories', () => ({ repositories: { integrations: setup } }));
vi.mock('./ProjectMatchReview', () => ({ ProjectMatchReview: () => null }));
vi.mock('./ConnectProposalReview', () => ({ ConnectProposalReview: () => null }));

import { ErpSetupChecklist } from './ErpSetupChecklist';

function Where() {
  const loc = useLocation();
  return <output data-testid="where">{loc.pathname}</output>;
}

function renderChecklist() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={['/integrations']}>
        <ErpSetupChecklist orgId="org-1" onRefreshCompany={() => {}} />
        <Where />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('ErpSetupChecklist internal links (#2077)', () => {
  it('following an internal link changes the route in-app: the click is handled by the router, not left to a document reload', async () => {
    renderChecklist();
    const link = await screen.findByRole('link', { name: 'Review companies' });
    expect(link).toHaveAttribute('href', '/companies');
    const click = createEvent.click(link, { button: 0 });
    fireEvent(link, click);
    // A plain <a href> leaves the click un-prevented (full navigation); the router prevents it.
    expect(click.defaultPrevented).toBe(true);
    expect(screen.getByTestId('where')).toHaveTextContent('/companies');
  });

  it('the employee-review link also navigates in-app', async () => {
    renderChecklist();
    const link = await screen.findByRole('link', { name: 'Review employee links' });
    const click = createEvent.click(link, { button: 0 });
    fireEvent(link, click);
    expect(click.defaultPrevented).toBe(true);
    expect(screen.getByTestId('where')).toHaveTextContent('/approvals');
  });
});
