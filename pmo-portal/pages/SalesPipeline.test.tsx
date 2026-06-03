import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import React from 'react';
import SalesPipeline from './SalesPipeline';
import type { ProjectWithRefs } from '@/src/lib/db/projects';

/**
 * Fixture mixes funnel (Tender/PQ/Negotiation/Won-Pending) and non-funnel
 * (Ongoing/Loss Tender/Close Out) rows so the filter (AC-SP-001) and the
 * win-rate formula (AC-SP-005) are exercised against real distinctions.
 */
const r = (over: Partial<ProjectWithRefs>): ProjectWithRefs =>
  ({
    id: '40000000-0000-0000-0000-000000000000',
    org_id: 'org-1',
    code: null,
    name: 'X',
    status: 'Tender Submitted',
    client_id: 'c1',
    project_manager_id: 'u-alice',
    contract_value: 0,
    budget: 0,
    spent: 0,
    start_date: null,
    end_date: null,
    last_update: '2026-01-01T00:00:00Z',
    created_at: '2026-01-01T00:00:00Z',
    client: { name: 'Client Co' },
    pm: { full_name: 'Alice Manager' },
    ...over,
  }) as ProjectWithRefs;

const seed: ProjectWithRefs[] = [
  r({ id: 'f-tender', name: 'Northwind ERP Rollout', status: 'Tender Submitted', contract_value: 1_200_000 }),
  r({ id: 'f-pq', name: 'Regional Services Program', status: 'PQ Submitted', contract_value: 800_000 }),
  r({ id: 'f-nego', name: 'Bid In Negotiation', status: 'Negotiation', contract_value: 500_000 }),
  r({ id: 'f-won', name: 'Won Pending Mobilisation', status: 'Won, Pending KoM', contract_value: 2_000_000 }),
  // non-funnel:
  r({ id: 'n-ongoing', name: 'Innovate Corp HQ Fit-Out', status: 'Ongoing Project', contract_value: 5_000_000 }),
  r({ id: 'n-loss', name: 'Lost Bid', status: 'Loss Tender', contract_value: 0 }),
  r({ id: 'n-close', name: 'Closed Out Job', status: 'Close Out', contract_value: 0 }),
];

const projectsState = { data: seed, isPending: false, isError: false, refetch: vi.fn() };
vi.mock('@/src/hooks/useProjects', () => ({ useProjects: () => projectsState }));
vi.mock('@/src/auth/useAuth', () => ({
  useAuth: () => ({ currentUser: { id: 'u-alice', org_id: 'org-1' }, role: 'Project Manager' }),
}));
vi.mock('@/src/auth/impersonation', () => ({ useEffectiveRole: () => ({ effectiveRole: 'Project Manager' }) }));

const renderPage = () => render(<MemoryRouter><SalesPipeline /></MemoryRouter>);

describe('SalesPipeline (real data)', () => {
  it('AC-SP-001: funnel-stage projects appear; non-funnel projects do not', () => {
    projectsState.data = seed; projectsState.isPending = false; projectsState.isError = false;
    renderPage();
    expect(screen.getByText('Northwind ERP Rollout')).toBeInTheDocument(); // Tender (funnel)
    expect(screen.getByText('Won Pending Mobilisation')).toBeInTheDocument(); // Won-Pending (funnel tail)
    expect(screen.queryByText('Innovate Corp HQ Fit-Out')).not.toBeInTheDocument(); // Ongoing (excluded)
    expect(screen.queryByText('Closed Out Job')).not.toBeInTheDocument(); // Close Out (excluded)
  });

  it('AC-SP-002: Total Pipeline Value = sum of funnel contract_value', () => {
    renderPage();
    // 1.2M + 0.8M + 0.5M + 2.0M = 4.5M
    expect(screen.getByText('$4,500,000')).toBeInTheDocument();
  });

  it('AC-SP-003: Weighted Forecast = sum(contract_value × stage probability)', () => {
    renderPage();
    // 1.2M*0.6 + 0.8M*0.2 + 0.5M*0.8 + 2.0M*1.0 = 720k + 160k + 400k + 2,000k = 3,280,000
    expect(screen.getByText('$3,280,000')).toBeInTheDocument();
  });

  it('AC-SP-004: Active Deals excludes Won-Pending; avg size = active sum / active count', () => {
    renderPage();
    // active = Tender, PQ, Negotiation → count 3; avg = (1.2M+0.8M+0.5M)/3 = 833,333
    expect(screen.getByText('3')).toBeInTheDocument();
    expect(screen.getByText(/\$833,333/)).toBeInTheDocument();
  });

  it('AC-SP-005: historical win-rate = won/(won+lost)×100 over all projects', () => {
    renderPage();
    // won = {Won-Pending, Ongoing, Close Out} = 3; lost = {Loss Tender} = 1 → 3/4 = 75.0%
    expect(screen.getByText('75.0%')).toBeInTheDocument();
  });
});

describe('SalesPipeline states', () => {
  it('AC-SP-007: shows loading skeleton while pending', () => {
    projectsState.isPending = true; projectsState.isError = false;
    renderPage();
    expect(screen.getByTestId('sales-loading')).toBeInTheDocument();
    projectsState.isPending = false;
  });

  it('AC-SP-008: shows error state with retry on failure', () => {
    projectsState.isError = true; projectsState.isPending = false;
    renderPage();
    expect(screen.getByRole('button', { name: /Retry/i })).toBeInTheDocument();
    projectsState.isError = false;
    projectsState.data = seed;
  });
});
