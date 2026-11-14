import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import React from 'react';
import type { Role } from '@/src/auth/AuthContext';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ToastProvider } from '@/src/components/ui';
import { toast as sonnerToast } from 'sonner';

/**
 * Floor test for the spend-approvers add dialog in PROJECT mode
 * (floor-tests/admin-accounting.md 5): the overhead path is driven by SpendApprovers.test.tsx;
 * this drives the project + person pair through to the repository seam.
 */
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
const fk = vi.hoisted(() => ({
  projectOptions: {
    data: [{ value: 'p-1', label: 'HQ Fit-Out' }],
    isError: false,
    refetch: async () => undefined,
  } as {
    data: { value: string; label: string }[] | undefined;
    isError: boolean;
    refetch: () => Promise<void>;
  },
}));
vi.mock('@/src/hooks/useFkOptions', () => ({
  useProjectOptions: () => fk.projectOptions,
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
  fk.projectOptions = {
    data: [{ value: 'p-1', label: 'HQ Fit-Out' }],
    isError: false,
    refetch: async () => undefined,
  };
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

afterEach(() => {
  act(() => { sonnerToast.dismiss(); });
});

describe('Spend approvers — floor', () => {
  it('floor: Add project approver sends the chosen project and person (floor-tests/admin-accounting.md 5)', async () => {
    const user = userEvent.setup();
    renderPanel('Admin');

    await user.click(await screen.findByRole('button', { name: 'Add project approver' }));
    expect(await screen.findByRole('dialog', { name: 'Add a project approver' })).toBeInTheDocument();
    await user.click(screen.getByRole('combobox', { name: 'Project' }));
    await user.click(await screen.findByRole('option', { name: 'HQ Fit-Out' }));
    await user.selectOptions(await screen.findByLabelText('Person'), 'u-exec');
    await user.click(screen.getByRole('button', { name: 'Add' }));

    await waitFor(() => expect(addSpendApprover).toHaveBeenCalledWith('u-exec', 'p-1'));
  });
});
