import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import React from 'react';
import { QueryClient } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router';
import { ToastProvider } from '@/src/components/ui';
import { ImpersonationProvider } from '@/src/auth/impersonation';
import { formatCurrency } from '@/src/lib/format';
import type { ProjectWithRefs } from '@/src/lib/db/projects';

/**
 * AC-IXD-DASH-005 (Area 4, plan task 21): confirm against the money. The mark-won capture panel
 * shows the value being booked ("Booking $X to contract value on win") above the contract-ref /
 * date inputs, so the user confirms against the actual figure before committing the win.
 */

const { transitionProject, repositoryTransition, invalidateQueries } = vi.hoisted(() => ({
  transitionProject: vi.fn().mockResolvedValue(undefined),
  repositoryTransition: vi.fn().mockResolvedValue(undefined),
  invalidateQueries: vi.fn().mockResolvedValue(undefined),
}));
// FR-L10N-020: this component reads useOrgCurrency for its ACROSS-record aggregates. Pinned here
// rather than left to a real query. ⚑ At LINE-START on purpose — inserted inside a neighbouring
// vi.mock call it parses as a syntax error and hides every real error beneath it.
vi.mock('@/src/hooks/useOrgCurrency', () => ({ useOrgCurrency: () => 'USD' }));
vi.mock('@/src/lib/db/projectTransitions', async (orig) => {
  const actual = await (orig() as Promise<Record<string, unknown>>);
  return { ...actual, transitionProject };
});

const winEligibility = vi.hoisted(() => ({ data: 'allowed' as string | undefined, isFetching: false, isError: false }));
vi.mock('@/src/hooks/useProjectTransitions', () => ({ useProjectWinEligibility: () => winEligibility }));

vi.mock('@/src/lib/repositories', async (orig) => {
  const actual = await orig() as typeof import('@/src/lib/repositories');
  return { ...actual, repositories: { ...actual.repositories, project: { ...actual.repositories.project, transition: repositoryTransition } } };
});

const CONTRACT_VALUE = 1200000;

const pipelineState = {
  data: {
    stages: [],
    projects: [
      {
        id: 'd1',
        name: 'Acme Tender Bid',
        status: 'Tender Submitted',
        contract_value: CONTRACT_VALUE, currency: 'USD',
        win_probability: 0.5,
      },
    ] as Array<Record<string, unknown>>,
  },
};
vi.mock('@/src/hooks/useDashboard', () => ({ useSalesPipeline: () => pipelineState }));
vi.mock('@/src/auth/useAuth', () => ({
  useAuth: () => ({ currentUser: { id: 'u-alice', org_id: 'org-1' }, role: 'Project Manager' }),
}));
vi.mock('@tanstack/react-query', async (orig) => {
  const actual = await (orig() as Promise<Record<string, unknown>>);
  return { ...actual, useQueryClient: () => ({ invalidateQueries }) };
});

import PipelineLens from '../PipelineLens';

const dealRow = {
  id: 'd1',
  name: 'Acme Tender Bid',
  code: 'OPP-0042',
  status: 'Tender Submitted',
  client_id: 'c1',
  project_manager_id: 'u-alice',
  contract_value: CONTRACT_VALUE, currency: 'USD',
  budget: 0,
  spent: 0,
  start_date: null,
  end_date: null,
  contract_date: null,
  decided_at: null,
  customer_contract_ref: null,
  client: { name: 'Acme' },
  pm: { full_name: 'Alice Manager' },
} as unknown as ProjectWithRefs;

const renderLens = () =>
  render(
    <MemoryRouter>
      <ImpersonationProvider realRole="Project Manager">
        <ToastProvider>
          <PipelineLens project={dealRow} />
        </ToastProvider>
      </ImpersonationProvider>
    </MemoryRouter>,
  );

beforeEach(() => {
  winEligibility.data = 'allowed';
  winEligibility.isFetching = false;
  winEligibility.isError = false;
  transitionProject.mockClear();
  repositoryTransition.mockClear();
  invalidateQueries.mockReset().mockResolvedValue(undefined);
});

