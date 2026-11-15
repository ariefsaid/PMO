import { describe, expect, it } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { WaitsOnYou } from '../DashParts';

describe('WaitsOnYou rows', () => {
  it('each row reads as its count and what it counts, and opens the place where it is done', () => {
    render(
      <MemoryRouter>
        <WaitsOnYou rows={[
          { id: 'approvals', count: 14, label: 'approvals to review', href: '/approvals', tone: 'warn' },
          { id: 'late', count: 2, label: 'tasks overdue', href: '/my-tasks', tone: 'lost', detail: 'Oldest 9d' },
        ]} onRetry={() => {}} />
      </MemoryRouter>,
    );

    const block = screen.getByTestId('waits-on-you');
    expect(within(block).getByRole('link', { name: /14 approvals to review/ })).toHaveAttribute('href', '/approvals');
    expect(within(block).getByRole('link', { name: /2 tasks overdue\s*Oldest 9d/ })).toHaveAttribute('href', '/my-tasks');
  });

  it('the badge says it counts every item waiting in all, apart from the approvals link beside it', () => {
    render(
      <MemoryRouter>
        <WaitsOnYou count={10} linkCount={3} rows={[{ id: 'late', count: 7, label: 'client invoices overdue', href: '/finance/receivables?overdue=true', tone: 'lost' }]}
          actions={<a href="/approvals">All 3 approvals</a>} onRetry={() => {}} />
      </MemoryRouter>,
    );
    const badge = screen.getByTestId('waits-count');
    expect(badge).toHaveTextContent('10 items in all');
    expect(screen.getByRole('link', { name: 'All 3 approvals' })).toBeInTheDocument();
  });

  it('shows no badge when every item waiting is an approval the header link already counts', () => {
    render(
      <MemoryRouter>
        <WaitsOnYou count={3} linkCount={3} rows={[]} lead={<li>Safety Equipment &amp; PPE</li>}
          actions={<a href="/approvals">All 3 approvals</a>} onRetry={() => {}} />
      </MemoryRouter>,
    );
    expect(screen.queryByTestId('waits-count')).toBeNull();
    expect(screen.getByRole('link', { name: 'All 3 approvals' })).toBeInTheDocument();
  });
});
