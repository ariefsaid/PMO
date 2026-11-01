import { afterEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router';
import { axe } from 'jest-axe';
import { ImpersonationProvider } from '@/src/auth/impersonation';

const h = vi.hoisted(() => ({ getConnection: vi.fn(), setup: vi.fn() }));
vi.mock('@/src/auth/useAuth', () => ({ useAuth: () => ({ currentUser: { org_id: 'org-1' } }) }));
vi.mock('@/src/lib/repositories', () => ({ repositories: { odoo: h, integrations: {} } }));
import { OdooConnectionCard } from './OdooConnectionCard';

afterEach(cleanup);
const mount = () => render(
  <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
    <ImpersonationProvider realRole="Admin"><MemoryRouter><OdooConnectionCard /></MemoryRouter></ImpersonationProvider>
  </QueryClientProvider>,
);

it('AC-ODC-084 the connected card has no axe violations', async () => {
  const at = new Date(Date.now() - 20 * 60_000).toISOString();
  h.getConnection.mockResolvedValue({ status: 'active', activated: true, capabilities: { missing: [], version_major: 20 }, connection: { state: 'healthy', failures: 0, last_ok_at: at, last_checked_at: at, error_class: null, missing: [] }, config: { odoo_company_name: 'PT Contoh', database: 'db', key_expires_on: '2027-01-01' } });
  const { container } = mount();
  expect(await screen.findByText('PT Contoh')).toBeInTheDocument();
  expect((await axe(container)).violations).toEqual([]);
});

it('AC-ODC-084 the connect dialog has no axe violations and its fields are labelled', async () => {
  h.getConnection.mockResolvedValue({ status: 'disconnected', activated: false, capabilities: null, connection: null, config: {} });
  mount();
  fireEvent.click(await screen.findByRole('button', { name: 'Connect Odoo' }));
  const dialog = await screen.findByRole('dialog');
  for (const label of [/Site URL/, /Database/, /API key/, /Key expires on/]) expect(screen.getByLabelText(label)).toBeInTheDocument();
  expect((await axe(dialog)).violations).toEqual([]);
});
