import React from 'react';
import { beforeEach, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, useLocation } from 'react-router';
import { ToastProvider } from '@/src/components/ui';
import { ImpersonationProvider } from '@/src/auth/impersonation';
import SalesPipeline from '../SalesPipeline';

const { state } = vi.hoisted(() => ({ state: { data: { stages: [], projects: [
  { id: 'p1', name: 'Harbor Renewal — Eastern Terminal Opportunity', status: 'Leads', pmo_project_number: 'PMO-001', currency: 'USD', contract_value: 500000, win_probability: 0.1, service_line: 'Engineering', sector: 'Energy', location: 'Java' },
  { id: 'p2', name: 'Harbor Renewal — Western Terminal Opportunity', status: 'Leads', pmo_project_number: 'PMO-002', currency: 'USD', contract_value: 250000, win_probability: 0.1, service_line: 'Advisory', sector: 'Transport', location: 'Bali' },
] }, isPending: false, isError: false, refetch: vi.fn() } }));
vi.mock('@/src/hooks/useOrgCurrency', () => ({ useOrgCurrency: () => 'USD' }));
vi.mock('@/src/hooks/useDashboard', () => ({ useSalesPipeline: () => state, useLostDeals: () => ({ data: [] }) }));
vi.mock('@/src/hooks/useProjects', () => ({ useProjectMutations: () => ({ create: {} }) }));
vi.mock('@/src/auth/useAuth', () => ({ useAuth: () => ({ role: 'Project Manager', currentUser: { id: 'pm' } }) }));
function Probe() { const location = useLocation(); return <output data-testid="url">{location.search}</output>; }
function page(path = '/sales?view=kanban') {
  return render(<ImpersonationProvider realRole="Project Manager"><MemoryRouter initialEntries={[path]}><Probe /><ToastProvider><SalesPipeline /></ToastProvider></MemoryRouter></ImpersonationProvider>);
}
beforeEach(() => {
  sessionStorage.clear(); state.isPending = false; state.isError = false;
  vi.stubGlobal('matchMedia', vi.fn((media: string) => ({ matches: true, media, addEventListener: vi.fn(), removeEventListener: vi.fn() })));
});

it.each(['kanban', 'table'])('UIP-004 Pipeline %s starts with Classification collapsed, narrows the real rows and clears without changing search/view', async (view) => {
  page(`/sales?view=${view}&q=Harbor`);
  const user = userEvent.setup();
  const trigger = screen.getByRole('button', { name: /^Classification$/ });
  expect(trigger).toHaveAttribute('aria-expanded', 'false');
  expect(screen.queryByLabelText('Filter by service line')).not.toBeInTheDocument();
  await user.click(trigger);
  await user.selectOptions(screen.getByLabelText('Filter by service line'), 'Engineering');
  expect(screen.getByText(state.data.projects[0].name)).toBeVisible();
  expect(screen.queryByText(state.data.projects[1].name)).not.toBeInTheDocument();
  expect(screen.getByRole('button', { name: /^Classification\s*1/ })).toBeVisible();
  await user.keyboard('{Escape}');
  expect(screen.getByText('Service line: Engineering')).toBeVisible();
  await user.click(screen.getByRole('button', { name: 'Clear classifications' }));
  expect(screen.getByText(state.data.projects[1].name)).toBeVisible();
  expect(screen.getByTestId('url')).toHaveTextContent(`view=${view}`);
  expect(screen.getByTestId('url')).toHaveTextContent('q=Harbor');
});

it('UIP-004 URL-owned classification stays visible collapsed on arrival and zero-match recovery retains existing clear behavior', async () => {
  page('/sales?view=kanban&serviceLine=Engineering&location=Bali');
  expect(screen.getByRole('button', { name: /^Classification\s*2/ })).toHaveAttribute('aria-expanded', 'false');
  expect(screen.getByText('Location: Bali')).toBeVisible();
  expect(screen.getByText('No projects match these classifications')).toBeVisible();
  await userEvent.click(screen.getByRole('button', { name: 'Clear filters' }));
  await waitFor(() => expect(screen.getByText(state.data.projects[0].name)).toBeVisible());
});

it.each(['kanban', 'table'])('UIP-004 phone %s keeps a single search/view/core scope and expands classification in flow', async (view) => {
  vi.stubGlobal('matchMedia', vi.fn((media: string) => ({ matches: false, media, addEventListener: vi.fn(), removeEventListener: vi.fn() })));
  page(`/sales?view=${view}`);
  const user = userEvent.setup();
  expect(screen.getAllByRole('searchbox', { name: 'Search projects' })).toHaveLength(1);
  expect(screen.getAllByRole('tablist', { name: 'Pipeline view' })).toHaveLength(1);
  expect(screen.getByRole('button', { name: 'Export' })).toBeVisible();
  if (view === 'table') expect(screen.getByRole('tablist', { name: 'Project scope' })).toBeVisible();
  await user.click(screen.getByRole('button', { name: /^Classification$/ }));
  expect(screen.getByRole('region', { name: /^Classification$/ })).toBeVisible();
  await user.selectOptions(screen.getByLabelText('Filter by sector'), 'Energy');
  await user.keyboard('{Escape}');
  expect(screen.getByText('Sector: Energy')).toBeVisible();
  expect(screen.queryByText(state.data.projects[1].name)).not.toBeInTheDocument();
});

it.each(['loading', 'error'])('UIP-004 Pipeline preserves its explicit %s state', (kind) => {
  state.isPending = kind === 'loading'; state.isError = kind === 'error'; page();
  if (kind === 'loading') expect(screen.getAllByTestId('liststate-loading').length).toBeGreaterThan(0);
  else expect(screen.getByText("Couldn't load the sales pipeline")).toBeVisible();
});
