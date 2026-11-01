import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import React from 'react';

const h = vi.hoisted(() => ({ data: [] as unknown[], receipts: [] as unknown[], isPending: false, download: vi.fn(), userId: 'pm', role: 'Project Manager' }));
vi.mock('@/src/hooks/useExpenseClaims', () => ({
  useExpenseClaimsAwaitingDecision: () => ({ data: h.data, isPending: h.isPending, isError: false, refetch: vi.fn() }),
}));
vi.mock('@/src/hooks/useExpenseReceipts', () => ({
  useExpenseReceipts: () => ({
    list: { data: h.receipts, isPending: false, isError: false },
    download: h.download,
  }),
}));
vi.mock('@/src/auth/useAuth', () => ({ useAuth: () => ({ currentUser: { id: h.userId, org_id: 'org-1' } }) }));
vi.mock('@/src/auth/impersonation', () => ({ useEffectiveRole: () => ({ realRole: h.role, effectiveRole: h.role }) }));

import { ExpenseClaimApprovalSection } from './ExpenseClaimApprovalSection';
import { DocumentViewerProvider } from '@/src/components/documents';
import { formatCurrencyAuto } from '@/src/lib/format';

const item = (id: string, claimant: string, route: unknown) => ({
  claim: { id, claim_number: `EXP-${id}`, title: `Claim ${id}`, claimant_id: claimant, claimant: { full_name: 'X' }, amount: 100, currency: 'IDR', status: 'Submitted' },
  route,
});

describe('ExpenseClaimApprovalSection', () => {
  it('FR-IMP-073 a claim the server routes as an exception carries an Out of plan tag; an ordinary claim does not', () => {
    h.data = [
      item('exc', 'eng', { route: 'flat', approvers: [], isException: true }),
      item('ord', 'eng', { route: 'flat', approvers: [], isException: false }),
    ];
    render(<MemoryRouter><ExpenseClaimApprovalSection /></MemoryRouter>);
    expect(screen.getAllByText('Out of plan')).toHaveLength(1);
    expect(screen.getByText('Claim exc').closest('li')).toHaveTextContent('Out of plan');
    h.data = [];
  });

  it('FR-IMP-024 an out-of-plan claim waits for the senior approver, not the project approver', () => {
    h.data = [item('exc', 'eng', { route: 'org', approvers: [{ id: 'sen', fullName: 'Sam Senior' }], isException: true })];
    h.userId = 'pm';
    h.role = 'Project Manager';
    const { unmount } = render(<MemoryRouter><ExpenseClaimApprovalSection /></MemoryRouter>);
    expect(screen.queryByText('Claim exc')).toBeNull();
    unmount();
    h.userId = 'sen';
    h.role = 'Executive';
    render(<MemoryRouter><ExpenseClaimApprovalSection /></MemoryRouter>);
    expect(screen.getByText('Claim exc')).toBeInTheDocument();
    h.data = [];
    h.userId = 'pm';
    h.role = 'Project Manager';
  });

  it('shows loading instead of hiding the section while claims are pending', () => {
    h.isPending = true;
    render(<MemoryRouter><ExpenseClaimApprovalSection /></MemoryRouter>);
    expect(screen.getByTestId('liststate-loading')).toBeInTheDocument();
    h.isPending = false;
  });

  it('AC-UXS-005 wires approved claim evidence through the shared receipt preview', async () => {
    h.data = [item('evidence', 'eng', { route: 'flat', approvers: [] })];
    h.receipts = [{ id: 'file-1', file_path: 'claim/evidence/taxi-receipt.png' }];
    h.download.mockResolvedValue('https://signed.test/receipt.png');
    const user = userEvent.setup();
    render(<MemoryRouter><DocumentViewerProvider><ExpenseClaimApprovalSection /></DocumentViewerProvider></MemoryRouter>);

    await user.click(screen.getByRole('button', { name: /preview claim evidence/i }));
    expect(screen.getByTestId('decision-context-summary')).toHaveTextContent('EXP-evidence');
    await user.click(screen.getByRole('button', { name: /preview receipt/i }));
    expect(await screen.findByRole('dialog', { name: 'taxi-receipt.png' })).toBeInTheDocument();
    expect(h.download).toHaveBeenCalledWith('claim/evidence/taxi-receipt.png');
  });

  it('AC-EXP-064 lists only records awaiting the viewer, each linking to its page', () => {
    h.data = [
      item('1', 'pm', null),
      item('2', 'eng', { route: 'flat', approvers: [] }),
      item('3', 'eng', { route: 'project', approvers: [{ id: 'other', fullName: 'O' }] }),
      item('4', 'eng', { route: 'project', approvers: [{ id: 'pm', fullName: 'P' }] }),
    ];
    render(<MemoryRouter><ExpenseClaimApprovalSection /></MemoryRouter>);
    expect(screen.getByRole('link', { name: 'EXP-2' })).toHaveAttribute('href', '/expenses/2');
    expect(screen.getByRole('link', { name: 'EXP-4' })).toHaveAttribute('href', '/expenses/4');
    expect(screen.queryByRole('link', { name: 'EXP-1' })).toBeNull();
    expect(screen.queryByRole('link', { name: 'EXP-3' })).toBeNull();
  });
  it('AC-MONEY-DISPLAY rounds an approval card amount to whole currency units', () => {
    const row = item('money', 'eng', { route: 'flat', approvers: [] });
    row.claim.amount = 100.49;
    row.claim.currency = 'USD';
    h.data = [row];
    render(<MemoryRouter><ExpenseClaimApprovalSection /></MemoryRouter>);
    const claimItem = screen.getByRole('link', { name: 'EXP-money' }).closest('li')!;
    expect(claimItem).toHaveTextContent('$100');
    expect(claimItem).not.toHaveTextContent('$100.49');
  });
  it('AC-EXP-064 renders nothing when nothing awaits the viewer', () => {
    h.data = [item('1', 'pm', null)];
    const { container } = render(<MemoryRouter><ExpenseClaimApprovalSection /></MemoryRouter>);
    expect(container).toBeEmptyDOMElement();
  });
});

describe('#1635 float claim amounts use the float currency', () => {
  it('a claim charged to a float shows its amount in the float currency, an ordinary claim in the claim currency', () => {
    const floatClaim = item('fl', 'eng', null);
    Object.assign(floatClaim.claim, { imprest_float_id: 'f1', float: { currency: 'USD' }, amount: 100, currency: 'IDR' });
    h.data = [floatClaim, item('ord', 'eng', null)];
    h.userId = 'sen'; h.role = 'Executive';
    render(<MemoryRouter><ExpenseClaimApprovalSection /></MemoryRouter>);
    const text = (title: string) => (screen.getByText(title).closest('li')?.textContent ?? '').replace(/\s/g, ' ');
    const money = (n: number, c: string) => formatCurrencyAuto(n, c).replace(/\s/g, ' ');
    expect(text('Claim fl')).toContain(money(100, 'USD'));
    expect(text('Claim fl')).not.toContain(money(100, 'IDR'));
    expect(text('Claim ord')).toContain(money(100, 'IDR'));
    h.data = [];
  });
});
