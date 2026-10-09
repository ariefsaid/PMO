vi.mock('@/src/hooks/useProjectClassificationOptions', () => ({ useProjectClassificationOptions: () => ({ data: { serviceLines: [], sectors: [] }, isPending: false, isError: false }) }));
/**
 * AC-RAM-006 (#688) / FR-RAM-009 — creating a project from /projects opens its canonical record.
 * Matrix cell R6 × O6 (docs/specs/ris-admin-route-matrix.spec.md). The F-4 ruling (2026-09-28,
 * Director): a successful create names the project AND navigates to `/projects/:id`, matching the
 * Meetings create handler; a failed create stays on /projects with the modal open.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/src/hooks/useOrgTaxDefault', async (orig) => {
  const actual = (await orig()) as Record<string, unknown>;
  return { ...actual, useOrgTaxDefault: () => 'exclusive' };
});

import { render, screen, within, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import React from 'react';
import { ToastProvider } from '@/src/components/ui';
import { findToastAnnouncement } from '@/src/components/ui/__tests__/toastTestQueries';
import { AppError } from '@/src/lib/appError';
import Projects from '../Projects';
import type { ProjectWithRefs } from '@/src/lib/db/projects';

const seed = [
  { id: 'p1', name: 'Innovate Corp HQ Fit-Out', code: 'PRJ-001', status: 'Ongoing Project',
    client_id: 'c2', project_manager_id: 'u-alice', contract_value: 5000000, currency: 'USD', budget: 4700000,
    spent: 2100000, end_date: '2026-12-18', client: { name: 'Innovate Corp' }, pm: { full_name: 'Alice Manager' },
    customer_contract_ref: null, contract_date: null, decided_at: null },
];

const projectsState = { data: seed as unknown as ProjectWithRefs[], isPending: false, isError: false, refetch: vi.fn() };
const { roleBox, projectMutations, deliverySummaryState } = vi.hoisted(() => ({
  roleBox: { value: 'Admin' },
  projectMutations: {
    create: { mutateAsync: vi.fn(), isPending: false },
    updateHeader: { mutateAsync: vi.fn(), isPending: false },
    archive: { mutateAsync: vi.fn(), isPending: false },
    setContractValue: { mutateAsync: vi.fn(), isPending: false },
  },
  deliverySummaryState: {
    p1: { deliveryPct: 50, committedSpend: 2_100_000, budget: 4_700_000 },
  },
}));
vi.mock('@/src/hooks/useOrgCurrency', () => ({ useOrgCurrency: () => 'USD' }));
vi.mock('@/src/hooks/useCompanies', () => ({
  useCompanies: () => ({ data: [], isError: false }),
}));
vi.mock('@/src/hooks/useProjects', () => ({
  useProjects: () => projectsState,
  useClientCompanies: () => ({ data: [{ id: 'c2', name: 'Innovate Corp', type: 'Client' }] }),
  useProjectManagers: () => ({ data: [{ id: 'u-alice', full_name: 'Alice Manager' }] }),
  useProjectMutations: () => projectMutations,
  useProjectsMilestoneDates: () => ({ data: [], isPending: false }),
}));
vi.mock('@/src/auth/useAuth', () => ({
  useAuth: () => ({ currentUser: { id: 'u-alice', org_id: 'org-1' }, role: roleBox.value }),
}));
vi.mock('@/src/hooks/useMyTasks', () => ({ useMyTasks: () => ({ data: [] }) }));
vi.mock('@/src/hooks/useProjectsDelivery', () => ({
  useProjectsDelivery: () => ({ data: {} }),
  useProjectsDeliverySummary: () => ({ data: deliverySummaryState }),
}));
vi.mock('@/src/auth/impersonation', () => ({ useEffectiveRole: () => ({ effectiveRole: roleBox.value, realRole: roleBox.value, canImpersonate: false, viewAs: vi.fn() }) }));
vi.mock('@/src/hooks/useProjectTransitions', () => ({
  useProjectTransition: () => ({ mutate: vi.fn(), mutateAsync: vi.fn(), isError: false, error: null, isPending: false }),
  usePipelineStageConfig: () => ({ data: [], isSuccess: true }),
}));
const navigate = vi.fn();
vi.mock('react-router', async (orig) => {
  const actual = await (orig() as Promise<Record<string, unknown>>);
  return { ...actual, useNavigate: () => navigate };
});

const renderPage = () => {
  roleBox.value = 'Admin';
  return render(
    <MemoryRouter initialEntries={['/projects']}>
      <ToastProvider>
        <Projects />
      </ToastProvider>
    </MemoryRouter>,
  );
};

/** Fill a valid create form (name + client) and submit it. */
async function submitNewProject(name: string, client = 'Innovate Corp') {
  await userEvent.click(screen.getByRole('button', { name: /new project/i }));
  const dialog = screen.getByRole('dialog');
  await userEvent.type(within(dialog).getByLabelText(/project name/i), name);
  await userEvent.click(within(dialog).getByRole('combobox', { name: /client company/i }));
  const listbox = await screen.findByRole('listbox', { name: /compan/i });
  await userEvent.click(within(listbox).getByRole('option', { name: new RegExp(client, 'i') }));
  await userEvent.click(within(dialog).getByRole('button', { name: /^Create project$/i }));
  return dialog;
}

