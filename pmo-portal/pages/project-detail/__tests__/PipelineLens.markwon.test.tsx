import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import React from 'react';
import { ToastProvider } from '@/src/components/ui';
import { ImpersonationProvider } from '@/src/auth/impersonation';
import { formatCurrencyAuto } from '@/src/lib/format';
import type { ProjectWithRefs } from '@/src/lib/db/projects';

/**
 * AC-IXD-DASH-005 (Area 4, plan task 21): confirm against the money. The mark-won capture panel
 * shows the contract value once with its tax basis above the contract-ref / date inputs, so the
 * user confirms against the actual figure before committing the win.
 */

const { transitionProject, invalidateQueries } = vi.hoisted(() => ({
  transitionProject: vi.fn().mockResolvedValue(undefined),
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
  tax_treatment: 'inclusive',
  tax_rate: 11,
  tax_base_numerator: 100,
  tax_base_denominator: 111,
  client: { name: 'Acme' },
  pm: { full_name: 'Alice Manager' },
} as unknown as ProjectWithRefs;

const renderLens = () =>
  render(
    <ImpersonationProvider realRole="Project Manager">
      <ToastProvider>
        <PipelineLens project={dealRow} />
      </ToastProvider>
    </ImpersonationProvider>,
  );

beforeEach(() => {
  transitionProject.mockClear();
  invalidateQueries.mockClear();
});

describe('PipelineLens — mark-won shows the booked value (AC-IXD-DASH-005)', () => {
  it('AC-IXD-DASH-005: the capture shows the exact amount and basis once and clears the shared primary', async () => {
    const onPrimaryActionChange = vi.fn();
    render(
      <ImpersonationProvider realRole="Project Manager">
        <ToastProvider>
          <PipelineLens project={dealRow} onPrimaryActionChange={onPrimaryActionChange} />
        </ToastProvider>
      </ImpersonationProvider>,
    );
    await userEvent.click(screen.getByRole('button', { name: /Mark won/i }));

    // The inline capture moves the decision amount into the primary evidence position and
    // removes the separate amount band / Advance action while that decision is in progress.
    const refInput = screen.getByLabelText(/Customer contract reference/i);
    expect(refInput).toBeInTheDocument();
    const formatted = formatCurrencyAuto(CONTRACT_VALUE, 'USD');
    expect(screen.getAllByText(formatted)).toHaveLength(1);
    expect(screen.getByTestId('tax-basis')).toHaveTextContent(/incl\. PPN/i);
    expect(screen.getByText(/This contract value is recorded when you confirm the win/i)).toBeInTheDocument();
    expect(screen.queryByTestId('pipeline-contract-value')).not.toBeInTheDocument();
    await vi.waitFor(() => expect(onPrimaryActionChange).toHaveBeenLastCalledWith(null));
  });
});

describe('PipelineLens — a transition refreshes the detail page (AC-OVERFETCH-001)', () => {
  it('AC-OVERFETCH-001: Advance invalidates the project detail key the page reads', async () => {
    renderLens();
    await userEvent.click(screen.getByRole('button', { name: /Advance/i }));
    await vi.waitFor(() => expect(transitionProject).toHaveBeenCalled());
    await vi.waitFor(() =>
      expect(invalidateQueries).toHaveBeenCalledWith({ queryKey: ['project', 'org-1', 'd1'] }),
    );
  });
});
