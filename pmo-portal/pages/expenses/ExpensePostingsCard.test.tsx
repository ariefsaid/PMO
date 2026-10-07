/**
 * AC-EXP-131 — pages/expenses/ExpensePostingsCard.tsx (#775 phase B, FR-EXP-117): what this claim posted to
 * ERPNext. One row per intent (label, state text, ERP name, reason); nothing at all for a claim with no postings.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

const { listMock } = vi.hoisted(() => ({ listMock: vi.fn() }));
// ADR-0017: the card reads through the repository seam, never the DAL module directly.
vi.mock('@/src/lib/repositories', () => ({ repositories: { expensePostings: { listForClaim: listMock } } }));

import { ExpensePostingsCard } from './ExpensePostingsCard';

const renderCard = () => render(
  <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
    <ExpensePostingsCard claimId="claim-1" />
  </QueryClientProvider>,
);

beforeEach(() => listMock.mockReset());

describe('ExpensePostingsCard (AC-EXP-131)', () => {
  it('AC-EXP-131 lists each posting with its label, state text and ERP document', async () => {
    listMock.mockResolvedValue([
      { id: 'm1', posting: 'approval', pushState: 'pushed', pushError: null, erpName: 'ACC-JV-2026-00002', erpCancelledAt: null, createdAt: 't1' },
      { id: 'm2', posting: 'claim-payment', pushState: 'failed', pushError: 'employee-unlinked: no confirmed link', erpName: null, erpCancelledAt: null, createdAt: 't2' },
      { id: 'm3', posting: 'settlement', pushState: 'pending', pushError: null, erpName: null, erpCancelledAt: null, createdAt: 't3' },
      { id: 'm4', posting: 'advance-return', pushState: 'held', pushError: 'command-held', erpName: null, erpCancelledAt: null, createdAt: 't4' },
    ]);
    renderCard();
    expect(await screen.findByRole('heading', { name: 'Ledger postings' })).toBeInTheDocument();
    expect(listMock).toHaveBeenCalledWith('claim-1');
    expect(screen.getAllByRole('listitem')).toHaveLength(4);
    expect(screen.getByText('Approval journal')).toBeInTheDocument();
    expect(screen.getByText('Posted')).toBeInTheDocument();
    expect(screen.getByText('ACC-JV-2026-00002')).toBeInTheDocument();
    expect(screen.getByText('Cash payment')).toBeInTheDocument();
    expect(screen.getByText('Failed')).toBeInTheDocument();
    // The reason is a sentence for the reader, never the machine code it was recorded as.
    expect(screen.getByText('The claimant is not linked to an ERPNext employee yet.')).toBeInTheDocument();
    expect(screen.queryByText('employee-unlinked: no confirmed link')).toBeNull();
    expect(screen.getByText('Advance settlement')).toBeInTheDocument();
    expect(screen.getByText('Queued')).toBeInTheDocument();
    expect(screen.getByText('Cash returned')).toBeInTheDocument();
    expect(screen.getByText('Needs an operator')).toBeInTheDocument();
    expect(screen.getByText('PMO cannot tell what ERPNext recorded. An operator must check it.')).toBeInTheDocument();
  });

  it.each([
    ['expense-posting-actor-not-authorized', 'The person who approved or paid this can no longer post it.'],
    ['expense-posting-actor-inactive', 'The person who approved or paid this can no longer post it.'],
    ['expense-posting-claim-cancelled', 'The claim was cancelled before this was posted.'],
    ['expense-posting-precondition-failed', 'The claim changed after this posting was queued.'],
    ['expense-account-unmapped: map these accounts in Administration › Accounting: Meals', 'An expense account is not mapped yet (Administration › Accounting).'],
    ['expense-account-invalid: employee_payable: X is disabled', 'A mapped account is not valid in ERPNext.'],
    ['project-unmapped: the claim’s project is not linked', 'The claim’s project is not linked to an ERPNext project.'],
    ['expense-cash-account-unconfigured: none', 'The ERPNext connection has no cash or bank account.'],
    ['config-rejected: the claim is in USD', 'The ERPNext connection settings do not allow this posting.'],
    ['expense-approval-journal-cancelled: cancelled', 'The approval journal was cancelled in ERPNext.'],
    ['expense-posting-attempts-exhausted', 'PMO cannot tell what ERPNext recorded. An operator must check it.'],
    ['external-unreachable', 'ERPNext could not be reached. It is retried automatically.'],
    ['actor u-1 is not an active member of org o-1', 'The posting could not be completed. Admins were notified with the details.'],
  ])('AC-EXP-131 reason %s is shown as a translated sentence', async (pushError, sentence) => {
    listMock.mockResolvedValue([{ id: 'm1', posting: 'claim-payment', pushState: 'failed', pushError, erpName: null, erpCancelledAt: null, createdAt: 't1' }]);
    renderCard();
    expect(await screen.findByText(sentence)).toBeInTheDocument();
    expect(screen.queryByText(pushError)).toBeNull();
  });

  it('AC-EXP-131 a posting cancelled in ERPNext says so instead of its push state', async () => {
    listMock.mockResolvedValue([{ id: 'm1', posting: 'approval', pushState: 'pushed', pushError: null, erpName: 'ACC-JV-2026-00002',
      erpCancelledAt: '2026-10-08T00:00:00Z', createdAt: 't1' }]);
    renderCard();
    expect(await screen.findByText('Cancelled in ERPNext')).toBeInTheDocument();
    expect(screen.queryByText('Posted')).toBeNull();
  });

  it('AC-EXP-131 renders nothing when the claim has no postings', async () => {
    listMock.mockResolvedValue([]);
    const { container } = renderCard();
    await vi.waitFor(() => expect(listMock).toHaveBeenCalled());
    await new Promise((r) => setTimeout(r, 0));
    expect(container).toBeEmptyDOMElement();
  });

  it('AC-EXP-131 a failed read shows the error state and retries', async () => {
    listMock.mockRejectedValue(new Error('boom'));
    renderCard();
    expect(await screen.findByText("Couldn't load ledger postings")).toBeInTheDocument();
    listMock.mockResolvedValue([]);
    await userEvent.click(screen.getByRole('button', { name: 'Retry' }));
    await vi.waitFor(() => expect(listMock).toHaveBeenCalledTimes(2));
  });
});