describe('Projects create navigation (AC-RAM-006)', () => {
  beforeEach(() => {
    sessionStorage.clear();
    projectsState.data = seed as unknown as ProjectWithRefs[];
    projectsState.isPending = false;
    projectsState.isError = false;
    navigate.mockClear();
    roleBox.value = 'Admin';
    projectMutations.create.mutateAsync.mockReset();
    projectMutations.create.isPending = false;
  });

  it('AC-RAM-006: a successful create names the project and opens its record', async () => {
    projectMutations.create.mutateAsync.mockResolvedValue({
      id: '9b1d0c2e-4f6a-4c3b-8d7e-000000000abc',
      name: 'New project',
      status: 'Leads',
    });
    renderPage();

    await submitNewProject('Harborside Terminal');

    // The success toast names the created record (goal oracle).
    const toast = await findToastAnnouncement('status', /Harborside Terminal/);
    expect(toast).toHaveTextContent(/Harborside Terminal/);
    // The app navigates to the newly created record's canonical route.
    await waitFor(() =>
      expect(navigate).toHaveBeenCalledWith(
        '/projects/9b1d0c2e-4f6a-4c3b-8d7e-000000000abc',
        expect.objectContaining({
          state: expect.objectContaining({
            pmoListReturn: expect.objectContaining({ list: 'projects' }),
          }),
        }),
      ),
    );
  });

  it('AC-RAM-006: when ERP linking needs a retry, the warning still names the created project', async () => {
    projectMutations.create.mutateAsync.mockResolvedValue({
      id: '9b1d0c2e-4f6a-4c3b-8d7e-000000000abd',
      name: 'New project',
      status: 'Leads',
      erpSetup: 'pending',
    });
    renderPage();

    await submitNewProject('Harborside Annex');

    const toast = await findToastAnnouncement('alert', /ERP linking needs attention/);
    expect(toast).toHaveTextContent(/ERP linking needs attention/);
    expect(toast).toHaveTextContent(/Harborside Annex/);
  });

  it('AC-RAM-006: a failed create stays on /projects with the modal open', async () => {
    projectMutations.create.mutateAsync.mockRejectedValue(new AppError('denied', '42501'));
    renderPage();

    const dialog = await submitNewProject('Blocked Project');

    // The dialog remains open — the failure does not navigate away or close the form.
    expect(dialog).toBeInTheDocument();
    expect(navigate).not.toHaveBeenCalled();
    expect(projectMutations.create.mutateAsync).toHaveBeenCalledTimes(1);
  });
});
// Project creation now requires a successful PMO number proposal; keep this
// journey focused on its original create/navigation or invalid-value outcome.
vi.mock('@/src/hooks/useProjectNumberProposal', () => ({
  useProjectNumberProposal: (clientId: string | null) => clientId
    ? { status: 'success', number: 'PMO-2026-TEST-0001', error: null }
    : { status: 'idle', number: null, error: null },
}));
