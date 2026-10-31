import React from 'react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router';
import { ImpersonationProvider, useEffectiveRole } from '@/src/auth/impersonation';
import { AppError } from '@/src/lib/appError';

const h = vi.hoisted(() => ({
  getConnection: vi.fn(),
  setup: vi.fn(),
  connectIntegration: vi.fn(),
  disconnectIntegration: vi.fn(),
}));
vi.mock('@/src/auth/useAuth', () => ({ useAuth: () => ({ currentUser: { org_id: 'org-1' } }) }));
vi.mock('@/src/lib/repositories', () => ({
  repositories: { odoo: { getConnection: h.getConnection, setup: h.setup }, integrations: { connectIntegration: h.connectIntegration, disconnectIntegration: h.disconnectIntegration } },
}));

import { OdooConnectionCard } from './OdooConnectionCard';

const recent = () => new Date(Date.now() - 60_000).toISOString();
const connected = (over: Record<string, unknown> = {}) => ({
  status: 'active', activated: true,
  connection: { state: 'healthy', failures: 0, last_ok_at: recent(), last_checked_at: recent(), error_class: null, missing: [] },
  capabilities: { missing: [], version_major: 20 },
  config: { database: 'prod_db', odoo_company_name: 'PT Contoh', ...over },
  ...over,
});
const NONE = { status: 'disconnected', activated: false, connection: null, capabilities: null, config: {} };

function mount(role: string, read: unknown) {
  h.getConnection.mockResolvedValue(read);
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <ImpersonationProvider realRole={role as never}>
        <MemoryRouter><OdooConnectionCard /></MemoryRouter>
      </ImpersonationProvider>
    </QueryClientProvider>,
  );
}
beforeEach(() => { vi.clearAllMocks(); h.setup.mockResolvedValue({ ok: true }); });
afterEach(cleanup);

async function fillConnect(user: ReturnType<typeof userEvent.setup>, expiry?: string) {
  await user.click(await screen.findByRole('button', { name: 'Connect Odoo' }));
  await user.type(screen.getByLabelText(/Site URL/), 'https://odoo.example.test');
  await user.type(screen.getByLabelText(/Database/), 'prod_db');
  await user.type(screen.getByLabelText(/API key/), 'k-secret');
  if (expiry) fireEvent.change(screen.getByLabelText(/Key expires on/), { target: { value: expiry } });
}

it('FR-ODC-110 the key field is masked, and the Admin connect sends exactly the credential', async () => {
  const user = userEvent.setup();
  h.connectIntegration.mockResolvedValue({ ok: true, binding: { status: 'active' }, companies: [] });
  mount('Admin', NONE);
  await fillConnect(user, '2027-03-01');
  const key = screen.getByLabelText(/API key/);
  expect(key).toHaveAttribute('type', 'password');
  expect(key).toHaveAttribute('autocomplete', 'off');
});

it('FR-ODC-110 submit sends tier odoo with siteUrl, database, apiKey and expiry', async () => {
  const user = userEvent.setup();
  h.connectIntegration.mockResolvedValue({ ok: true, binding: { status: 'active' }, companies: [] });
  mount('Admin', NONE);
  await fillConnect(user, '2027-03-01');
  const dialog = screen.getByRole('dialog');
  await user.click(within(dialog).getByRole('button', { name: 'Connect Odoo' }));
  await waitFor(() => expect(h.connectIntegration).toHaveBeenCalled());
  expect(h.connectIntegration).toHaveBeenCalledWith('org-1', { tier: 'odoo', credential: { siteUrl: 'https://odoo.example.test', database: 'prod_db', apiKey: 'k-secret', keyExpiresOn: '2027-03-01' } });
});

it('FR-ODC-110 a rejected key shows its localised message and the key field is empty again', async () => {
  const user = userEvent.setup();
  h.connectIntegration.mockRejectedValue(new AppError('English line from server', 'key-rejected'));
  mount('Admin', NONE);
  await fillConnect(user);
  await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Connect Odoo' }));
  expect(await screen.findByText('Odoo rejected the API key. Check the key and try again.')).toBeInTheDocument();
  expect(screen.getByLabelText(/API key/)).toHaveValue('');
  expect(screen.queryByText('English line from server')).not.toBeInTheDocument();
});

it('FR-ODC-110 confirm-discard asks, and Confirm resubmits with confirmDiscard true', async () => {
  const user = userEvent.setup();
  h.connectIntegration.mockRejectedValueOnce(new AppError('x', 'confirm-discard')).mockResolvedValueOnce({ ok: true, binding: { status: 'active' } });
  mount('Admin', NONE);
  await fillConnect(user);
  await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Connect Odoo' }));
  const confirm = await screen.findByRole('alertdialog');
  expect(within(confirm).getByText(/discards what PMO mirrored/)).toBeInTheDocument();
  expect(screen.getByLabelText(/API key/)).toHaveValue('');
  await user.click(within(confirm).getByRole('button', { name: 'Discard and connect' }));
  await waitFor(() => expect(h.connectIntegration).toHaveBeenCalledTimes(2));
  expect(h.connectIntegration.mock.calls[1][1].credential).toMatchObject({ apiKey: 'k-secret', confirmDiscard: true });
});

