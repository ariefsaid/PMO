/**
 * #1599 ECX-4 (AC-ECX-030, UI half): a budget category with no direct-cost account is created from PMO, under an expense group the
 * Admin or Finance user picks. Nobody is sent into the ERP to do it.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { AppError } from '@/src/lib/appError';
import { useIsFetching, useQueryClient } from '@tanstack/react-query';

const repo = vi.hoisted(() => ({
  listAccountSendGroups: vi.fn(async () => [
    { erpName: 'Direct Expenses - EC', accountName: 'Direct Expenses', parentAccount: 'Expenses - EC' },
    { erpName: 'Indirect Expenses - EC', accountName: 'Indirect Expenses', parentAccount: 'Expenses - EC' },
  ]),
  getConnectStatus: vi.fn(async () => ({ waitingForSend: 1 })),
  requestAccountSend: vi.fn(async (_tier: string, _request: { category: string; parentAccount: string; accountName: string }) => ({ id: 'send-1' })),
  listConnectProposals: vi.fn(async (..._args: unknown[]) => ({ proposals: [] as Array<Record<string, unknown>>, nextAfterId: null as string | null })),
}));
vi.mock('@/src/lib/repositories', () => ({ repositories: { integrations: repo } }));

import { wrapWithRole } from './IntegrationsView.test-helpers';
import { AccountLinkNotes, DirectCostAccounts } from './DirectCostAccounts';
import { ErpSendStates } from './ErpSendStates';

const show = (role: string, categories = ['Labor', 'Equipment']) => wrapWithRole(role, <DirectCostAccounts categories={categories} />);
function ReconciliationProbe() {
  const pending = useIsFetching({ queryKey: ['integrations', 'account-request-reviews'] });
  return <span data-testid='reconciliation'>{pending ? 'fetching' : 'settled'}</span>;
}
const openDialog = async () => {
  fireEvent.click(screen.getByRole('button', { name: 'Create accounts' }));
  return screen.findByRole('dialog');
};

beforeEach(() => {
  repo.listAccountSendGroups.mockClear();
  repo.requestAccountSend.mockReset().mockResolvedValue({ id: 'send-1' });
  repo.getConnectStatus.mockReset().mockResolvedValue({ waitingForSend: 1 });
  repo.listConnectProposals.mockReset().mockResolvedValue({ proposals: [], nextAfterId: null });
});

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

  it('AC-ECX-030 retries only the category that failed after a partial acceptance', async () => {
    repo.requestAccountSend.mockResolvedValueOnce({ id: 'accepted' }).mockRejectedValueOnce(new Error('temporary'));
    show('Finance');
    const dialog = await openDialog();
    fireEvent.change(await within(dialog).findByLabelText(/^Expense group/), { target: { value: 'Direct Expenses - EC' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Create accounts' }));
    await within(dialog).findByText(/Equipment: PMO could not ask/);
    expect(within(dialog).queryByText(/nothing was saved/i)).toBeNull();
    expect(within(dialog).getByText('Requests accepted: Labor.')).toBeInTheDocument();
    await waitFor(() => expect(within(dialog).getByRole('button', { name: 'Create accounts' })).toBeEnabled());
    fireEvent.click(within(dialog).getByRole('button', { name: 'Create accounts' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(repo.requestAccountSend.mock.calls.map(([, request]) => request.category)).toEqual(['Labor', 'Equipment', 'Equipment']);
  });

  it('AC-ECX-030 preserves the accepted account name when reopening a partial request', async () => {
    repo.requestAccountSend.mockResolvedValueOnce({ id: 'accepted' }).mockRejectedValueOnce(new Error('temporary'));
    show('Finance');
    let dialog = await openDialog();
    fireEvent.change(await within(dialog).findByLabelText(/^Expense group/), { target: { value: 'Direct Expenses - EC' } });
    fireEvent.change(within(dialog).getByLabelText(/^Account name for Labor/), { target: { value: 'Site labour' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Create accounts' }));
    await within(dialog).findByText(/Equipment: PMO could not ask/);
    fireEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    // A dirty form asks for confirmation before closing.
    const discard = screen.queryByRole('button', { name: /discard/i });
    if (discard) fireEvent.click(discard);
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    dialog = await openDialog();
    expect(within(dialog).getByLabelText(/^Account name for Labor/)).toHaveValue('Site labour');
  });

  it.each([0, 1])('AC-ECX-030 allows a corrected request after rejection with %i sends still waiting', async (remaining) => {
    function SweepFinished() {
      const qc = useQueryClient();
      return <button onClick={() => qc.setQueryData(['integrations', 'connect-status', 'erpnext'], { waitingForSend: remaining })}>Sweep finished</button>;
    }
    repo.listConnectProposals.mockImplementation(async () => ({ proposals: [], nextAfterId: null }));
    wrapWithRole('Finance', <><DirectCostAccounts categories={['Labor']} /><SweepFinished /></>);
    let dialog = await openDialog();
    fireEvent.change(await within(dialog).findByLabelText(/^Expense group/), { target: { value: 'Direct Expenses - EC' } });
    fireEvent.change(within(dialog).getByLabelText(/^Account name for Labor/), { target: { value: 'Unsuitable account' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Create accounts' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    await waitFor(() => expect(repo.listConnectProposals).toHaveBeenCalled());
    repo.listConnectProposals.mockImplementation(async (...args: unknown[]) => ({ proposals: (args[4] ?? 'open') === 'open' ? [{ id: 'send-1', kind: 'account', outcome: 'review', state: 'open', reason: 'rejected', pmo_ids: ['Labor'], snapshot: { accountName: 'Unsuitable account' } }] : [], nextAfterId: null }));
    fireEvent.click(screen.getByRole('button', { name: 'Sweep finished' }));
    dialog = await openDialog();
    const name = within(dialog).getByLabelText(/^Account name for Labor/);
    await waitFor(() => expect(name).toBeEnabled());
    fireEvent.change(name, { target: { value: 'Corrected account' } });
    fireEvent.change(await within(dialog).findByLabelText(/^Expense group/), { target: { value: 'Direct Expenses - EC' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Create accounts' }));
    await waitFor(() => expect(repo.requestAccountSend).toHaveBeenCalledTimes(2));
    expect(repo.requestAccountSend.mock.calls[1][1]).toEqual({ category: 'Labor', parentAccount: 'Direct Expenses - EC', accountName: 'Corrected account' });
  });

  it('AC-ECX-030 finds a rejection on a later page of account reviews', async () => {
    repo.listConnectProposals.mockImplementation(async (...args: unknown[]) => (args[4] ?? 'open') !== 'open'
      ? { proposals: [], nextAfterId: null }
      : args[3] === null ? { proposals: [], nextAfterId: 'next-page' }
        : { proposals: [{ id: 'send-1', kind: 'account', outcome: 'review', state: 'open', reason: 'rejected', pmo_ids: ['Labor'], snapshot: {} }], nextAfterId: null });
    show('Finance', ['Labor']);
    let dialog = await openDialog();
    fireEvent.change(await within(dialog).findByLabelText(/^Expense group/), { target: { value: 'Direct Expenses - EC' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Create accounts' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    await waitFor(() => expect(repo.listConnectProposals).toHaveBeenCalledWith('erpnext', 'account', 'review', 'next-page'));
    dialog = await openDialog();
    await waitFor(() => expect(within(dialog).getByLabelText(/^Account name for Labor/)).toBeEnabled());
  });

  it('AC-ECX-030 permits correction even if a rejected review was dismissed', async () => {
    repo.listConnectProposals.mockImplementation(async (...args: unknown[]) => ({
      proposals: args[4] === 'dismissed' ? [{ id: 'send-1', kind: 'account', outcome: 'review', state: 'dismissed', reason: 'rejected', pmo_ids: ['Labor'], snapshot: {} }] : [],
      nextAfterId: null,
    }));
    show('Finance', ['Labor']);
    let dialog = await openDialog();
    fireEvent.change(await within(dialog).findByLabelText(/^Expense group/), { target: { value: 'Direct Expenses - EC' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Create accounts' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    dialog = await openDialog();
    await waitFor(() => expect(within(dialog).getByLabelText(/^Account name for Labor/)).toBeEnabled());
  });

  it('AC-ECX-030 keeps an unconfirmed held request locked to prevent another request', async () => {
    repo.listConnectProposals.mockImplementation(async (...args: unknown[]) => ({ proposals: (args[4] ?? 'open') === 'open' ? [{ id: 'send-1', kind: 'account', outcome: 'review', state: 'open', reason: 'held', pmo_ids: ['Labor'], snapshot: {} }] : [], nextAfterId: null }));
    show('Finance', ['Labor']);
    let dialog = await openDialog();
    fireEvent.change(await within(dialog).findByLabelText(/^Expense group/), { target: { value: 'Direct Expenses - EC' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Create accounts' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    await waitFor(() => expect(repo.listConnectProposals).toHaveBeenCalled());
    dialog = await openDialog();
    expect(within(dialog).getByLabelText(/^Account name for Labor/)).toBeDisabled();
    expect(within(dialog).getByRole('button', { name: 'Create accounts' })).toBeDisabled();
    expect(repo.requestAccountSend).toHaveBeenCalledTimes(1);
  });

  it.each(['sending', 'held', 'dismissed-held'] as const)('AC-ECX-030 keeps a category locked when another session has an outstanding %s request', async (otherState) => {
    function RefreshStatus() {
      const qc = useQueryClient();
      return <button onClick={() => qc.setQueryData(['integrations', 'connect-status', 'erpnext'], { waitingForSend: otherState === 'sending' ? 1 : 0 })}>Refresh status</button>;
    }
    const first = wrapWithRole('Finance', <><DirectCostAccounts categories={['Labor']} /><RefreshStatus /><ReconciliationProbe /></>);
    let dialog = await openDialog();
    fireEvent.change(await within(dialog).findByLabelText(/^Expense group/), { target: { value: 'Direct Expenses - EC' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Create accounts' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    await waitFor(() => expect(repo.listConnectProposals).toHaveBeenCalled());
    // The shared source now reports A rejected, and a separate Admin session submits the correction.
    repo.listConnectProposals.mockImplementation(async (...args: unknown[]) => ({
      proposals: (args[4] ?? 'open') === 'open' ? [{ id: 'send-1', kind: 'account', outcome: 'review', state: 'open', reason: 'rejected', pmo_ids: ['Labor'], snapshot: {} }] : [],
      nextAfterId: null,
    }));
    repo.requestAccountSend.mockResolvedValueOnce({ id: 'send-2' });
    const second = wrapWithRole('Admin', <DirectCostAccounts categories={['Labor']} />);
    fireEvent.click(within(second.container).getByRole('button', { name: 'Create accounts' }));
    const otherDialog = await screen.findByRole('dialog');
    await waitFor(() => expect(otherDialog.querySelector('select option[value="Direct Expenses - EC"]')).toBeInTheDocument());
    fireEvent.change(otherDialog.querySelector('select')!, { target: { value: 'Direct Expenses - EC' } });
    fireEvent.change(within(otherDialog).getByLabelText(/^Account name for Labor/), { target: { value: 'Corrected by another administrator' } });
    fireEvent.click(within(otherDialog).getByRole('button', { name: 'Create accounts' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(repo.requestAccountSend).toHaveBeenCalledTimes(2);
    repo.listConnectProposals.mockImplementation(async (...args: unknown[]) => {
      const state = args[4] ?? 'open';
      const rejected = { id: 'send-1', kind: 'account', outcome: 'review', state: 'dismissed', reason: 'rejected', pmo_ids: ['Labor'], snapshot: {} };
      const outstanding = { id: 'send-2', kind: 'account', outcome: otherState === 'sending' ? 'send' : 'review', state: otherState === 'sending' ? 'sending' : otherState === 'held' ? 'open' : 'dismissed', reason: otherState === 'sending' ? null : 'held', pmo_ids: ['Labor'], snapshot: {} };
      if (state === 'sending' && otherState === 'sending' && !args[3]) return { proposals: [], nextAfterId: 'next-page' };
      return { proposals: state === 'dismissed' ? [rejected, ...(outstanding.state === 'dismissed' ? [outstanding] : [])] : state === outstanding.state ? [outstanding] : [], nextAfterId: null };
    });
    repo.listConnectProposals.mockClear();
    await act(async () => { fireEvent.click(within(first.container).getByText('Refresh status')); });
    fireEvent.click(within(first.container).getByRole('button', { name: 'Create accounts' }));
    dialog = await screen.findByRole('dialog');
    if (otherState === 'sending') await waitFor(() => expect(repo.listConnectProposals).toHaveBeenCalledWith('erpnext', 'account', 'send', 'next-page', 'sending'));
    else await waitFor(() => expect(repo.listConnectProposals).toHaveBeenCalledWith('erpnext', 'account', 'send', null, 'sending'));
    await waitFor(() => expect(within(first.container).getByTestId('reconciliation')).toHaveTextContent('settled'));
    expect(within(dialog).getByLabelText(/^Account name for Labor/)).toBeDisabled();
    expect(within(dialog).getByRole('button', { name: 'Create accounts' })).toBeDisabled();
  });

  it.each(['unavailable', 'incomplete', 'incomplete-row'] as const)('AC-ECX-030 keeps the accepted category locked when the outstanding list is %s', async (failure) => {
    function RefreshStatus() {
      const qc = useQueryClient();
      return <button onClick={() => qc.setQueryData(['integrations', 'connect-status', 'erpnext'], { waitingForSend: 1 })}>Refresh status</button>;
    }
    wrapWithRole('Finance', <><DirectCostAccounts categories={['Labor']} /><RefreshStatus /><ReconciliationProbe /></>);
    let dialog = await openDialog();
    fireEvent.change(await within(dialog).findByLabelText(/^Expense group/), { target: { value: 'Direct Expenses - EC' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Create accounts' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    await waitFor(() => expect(repo.listConnectProposals).toHaveBeenCalled());
    repo.listConnectProposals.mockImplementation(async (...args: unknown[]) => ({
      proposals: args[4] === 'dismissed' ? [{ id: 'send-1', kind: 'account', outcome: 'review', state: 'dismissed', reason: 'rejected', pmo_ids: ['Labor'], snapshot: {} }] : [],
      nextAfterId: null,
    }));
    await act(async () => { fireEvent.click(screen.getByText('Refresh status')); });
    dialog = await openDialog();
    await waitFor(() => expect(within(dialog).getByLabelText(/^Account name for Labor/)).toBeEnabled());
    repo.listConnectProposals.mockClear();
    let releasePage!: () => void;
    const pagePending = new Promise<void>((resolve) => { releasePage = resolve; });
    repo.listConnectProposals.mockImplementation(async (...args: unknown[]) => {
      if (args[4] === 'sending') {
        if (args[3]) {
          await pagePending;
          if (failure === 'unavailable') throw new Error('page unavailable');
          if (failure === 'incomplete-row') return { proposals: [{ id: 'send-2', kind: 'account', state: 'sending', outcome: 'send' }], nextAfterId: null };
          return { proposals: [] } as unknown as { proposals: Array<Record<string, unknown>>; nextAfterId: string | null };
        }
        return { proposals: [], nextAfterId: 'next-page' };
      }
      return { proposals: args[4] === 'dismissed' ? [{ id: 'send-1', kind: 'account', outcome: 'review', state: 'dismissed', reason: 'rejected', pmo_ids: ['Labor'], snapshot: {} }] : [], nextAfterId: null };
    });
    await act(async () => { fireEvent.click(screen.getByText('Refresh status')); });
    await waitFor(() => expect(repo.listConnectProposals).toHaveBeenCalledWith('erpnext', 'account', 'send', 'next-page', 'sending'));
    expect(within(dialog).getByLabelText(/^Account name for Labor/)).toBeEnabled();
    expect(within(dialog).getByRole('button', { name: 'Create accounts' })).toBeDisabled();
    await act(async () => { releasePage(); });
    await waitFor(() => expect(screen.getByTestId('reconciliation')).toHaveTextContent('settled'));
    expect(within(dialog).getByLabelText(/^Account name for Labor/)).toBeDisabled();
  });

  it('AC-ECX-030 keeps a correction focused during a pending refresh while submission waits', async () => {
    function RefreshStatus() {
      const pending = useIsFetching({ queryKey: ['integrations', 'connect-status', 'erpnext'] });
      return <span data-testid='status-pending'>{pending}</span>;
    }
    repo.listConnectProposals.mockImplementation(async (...args: unknown[]) => ({
      proposals: (args[4] ?? 'open') === 'open' ? [{ id: 'send-1', kind: 'account', outcome: 'review', state: 'open', reason: 'rejected', pmo_ids: ['Labor'], snapshot: {} }] : [], nextAfterId: null,
    }));
    wrapWithRole('Finance', <><DirectCostAccounts categories={['Labor']} /><RefreshStatus /></>);
    let dialog = await openDialog();
    fireEvent.change(await within(dialog).findByLabelText(/^Expense group/), { target: { value: 'Direct Expenses - EC' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Create accounts' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    dialog = await openDialog();
    const name = within(dialog).getByLabelText(/^Account name for Labor/);
    await waitFor(() => expect(name).toBeEnabled());
    fireEvent.change(within(dialog).getByLabelText(/^Expense group/), { target: { value: 'Direct Expenses - EC' } });
    let release!: () => void;
    repo.getConnectStatus.mockImplementationOnce(() => new Promise((resolve) => { release = () => resolve({ waitingForSend: 0 }); }));
    name.focus();
    await waitFor(() => expect(screen.getByTestId('status-pending')).toHaveTextContent('1'), { timeout: 15000 });
    expect(name).toBeEnabled();
    expect(name).toHaveFocus();
    fireEvent.change(name, { target: { value: 'Corrected name' } });
    expect(within(dialog).getByRole('button', { name: 'Create accounts' })).toBeDisabled();
    await act(async () => { release(); });
    await waitFor(() => expect(within(dialog).getByRole('button', { name: 'Create accounts' })).toBeEnabled());
    expect(name).toHaveValue('Corrected name');
    expect(name).toHaveFocus();
  }, 20000);

  it.each(['sending', 'held', 'unresolved'] as const)('AC-ECX-030 refreshes an open correction when another session has a %s request', async (otherState) => {
    let phase: 'sending-a' | 'rejected-a' | 'sending-b' = 'sending-a';
    repo.getConnectStatus.mockImplementation(async () => ({ waitingForSend: phase === 'rejected-a' || (phase === 'sending-b' && otherState !== 'sending') ? 0 : 1 }));
    repo.requestAccountSend.mockImplementation(async () => {
      if (phase === 'rejected-a') { phase = 'sending-b'; return { id: 'send-2' }; }
      return { id: 'send-1' };
    });
    repo.listConnectProposals.mockImplementation(async (...args: unknown[]) => {
      const state = args[4] ?? 'open';
      const outcome = args[2];
      const rejected = { id: 'send-1', kind: 'account', outcome: 'review', state: 'open', reason: 'rejected', reason_text: 'Rejected', pmo_ids: ['Labor'], snapshot: {} };
      const outstanding = { id: 'send-2', kind: 'account', outcome: otherState === 'sending' ? 'send' : 'review', state: otherState === 'sending' ? 'sending' : 'open', reason: otherState === 'sending' ? null : otherState, pmo_ids: ['Labor'], snapshot: {} };
      return { proposals: [
        ...(outcome === 'review' && state === 'open' && phase !== 'sending-a' ? [rejected] : []),
        ...(phase === 'sending-b' && state === outstanding.state && outcome === outstanding.outcome ? [outstanding] : []),
      ], nextAfterId: null };
    });
    wrapWithRole('Finance', <><DirectCostAccounts categories={['Labor']} /><ErpSendStates enabled /></>);
    let dialog = await openDialog();
    fireEvent.change(await within(dialog).findByLabelText(/^Expense group/), { target: { value: 'Direct Expenses - EC' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Create accounts' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    phase = 'rejected-a';
    dialog = await openDialog();
    const name = within(dialog).getByLabelText(/^Account name for Labor/);
    await waitFor(() => expect(name).toBeEnabled());
    const second = wrapWithRole('Admin', <DirectCostAccounts categories={['Labor']} />);
    fireEvent.click(within(second.container).getByRole('button', { name: 'Create accounts' }));
    const otherDialog = await screen.findByRole('dialog');
    await waitFor(() => expect(otherDialog.querySelector('select option[value="Direct Expenses - EC"]')).toBeInTheDocument());
    fireEvent.change(otherDialog.querySelector('select')!, { target: { value: 'Direct Expenses - EC' } });
    fireEvent.click(within(otherDialog).getByRole('button', { name: 'Create accounts' }));
    await waitFor(() => expect(otherDialog).not.toBeInTheDocument());
    expect(dialog).toBeInTheDocument();
    await waitFor(() => expect(name).toBeDisabled(), { timeout: 15000 });
    expect(within(dialog).getByRole('button', { name: 'Create accounts' })).toBeDisabled();
    repo.getConnectStatus.mockReset().mockResolvedValue({ waitingForSend: 1 });
    repo.requestAccountSend.mockReset().mockResolvedValue({ id: 'send-1' });
  }, 20000);

  it.each([
    { page: 'sending', state: 'open', outcome: 'send', reason: null },
    { page: 'open', state: 'open', outcome: 'send', reason: null },
    { page: 'sending', state: 'sending', outcome: 'review', reason: null },
    { page: 'open', state: 'open', outcome: 'review', reason: 'unknown' },
  ])('AC-ECX-030 fails closed for inconsistent later request pages: $state / $outcome / $reason', async (bad) => {
    function RefreshStatus() {
      const qc = useQueryClient();
      return <button onClick={() => qc.setQueryData(['integrations', 'connect-status', 'erpnext'], { waitingForSend: 0 })}>Refresh status</button>;
    }
    let malformed = false;
    repo.listConnectProposals.mockImplementation(async (...args: unknown[]) => {
      const state = args[4] ?? 'open';
      const rejected = { id: 'send-1', kind: 'account', outcome: 'review', state: 'open', reason: 'rejected', pmo_ids: ['Labor'], snapshot: {} };
      if (state === bad.page && malformed) return args[3]
        ? { proposals: [{ id: 'send-2', kind: 'account', state: bad.state, outcome: bad.outcome, reason: bad.reason, pmo_ids: ['Labor'], snapshot: {} }], nextAfterId: null }
        : { proposals: state === 'open' ? [rejected] : [], nextAfterId: 'page-2' };
      return { proposals: state === 'open' ? [rejected] : [], nextAfterId: null };
    });
    wrapWithRole('Finance', <><DirectCostAccounts categories={['Labor']} /><RefreshStatus /><ReconciliationProbe /></>);
    let dialog = await openDialog();
    fireEvent.change(await within(dialog).findByLabelText(/^Expense group/), { target: { value: 'Direct Expenses - EC' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Create accounts' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    dialog = await openDialog();
    const name = within(dialog).getByLabelText(/^Account name for Labor/);
    await waitFor(() => expect(name).toBeEnabled());
    malformed = true;
    await act(async () => { fireEvent.click(screen.getByText('Refresh status')); });
    await waitFor(() => expect(repo.listConnectProposals).toHaveBeenCalledWith(...(bad.page === 'open' ? ['erpnext', 'account', 'review', 'page-2'] : ['erpnext', 'account', 'send', 'page-2', 'sending'])));
    await waitFor(() => expect(screen.getByTestId('reconciliation')).toHaveTextContent('settled'));
    expect(name).toBeDisabled();
    malformed = false;
    await act(async () => { fireEvent.click(screen.getByText('Refresh status')); });
    await waitFor(() => expect(name).toBeEnabled());
  });

  it('AC-ECX-030 group read failure offers a retry that loads groups', async () => {
    repo.listAccountSendGroups.mockRejectedValueOnce(new Error('offline'));
    show('Finance', ['Labor']);
    const dialog = await openDialog();
    expect(await within(dialog).findByText('Could not load expense groups. Try again.')).toBeInTheDocument();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Retry' }));
    await waitFor(() => expect(within(dialog).getByLabelText(/^Expense group/)).toBeEnabled());
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

  it('AC-ECX-030 when every request fails, the standard save-failed alert shows, the plain reason is said once per category, and nothing is saved', async () => {
    const reason = 'Choose an expense group of the connected company';
    repo.requestAccountSend.mockRejectedValue(new AppError(reason, 'BAD_REQUEST'));
    show('Finance');
    const dialog = await openDialog();
    fireEvent.change(await within(dialog).findByLabelText(/^Expense group/), { target: { value: 'Direct Expenses - EC' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Create accounts' }));
    const saveError = await within(dialog).findByTestId('entity-modal-save-error');
    expect(saveError).toHaveTextContent(/Nothing was saved/);
    expect(repo.requestAccountSend).toHaveBeenCalledTimes(2);
    // per-category result kept; the reason text is not repeated in the save-failed banner
    expect(within(dialog).getByText(`Labor: ${reason} Equipment: ${reason}`)).toBeInTheDocument();
    expect(within(saveError).queryByText(reason)).toBeNull();
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

  it('AC-ECX-031 keeps the account name and group distinct even when either contains the notice separator', async () => {
    repo.listConnectProposals.mockResolvedValueOnce({ proposals: [{ id: 'p3', kind: 'account', outcome: 'send', state: 'applied', reason_text: 'Materials already exists under Lab already exists under Indirect; linked there.', snapshot: { accountName: 'Materials' } }], nextAfterId: null });
    wrapWithRole('Finance', <AccountLinkNotes />);
    expect(await screen.findByText('Materials was already in the ERP under Lab already exists under Indirect, so PMO linked it there.')).toBeInTheDocument();
  });

  it('AC-ECX-031 includes a different-parent notice beyond the first page', async () => {
    repo.listConnectProposals.mockResolvedValueOnce({ proposals: [], nextAfterId: 'page-2' }).mockResolvedValueOnce({
      proposals: [{ id: 'p2', kind: 'account', outcome: 'send', state: 'applied', reason_text: 'Site labour already exists under Indirect Expenses - EC; linked there.', snapshot: {} }], nextAfterId: null,
    });
    wrapWithRole('Finance', <AccountLinkNotes />);
    expect(await screen.findByText('Site labour was already in the ERP under Indirect Expenses - EC, so PMO linked it there.')).toBeInTheDocument();
    expect(repo.listConnectProposals).toHaveBeenCalledWith('erpnext', 'account', 'send', 'page-2', 'applied');
  });

  it('AC-ECX-031 says nothing when no account was linked elsewhere', async () => {
    repo.listConnectProposals.mockResolvedValueOnce({ proposals: [], nextAfterId: null });
    const { container } = wrapWithRole('Finance', <AccountLinkNotes />);
    await waitFor(() => expect(repo.listConnectProposals).toHaveBeenCalled());
    expect(container.querySelector('[role="status"]')).toBeNull();
  });
});
