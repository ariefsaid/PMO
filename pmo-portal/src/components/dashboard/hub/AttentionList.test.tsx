import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { AttentionList, type AttentionItem } from './AttentionList';

const items: AttentionItem[] = [
  {
    id: 'overdue-client-invoices',
    tone: 'lost',
    count: 3,
    label: 'Client invoices overdue',
    sub: 'Oldest is 38 days late',
    amount: 'Rp 412.000',
    href: '/sales-invoices?overdue=true',
  },
  {
    id: 'waiting-approvals',
    tone: 'warn',
    count: 5,
    label: 'Waiting for your approval',
    href: '/approvals',
  },
];

describe('AttentionList', () => {
  it('renders every attention row as one link with its count, label, and destination', () => {
    render(
      <MemoryRouter>
        <AttentionList items={items} title="Needs your attention" />
      </MemoryRouter>,
    );

    const invoices = screen.getByRole('link', { name: /3 client invoices overdue/i });
    const approvals = screen.getByRole('link', { name: /5 waiting for your approval/i });
    expect(invoices).toHaveAttribute('href', '/sales-invoices?overdue=true');
    expect(approvals).toHaveAttribute('href', '/approvals');
    expect(invoices).toHaveTextContent('Rp 412.000');
    expect(screen.getByRole('heading', { name: 'Needs your attention' })).toBeInTheDocument();
    expect(screen.getByText('2 items')).toBeInTheDocument();
  });

  it('N14: a row with a help tooltip lays out like a row without one (full width, chevron at the far right)', () => {
    render(
      <MemoryRouter>
        <AttentionList compact items={[
          { id: 'a', tone: 'lost', count: 1, label: 'budget running over', href: '/projects', tooltip: 'Over its recorded spend' },
          { id: 'b', tone: 'warn', count: 1, label: 'project at risk', href: '/projects?filter=at-risk' },
        ]}
        />
      </MemoryRouter>,
    );
    const withTooltip = screen.getByRole('link', { name: /budget running over/i });
    expect(withTooltip.parentElement).toHaveClass('flex', 'w-full');
    expect(withTooltip).toHaveClass('w-full');
  });

  it('renders nothing when there are no items', () => {
    const { container } = render(
      <MemoryRouter>
        <AttentionList items={[]} title="Needs your attention" />
      </MemoryRouter>,
    );

    expect(container).toBeEmptyDOMElement();
  });
});
