import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

const h = vi.hoisted(() => ({ listBindings: vi.fn(), matchProps: vi.fn() }));
vi.mock('@/src/lib/repositories', () => ({ repositories: { integrations: { listBindings: h.listBindings } } }));
vi.mock('@/src/auth/useAuth', () => ({ useAuth: () => ({ currentUser: { org_id: 'org-1' } }) }));
vi.mock('@/src/components/integrations/ProjectMatchReview', () => ({
  ProjectMatchReview: (p: unknown) => { h.matchProps(p); return <div>erpnext link</div>; },
}));
vi.mock('./ProjectOdooLink', () => ({ ProjectOdooLink: (p: { projectId: string; managerId: string | null }) => <div>odoo link {p.projectId} {p.managerId}</div> }));
import { ProjectErpLink } from './ProjectErpLink';

const mount = (client = new QueryClient()) => render(<QueryClientProvider client={client}><ProjectErpLink projectId="p-1" managerId="u-1" /></QueryClientProvider>);
beforeEach(() => { vi.clearAllMocks(); });
afterEach(cleanup);

it('FR-ODC-112 an org connected to Odoo gets the Odoo cost-account link, not the ERPNext match review', async () => {
  h.listBindings.mockResolvedValue([{ external_tier: 'odoo', status: 'active' }]);
  mount();
  expect(await screen.findByText('odoo link p-1 u-1')).toBeInTheDocument();
  expect(screen.queryByText('erpnext link')).not.toBeInTheDocument();
});

it('any other org keeps the ERPNext review, handed the binding already read', async () => {
  const erpnext = { external_tier: 'erpnext', status: 'active', config: {} };
  h.listBindings.mockResolvedValue([{ external_tier: 'odoo', status: 'disconnected' }, erpnext]);
  mount();
  expect(await screen.findByText('erpnext link')).toBeInTheDocument();
  expect(h.matchProps.mock.calls[0][0]).toMatchObject({ projectId: 'p-1', orgId: 'org-1', binding: erpnext });
});

it('one read decides it: no polling interval, and a second mount reuses the cache', async () => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  h.listBindings.mockResolvedValue([]);
  const client = new QueryClient();
  mount(client);
  await screen.findByText('erpnext link');
  await vi.advanceTimersByTimeAsync(180_000);
  cleanup();
  mount(client);
  await screen.findByText('erpnext link');
  expect(h.listBindings).toHaveBeenCalledTimes(1);
  expect(h.matchProps.mock.calls[0][0]).toMatchObject({ binding: null });
  vi.useRealTimers();
});
