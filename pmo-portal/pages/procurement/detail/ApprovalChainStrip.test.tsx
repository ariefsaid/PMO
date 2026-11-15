/** #2058 — the approval chain strip under the procurement record header. */
import { describe, expect, it } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import React from 'react';
import { ApprovalChainStrip } from './ApprovalChainStrip';
import type { ApprovalChainSource } from '@/src/lib/procurement/approvalChain';

const DAY = 86_400_000;
const ago = (days: number) => new Date(Date.now() - days * DAY).toISOString();

const requested: ApprovalChainSource = {
  status: 'Requested',
  created_at: ago(6),
  requested_by: { full_name: 'Rina Wati' },
  approved_by: null,
  approvalRoute: { approvers: [{ id: 'u1', fullName: 'Budi Santoso' }, { id: 'u2', fullName: 'Sari Dewi' }] },
  statusEvents: [{ to_status: 'Requested', created_at: ago(4), actor: { full_name: 'Rina Wati' } }],
};

describe('#2058 ApprovalChainStrip', () => {
  it('lists the requester, then who decides next and how long it has waited', () => {
    render(<ApprovalChainStrip procurement={requested} />);
    const chain = screen.getByRole('list', { name: 'Approval chain' });
    const [first, second] = within(chain).getAllByRole('listitem');
    expect(first).toHaveTextContent('Rina Wati');
    expect(first).toHaveTextContent('Requested');
    expect(second).toHaveTextContent('Budi Santoso or Sari Dewi');
    expect(second).toHaveTextContent('Next');
    expect(second).toHaveTextContent('Waiting 4 days');
  });

  it('marks each step done or waiting for assistive tech', () => {
    render(<ApprovalChainStrip procurement={requested} />);
    const [first, second] = screen.getAllByRole('listitem');
    expect(within(first).getByText('Done')).toBeInTheDocument();
    expect(within(second).getByText('Waiting')).toBeInTheDocument();
  });

  it('shows who approved once it is approved', () => {
    render(<ApprovalChainStrip procurement={{
      ...requested,
      status: 'Approved',
      approved_by: { full_name: 'Budi Santoso' },
      statusEvents: [...requested.statusEvents, { to_status: 'Approved', created_at: ago(1), actor: { full_name: 'Budi Santoso' } }],
    }} />);
    const [, second] = screen.getAllByRole('listitem');
    expect(second).toHaveTextContent('Budi Santoso');
    expect(second).toHaveTextContent('Approved');
    expect(second).not.toHaveTextContent('Waiting');
  });

  it('names an unrouted next step generically and a fresh wait as under a day', () => {
    render(<ApprovalChainStrip procurement={{
      ...requested,
      approvalRoute: null,
      statusEvents: [{ to_status: 'Requested', created_at: ago(0.1), actor: null }],
    }} />);
    const [, second] = screen.getAllByRole('listitem');
    expect(second).toHaveTextContent('An approver');
    expect(second).toHaveTextContent('Waiting under a day');
  });

  it('renders nothing before submission', () => {
    const { container } = render(<ApprovalChainStrip procurement={{ ...requested, status: 'Draft', statusEvents: [] }} />);
    expect(container).toBeEmptyDOMElement();
  });
});
