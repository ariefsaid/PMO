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
