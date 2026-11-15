import { describe, expect, it, vi, afterEach } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import React from 'react';
import { ApprovalChainStrip } from './ApprovalChainStrip';

afterEach(() => vi.useRealTimers());

describe('ApprovalChainStrip', () => {
  it('shows each step with who and its role: a done step with its date, the current one with how long it has waited', () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-11-09T12:00:00Z'));
    render(<ApprovalChainStrip steps={[
      { key: 'requested', role: 'requester', people: ['Budi Santoso'], state: 'done', at: '2026-11-04T08:00:00Z' },
      { key: 'approval', role: 'approver', people: ['Rina Kartika', 'Agus Wijaya', 'Sari Dewi'], state: 'current', at: '2026-11-04T08:00:00Z' },
    ]} />);
    const chain = screen.getByRole('list', { name: 'Approval steps' });
    const [done, current] = within(chain).getAllByRole('listitem').filter((li) => li.dataset.step);
    expect(done).toHaveAttribute('data-state', 'done');
    expect(within(done).getByRole('img', { name: 'Budi Santoso' })).toHaveTextContent('BS');
    expect(done).toHaveTextContent(/Requester/);
    expect(done).toHaveTextContent(/done/);
    expect(done).not.toHaveTextContent(/waiting/);
    expect(current).toHaveAttribute('data-state', 'current');
    expect(within(current).getByRole('img', { name: 'Rina Kartika' })).toHaveTextContent('RK');
    expect(current).toHaveTextContent('+1');
    expect(current).toHaveTextContent(/Approver/);
    expect(current).toHaveTextContent('waiting 5 days');
  });

  it('names "Any approver" when the route lists nobody in particular', () => {
    render(<ApprovalChainStrip steps={[{ key: 'approval', role: 'approver', people: [], state: 'current', at: new Date().toISOString() }]} />);
    expect(screen.getByRole('list', { name: 'Approval steps' })).toHaveTextContent(/Any approver.*waiting since today/);
  });

  it('renders nothing when the chain is unknown', () => {
    const { container } = render(<ApprovalChainStrip steps={null} />);
    expect(container).toBeEmptyDOMElement();
    expect(screen.queryByRole('list', { name: 'Approval steps' })).toBeNull();
  });
});
