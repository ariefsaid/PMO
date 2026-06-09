import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import React from 'react';
import { ToastProvider } from '@/src/components/ui';
import { ImpersonationProvider } from '@/src/auth/impersonation';
import { formatCurrency } from '@/src/lib/format';
import type { ProjectWithRefs } from '@/src/lib/db/projects';

/**
 * AC-IXD-DASH-005 (Area 4, plan task 21): confirm against the money. The mark-won capture panel
 * shows the value being booked ("Booking $X to contract value on win") above the contract-ref /
 * date inputs, so the user confirms against the actual figure before committing the win.
 */

const { transitionProject } = vi.hoisted(() => ({
  transitionProject: vi.fn().mockResolvedValue(undefined),
}));
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
        contract_value: CONTRACT_VALUE,
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
  return { ...actual, useQueryClient: () => ({ invalidateQueries: vi.fn() }) };
});

import PipelineLens from '../PipelineLens';

const dealRow = {
  id: 'd1',
  name: 'Acme Tender Bid',
  code: 'OPP-0042',
  status: 'Tender Submitted',
  client_id: 'c1',
  project_manager_id: 'u-alice',
  contract_value: CONTRACT_VALUE,
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
    <ImpersonationProvider realRole="Project Manager">
      <ToastProvider>
        <PipelineLens project={dealRow} />
      </ToastProvider>
    </ImpersonationProvider>,
  );

beforeEach(() => {
  transitionProject.mockClear();
});

describe('PipelineLens — mark-won shows the booked value (AC-IXD-DASH-005)', () => {
  it('AC-IXD-DASH-005: the won-capture panel states the value being booked to contract value', async () => {
    renderLens();
    await userEvent.click(screen.getByRole('button', { name: /Mark won/i }));

    // The capture panel restates the figure the user is committing against.
    const refInput = screen.getByLabelText(/Customer contract reference/i);
    expect(refInput).toBeInTheDocument();
    // "Booking $1,200,000 to contract value on win" — the money is shown before confirming.
    // The phrase spans inline elements (the amount is bolded), so assert the wrapper carries the
    // full sentence (textContent stitches the inline <strong>) and that the amount is the bolded run.
    const formatted = formatCurrency(CONTRACT_VALUE);
    const bookingLine = screen.getByText(
      (content) => /^Booking\b/.test(content.trim()),
      { selector: 'div' },
    );
    expect(bookingLine).toHaveTextContent(
      new RegExp(`Booking\\s*${formatted.replace(/[$,]/g, '\\$&')}\\s*to contract value on win`, 'i'),
    );
  });
});
