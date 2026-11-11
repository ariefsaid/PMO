import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router';

const h = vi.hoisted(() => ({ q: { data: undefined as unknown, isPending: false, isError: false, refetch: vi.fn() }, userId: 'u-fin', role: 'Finance' }));
vi.mock('@/src/hooks/useImprest', () => ({ useImprestAwaiting: () => h.q }));
vi.mock('@/src/auth/useAuth', () => ({ useAuth: () => ({ currentUser: { id: h.userId, org_id: 'org-1' } }) }));
vi.mock('@/src/auth/impersonation', () => ({ useEffectiveRole: () => ({ realRole: h.role, effectiveRole: h.role }) }));

import { ImprestApprovalSection } from './ImprestApprovalSection';

const float = { custodian_id: 'u-cust', currency: 'IDR', project: { name: 'Site Alpha' } };
const rep = (over: Record<string, unknown> = {}) => ({ id: 'r1', float_id: 'f1', number: 'REP-1', kind: 'replenishment', amount: 3500000, status: 'Requested', requested_by: 'u-cust', approved_by: null, float, ...over });
const plan = (over: Record<string, unknown> = {}) => ({ id: 'pl1', float_id: 'f1', month: '2026-11-01', status: 'Submitted', author_id: 'u-cust', total: 800000, float, ...over });
const renderIt = () => render(<MemoryRouter><ImprestApprovalSection /></MemoryRouter>);

describe('FR-IMP-073 site cash approvals', () => {
  beforeEach(() => { h.userId = 'u-fin'; h.role = 'Finance'; h.q = { data: { plans: [], replenishments: [] }, isPending: false, isError: false, refetch: vi.fn() }; });

  it('FR-IMP-073 a Finance user sees a Requested replenishment they may approve', () => {
    h.q.data = { plans: [], replenishments: [rep()] };
    renderIt();
    const link = screen.getByRole('link', { name: /REP-1/ });
    expect(link).toHaveAttribute('href', '/imprest/f1');
    expect(screen.getByText(/Site Alpha/)).toBeInTheDocument();
  });

  it('FR-IMP-073 the custodian does not see their own replenishment', () => {
    h.userId = 'u-cust';
    h.q.data = { plans: [], replenishments: [rep()] };
    const { container } = renderIt();
    expect(container).toBeEmptyDOMElement();
  });

  it('FR-IMP-073 an Approved replenishment shows only to someone who may pay it', () => {
    h.q.data = { plans: [], replenishments: [rep({ status: 'Approved', approved_by: 'u-fin' })] };
    const { container } = renderIt();
    expect(container).toBeEmptyDOMElement();
  });

  it('FR-IMP-073 a Submitted plan shows to an approver who is neither author nor custodian', () => {
    h.q.data = { plans: [plan()], replenishments: [] };
    renderIt();
    expect(screen.getByRole('link', { name: /2026-11/ })).toHaveAttribute('href', '/imprest/f1');
  });

  it('FR-IMP-073 an Engineer sees nothing', () => {
    h.role = 'Engineer';
    h.q.data = { plans: [plan()], replenishments: [rep()] };
    const { container } = renderIt();
    expect(container).toBeEmptyDOMElement();
  });

  it('FR-IMP-073 a failed read shows an error, never a false empty inbox', () => {
    h.q = { data: undefined, isPending: false, isError: true, refetch: vi.fn() };
    renderIt();
    expect(screen.getByText("Couldn't load site cash awaiting you")).toBeInTheDocument();
  });
});
