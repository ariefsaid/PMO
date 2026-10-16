/**
 * AC-APR-034 — Administration › Spend approvers (#803). Admin-only writes, mirrored by
 * can('manage','orgAccounting'); UX only — the spend_approvers RLS is the authority (ADR-0016).
 * Idiom copied from OrgTaxDefault.test.tsx (react-query + repository seam mocked directly).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import React from 'react';
import type { Role } from '@/src/auth/AuthContext';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ToastProvider } from '@/src/components/ui';

const { listSpendApprovers, addSpendApprover, removeSpendApprover, listOrgProfiles } = vi.hoisted(() => ({
  listSpendApprovers: vi.fn(),
  addSpendApprover: vi.fn(),
  removeSpendApprover: vi.fn(),
  listOrgProfiles: vi.fn(),
}));

vi.mock('@/src/lib/repositories', () => ({
  repositories: {
    orgSettings: { listSpendApprovers, addSpendApprover, removeSpendApprover },
    profile: { listOrgProfiles },
  },
}));
vi.mock('@/src/auth/useAuth', () => ({
  useAuth: () => ({ currentUser: { id: 'u-admin', org_id: 'org-1' } }),
}));
let realRole: Role = 'Admin';
vi.mock('@/src/auth/impersonation', () => ({
  useEffectiveRole: () => ({ realRole, effectiveRole: realRole }),
}));
vi.mock('@/src/hooks/useFkOptions', () => ({
  useProjectOptions: () => ({ data: [{ value: 'p-1', label: 'HQ Fit-Out' }] }),
}));

import SpendApprovers from './SpendApprovers';

const renderPanel = (role: Role) => {
  realRole = role;
  return render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <ToastProvider>
        <SpendApprovers />
      </ToastProvider>
    </QueryClientProvider>,
  );
};

beforeEach(() => {
  listSpendApprovers.mockReset().mockResolvedValue([
    { id: 'sa-1', projectId: null, projectName: null, profileId: 'u-fin', fullName: 'Fiona Finance' },
    { id: 'sa-2', projectId: 'p-1', projectName: 'HQ Fit-Out', profileId: 'u-pm', fullName: 'Pat PM' },
  ]);
  addSpendApprover.mockReset().mockResolvedValue(undefined);
  removeSpendApprover.mockReset().mockResolvedValue(undefined);
  listOrgProfiles.mockReset().mockResolvedValue([
    { id: 'u-exec', full_name: 'Eve Exec', role: 'Executive', status: 'active' },
    { id: 'u-eng', full_name: 'Eli Eng', role: 'Engineer', status: 'active' },
    { id: 'u-gone', full_name: 'Gus Gone', role: 'Finance', status: 'disabled' },
  ]);
});

describe('AC-APR-034 Spend approvers admin card', () => {
  it('AC-APR-034: lists the senior set and the project approvers', async () => {
    renderPanel('Admin');
    expect(await screen.findByText('Fiona Finance')).toBeInTheDocument();
    expect(screen.getByText('Pat PM')).toBeInTheDocument();
    expect(screen.getByText('HQ Fit-Out')).toBeInTheDocument();
  });

  it('AC-APR-034: a non-Admin sees names but no add/remove controls', async () => {
    renderPanel('Finance');
    await screen.findByText('Fiona Finance');
    expect(screen.queryByRole('button', { name: /add overhead approver/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^remove/i })).not.toBeInTheDocument();
    expect(screen.getByText('Only an Admin can change this.')).toBeInTheDocument();
  });

  it('AC-APR-034: an Admin removes an approver through a confirm', async () => {
    renderPanel('Admin');
    await userEvent.click(await screen.findByRole('button', { name: 'Remove Fiona Finance' }));
    await userEvent.click(screen.getByRole('button', { name: 'Remove' }));
    await waitFor(() => expect(removeSpendApprover).toHaveBeenCalledWith('sa-1'));
  });

  it('AC-APR-034: an Admin adds an overhead approver; only active approval-rank people are offered', async () => {
    renderPanel('Admin');
    await userEvent.click(await screen.findByRole('button', { name: /add overhead approver/i }));
    const person = await screen.findByLabelText('Person');
    await waitFor(() =>
      expect(within(person).getAllByRole('option').map((o) => o.textContent)).toEqual([
        'Select a person…',
        'Eve Exec',
      ]),
    );
    await userEvent.selectOptions(person, 'u-exec');
    await userEvent.click(screen.getByRole('button', { name: 'Add' }));
    await waitFor(() => expect(addSpendApprover).toHaveBeenCalledWith('u-exec', null));
  });
});

describe('UX-081 resolved approval route (S-32)', () => {
  it('UX-081: no explicit list names the fallback roles and the people who hold them now', async () => {
    listSpendApprovers.mockResolvedValue([]);
    listOrgProfiles.mockResolvedValue([
      { id: 'u-exec', full_name: 'Eve Exec', role: 'Executive', status: 'active' },
      { id: 'u-fin', full_name: 'Fay Fin', role: 'Finance', status: 'active' },
      { id: 'u-eng', full_name: 'Eli Eng', role: 'Engineer', status: 'active' },
      { id: 'u-gone', full_name: 'Gus Gone', role: 'Finance', status: 'disabled' },
    ]);
    renderPanel('Admin');
    const route = await screen.findByTestId('spend-route-org');
    expect(route).toHaveTextContent('Admin, Executive, Project Manager or Finance');
    await waitFor(() => expect(route).toHaveTextContent('Eve Exec'));
    expect(route).toHaveTextContent('Fay Fin');
    expect(route).not.toHaveTextContent('Eli Eng');
    expect(route).not.toHaveTextContent('Gus Gone');
    // project section follows the role rules too when no overhead set exists
    expect(screen.getByTestId('spend-route-project')).toHaveTextContent('Admin, Executive, Project Manager or Finance');
  });

  it('UX-081: a configured list nobody on it can act on says only an Admin can decide', async () => {
    listSpendApprovers.mockResolvedValue([
      { id: 'sa-9', projectId: null, projectName: null, profileId: 'u-gone', fullName: 'Gus Gone' },
    ]);
    renderPanel('Admin');
    const route = await screen.findByTestId('spend-route-org');
    await waitFor(() => expect(route).toHaveTextContent('Only an Admin can decide'));
  });

  it('UX-081: a configured list whose eligibility cannot be checked says the route is unavailable', async () => {
    listOrgProfiles.mockRejectedValue(new Error('boom'));
    renderPanel('Admin');
    expect(await screen.findByTestId('spend-route-org')).toHaveTextContent("Couldn't verify who can approve right now.");
  });

  it('UX-081: a configured list with an eligible person shows no route note', async () => {
    // Fiona herself must be in the people list and eligible — otherwise the steady state is
    // the Admin note (DD-APR-4), and the absence below would only be a load race.
    listOrgProfiles.mockResolvedValue([
      { id: 'u-fin', full_name: 'Fiona Finance', role: 'Finance', status: 'active' },
      { id: 'u-eng', full_name: 'Eli Eng', role: 'Engineer', status: 'active' },
    ]);
    renderPanel('Admin');
    await screen.findByText('Fiona Finance');
    await waitFor(() => expect(listOrgProfiles).toHaveBeenCalled());
    expect(screen.queryByTestId('spend-route-org')).not.toBeInTheDocument();
  });

  it('UX-081: an empty list with the people list unavailable states the roles and does not name anyone', async () => {
    listSpendApprovers.mockResolvedValue([]);
    listOrgProfiles.mockRejectedValue(new Error('boom'));
    renderPanel('Admin');
    const route = await screen.findByTestId('spend-route-org');
    expect(route).toHaveTextContent('Admin, Executive, Project Manager or Finance');
    await waitFor(() => expect(route).toHaveTextContent("Couldn't check who holds these roles right now."));
  });

  it('UX-081: an empty project list over a configured senior set resolves both destinations', async () => {
    // FR-APR-013: within budget → the flat role rules, NOT the overhead set;
    // FR-APR-012: otherwise → the senior set.
    listSpendApprovers.mockResolvedValue([
      { id: 'sa-1', projectId: null, projectName: null, profileId: 'u-exec', fullName: 'Eve Exec' },
    ]);
    listOrgProfiles.mockResolvedValue([{ id: 'u-exec', full_name: 'Eve Exec', role: 'Executive', status: 'active' }]);
    renderPanel('Admin');
    const note = await screen.findByTestId('spend-route-project');
    expect(note).toHaveTextContent('Within budget, the standard rules apply');
    expect(note).toHaveTextContent('go to the overhead approvers');
  });

  it('UX-081: an empty project list with no eligible senior approver leaves decisions to an Admin (DD-APR-4)', async () => {
    listSpendApprovers.mockResolvedValue([
      { id: 'sa-1', projectId: null, projectName: null, profileId: 'u-gone', fullName: 'Gus Gone' },
    ]);
    listOrgProfiles.mockResolvedValue([{ id: 'u-gone', full_name: 'Gus Gone', role: 'Finance', status: 'disabled' }]);
    renderPanel('Admin');
    const note = await screen.findByTestId('spend-route-project');
    expect(note).toHaveTextContent('Only an Admin can decide');
    expect(note).not.toHaveTextContent('go to the overhead approvers');
  });

  it('UX-081: a project list nobody on it can act on escalates to a working senior set (FR-APR-014)', async () => {
    listSpendApprovers.mockResolvedValue([
      { id: 'sa-1', projectId: null, projectName: null, profileId: 'u-exec', fullName: 'Eve Exec' },
      { id: 'sa-2', projectId: 'p-1', projectName: 'HQ Fit-Out', profileId: 'u-gone', fullName: 'Gus Gone' },
    ]);
    listOrgProfiles.mockResolvedValue([
      { id: 'u-exec', full_name: 'Eve Exec', role: 'Executive', status: 'active' },
      { id: 'u-gone', full_name: 'Gus Gone', role: 'Finance', status: 'disabled' },
    ]);
    renderPanel('Admin');
    const note = await screen.findByTestId('spend-route-project');
    await waitFor(() => expect(note).toHaveTextContent('Nobody listed can approve right now'));
    expect(note).toHaveTextContent('go to the overhead approvers');
  });

  it('UX-081: dead project rows with no senior rows fall back to the flat role rules', async () => {
    listSpendApprovers.mockResolvedValue([
      { id: 'sa-2', projectId: 'p-1', projectName: 'HQ Fit-Out', profileId: 'u-gone', fullName: 'Gus Gone' },
    ]);
    listOrgProfiles.mockResolvedValue([{ id: 'u-gone', full_name: 'Gus Gone', role: 'Finance', status: 'disabled' }]);
    renderPanel('Admin');
    const note = await screen.findByTestId('spend-route-project');
    expect(note).toHaveTextContent('Standard rules: any of');
    expect(note).not.toHaveTextContent('Only an Admin can decide');
  });

  it('UX-081: dead project and senior sets leave only an Admin (DD-APR-4 cascade)', async () => {
    listSpendApprovers.mockResolvedValue([
      { id: 'sa-1', projectId: null, projectName: null, profileId: 'u-gone', fullName: 'Gus Gone' },
      { id: 'sa-2', projectId: 'p-1', projectName: 'HQ Fit-Out', profileId: 'u-gone', fullName: 'Gus Gone' },
    ]);
    listOrgProfiles.mockResolvedValue([{ id: 'u-gone', full_name: 'Gus Gone', role: 'Finance', status: 'disabled' }]);
    renderPanel('Admin');
    await waitFor(() => expect(screen.getByTestId('spend-route-org')).toHaveTextContent('Only an Admin can decide'));
    expect(screen.getByTestId('spend-route-project')).toHaveTextContent('Only an Admin can decide');
  });
});
