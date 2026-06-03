import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import React from 'react';
import Procurement from './Procurement';

const seed = [
  { id: 'pc1', code: 'PROC-2026-004', title: 'Workstations & AV', status: 'Vendor Quoted',
    total_value: 150000, project_id: 'pr1', requested_by_id: 'u-alice', vendor_id: null,
    created_at: '2026-02-05T00:00:00Z',
    project: { name: 'Innovate Corp HQ Fit-Out', code: 'PRJ-001' }, vendor: null,
    requested_by: { full_name: 'Alice Manager' } },
];

const procState = { data: seed, isPending: false, isError: false, refetch: vi.fn() };
vi.mock('@/src/hooks/useProcurements', () => ({ useProcurements: () => procState }));
vi.mock('@/src/auth/useAuth', () => ({
  useAuth: () => ({ currentUser: { id: 'u-alice', org_id: 'org-1' }, role: 'Project Manager' }),
}));
vi.mock('@/src/auth/impersonation', () => ({ useEffectiveRole: () => ({ effectiveRole: 'Project Manager' }) }));

const renderPage = () => render(<MemoryRouter><Procurement /></MemoryRouter>);

describe('Procurement (real data)', () => {
  it('renders seeded procurement with joined project name (AC-501)', async () => {
    renderPage();
    await userEvent.click(screen.getByRole('button', { name: /^All/ }));
    expect(screen.getByText('Workstations & AV')).toBeInTheDocument();
    expect(screen.getByText('Innovate Corp HQ Fit-Out')).toBeInTheDocument();
  });

  it('"My Requests" uses the real profile id (AC-502)', () => {
    renderPage(); // default tab is My Requests; u-alice is the requester
    expect(screen.getByText('Workstations & AV')).toBeInTheDocument();
  });

  it('Active Orders excludes the Vendor Quoted row (AC-503)', async () => {
    renderPage();
    await userEvent.click(screen.getByRole('button', { name: /Active Orders/ }));
    expect(screen.queryByText('Workstations & AV')).not.toBeInTheDocument();
    expect(screen.getByText(/No requests found/i)).toBeInTheDocument();
  });

  it('search filters real rows (AC-504)', async () => {
    renderPage();
    await userEvent.click(screen.getByRole('button', { name: /^All/ }));
    await userEvent.type(screen.getByPlaceholderText(/Search procurements/i), 'zzz');
    expect(screen.getByText(/No requests found/i)).toBeInTheDocument();
  });
});

describe('Procurement states', () => {
  it('loading skeleton while pending (AC-505)', () => {
    procState.isPending = true; procState.isError = false;
    renderPage();
    expect(screen.getByTestId('procurement-loading')).toBeInTheDocument();
    procState.isPending = false;
  });
  it('error state with retry (AC-507)', () => {
    procState.isError = true; procState.isPending = false;
    renderPage();
    expect(screen.getByRole('button', { name: /Retry/i })).toBeInTheDocument();
    procState.isError = false;
  });
  it('empty state when zero rows (AC-506)', async () => {
    procState.data = [];
    renderPage();
    expect(screen.getByText(/No requests found/i)).toBeInTheDocument();
    procState.data = seed;
  });
});
