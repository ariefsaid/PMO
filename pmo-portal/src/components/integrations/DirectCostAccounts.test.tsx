/**
 * #1599 ECX-4 (AC-ECX-030, UI half): a budget category with no direct-cost account is created from PMO, under an expense group the
 * Admin or Finance user picks. Nobody is sent into the ERP to do it.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { AppError } from '@/src/lib/appError';

const repo = vi.hoisted(() => ({
  listAccountSendGroups: vi.fn(async () => [
    { erpName: 'Direct Expenses - EC', accountName: 'Direct Expenses', parentAccount: 'Expenses - EC' },
    { erpName: 'Indirect Expenses - EC', accountName: 'Indirect Expenses', parentAccount: 'Expenses - EC' },
  ]),
  requestAccountSend: vi.fn(async () => ({ id: 'send-1' })),
  listConnectProposals: vi.fn(async () => ({ proposals: [], nextAfterId: null })),
}));
vi.mock('@/src/lib/repositories', () => ({ repositories: { integrations: repo } }));

import { wrapWithRole } from './IntegrationsView.test-helpers';
import { AccountLinkNotes, DirectCostAccounts } from './DirectCostAccounts';

const show = (role: string, categories = ['Labor', 'Equipment']) => wrapWithRole(role, <DirectCostAccounts categories={categories} />);
const openDialog = async () => {
  fireEvent.click(screen.getByRole('button', { name: 'Create accounts' }));
  return screen.findByRole('dialog');
};

beforeEach(() => { repo.listAccountSendGroups.mockClear(); repo.requestAccountSend.mockClear(); });

describe('AC-ECX-030 DirectCostAccounts', () => {
  it('AC-ECX-030 Finance creates the missing accounts under the group they pick, one request per category, names trimmed', async () => {
    show('Finance');
    expect(screen.getByText('No direct-cost account for: Labor, Equipment')).toBeInTheDocument();
    expect(screen.queryByText(/accountant|in the ERP/i)).toBeNull();
    const dialog = await openDialog();
    const group = await within(dialog).findByLabelText(/^Expense group/);
    fireEvent.change(group, { target: { value: 'Indirect Expenses - EC' } });
    const labor = within(dialog).getByLabelText(/^Account name for Labor/);
    expect(labor).toHaveValue('Labor');
    fireEvent.change(labor, { target: { value: '  Site labour  ' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Create accounts' }));
    await waitFor(() => expect(repo.requestAccountSend).toHaveBeenCalledTimes(2));
    expect(repo.requestAccountSend.mock.calls).toEqual([
      ['erpnext', { category: 'Labor', parentAccount: 'Indirect Expenses - EC', accountName: 'Site labour' }],
      ['erpnext', { category: 'Equipment', parentAccount: 'Indirect Expenses - EC', accountName: 'Equipment' }],
    ]);
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  });

  it('AC-ECX-030 nothing is asked until a group is chosen and every name is filled in', async () => {
    show('Admin', ['Labor']);
    const dialog = await openDialog();
    await within(dialog).findByLabelText(/^Expense group/);
    const submit = within(dialog).getByRole('button', { name: 'Create accounts' });
    expect(submit).toBeDisabled();
    fireEvent.change(within(dialog).getByLabelText(/^Expense group/), { target: { value: 'Direct Expenses - EC' } });
    expect(submit).toBeEnabled();
    fireEvent.change(within(dialog).getByLabelText(/^Account name for Labor/), { target: { value: '   ' } });
    expect(submit).toBeDisabled();
    expect(repo.requestAccountSend).not.toHaveBeenCalled();
  });

  it('AC-ECX-030 a refusal is shown in its own plain words and the dialog stays open', async () => {
    repo.requestAccountSend.mockRejectedValueOnce(new AppError('Choose an expense group of the connected company', 'BAD_REQUEST'));
    show('Finance', ['Labor']);
    const dialog = await openDialog();
    fireEvent.change(await within(dialog).findByLabelText(/^Expense group/), { target: { value: 'Direct Expenses - EC' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Create accounts' }));
    expect(await within(dialog).findByText('Labor: Choose an expense group of the connected company')).toBeInTheDocument();
    expect(screen.getByRole('dialog')).toBeInTheDocument();
  });

  it('AC-ECX-030 with no expense group read yet, it says so and cannot submit', async () => {
    repo.listAccountSendGroups.mockResolvedValueOnce([]);
    show('Finance', ['Labor']);
    const dialog = await openDialog();
    expect(await within(dialog).findByText(/has not read the expense groups yet/)).toBeInTheDocument();
    expect(within(dialog).getByRole('button', { name: 'Create accounts' })).toBeDisabled();
  });

  it('AC-ECX-031 a role that cannot set up accounts sees the missing categories but no create action', () => {
    show('Project Manager');
    expect(screen.getByText('No direct-cost account for: Labor, Equipment')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Create accounts' })).toBeNull();
  });
});

describe('AC-ECX-031 AccountLinkNotes', () => {
  it('AC-ECX-031 an account linked under a different group says so on the screen, announced politely', async () => {
    repo.listConnectProposals.mockResolvedValueOnce({
      proposals: [
        { id: 'p1', kind: 'account', outcome: 'send', state: 'applied', reason_text: 'Site labour already exists under Indirect Expenses - EC; linked there.', snapshot: {} },
        { id: 'p2', kind: 'account', outcome: 'send', state: 'applied', reason_text: null, snapshot: {} },
      ],
      nextAfterId: null,
    });
    wrapWithRole('Finance', <AccountLinkNotes />);
    const note = await screen.findByText('Site labour was already in the ERP under Indirect Expenses - EC, so PMO linked it there.');
    expect(note.closest('[role="status"]')).not.toBeNull();
    expect(repo.listConnectProposals).toHaveBeenCalledWith('erpnext', 'account', 'send', null, 'applied');
    expect(screen.getAllByRole('listitem')).toHaveLength(1);
  });

  it('AC-ECX-031 says nothing when no account was linked elsewhere', async () => {
    repo.listConnectProposals.mockResolvedValueOnce({ proposals: [], nextAfterId: null });
    const { container } = wrapWithRole('Finance', <AccountLinkNotes />);
    await waitFor(() => expect(repo.listConnectProposals).toHaveBeenCalled());
    expect(container.querySelector('[role="status"]')).toBeNull();
  });
});
