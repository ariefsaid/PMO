import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { NeedsYouList } from './NeedsYouList';
import type { NeedsItem } from './useNeedsYou';

const items: NeedsItem[] = [
  { id: 'approvals', count: 2, label: '2 approvals waiting for you', href: '/approvals', tone: 'warn' },
  { id: 'overdue', count: 1, label: '1 client invoice overdue', amount: 'USD 1,250', href: '/sales-invoices?overdue=true', tone: 'lost' },
];

const renderList = (props: Partial<React.ComponentProps<typeof NeedsYouList>> = {}) =>
  render(<MemoryRouter><NeedsYouList items={items} {...props} /></MemoryRouter>);

describe('NeedsYouList', () => {
  it('renders each need as one complete link with count, label, amount and tone text', () => {
    renderList();

    const approvals = screen.getByRole('link', { name: /2 approvals waiting for you/i });
    const overdue = screen.getByRole('link', { name: /1 client invoice overdue/i });
    expect(approvals).toHaveAttribute('href', '/approvals');
    expect(overdue).toHaveAttribute('href', '/sales-invoices?overdue=true');
    expect(overdue).toHaveTextContent('USD 1,250');
    expect(screen.getByText('Needs attention')).toBeInTheDocument();
    expect(screen.getByText('Overdue')).toBeInTheDocument();
  });

  it('uses one quiet sentence when nothing needs attention', () => {
    renderList({ items: [] });

    expect(screen.getByText('Nothing waiting for you')).toBeInTheDocument();
    expect(screen.queryByRole('img')).not.toBeInTheDocument();
  });

  it('shows a same-shape loading state and a retryable error state', () => {
    const { rerender } = render(<MemoryRouter><NeedsYouList items={items} isPending /></MemoryRouter>);
    expect(screen.getByTestId('needs-you-loading')).toHaveAttribute('aria-busy', 'true');

    const retry = vi.fn();
    rerender(<MemoryRouter><NeedsYouList items={items} isError onRetry={retry} /></MemoryRouter>);
    fireEvent.click(screen.getByRole('button', { name: /retry/i }));
    expect(retry).toHaveBeenCalledOnce();
  });
});
