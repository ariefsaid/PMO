/**
 * AC-TIER-012 — Administration › Spend approvers, amount tiers (#2695). UX only (ADR-0016): the
 * spend_approval_settings and spend_approvers RLS are the authority (supabase/tests/spend_approval_tiers.test.sql).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import React from 'react';
import type { Role } from '@/src/auth/AuthContext';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ToastProvider } from '@/src/components/ui';
import { toast as sonnerToast } from 'sonner';

const m = vi.hoisted(() => ({
  listSpendApprovers: vi.fn(),
  addSpendApprover: vi.fn(),
  removeSpendApprover: vi.fn(),
  getSpendApprovalTiersEnabled: vi.fn(),
  setSpendApprovalTiersEnabled: vi.fn(),
  listOrgProfiles: vi.fn(),
}));

vi.mock('@/src/lib/repositories', () => ({
  repositories: {
    orgSettings: {
      listSpendApprovers: m.listSpendApprovers,
      addSpendApprover: m.addSpendApprover,
      removeSpendApprover: m.removeSpendApprover,
      getSpendApprovalTiersEnabled: m.getSpendApprovalTiersEnabled,
      setSpendApprovalTiersEnabled: m.setSpendApprovalTiersEnabled,
    },
    profile: { listOrgProfiles: m.listOrgProfiles },
  },
}));
vi.mock('@/src/auth/useAuth', () => ({ useAuth: () => ({ currentUser: { id: 'u-admin', org_id: 'org-1' } }) }));
let realRole: Role = 'Admin';
vi.mock('@/src/auth/impersonation', () => ({ useEffectiveRole: () => ({ realRole, effectiveRole: realRole }) }));
vi.mock('@/src/hooks/useFkOptions', () => ({
  useProjectOptions: () => ({ data: [], isError: false, refetch: async () => undefined }),
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
  m.listSpendApprovers.mockReset().mockResolvedValue([
    { id: 'sa-1', projectId: null, projectName: null, profileId: 'u-fin', fullName: 'Fiona Finance' },
    { id: 'sa-2', projectId: null, projectName: null, profileId: 'u-exec', fullName: 'Eve Exec', minAmount: 100000 },
  ]);
  m.addSpendApprover.mockReset().mockResolvedValue(undefined);
  m.removeSpendApprover.mockReset().mockResolvedValue(undefined);
  m.getSpendApprovalTiersEnabled.mockReset().mockResolvedValue(false);
  m.setSpendApprovalTiersEnabled.mockReset().mockResolvedValue(undefined);
  m.listOrgProfiles.mockReset().mockResolvedValue([
    { id: 'u-exec', full_name: 'Eve Exec', role: 'Executive', status: 'active' },
  ]);
});
afterEach(() => {
  act(() => { sonnerToast.dismiss(); });
});

describe('AC-TIER-012 amount tiers on the spend approvers card', () => {
  it('AC-TIER-012: an Admin turns the approver-by-amount setting on', async () => {
    renderPanel('Admin');
    const box = await screen.findByRole('checkbox', { name: 'Choose the approver by amount' });
    await waitFor(() => expect(box).not.toBeDisabled());
    await userEvent.click(box);
    await waitFor(() => expect(m.setSpendApprovalTiersEnabled).toHaveBeenCalledWith(true));
  });

  it('AC-TIER-012: with tiers off, rows show no tier label', async () => {
    renderPanel('Admin');
    await screen.findByText('Fiona Finance');
    expect(screen.queryByTestId('spend-approver-tier')).not.toBeInTheDocument();
  });

  it('AC-TIER-012: with tiers on, each row names its tier', async () => {
    m.getSpendApprovalTiersEnabled.mockResolvedValue(true);
    renderPanel('Admin');
    await screen.findByText('Fiona Finance');
    await waitFor(() => expect(screen.getAllByTestId('spend-approver-tier')).toHaveLength(2));
    const labels = screen.getAllByTestId('spend-approver-tier').map((n) => n.textContent);
    expect(labels).toEqual(['Base tier', expect.stringMatching(/^From .*100.*000/)]);
  });

  it('AC-TIER-012: an Admin adds an approver with a from-amount', async () => {
    renderPanel('Admin');
    await userEvent.click(await screen.findByRole('button', { name: /add overhead approver/i }));
    await userEvent.selectOptions(await screen.findByLabelText('Person'), 'u-exec');
    await userEvent.type(screen.getByLabelText(/From amount/), '250000');
    await userEvent.click(screen.getByRole('button', { name: 'Add' }));
    await waitFor(() => expect(m.addSpendApprover).toHaveBeenCalledWith('u-exec', null, 250000));
  });

  it('AC-TIER-012: an empty from-amount adds the base tier (null)', async () => {
    renderPanel('Admin');
    await userEvent.click(await screen.findByRole('button', { name: /add overhead approver/i }));
    await userEvent.selectOptions(await screen.findByLabelText('Person'), 'u-exec');
    await userEvent.click(screen.getByRole('button', { name: 'Add' }));
    await waitFor(() => expect(m.addSpendApprover).toHaveBeenCalledWith('u-exec', null));
  });

  it('AC-TIER-012: a negative from-amount is refused before it is sent', async () => {
    renderPanel('Admin');
    await userEvent.click(await screen.findByRole('button', { name: /add overhead approver/i }));
    await userEvent.selectOptions(await screen.findByLabelText('Person'), 'u-exec');
    await userEvent.type(screen.getByLabelText(/From amount/), '-5');
    await userEvent.click(screen.getByRole('button', { name: 'Add' }));
    expect(await screen.findByText('Enter an amount of zero or more.')).toBeInTheDocument();
    expect(m.addSpendApprover).not.toHaveBeenCalled();
  });

  it('AC-TIER-012: a non-Admin sees no switch', async () => {
    renderPanel('Finance');
    await screen.findByText('Fiona Finance');
    expect(screen.queryByRole('checkbox', { name: 'Choose the approver by amount' })).not.toBeInTheDocument();
  });

  it('AC-TIER-012: the Bahasa Indonesia strings exist beside the English ones', async () => {
    const en = (await import('../../public/locales/en/administration.json')).default as { admin: { spendApprovers: { tiers: Record<string, string> } } };
    const id = (await import('../../public/locales/id/administration.json')).default as { admin: { spendApprovers: { tiers: Record<string, string> } } };
    expect(Object.keys(id.admin.spendApprovers.tiers).sort()).toEqual(Object.keys(en.admin.spendApprovers.tiers).sort());
  });
});