it('FR-ODC-110 connected but not activated: one company is pre-selected and Activate sends its id', async () => {
  const user = userEvent.setup();
  h.setup.mockImplementation(async (verb: string) => (verb === 'list-companies' ? { companies: [{ id: 7, name: 'PT Contoh' }] } : { ok: true }));
  mount('Admin', { ...NONE, status: 'active' });
  expect(await screen.findByText('PT Contoh')).toBeInTheDocument();
  expect(screen.queryByRole('combobox')).not.toBeInTheDocument();
  await user.click(screen.getByRole('button', { name: 'Activate' }));
  await waitFor(() => expect(h.setup).toHaveBeenCalledWith('activate', { companyId: 7 }));
});

it('FR-ODC-110 two companies show a select and the chosen one is activated', async () => {
  const user = userEvent.setup();
  h.setup.mockImplementation(async (verb: string) => (verb === 'list-companies' ? { companies: [{ id: 7, name: 'PT A' }, { id: 9, name: 'PT B' }] } : { ok: true }));
  mount('Admin', { ...NONE, status: 'active' });
  const select = await screen.findByLabelText('Company');
  await user.selectOptions(select, '9');
  await user.click(screen.getByRole('button', { name: 'Activate' }));
  await waitFor(() => expect(h.setup).toHaveBeenCalledWith('activate', { companyId: 9 }));
});

it('FR-ODC-110 connected: state label, age, Re-check and Refresh now for Admin; Disconnect confirms first', async () => {
  const user = userEvent.setup();
  h.disconnectIntegration.mockResolvedValue({ ok: true });
  mount('Admin', connected());
  expect(await screen.findByText('Connected')).toBeInTheDocument();
  expect(screen.getByText(/Checked/)).toBeInTheDocument();
  expect(screen.getByText('PT Contoh')).toBeInTheDocument();
  await user.click(screen.getByRole('button', { name: 'Re-check' }));
  await waitFor(() => expect(h.setup).toHaveBeenCalledWith('recheck', {}));
  await user.click(screen.getByRole('button', { name: 'Refresh now' }));
  await waitFor(() => expect(h.setup).toHaveBeenCalledWith('refresh', {}));
  await user.click(screen.getByRole('button', { name: 'Disconnect Odoo' }));
  expect(h.disconnectIntegration).not.toHaveBeenCalled();
  await user.click(within(await screen.findByRole('alertdialog')).getByRole('button', { name: 'Disconnect' }));
  await waitFor(() => expect(h.disconnectIntegration).toHaveBeenCalledWith('org-1', 'odoo'));
});

it('FR-ODC-110 Finance sees the state and Refresh now only', async () => {
  mount('Finance', connected());
  expect(await screen.findByText('Connected')).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Refresh now' })).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Re-check' })).not.toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Disconnect Odoo' })).not.toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Connect Odoo' })).not.toBeInTheDocument();
});

it('FR-ODC-110 a stale healthy state shows "Not checked recently", never "Connected"', async () => {
  const old = new Date(Date.now() - 20 * 60_000).toISOString();
  mount('Admin', connected({ connection: { state: 'healthy', failures: 0, last_ok_at: old, last_checked_at: old, error_class: null, missing: [] } }));
  expect((await screen.findAllByText('Not checked recently')).length).toBeGreaterThan(0);
  expect(screen.queryByText('Connected')).not.toBeInTheDocument();
});

it('FR-ODC-110 only an Admin can start a connection; others see "Not connected" and no button', async () => {
  for (const role of ['Finance', 'Executive', 'Project Manager', 'Engineer']) {
    const { unmount } = mount(role, NONE);
    expect(await screen.findByText('Not connected')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Connect Odoo' })).not.toBeInTheDocument();
    unmount();
  }
});

function ViewAsEngineer({ children }: { children: React.ReactNode }) {
  const { viewAs } = useEffectiveRole();
  React.useEffect(() => { viewAs('Engineer'); }, [viewAs]);
  return <>{children}</>;
}

it('FR-ODC-110 an Admin viewing as Engineer (view-as) gets no write control', async () => {
  h.getConnection.mockResolvedValue(connected());
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={qc}>
      <ImpersonationProvider realRole="Admin" demoEligibility="eligible"><MemoryRouter><ViewAsEngineer><OdooConnectionCard /></ViewAsEngineer></MemoryRouter></ImpersonationProvider>
    </QueryClientProvider>,
  );
  expect(await screen.findByText('Connected')).toBeInTheDocument();
  for (const name of ['Re-check', 'Refresh now', 'Disconnect Odoo']) expect(screen.queryByRole('button', { name })).not.toBeInTheDocument();
});
