import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import React from 'react';

const h = vi.hoisted(() => ({ data: [] as unknown[] }));
vi.mock('@/src/hooks/useExpenseClaims', () => ({
  useExpenseClaimsAwaitingDecision: () => ({ data: h.data, isPending: false, isError: false, refetch: vi.fn() }),
}));
vi.mock('@/src/auth/useAuth', () => ({ useAuth: () => ({ currentUser: { id: 'pm', org_id: 'org-1' } }) }));
vi.mock('@/src/auth/impersonation', () => ({ useEffectiveRole: () => ({ realRole: 'Project Manager', effectiveRole: 'Project Manager' }) }));

import { ExpenseClaimApprovalSection } from './ExpenseClaimApprovalSection';

const item = (id: string, claimant: string, route: unknown) => ({
  claim: { id, claim_number: `EXP-${id}`, title: `Claim ${id}`, claimant_id: claimant, claimant: { full_name: 'X' }, amount: 100, currency: 'IDR', status: 'Submitted' },
  route,
});

describe('ExpenseClaimApprovalSection', () => {
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
  it('AC-EXP-064 renders nothing when nothing awaits the viewer', () => {
    h.data = [item('1', 'pm', null)];
    const { container } = render(<MemoryRouter><ExpenseClaimApprovalSection /></MemoryRouter>);
    expect(container).toBeEmptyDOMElement();
  });
});
