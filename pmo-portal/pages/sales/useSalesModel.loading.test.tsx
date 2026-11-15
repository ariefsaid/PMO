// AC-NBR-001 / AC-NBR-091: the open read alone gates the body + toolbar; Won / Lost carry their own status.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen } from '@testing-library/react';
import { renderWithQueryClient as render } from '@/test/renderWithQueryClient';
import { MemoryRouter } from 'react-router';
import SalesPipeline from '../SalesPipeline';
import { ImpersonationProvider } from '@/src/auth/impersonation';
import { ToastProvider } from '@/src/components/ui';

vi.mock('@/src/components/ui/useIsDesktop', () => ({ useIsDesktop: () => true }));
vi.mock('@/src/hooks/useOrgCurrency', () => ({ useOrgCurrency: () => 'USD' }));

const stages = [{ status: 'PQ Submitted', count: 1, total_value: 800000, win_probability: 0.25, weighted_value: 200000 }];
const projects = [{ id: 'p10', name: 'Regional Services', short_name: null, client_name: null, status: 'PQ Submitted', contract_value: 800000, currency: 'USD', win_probability: 0.25 }];
type Q = { data: unknown; isPending: boolean; isError: boolean; fetchStatus: string; refetch: () => void };
const mk = (over: Partial<Q>): Q => ({ data: [], isPending: false, isError: false, fetchStatus: 'idle', refetch: vi.fn(), ...over });
const reads = vi.hoisted(() => ({ open: null as unknown, won: null as unknown, lost: null as unknown }));
vi.mock('@/src/hooks/useDashboard', () => ({
  useSalesPipeline: () => reads.open,
  useWonDeals: () => reads.won,
  useLostDeals: () => reads.lost,
  useDashboard: () => ({ data: undefined, isPending: false, isError: false }),
  useWinRate: () => ({ data: undefined, isPending: false, isError: false }),
}));
vi.mock('@/src/auth/useAuth', () => ({ useAuth: () => ({ currentUser: { id: 'u1', org_id: 'org-1' }, role: 'Executive' }) }));
vi.mock('@/src/hooks/useProjects', () => ({
  useProjectMutations: () => ({ create: { mutateAsync: vi.fn(), isPending: false } }),
  useClientCompanies: () => ({ data: [] }),
  useProjectManagers: () => ({ data: [] }),
}));

const page = (path = '/sales') => render(
  <ImpersonationProvider realRole="Project Manager">
    <MemoryRouter initialEntries={[path]}><ToastProvider><SalesPipeline /></ToastProvider></MemoryRouter>
  </ImpersonationProvider>,
);

beforeEach(() => {
  reads.open = mk({ data: { stages, projects } });
  reads.won = mk({});
  reads.lost = mk({});
});

describe('AC-NBR-001 /sales per-region loading', () => {
  it('(P) won pending: open deals and toolbar render; only the Won count loads', () => {
    reads.won = mk({ data: undefined, isPending: true, fetchStatus: 'fetching' });
    page();
    expect(screen.getByText('Regional Services')).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: /Table/i })).toBeInTheDocument();
    expect(screen.getByRole('searchbox')).toBeInTheDocument();
    expect(screen.getByText(/Won — all time/)).toBeInTheDocument();
  });
  it('(P) won pending: the Won scope shows loading, not "No won projects"', () => {
    reads.won = mk({ data: undefined, isPending: true, fetchStatus: 'fetching' });
    page('/sales?view=table&scope=Won');
    expect(screen.getByRole('searchbox')).toBeInTheDocument();
    expect(screen.queryByText('No won projects')).not.toBeInTheDocument();
    expect(document.querySelector('[aria-busy="true"], [data-testid*="loading"]')).not.toBeNull();
  });
  it('(F) lost failed: open deals render and the Lost scope says it could not load', () => {
    reads.lost = mk({ data: undefined, isError: true });
    page('/sales?view=table&scope=Lost');
    expect(screen.getByText("Couldn't load lost projects")).toBeInTheDocument();
    expect(screen.getByRole('searchbox')).toBeInTheDocument();
  });
  it('(F) lost failed on the board: deals still render', () => {
    reads.lost = mk({ data: undefined, isError: true });
    page();
    expect(screen.getByText('Regional Services')).toBeInTheDocument();
    expect(screen.getByRole('searchbox')).toBeInTheDocument();
  });
  it('AC-NBR-091: nothing-here is not concluded while won is pending', () => {
    reads.open = mk({ data: { stages: [], projects: [] } });
    reads.won = mk({ data: undefined, isPending: true, fetchStatus: 'fetching' });
    page();
    expect(screen.getByRole('searchbox')).toBeInTheDocument();
    expect(screen.queryByText('No projects yet')).not.toBeInTheDocument();
  });
  it('AC-NBR-091: nothing-here concludes once all three settled empty', () => {
    reads.open = mk({ data: { stages: [], projects: [] } });
    page();
    expect(screen.getByText('No projects yet')).toBeInTheDocument();
  });
});