describe('PipelineLens — mark-won shows the booked value (AC-IXD-DASH-005)', () => {
  it('withdraws the open win action until the current decision allows it', async () => {
    const user = userEvent.setup();
    const view = renderLens();
    await user.click(screen.getByRole('button', { name: /Mark won/i }));
    const refresh = () => view.rerender(<MemoryRouter><ImpersonationProvider realRole="Project Manager"><ToastProvider><PipelineLens project={dealRow} /></ToastProvider></ImpersonationProvider></MemoryRouter>);
    winEligibility.isFetching = true; refresh();
    expect(screen.queryByLabelText(/Customer contract reference/i)).not.toBeInTheDocument();
    expect(screen.getAllByText('Checking win eligibility…').length).toBeGreaterThan(0);
    winEligibility.isFetching = false; winEligibility.isError = true; refresh();
    expect(screen.queryByRole('button', { name: /Mark won/i })).not.toBeInTheDocument();
    expect(screen.getAllByText('Win eligibility is unavailable. Refresh this page and try again.').length).toBeGreaterThan(0);
    winEligibility.isError = false; winEligibility.data = 'reviewer_required'; refresh();
    expect(screen.queryByRole('button', { name: /Mark won/i })).not.toBeInTheDocument();
    expect(repositoryTransition).not.toHaveBeenCalled();
    expect(transitionProject).not.toHaveBeenCalled();
    winEligibility.data = 'allowed'; refresh();
    await user.type(screen.getByLabelText(/Customer contract reference/i), 'CPO-RECOVERED');
    await user.type(screen.getByLabelText(/Contract date/i), '2026-03-15');
    await user.click(screen.getByRole('button', { name: /Confirm won/i }));
    expect(repositoryTransition).toHaveBeenCalledWith('d1', 'Won, Pending KoM', { customerContractRef: 'CPO-RECOVERED', contractDate: '2026-03-15' });
  });

  it('asks for a refresh when win eligibility is unavailable', () => {
    winEligibility.data = 'unavailable';
    renderLens();
    expect(screen.queryByRole('button', { name: /Mark won/i })).not.toBeInTheDocument();
    expect(screen.getByText('Win eligibility is unavailable. Refresh this page and try again.')).toBeInTheDocument();
  });

  it('shows review guidance instead of an ineligible win action', () => {
    winEligibility.data = 'reviewer_required';
    renderLens();
    expect(screen.queryByRole('button', { name: /Mark won/i })).not.toBeInTheDocument();
    expect(screen.getByText(/Ask your supervisor or a more senior reviewer/)).toBeInTheDocument();
  });

  it('AC-IXD-DASH-005: the won-capture panel states the value being booked to contract value', async () => {
    renderLens();
    await userEvent.click(screen.getByRole('button', { name: /Mark won/i }));

    // The capture panel restates the figure the user is committing against.
    const refInput = screen.getByLabelText(/Customer contract reference/i);
    expect(refInput).toBeInTheDocument();
    // "Booking $1,200,000 to contract value on win" — the money is shown before confirming.
    // The phrase spans inline elements (the amount is bolded), so assert the wrapper carries the
    // full sentence (textContent stitches the inline <strong>) and that the amount is the bolded run.
    const formatted = formatCurrency(CONTRACT_VALUE, 'USD');
    const bookingLine = screen.getByText(
      (content) => /^Booking\b/.test(content.trim()),
      { selector: 'div' },
    );
    expect(bookingLine).toHaveTextContent(
      new RegExp(`Booking\\s*${formatted.replace(/[$,]/g, '\\$&')}\\s*to contract value on win`, 'i'),
    );
  });
});

describe('PipelineLens — a transition refreshes the detail page (AC-OVERFETCH-001)', () => {
  it('AC-OVERFETCH-001: Advance invalidates the project detail key the page reads', async () => {
    const client = new QueryClient();
    client.setQueryData(['won-deals', 'org-1'], 'old');
    client.setQueryData(['win-rate', 'org-1', 'year'], 'old');
    client.setQueryData(['won-deals', 'org-2'], 'other');
    invalidateQueries.mockImplementation((options) => client.invalidateQueries(options));
    renderLens();
    await userEvent.click(screen.getByRole('button', { name: /Advance/i }));
    await vi.waitFor(() => expect(repositoryTransition).toHaveBeenCalledWith('d1', expect.any(String)));
    await vi.waitFor(() =>
      expect(invalidateQueries).toHaveBeenCalledWith({ queryKey: ['project', 'org-1', 'd1'] }),
    );
    expect(invalidateQueries).toHaveBeenCalledWith({ queryKey: ['won-deals', 'org-1'] });
    expect(invalidateQueries).toHaveBeenCalledWith({ queryKey: ['win-rate', 'org-1'] });
    expect(client.getQueryState(['won-deals', 'org-1'])?.isInvalidated).toBe(true);
    expect(client.getQueryState(['win-rate', 'org-1', 'year'])?.isInvalidated).toBe(true);
    expect(client.getQueryState(['won-deals', 'org-2'])?.isInvalidated).toBe(false);
  });
});
