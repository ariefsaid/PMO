import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

const h = vi.hoisted(() => ({ rows: [] as unknown[] }));
vi.mock('@/src/auth/useAuth', () => ({ useAuth: () => ({ currentUser: { id: 'u', org_id: 'o' } }) }));
vi.mock('@/src/lib/repositories', () => ({ repositories: { workOrder: { listCandidateRecords: vi.fn(async () => h.rows) } } }));

import { CandidateRecords } from './CandidateRecords';

const renderIt = () => render(
  <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
    <MemoryRouter><CandidateRecords projectId="p1" /></MemoryRouter>
  </QueryClientProvider>,
);

describe('AC-WOC-005 earlier candidate work orders stay readable', () => {
  beforeEach(() => { h.rows = []; });
  it('shows each earlier candidate with its decision, reason and checks, read-only, and links an accepted one to its work order', async () => {
    h.rows = [
      { id: 'c1', title: 'Header scope', client_reference: 'REF-1', offered_on: '2026-11-20', status: 'accepted', decision_reason: 'All checks passed', work_order_id: 'wo-1', items: [{ label: 'Site check', status: 'passed', note: null }] },
      { id: 'c2', title: 'Deferred scope', client_reference: null, offered_on: '2026-11-21', status: 'rejected', decision_reason: 'Next shutdown', work_order_id: null, items: [] },
    ];
    renderIt();
    expect(await screen.findByText('Header scope')).toBeInTheDocument();
    expect(screen.getByText('Accepted')).toBeInTheDocument();
    expect(screen.getByText('All checks passed')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Open the work order' })).toHaveAttribute('href', '/work-orders/wo-1');
    expect(screen.getByText('Rejected')).toBeInTheDocument();
    expect(screen.queryByRole('button')).toBeNull();
  });
  it('renders nothing for a project with no earlier candidates', async () => {
    const { container } = renderIt();
    await new Promise((r) => setTimeout(r, 0));
    expect(container).toBeEmptyDOMElement();
  });
});
