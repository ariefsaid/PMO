import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import React from 'react';
import { MemoryRouter } from 'react-router';
import { ToastProvider } from '@/src/components/ui';
import { ImpersonationProvider } from '@/src/auth/impersonation';
import type { ProjectWithRefs } from '@/src/lib/db/projects';

const { transitionProject } = vi.hoisted(() => ({
  transitionProject: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('@/src/hooks/useOrgCurrency', () => ({ useOrgCurrency: () => 'USD' }));
vi.mock('@/src/lib/repositories', async (orig) => {
  const actual = (await orig()) as typeof import('@/src/lib/repositories');
  return {
    ...actual,
    repositories: {
      ...actual.repositories,
      project: { ...actual.repositories.project, transition: transitionProject },
    },
  };
});
vi.mock('@/src/lib/db/projectTransitions', async (orig) => {
  const actual = await (orig() as Promise<Record<string, unknown>>);
  return { ...actual, transitionProject };
});

const pipelineState = {
  data: {
    stages: [],
    projects: [
      { id: 'd1', name: 'Acme Tender Bid', status: 'Tender Submitted', contract_value: 1200000, currency: 'USD', win_probability: 0.5 },
    ] as Array<Record<string, unknown>>,
  },
};
vi.mock('@/src/hooks/useDashboard', () => ({ useSalesPipeline: () => pipelineState }));
vi.mock('@/src/hooks/useProjectTransitions', () => ({ useProjectWinEligibility: () => ({ data: 'allowed' }) }));
vi.mock('@/src/hooks/useProjectStageEntries', () => ({
  useProjectStageEntries: () => ({ data: [], isLoading: false, error: null }),
  useStageEntryMutations: () => ({ redate: { mutateAsync: vi.fn() }, addSkipped: { mutateAsync: vi.fn() } }),
}));
vi.mock('@/src/hooks/useOrgToday', () => ({ useOrgToday: () => '2026-11-01' }));
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
  contract_value: 1200000,
  currency: 'USD',
  budget: 0,
  spent: 0,
  start_date: null,
  end_date: null,
  contract_date: null,
  decided_at: null,
  customer_contract_ref: null,
  lost_reason: null,
  lost_note: null,
  client: { name: 'Acme' },
  pm: { full_name: 'Alice Manager' },
} as unknown as ProjectWithRefs;

const renderLens = (project: ProjectWithRefs = dealRow) =>
  render(
    <MemoryRouter>
      <ImpersonationProvider realRole="Project Manager">
        <ToastProvider>
          <PipelineLens project={project} />
        </ToastProvider>
      </ImpersonationProvider>
    </MemoryRouter>,
  );

beforeEach(() => {
  transitionProject.mockClear();
  transitionProject.mockResolvedValue(undefined);
});

describe('PipelineLens - Lost Reason (AC-LR-011, 013, 014)', () => {
  it('AC-LR-011: "Mark lost" confirm shows reason picker, disabled until valid, sends transition with reason', async () => {
    renderLens();
    await userEvent.click(screen.getByRole('button', { name: /Mark lost/i }));

    const dialog = await screen.findByRole('alertdialog');
    expect(dialog).toBeInTheDocument();

    const confirmBtn = within(dialog).getByRole('button', { name: /Mark lost/i });
    expect(confirmBtn).toBeDisabled();

    const reasonSelect = within(dialog).getByRole('combobox', { name: /Reason/i });
    expect(reasonSelect).toHaveValue('');

    await userEvent.selectOptions(reasonSelect, 'price');
    expect(confirmBtn).toBeEnabled();

    await userEvent.click(confirmBtn);
    await waitFor(() => {
      expect(transitionProject).toHaveBeenCalledWith('d1', 'Loss Tender', {
        lostReason: 'price',
        lostNote: undefined,
      });
    });
  });

  it('AC-LR-011: "Decline to bid" confirm shows reason picker, requires note for other, sends transition with reason and note', async () => {
    renderLens();
    await userEvent.click(screen.getByRole('button', { name: /Decline to bid/i }));

    const dialog = await screen.findByRole('alertdialog');
    const confirmBtn = within(dialog).getByRole('button', { name: /Decline to bid/i });
    expect(confirmBtn).toBeDisabled();

    const reasonSelect = within(dialog).getByRole('combobox', { name: /Reason/i });
    await userEvent.selectOptions(reasonSelect, 'other');
    expect(confirmBtn).toBeDisabled();

    const noteInput = within(dialog).getByRole('textbox', { name: /Note/i });
    await userEvent.type(noteInput, 'Client postponed the bid indefinitely');
    expect(confirmBtn).toBeEnabled();

    await userEvent.click(confirmBtn);
    await waitFor(() => {
      expect(transitionProject).toHaveBeenCalledWith('d1', 'Declined', {
        lostReason: 'other',
        lostNote: 'Client postponed the bid indefinitely',
      });
    });
  });

  it('AC-LR-013: rejected transition shows server error message and leaves deal', async () => {
    transitionProject.mockRejectedValueOnce(new Error('P0001: reason is invalid'));
    renderLens();
    await userEvent.click(screen.getByRole('button', { name: /Mark lost/i }));

    const dialog = await screen.findByRole('alertdialog');
    const reasonSelect = within(dialog).getByRole('combobox', { name: /Reason/i });
    await userEvent.selectOptions(reasonSelect, 'price');
    await userEvent.click(within(dialog).getByRole('button', { name: /Mark lost/i }));

    await waitFor(() => {
      expect(screen.getByText(/reason is invalid/i)).toBeInTheDocument();
    });
  });

  it('AC-LR-014: a lost deal with reason and note displays label and note in the stats area', () => {
    const lostDeal = {
      ...dealRow,
      status: 'Loss Tender',
      decided_at: '2026-06-14T23:30:00Z',
      lost_reason: 'price',
      lost_note: 'Competitor undercut by 10%',
    } as ProjectWithRefs;

    renderLens(lostDeal);
    expect(screen.getByText('Lost reason')).toBeInTheDocument();
    expect(screen.getByText('Price')).toBeInTheDocument();
    const noteEl = screen.getByTestId('lost-note');
    expect(noteEl).toHaveTextContent('Competitor undercut by 10%');
  });

  it('AC-LR-014: a historic lost deal with no reason displays "Not recorded" and no note', () => {
    const historicLost = {
      ...dealRow,
      status: 'Loss Tender',
      decided_at: '2026-06-14T23:30:00Z',
      lost_reason: null,
      lost_note: null,
    } as ProjectWithRefs;

    renderLens(historicLost);
    expect(screen.getByText('Lost reason')).toBeInTheDocument();
    expect(screen.getByText('Not recorded')).toBeInTheDocument();
    expect(screen.queryByTestId('lost-note')).toBeNull();
  });

  it('AC-LR-014 / FR-LR-021: an open deal shows neither lost reason nor lost note', () => {
    renderLens(dealRow);
    expect(screen.queryByText('Lost reason')).toBeNull();
    expect(screen.queryByTestId('lost-note')).toBeNull();
  });
});
