import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
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

import DealBand from '../../sales/DealBand';

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
          <DealBand project={project} />
        </ToastProvider>
      </ImpersonationProvider>
    </MemoryRouter>,
  );


const phone = () => vi.stubGlobal('matchMedia', vi.fn().mockImplementation((query: string) => ({
  matches: false, media: query, onchange: null,
  addEventListener: vi.fn(), removeEventListener: vi.fn(), addListener: vi.fn(), removeListener: vi.fn(), dispatchEvent: vi.fn(),
})));

beforeEach(() => {
  transitionProject.mockClear();
  transitionProject.mockResolvedValue(undefined);
  phone();
});
afterEach(() => vi.unstubAllGlobals());

describe('DealBand at phone width (#2389)', () => {
  it('AC-2389-1: mark a deal lost with a reason from the phone action menu', async () => {
    renderLens();
    await userEvent.click(screen.getByRole('button', { name: /More actions/i }));
    await userEvent.click(await screen.findByRole('menuitem', { name: /Mark lost/i }));
    const dialog = await screen.findByRole('alertdialog');
    const confirmBtn = within(dialog).getByRole('button', { name: /Mark lost/i });
    expect(confirmBtn).toBeDisabled();
    await userEvent.selectOptions(within(dialog).getByRole('combobox', { name: /Reason/i }), 'price');
    await userEvent.click(confirmBtn);
    await waitFor(() => expect(transitionProject).toHaveBeenCalledWith('d1', 'Loss Tender', { lostReason: 'price', lostNote: undefined }));
  });

  it('AC-2389-1: Decline to bid is reachable from the phone action menu', async () => {
    renderLens();
    await userEvent.click(screen.getByRole('button', { name: /More actions/i }));
    await userEvent.click(await screen.findByRole('menuitem', { name: /Decline to bid/i }));
    expect(await screen.findByRole('alertdialog')).toBeInTheDocument();
  });

  it('AC-2389-2: Mark won (contract reference, date) is reachable where desktop offers it', async () => {
    renderLens();
    await userEvent.click(screen.getByRole('button', { name: /More actions/i }));
    await userEvent.click(await screen.findByRole('menuitem', { name: /Mark won/i }));
    expect(await screen.findByLabelText(/Customer contract reference/i)).toBeVisible();
    expect(screen.getByLabelText(/Contract date/i)).toBeVisible();
    expect(screen.getByText(/Booking/i)).toBeInTheDocument();
  });

  it('AC-2389-3: Mark won is offered at Quotation Submitted, as the stage-move list (#2379) allows', async () => {
    renderLens({ ...dealRow, status: 'Quotation Submitted' } as ProjectWithRefs);
    await userEvent.click(screen.getByRole('button', { name: /More actions/i }));
    expect(await screen.findByRole('menuitem', { name: /Mark won/i })).toBeInTheDocument();
    expect(screen.getByRole('menuitem', { name: /Mark lost/i })).toBeInTheDocument();
  });

  it('AC-2389-3: a stage where desktop offers no Mark won (PQ Submitted) offers none in the phone menu either', async () => {
    renderLens({ ...dealRow, status: 'PQ Submitted' } as ProjectWithRefs);
    await userEvent.click(screen.getByRole('button', { name: /More actions/i }));
    expect(await screen.findByRole('menuitem', { name: /Mark lost/i })).toBeInTheDocument();
    expect(screen.queryByRole('menuitem', { name: /Mark won/i })).toBeNull();
  });
});
